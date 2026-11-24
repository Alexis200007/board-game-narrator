// Routes du serveur : fichiers de la page + API (Claude via le CLI, ElevenLabs via la clé du PC,
// profils de jeu dans data/).
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { errorMessageFor } from "../js/tts.js";
import { AMBIANCES } from "../js/claude.js";
import { newPartie, newGroupe } from "./store.mjs";
import { audioKey } from "./audio-cache.mjs";
import { RULES_EXTRACT_SYSTEM, rulesQuestionSystem, summarySystem, directSystem, livretPourQuestion, termesPourTranscription, aideSystem, AIDE_SCHEMA, versionLivret, nettoyerAide } from "./prompts.mjs";
import { LABELS } from "./prompts-en.mjs";
import { MODELE_VOIX, MODELE_RAPIDE } from "./eleven.mjs";
import { createConversations } from "./direct.mjs";
import { lireReferences, createFiltreReferences } from "./references.mjs";
import { fallbackVoiceFor } from "../js/voices.js";
import { extractPdfText, planLivret, ocrBatches } from "./livret-pdf.mjs";

const pagesLabel = (pages) => (pages.length === 1 ? `p. ${pages[0]}` : `p. ${pages[0]}–${pages.at(-1)}`);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};
// Seuls les fichiers de la page sont servis (jamais config, serveur, tests, docs, data).
const PUBLIC = /^(index\.html|styles\.css|manifest\.webmanifest|icon\.svg|icon-180\.png|js[\\/][\w-]+\.js)$/;

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function sendAudio(res, buf) {
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
  res.end(buf);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= maxBytes) chunks.push(c); // au-delà, on lit sans garder, pour pouvoir répondre 413
    });
    req.on("end", () => {
      if (size > maxBytes) reject(Object.assign(new Error("trop lourd"), { status: 413 }));
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}
async function readJson(req) {
  try { return JSON.parse((await readBody(req, 256 * 1024)).toString("utf8")); } catch { return {}; }
}

const statusOf = (err) => err?.statusCode ?? err?.status ?? 0;
const NO_TTS = "ElevenLabs n'est pas configuré sur l'ordinateur (.env.local).";
const NO_STORE = "Les profils de jeu ne sont pas disponibles.";
const textOf = (analyse) => analyse.segments.map((s) => (s.personnage ? `${s.personnage} : ${s.texte_fr}` : s.texte_fr)).join("\n");

/** Langue du téléphone qui demande. Glossaire, aide-mémoire, résumés et voix existent une fois par langue. */
const langueDe = (req) => (req.headers["x-langue"] === "en" ? "en" : "fr");
const champ = (nom, langue) => (langue === "en" ? `${nom}En` : nom);
const glossaireDe = (g, langue) => (g[champ("glossaire", langue)] ||= {});
const listeGlossaire = (g, langue) => Object.entries(glossaireDe(g, langue)).map(([en, fr]) => `- ${en} → ${fr}`).join("\n") || LABELS[langue].vide;

/** Vue légère d'un jeu pour la page : sans le texte complet du livret. */
function gameView(g, images = new Set(), langue = "fr") {
  const a = g[champ("aide", langue)];
  const aide = a ? { sections: a.sections, date: a.date, perime: a.version !== versionLivret(g.livret) } : null;
  const { aideEn, glossaireEn, ...base } = g;
  const groupes = g.groupes.map(({ personnagesEn, ...gr }) => ({
    ...gr,
    personnages: langue === "en" ? personnagesEn || {} : gr.personnages,
    parties: gr.parties.map(({ resumeEn, ...p }) => ({ ...p, resume: langue === "en" ? resumeEn ?? null : p.resume })),
  }));
  return { ...base, groupes, glossaire: glossaireDe(g, langue), aide, livret: g.livret.map(({ id, titre, texte, source }) => ({ id, titre, longueur: texte.length, ...(source ? { source } : {}), images: images.has(source || id) })) };
}
// Groupe demandé (ou le premier) ; partie demandée dans ce groupe (ou la dernière).
const findGroupe = (g, id) => g.groupes.find((x) => x.id === id) || g.groupes[0];
const findPartie = (groupe, id) => groupe.parties.find((p) => p.id === id) || groupe.parties.at(-1);

export function createHandler({ root, runClaude, runTask, tts = null, store = null, audioCache = null, conversations = createConversations(), images = null, claude = "cli", maxBytes = 8 * 1024 * 1024 }) {
  let queue = Promise.resolve(); // une seule tâche Claude à la fois
  const travaux = new Map(); // lectures de livrets PDF en cours : id → { id, jeu, titre, total, faites, etat, erreur }

  const aides = new Map(); // aide-mémoire en préparation : jeu → { etat, erreur }

  /** Prépare l'aide-mémoire en arrière-plan, hors de la file : les cartes n'attendent pas. */
  async function preparerAide(jeu, suivi, model, langue) {
    try {
      const L = LABELS[langue], glossaire = listeGlossaire(jeu, langue);
      const r = await runTask({
        content: [{ type: "text", text: `${L.jeu} : ${jeu.nom}\n\n${L.livret} :\n${livretPourQuestion(jeu.livret, langue)}\n\n${L.glossaire} :\n${glossaire}\n\n${L.preparer}` }],
        system: aideSystem(langue), schema: AIDE_SCHEMA, expect: "json", model, effort: "medium", timeoutMs: 420_000,
      });
      if (!r.ok) throw new Error(r.erreur);
      const sections = nettoyerAide(r.data);
      if (!sections) throw new Error("L'aide-mémoire reçu est vide. Réessaie.");
      await store.update(jeu.id, (j) => { j[champ("aide", langue)] = { sections, date: new Date().toISOString(), version: versionLivret(jeu.livret) }; return j; });
      suivi.etat = "fini";
    } catch (err) {
      suivi.etat = "erreur";
      suivi.erreur = err.message || "L'aide-mémoire n'a pas pu être préparé.";
    }
  }

  /** Lit un livret PDF en arrière-plan : texte lu sur place, pages sans texte confiées à Claude. */
  async function lireLivretPdf(travail, pdf, pages, model) {
    const { textChunks, ocrPages } = planLivret(pages);
    const ajout = (morceaux) => store.update(travail.jeu, (j) => {
      for (const m of morceaux) j.livret.push({ id: randomUUID().slice(0, 8), titre: `${travail.titre}, ${pagesLabel(m.pages)}`, texte: m.texte, source: travail.id, debut: m.pages[0] });
      return j;
    });
    try {
      if (textChunks.length) await ajout(textChunks);
      travail.faites = textChunks.reduce((n, c) => n + c.pages.length, 0);
      for (const lot of await ocrBatches(pdf, ocrPages)) {
        const r = await enqueue(() => runTask({
          content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: lot.pdf.toString("base64") } },
            { type: "text", text: "Recopie le texte de ces pages du livret, page par page, en commençant chaque page par === p. N === (N = numéro de page indiqué ici : " + lot.pages.join(", ") + ")." }],
          system: RULES_EXTRACT_SYSTEM,
          model,
          effort: "low",
          timeoutMs: 600_000,
        }));
        if (!r.ok) throw new Error(r.erreur);
        await ajout([{ pages: lot.pages, texte: r.text }]);
        travail.faites += lot.pages.length;
      }
      // Remet les pages de ce livret dans l'ordre du PDF.
      await store.update(travail.jeu, (j) => {
        const autres = j.livret.filter((p) => p.source !== travail.id);
        const celles = j.livret.filter((p) => p.source === travail.id).sort((a, b) => a.debut - b.debut);
        j.livret = [...autres, ...celles];
        return j;
      });
      travail.etat = "fini";
    } catch (err) {
      travail.etat = "erreur";
      travail.erreur = err.message || "La lecture du livret a échoué.";
    }
  }
  const enqueue = (fn) => {
    const job = queue.then(fn);
    queue = job.catch(() => {});
    return job;
  };

  async function analyser(req, res, url) {
    const body = await readBody(req, maxBytes);
    const model = url.searchParams.get("modele") || "claude-opus-5";
    const langue = langueDe(req);
    const jeuId = url.searchParams.get("jeu");
    const jeu = jeuId && store ? await store.getGame(jeuId) : null;
    const r = await enqueue(() => runClaude(body.toString("base64"), model, jeu ? glossaireDe(jeu, langue) : {}, { langue }));
    if (!r.ok) return sendJson(res, 502, { ok: false, erreur: r.erreur });
    if (jeu) {
      await store.update(jeu.id, (g) => {
        for (const { en, fr } of r.data.glossaire || []) if (!(en in glossaireDe(g, langue))) glossaireDe(g, langue)[en] = fr;
        findPartie(findGroupe(g, url.searchParams.get("groupe")), url.searchParams.get("partie")).cartes.push({ date: new Date().toISOString(), analyse: r.data });
        return g;
      });
    }
    sendJson(res, 200, { ok: true, data: r.data });
  }

  async function parole(req, res) {
    if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
    const payload = await readJson(req);
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    const voiceId = typeof payload?.voiceId === "string" ? payload.voiceId : "";
    if (!text || !voiceId) return sendJson(res, 400, { erreur: "Texte ou voix manquant." });
    const langue = langueDe(req);
    const rapide = payload?.rapide === true; // assistant vocal
    const key = audioKey("voix", rapide ? MODELE_RAPIDE : MODELE_VOIX, voiceId, text, ...(langue === "en" ? ["en"] : []));
    const cached = await audioCache?.get(key);
    if (cached) return sendAudio(res, cached);
    let audio;
    try {
      audio = await tts.speak(text, voiceId, { rapide, langue });
    } catch (err) {
      const code = statusOf(err);
      return sendJson(res, 502, { erreur: errorMessageFor(code, String(err?.body ? JSON.stringify(err.body) : "")), code });
    }
    await audioCache?.put(key, audio);
    sendAudio(res, audio);
  }

  /** Voix de la conversation en direct, envoyée dès le premier son. */
  async function paroleDirecte(req, res) {
    if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
    const p = await readJson(req);
    const text = typeof p?.text === "string" ? p.text.trim().slice(0, 1500) : "";
    const voiceId = typeof p?.voiceId === "string" ? p.voiceId : "";
    if (!text || !voiceId) return sendJson(res, 400, { erreur: "Texte ou voix manquant." });
    let flux;
    try {
      flux = await tts.streamPcm(text, voiceId, langueDe(req));
    } catch (err) {
      const secours = [402, 403, 404].includes(statusOf(err)) ? fallbackVoiceFor(voiceId) : null;
      try {
        if (!secours) throw err;
        flux = await tts.streamPcm(text, secours, langueDe(req));
      } catch (e) {
        return sendJson(res, 502, { erreur: errorMessageFor(statusOf(e), e?.body ? JSON.stringify(e.body) : ""), code: statusOf(e) });
      }
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    try {
      for await (const bout of flux) {
        if (res.destroyed) return; // le joueur a coupé : la boucle ferme aussi la demande à ElevenLabs
        res.write(bout);
      }
      res.end();
    } catch {
      res.destroy();
    }
  }

  async function ambiance(res, nom) {
    if (!AMBIANCES.includes(nom) || nom === "aucune") return sendJson(res, 404, { erreur: "Ambiance inconnue." });
    if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
    const key = audioKey("ambiance", "sfx-v3", nom);
    const cached = await audioCache?.get(key);
    if (cached) return sendAudio(res, cached);
    try {
      const buf = await tts.ambiance(nom);
      await audioCache?.put(key, buf);
      sendAudio(res, buf);
    } catch (err) {
      sendJson(res, 502, { erreur: errorMessageFor(statusOf(err), ""), code: statusOf(err) });
    }
  }

  async function voix(res) {
    if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
    try {
      sendJson(res, 200, { voices: await tts.listVoices() });
    } catch (err) {
      sendJson(res, 502, { erreur: errorMessageFor(statusOf(err), ""), code: statusOf(err) });
    }
  }

  // ---------- Profils de jeu ----------
  async function jeux(req, res, parts) {
    if (!store) return sendJson(res, 503, { erreur: NO_STORE });
    const [id, sub, arg] = parts;
    const langue = langueDe(req), L = LABELS[langue];

    if (!id && req.method === "GET") {
      const list = await store.listGames();
      return sendJson(res, 200, { jeux: list.map((g) => ({ id: g.id, nom: g.nom, groupes: g.groupes.length, pagesLivret: g.livret.length })) });
    }
    if (!id && req.method === "POST") {
      const nom = String((await readJson(req)).nom || "").trim();
      if (!nom) return sendJson(res, 400, { erreur: "Donne un nom au jeu." });
      return sendJson(res, 200, gameView(await store.createGame(nom.slice(0, 80), langue === "en" ? "Main group" : undefined), undefined, langue));
    }

    const jeu = await store.getGame(id);
    if (!jeu) return sendJson(res, 404, { erreur: "Jeu introuvable." });

    if (!sub && req.method === "GET") return sendJson(res, 200, gameView(jeu, await images?.sources(id), langue));

    if (sub === "glossaire" && req.method === "DELETE" && arg) {
      const g = await store.update(id, (j) => { delete glossaireDe(j, langue)[decodeURIComponent(arg)]; return j; });
      return sendJson(res, 200, { glossaire: glossaireDe(g, langue) });
    }

    if (sub === "groupes" && req.method === "POST" && !arg) {
      const nom = String((await readJson(req)).nom || "").trim().slice(0, 60);
      if (!nom) return sendJson(res, 400, { erreur: "Donne un nom au groupe." });
      const groupe = newGroupe(nom);
      await store.update(id, (j) => { j.groupes.push(groupe); return j; });
      return sendJson(res, 200, groupe);
    }

    if (sub === "groupes" && req.method === "PUT" && arg) {
      const nom = String((await readJson(req)).nom || "").trim().slice(0, 60);
      if (!nom) return sendJson(res, 400, { erreur: "Donne un nom au groupe." });
      if (!jeu.groupes.some((x) => x.id === arg)) return sendJson(res, 404, { erreur: "Groupe introuvable." });
      await store.update(id, (j) => { j.groupes.find((x) => x.id === arg).nom = nom; return j; });
      return sendJson(res, 200, { ok: true });
    }

    if (sub === "groupes" && req.method === "DELETE" && arg) {
      let code = 200;
      await store.update(id, async (j) => {
        const groupe = j.groupes.find((x) => x.id === arg);
        if (!groupe) { code = 404; return j; }
        if (j.groupes.length < 2) { code = 409; return j; }
        await store.corbeille(id, groupe);
        j.groupes = j.groupes.filter((x) => x.id !== arg);
        return j;
      });
      if (code === 404) return sendJson(res, 404, { erreur: "Groupe introuvable." });
      if (code === 409) return sendJson(res, 409, { erreur: "Il faut garder au moins un groupe." });
      return sendJson(res, 200, { ok: true });
    }

    if (sub === "personnages" && req.method === "PUT") {
      const p = await readJson(req);
      await store.update(id, (j) => {
        findGroupe(j, p.groupe)[champ("personnages", langue)] = { assigned: { ...(p.assigned || {}) }, counters: { ...(p.counters || {}) } };
        return j;
      });
      return sendJson(res, 200, { ok: true });
    }

    if (sub === "parties" && req.method === "POST") {
      const p = await readJson(req);
      const partie = newPartie();
      await store.update(id, (j) => { findGroupe(j, p.groupe).parties.push(partie); return j; });
      return sendJson(res, 200, partie);
    }

    if (sub === "aide" && req.method === "GET") {
      const suivi = aides.get(`${id} ${langue}`);
      return sendJson(res, 200, { etat: suivi?.etat || "repos", erreur: suivi?.erreur || null, aide: gameView(jeu, undefined, langue).aide });
    }

    if (sub === "aide" && req.method === "POST") {
      const p = await readJson(req);
      if (!jeu.livret.length) return sendJson(res, 409, { erreur: "Ajoute d'abord le livret de règles dans « Le jeu »." });
      if ([...travaux.values()].some((t) => t.jeu === id && t.etat === "en cours")) {
        return sendJson(res, 409, { erreur: "Le livret est encore en lecture. Réessaie quand il est fini." });
      }
      if (aides.get(`${id} ${langue}`)?.etat !== "en cours") {
        const suivi = { etat: "en cours", erreur: null };
        aides.set(`${id} ${langue}`, suivi);
        preparerAide(jeu, suivi, p.modele || "claude-opus-5", langue);
      }
      return sendJson(res, 202, { etat: "en cours" });
    }

    if (sub === "travaux" && req.method === "GET") {
      return sendJson(res, 200, { travaux: [...travaux.values()].filter((t) => t.jeu === id) });
    }

    // Page d'un livret en image, et emplacement du passage cité.
    if (sub === "livret" && parts[3] === "page" && req.method === "GET") {
      const n = Number(parts[4]);
      const connue = jeu.livret.some((p) => (p.source || p.id) === arg && (!p.source || p.texte.includes(`=== p. ${n} ===`)));
      if (!images || !connue || !Number.isInteger(n)) return sendJson(res, 404, { erreur: "Page introuvable." });
      if (parts[5] === "repere") {
        const q = new URL(req.url, "http://localhost").searchParams.get("q") || "";
        return sendJson(res, 200, { boites: await images.repere(id, arg, n, q.slice(0, 300)) });
      }
      const image = await images.page(id, arg, n).catch(() => null);
      if (!image) return sendJson(res, 404, { erreur: "Cette page n'a pas d'image." });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" });
      return res.end(image);
    }

    // Images d'un livret déjà lu : le même PDF, ajouté de nouveau, sans relecture.
    if (sub === "livret" && parts[3] === "images" && req.method === "POST") {
      const parties = jeu.livret.filter((p) => p.source === arg);
      if (!images || !parties.length) return sendJson(res, 404, { erreur: "Livret introuvable." });
      const pdf = await readBody(req, 300 * 1024 * 1024);
      let pages;
      try { pages = await extractPdfText(pdf); } catch (err) { return sendJson(res, 400, { erreur: err.message }); }
      const garde = parties.map((p) => p.texte).join("\n");
      const numeros = [...garde.matchAll(/=== p\. (\d+) ===/g)].map((m) => Number(m[1]));
      const texte = pages.filter((p) => p.texte.length >= 40 && numeros.includes(p.page));
      const pareilles = texte.filter((p) => garde.includes(`=== p. ${p.page} ===\n${p.texte.slice(0, 120)}`)).length;
      if (Math.max(...numeros) > pages.length || (texte.length && pareilles / texte.length < 0.6)) {
        return sendJson(res, 409, { erreur: "Ce PDF ne correspond pas au livret déjà lu. Choisis le même fichier qu'à l'origine." });
      }
      await images.garderPdf(id, arg, pdf);
      return sendJson(res, 200, { ok: true });
    }

    if (sub === "livret" && req.method === "POST" && (req.headers["content-type"] || "").includes("pdf")) {
      const url = new URL(req.url, "http://localhost");
      const pdf = await readBody(req, 300 * 1024 * 1024);
      let pages;
      try {
        pages = await extractPdfText(pdf);
      } catch (err) {
        return sendJson(res, 400, { erreur: err.message });
      }
      const travail = {
        id: randomUUID().slice(0, 8), jeu: id, etat: "en cours", erreur: null, faites: 0, total: pages.length,
        titre: (url.searchParams.get("titre") || "Livret").slice(0, 80),
      };
      await images?.garderPdf(id, travail.id, pdf).catch(() => {}); // les images sont un plus : la lecture continue sans elles
      travaux.set(travail.id, travail);
      lireLivretPdf(travail, pdf, pages, url.searchParams.get("modele") || "claude-opus-5");
      return sendJson(res, 202, { travail: travail.id, total: pages.length });
    }

    if (sub === "livret" && req.method === "POST") {
      const url = new URL(req.url, "http://localhost");
      const body = await readBody(req, 30 * 1024 * 1024);
      const isPdf = false;
      const titre = (url.searchParams.get("titre") || `Page ${jeu.livret.length + 1}`).slice(0, 80);
      const source = { type: "base64", media_type: isPdf ? "application/pdf" : "image/jpeg", data: body.toString("base64") };
      const r = await enqueue(() => runTask({
        content: [{ type: isPdf ? "document" : "image", source }, { type: "text", text: "Recopie le texte de cette page du livret." }],
        system: RULES_EXTRACT_SYSTEM,
        model: url.searchParams.get("modele") || "claude-opus-5",
        effort: "low",
        timeoutMs: 300_000,
      }));
      if (!r.ok) return sendJson(res, 502, { erreur: r.erreur });
      const page = { id: randomUUID().slice(0, 8), titre, texte: r.text };
      await images?.garderPhoto(id, page.id, body).catch(() => {});
      await store.update(id, (j) => { j.livret.push(page); return j; });
      return sendJson(res, 200, { id: page.id, titre, longueur: page.texte.length });
    }

    if (sub === "livret" && req.method === "DELETE" && arg) {
      const retiree = jeu.livret.find((p) => p.id === arg);
      const apres = await store.update(id, (j) => { j.livret = j.livret.filter((p) => p.id !== arg); return j; });
      const source = retiree?.source || retiree?.id;
      if (source && !apres.livret.some((p) => p.source === source)) await images?.retirer(id, source);
      return sendJson(res, 200, { ok: true });
    }

    // Conversation en direct : ouvrir, question, couper, jeton, fermer.
    if (sub === "direct") {
      if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
      if (!arg && req.method === "POST") {
        const p = await readJson(req);
        const partie = findPartie(findGroupe(jeu, p.groupe), p.partie);
        const derniere = partie.cartes.at(-1);
        const echanges = partie.discussion.slice(-8).map((m) => `${m.role === "joueur" ? L.joueur : L.aide} : ${m.texte}`).join("\n") || L.aucun;
        const session = randomUUID();
        conversations.creer(session, id, {
          langue,
          system: directSystem({ ...jeu, glossaire: glossaireDe(jeu, langue) }, langue),
          contexte: `${L.carte} :\n${derniere ? textOf(derniere.analyse) : L.aucune}\n\n${L.echanges} :\n${echanges}`,
        });
        return sendJson(res, 200, { session });
      }
      const conv = conversations.trouver(arg, id);
      if (!conv) return sendJson(res, 410, { erreur: "La conversation est terminée. Touche le rond pour recommencer." });
      const action = parts[3];
      if (!action && req.method === "DELETE") { conv.fermer(); return sendJson(res, 200, { ok: true }); }
      if (action === "jeton" && req.method === "POST") {
        try {
          return sendJson(res, 200, { jeton: await tts.jetonTranscription(), termes: termesPourTranscription(glossaireDe(jeu, langue)).slice(0, 50) });
        } catch (err) {
          return sendJson(res, 502, { erreur: errorMessageFor(statusOf(err), err?.body ? JSON.stringify(err.body) : "") });
        }
      }
      if (action === "couper" && req.method === "POST") {
        conv.couper(String((await readJson(req)).entendu || ""));
        return sendJson(res, 200, { ok: true });
      }
      if (action === "question" && req.method === "POST") {
        const p = await readJson(req);
        const question = String(p.question || "").trim().slice(0, 2000);
        if (!question) return sendJson(res, 400, { erreur: "Aucune question." });
        const groupe = findGroupe(jeu, p.groupe), partie = findPartie(groupe, p.partie);
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        const ligne = (o) => { if (!res.destroyed) res.write(JSON.stringify(o) + "\n"); };
        const r = await conv.demander(question, createFiltreReferences((morceau) => ligne({ morceau })));
        if (!r.ok) { ligne({ erreur: r.erreur }); return res.end(); }
        const { texte: propre, refs } = lireReferences(r.text, jeu.livret);
        const reponse = r.coupe ? `${propre} …`.trim() : propre;
        const extra = refs.length ? { refs } : {};
        const now = new Date().toISOString();
        await store.update(id, (j) => {
          findPartie(findGroupe(j, groupe.id), partie.id).discussion.push({ role: "joueur", texte: question, date: now }, { role: "aide", texte: reponse, date: now, ...extra });
          return j;
        });
        ligne({ fin: true, reponse, ...extra });
        return res.end();
      }
    }

    // Question posée à voix haute : transcrite, jamais gardée sur le disque.
    if (sub === "transcription" && req.method === "POST") {
      if (!tts) return sendJson(res, 503, { erreur: NO_TTS });
      const son = await readBody(req, maxBytes);
      if (!son.length) return sendJson(res, 400, { erreur: "Aucun son reçu." });
      try {
        const texte = await tts.transcribe(son, req.headers["content-type"] || "audio/mp4", termesPourTranscription(glossaireDe(jeu, langue)), langue);
        return sendJson(res, 200, { texte });
      } catch (err) {
        return sendJson(res, 502, { erreur: errorMessageFor(statusOf(err), err?.body ? JSON.stringify(err.body) : "") });
      }
    }

    if (sub === "question" && req.method === "POST") {
      const p = await readJson(req);
      const question = String(p.question || "").trim().slice(0, 2000);
      if (!question) return sendJson(res, 400, { erreur: "Écris une question." });
      const groupe = findGroupe(jeu, p.groupe);
      const partie = findPartie(groupe, p.partie);
      const derniere = partie.cartes.at(-1);
      const glossaire = listeGlossaire(jeu, langue);
      const echanges = partie.discussion.slice(-8).map((m) => `${m.role === "joueur" ? L.joueur : L.aide} : ${m.texte}`).join("\n") || L.aucun;
      const texte = `${L.jeu} : ${jeu.nom}

${L.livret} :
${livretPourQuestion(jeu.livret, langue)}

${L.glossaire} :
${glossaire}

${L.carte} :
${derniere ? textOf(derniere.analyse) : L.aucune}

${L.echanges} :
${echanges}

${L.question} :
${question}`;
      // ?flux=1 : la réponse part au fil de l'écriture, une ligne JSON par morceau (comme un chat d'IA).
      const flux = new URL(req.url, "http://localhost").searchParams.get("flux") === "1";
      const envoyer = (obj) => res.write(JSON.stringify(obj) + "\n");
      if (flux) res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const r = await enqueue(() => runTask({
        prefixe: texte.indexOf(`\n\n${L.glossaire} :`), // le livret, réutilisable d'une question à l'autre (mode API)
        content: [{ type: "text", text: texte }], system: rulesQuestionSystem({ vocal: p.vocal === true, langue }), model: p.modele || "claude-opus-5", effort: p.vocal === true ? "low" : "medium",
        onText: flux ? createFiltreReferences((morceau) => envoyer({ morceau })) : null,
      }));
      if (!r.ok) {
        if (flux) { envoyer({ erreur: r.erreur }); return res.end(); }
        return sendJson(res, 502, { erreur: r.erreur });
      }
      const now = new Date().toISOString();
      const { texte: reponse, refs } = lireReferences(r.text, jeu.livret);
      const extra = refs.length ? { refs } : {};
      await store.update(id, (j) => {
        findPartie(findGroupe(j, groupe.id), partie.id).discussion.push({ role: "joueur", texte: question, date: now }, { role: "aide", texte: reponse, date: now, ...extra });
        return j;
      });
      if (flux) { envoyer({ fin: true, reponse, ...extra }); return res.end(); }
      return sendJson(res, 200, { reponse, ...extra });
    }

    if (sub === "resume" && req.method === "POST") {
      const p = await readJson(req);
      const groupe = findGroupe(jeu, p.groupe);
      const precedente = groupe.parties.length >= 2 ? groupe.parties.at(-2) : null;
      if (!precedente || precedente.cartes.length === 0) {
        return sendJson(res, 409, { erreur: "Pas de partie précédente à résumer pour ce groupe." });
      }
      const lus = precedente.cartes.map((c) => textOf(c.analyse)).join("\n\n").slice(-60_000);
      const r = await enqueue(() => runTask({ content: [{ type: "text", text: `${L.lus}\n\n${lus}` }], system: summarySystem(langue), model: p.modele || "claude-opus-5", effort: "low" }));
      if (!r.ok) return sendJson(res, 502, { erreur: r.erreur });
      await store.update(id, (j) => { findGroupe(j, groupe.id).parties.at(-1)[champ("resume", langue)] = r.text; return j; });
      return sendJson(res, 200, { texte: r.text });
    }

    return sendJson(res, 404, { erreur: "Introuvable." });
  }

  async function fichier(res, pathname) {
    let rel;
    try { rel = normalize(decodeURIComponent(pathname)).split(/[\\/]+/).filter(Boolean).join(sep); } catch { rel = null; }
    if (rel === "") rel = "index.html";
    if (!rel || !PUBLIC.test(rel)) return res.writeHead(404).end("Introuvable");
    try {
      const body = await readFile(join(root, rel));
      // no-store : l'iPhone recharge toujours la dernière version de l'app.
      res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Introuvable");
    }
  }

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "jeux", id, sous-route, argument]
    try {
      if (url.pathname === "/api/analyser" && req.method === "POST") return await analyser(req, res, url);
      if (url.pathname === "/api/parole" && req.method === "POST") return await parole(req, res);
      if (url.pathname === "/api/parole-directe" && req.method === "POST") return await paroleDirecte(req, res);
      if (url.pathname === "/api/voix" && req.method === "GET") return await voix(res);
      if (parts[0] === "api" && parts[1] === "ambiance" && req.method === "GET") return await ambiance(res, parts[2]);
      if (parts[0] === "api" && parts[1] === "jeux") return await jeux(req, res, parts.slice(2));
      if (url.pathname === "/api/etat" && req.method === "GET") return sendJson(res, 200, { eleven: Boolean(tts), claude });
      if (req.method === "GET") return await fichier(res, url.pathname);
      res.writeHead(405).end();
    } catch (err) {
      if (!res.headersSent) {
        const status = err.status || 500;
        sendJson(res, status, { erreur: status === 413 ? "Fichier trop lourd." : status === 404 ? err.message : "Erreur du serveur." });
      }
    }
  };
}
