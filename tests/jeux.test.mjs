import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { createAudioCache } from "../server/audio-cache.mjs";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    if (text) page.drawText(text, { x: 50, y: 700, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

const carte = (texte, extra = {}) => ({
  type: "histoire",
  texte_original: "x",
  segments: [{ role: "narrateur", personnage: "", genre: "inconnu", ton: "", texte_fr: texte }],
  glossaire: [],
  ambiance: "aucune",
  ...extra,
});

async function withApp(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), "narrateur-"));
  const store = createStore(dir);
  const audioCache = createAudioCache(join(dir, "audio"));
  const srv = createServer(createHandler({ root: process.cwd(), store, audioCache, ...opts }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = async (path, init = {}) => {
    const res = await fetch(base + path, init);
    const type = res.headers.get("content-type") || "";
    return { status: res.status, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  const post = (path, obj) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  try { await fn({ api, post, store }); } finally { srv.close(); }
}

test("jeux : créer puis lister", async () => {
  await withApp({}, async ({ api, post }) => {
    const c = await post("/api/jeux", { nom: "Gloomhaven" });
    assert.equal(c.status, 200);
    assert.equal(c.body.id, "gloomhaven");
    const l = await api("/api/jeux");
    assert.deepEqual(l.body.jeux.map((j) => j.nom), ["Gloomhaven"]);
    assert.equal((await api("/api/jeux/inconnu")).status, 404);
    assert.equal((await post("/api/jeux", { nom: "  " })).status, 400);
  });
});

test("analyser avec un jeu : glossaire transmis, carte enregistrée, glossaire fusionné", async () => {
  const seen = [];
  const runClaude = async (b64, model, glossaire) => {
    seen.push(glossaire);
    return { ok: true, data: carte("Piochez.", { glossaire: [{ en: "Exhaust", fr: "Épuiser" }, { en: "Loot", fr: "AUTRE" }] }) };
  };
  await withApp({ runClaude }, async ({ api, post, store }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    await store.update(jeu.id, (g) => { g.glossaire.Loot = "Butin"; return g; });
    const r = await api(`/api/analyser?jeu=${jeu.id}&partie=${jeu.groupes[0].parties[0].id}`, { method: "POST", body: "img" });
    assert.equal(r.status, 200);
    assert.deepEqual(seen[0], { Loot: "Butin" });
    const g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.equal(g.glossaire.Exhaust, "Épuiser");
    assert.equal(g.glossaire.Loot, "Butin", "une traduction existante n'est jamais remplacée");
    assert.equal(g.groupes[0].parties[0].cartes.length, 1);
    assert.equal(g.groupes[0].parties[0].cartes[0].analyse.segments[0].texte_fr, "Piochez.");
  });
});

test("glossaire : retirer une entrée", async () => {
  await withApp({}, async ({ api, post, store }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    await store.update(jeu.id, (g) => { g.glossaire["Attack Modifier"] = "Modificateur"; return g; });
    const r = await api(`/api/jeux/${jeu.id}/glossaire/${encodeURIComponent("Attack Modifier")}`, { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.deepEqual((await api(`/api/jeux/${jeu.id}`)).body.glossaire, {});
  });
});

test("personnages : voix enregistrées dans le jeu", async () => {
  await withApp({}, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    await api(`/api/jeux/${jeu.id}/personnages`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupe: jeu.groupes[0].id, assigned: { elara: "V1" }, counters: { homme: 0, femme: 1 } }) });
    assert.deepEqual((await api(`/api/jeux/${jeu.id}`)).body.groupes[0].personnages, { assigned: { elara: "V1" }, counters: { homme: 0, femme: 1 } });
  });
});

test("livret : photo lue par Claude", async () => {
  const calls = [];
  const runTask = async (opts) => { calls.push(opts); return { ok: true, text: "COMBAT RULES\nEach hero attacks once." }; };
  await withApp({ runTask }, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const r1 = await api(`/api/jeux/${jeu.id}/livret?titre=Page%201`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: "img" });
    assert.equal(r1.status, 200);
    assert.equal(calls[0].content[0].type, "image");
    const g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.deepEqual(g.livret.map((p) => p.titre), ["Page 1"]);
    assert.equal(g.livret[0].texte, undefined, "le texte complet du livret n'est pas renvoyé à la page");
    const del = await api(`/api/jeux/${jeu.id}/livret/${g.livret[0].id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal((await api(`/api/jeux/${jeu.id}`)).body.livret.length, 0);
  });
});

test("livret PDF : texte lu sur place, pages sans texte envoyées à Claude, en arrière-plan", async () => {
  const calls = [];
  const runTask = async (opts) => { calls.push(opts); return { ok: true, text: "SCANNED PAGE TEXT" }; };
  await withApp({ runTask }, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const pdf = await makePdf(["COMBAT RULES Each hero may attack once per turn during the fight.", "", "SETUP Shuffle the monster deck and place it near the board."]);
    const r = await api(`/api/jeux/${jeu.id}/livret?titre=Livret`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf });
    assert.equal(r.status, 202);
    let travail;
    for (let i = 0; i < 250; i++) { // jusqu'à 10 s : la lecture du PDF est plus lente quand toute la suite tourne
      travail = (await api(`/api/jeux/${jeu.id}/travaux`)).body.travaux.find((t) => t.id === r.body.travail);
      if (travail.etat !== "en cours") break;
      await new Promise((res) => setTimeout(res, 40));
    }
    assert.equal(travail.etat, "fini", travail.erreur || "");
    assert.equal(travail.faites, 3);
    assert.equal(travail.total, 3);
    assert.equal(calls.length, 1, "seule la page vide part à Claude");
    assert.equal(calls[0].content[0].type, "document");
    const g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.deepEqual(g.livret.map((p) => p.titre), ["Livret, p. 1", "Livret, p. 2", "Livret, p. 3"]);
  });
});

test("livret PDF illisible : erreur immédiate", async () => {
  await withApp({ runTask: async () => ({ ok: true, text: "x" }) }, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const r = await api(`/api/jeux/${jeu.id}/livret?titre=X`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "pas un pdf" });
    assert.equal(r.status, 400);
    assert.match(r.body.erreur, /PDF/);
  });
});

test("question : livret, glossaire et dernière carte envoyés ; discussion enregistrée", async () => {
  const calls = [];
  const runTask = async (opts) => { calls.push(opts); return { ok: true, text: opts.system.includes("Recopie") ? "COMBAT RULES" : "Non, il ne peut pas." }; };
  const runClaude = async () => ({ ok: true, data: carte("Le héros est épuisé.") });
  await withApp({ runTask, runClaude }, async ({ api, post, store }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const partie = jeu.groupes[0].parties[0].id;
    await store.update(jeu.id, (g) => { g.glossaire.Exhaust = "Épuiser"; return g; });
    await api(`/api/jeux/${jeu.id}/livret?titre=Combat`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: "img" });
    await api(`/api/analyser?jeu=${jeu.id}&partie=${partie}`, { method: "POST", body: "img" });
    const r = await post(`/api/jeux/${jeu.id}/question`, { partie, question: "Un héros épuisé peut-il attaquer ?" });
    assert.equal(r.status, 200);
    assert.equal(r.body.reponse, "Non, il ne peut pas.");
    const q = calls.at(-1).content[0].text;
    assert.match(q, /COMBAT RULES/);
    assert.match(q, /Exhaust → Épuiser/);
    assert.match(q, /Le héros est épuisé\./);
    assert.match(q, /Un héros épuisé peut-il attaquer \?/);
    assert.equal(calls.at(-1).effort, "medium");
    const disc = (await api(`/api/jeux/${jeu.id}`)).body.groupes[0].parties[0].discussion;
    assert.deepEqual(disc.map((m) => m.role), ["joueur", "aide"]);
    assert.equal((await post(`/api/jeux/${jeu.id}/question`, { partie, question: " " })).status, 400);
  });
});

test("résumé : 409 sans partie précédente, sinon texte enregistré", async () => {
  const calls = [];
  const runTask = async (opts) => { calls.push(opts); return { ok: true, text: "Précédemment… Les héros ont fui le dragon." }; };
  const runClaude = async () => ({ ok: true, data: carte("Le dragon rugit.") });
  await withApp({ runTask, runClaude }, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    assert.equal((await post(`/api/jeux/${jeu.id}/resume`, {})).status, 409);
    assert.equal(calls.length, 0);
    await api(`/api/analyser?jeu=${jeu.id}&partie=${jeu.groupes[0].parties[0].id}`, { method: "POST", body: "img" });
    const p2 = await post(`/api/jeux/${jeu.id}/parties`, {});
    assert.equal(p2.status, 200);
    const r = await post(`/api/jeux/${jeu.id}/resume`, {});
    assert.equal(r.status, 200);
    assert.match(r.body.texte, /^Précédemment/);
    assert.match(calls[0].content[0].text, /Le dragon rugit\./);
    const g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.equal(g.groupes[0].parties.at(-1).resume, r.body.texte);
  });
});

test("parole : mise en cache, une seule génération", async () => {
  let n = 0;
  const tts = { speak: async () => { n++; return Buffer.from([1, 2]); } };
  await withApp({ tts }, async ({ post }) => {
    const a = await post("/api/parole", { text: "Bonjour", voiceId: "V" });
    const b = await post("/api/parole", { text: "Bonjour", voiceId: "V" });
    assert.deepEqual([...a.body], [1, 2]);
    assert.deepEqual([...b.body], [1, 2]);
    assert.equal(n, 1);
  });
});

test("ambiance : générée une fois, inconnue refusée, échec signalé", async () => {
  let n = 0;
  const tts = { ambiance: async () => { n++; return Buffer.from([5]); } };
  await withApp({ tts }, async ({ api }) => {
    assert.deepEqual([...(await api("/api/ambiance/foret")).body], [5]);
    assert.deepEqual([...(await api("/api/ambiance/foret")).body], [5]);
    assert.equal(n, 1);
    assert.equal((await api("/api/ambiance/disco")).status, 404);
    assert.equal((await api("/api/ambiance/aucune")).status, 404);
  });
  const broken = { ambiance: async () => { throw Object.assign(new Error("x"), { statusCode: 429 }); } };
  await withApp({ tts: broken }, async ({ api }) => {
    assert.equal((await api("/api/ambiance/mer")).status, 502);
  });
});

test("groupes : création, historiques et résumés séparés", async () => {
  const runClaude = async () => ({ ok: true, data: carte("Le dragon rugit.") });
  const runTask = async () => ({ ok: true, text: "Précédemment… Le dragon a rugi." });
  await withApp({ runClaude, runTask }, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const a = jeu.groupes[0];
    assert.equal((await post(`/api/jeux/${jeu.id}/groupes`, { nom: "  " })).status, 400);
    const b = (await post(`/api/jeux/${jeu.id}/groupes`, { nom: "Les cousins" })).body;
    assert.equal(b.nom, "Les cousins");
    assert.equal(b.parties.length, 1);

    await api(`/api/analyser?jeu=${jeu.id}&groupe=${b.id}&partie=${b.parties[0].id}`, { method: "POST", body: "img" });
    let g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.equal(g.groupes.find((x) => x.id === a.id).parties[0].cartes.length, 0, "rien dans le groupe A");
    assert.equal(g.groupes.find((x) => x.id === b.id).parties[0].cartes.length, 1);

    // Nouvelle partie pour le groupe B seulement ; le résumé du groupe A reste impossible.
    await post(`/api/jeux/${jeu.id}/parties`, { groupe: b.id });
    assert.equal((await post(`/api/jeux/${jeu.id}/resume`, { groupe: a.id })).status, 409);
    const r = await post(`/api/jeux/${jeu.id}/resume`, { groupe: b.id });
    assert.equal(r.status, 200);
    g = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.equal(g.groupes.find((x) => x.id === a.id).parties.length, 1);
    assert.equal(g.groupes.find((x) => x.id === b.id).parties.length, 2);
    assert.equal((await api("/api/jeux")).body.jeux[0].groupes, 2);
  });
});

test("groupes : renommer", async () => {
  await withApp({}, async ({ api, post }) => {
    const jeu = (await post("/api/jeux", { nom: "Test" })).body;
    const r = await api(`/api/jeux/${jeu.id}/groupes/${jeu.groupes[0].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: "Les amis du jeudi" }) });
    assert.equal(r.status, 200);
    assert.equal((await api(`/api/jeux/${jeu.id}`)).body.groupes[0].nom, "Les amis du jeudi");
  });
});

test("question en direct : morceaux envoyés au fil de l'eau, réponse finale enregistrée", async () => {
  const runTask = async (opts) => {
    opts.onText?.("Non, ");
    opts.onText?.("il ne peut pas.");
    return { ok: true, text: "Non, il ne peut pas." };
  };
  // Appel brut pour lire le flux ligne par ligne.
  const dir = (await import("node:fs")).mkdtempSync(join(tmpdir(), "narrateur-"));
  const store = createStore(dir);
  const srv = createServer(createHandler({ root: process.cwd(), store, runTask }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const jeu = await store.createGame("Flux");
    const res = await fetch(`${base}/api/jeux/${jeu.id}/question?flux=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Épuisé, j'attaque ?" }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /ndjson/);
    const lignes = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lignes.filter((l) => l.morceau).map((l) => l.morceau), ["Non, ", "il ne peut pas."]);
    assert.deepEqual(lignes.at(-1), { fin: true, reponse: "Non, il ne peut pas." });
    const g = await store.getGame(jeu.id);
    assert.deepEqual(g.groupes[0].parties[0].discussion.map((m) => m.texte), ["Épuisé, j'attaque ?", "Non, il ne peut pas."]);
  } finally { srv.close(); }
});

test("question en direct : erreur envoyée dans le flux", async () => {
  const dir = (await import("node:fs")).mkdtempSync(join(tmpdir(), "narrateur-"));
  const store = createStore(dir);
  const srv = createServer(createHandler({ root: process.cwd(), store, runTask: async () => ({ ok: false, erreur: "Limite d'usage Claude atteinte." }) }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const jeu = await store.createGame("Flux");
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/jeux/${jeu.id}/question?flux=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "x" }) });
    const lignes = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lignes.at(-1), { erreur: "Limite d'usage Claude atteinte." });
    assert.equal((await store.getGame(jeu.id)).groupes[0].parties[0].discussion.length, 0, "rien d'enregistré en cas d'erreur");
  } finally { srv.close(); }
});

test("transcription : son envoyé avec les termes du glossaire, rien gardé", async () => {
  const appels = [];
  const tts = { transcribe: async (...a) => { appels.push(a); return "Un héros épuisé ?"; } };
  await withApp({ tts }, async ({ api, store }) => {
    const jeu = await store.createGame("Vocal");
    await store.update(jeu.id, (j) => { j.glossaire = { Exhausted: "Épuisé", "un terme bien trop long pour être envoyé tel quel": "X" }; return j; });
    const envoyer = (body) => api(`/api/jeux/${jeu.id}/transcription`, { method: "POST", headers: { "Content-Type": "audio/mp4" }, body });
    assert.deepEqual(await envoyer(Buffer.from([1, 2])), { status: 200, body: { texte: "Un héros épuisé ?" } });
    assert.deepEqual([...appels[0][0]], [1, 2]);
    assert.equal(appels[0][1], "audio/mp4");
    assert.deepEqual(appels[0][2], ["Exhausted", "Épuisé", "X"]);
    assert.equal((await envoyer(Buffer.alloc(0))).status, 400);
    assert.equal((await store.getGame(jeu.id)).groupes[0].parties[0].discussion.length, 0);
  });
});

test("transcription : sans ElevenLabs, 503 ; erreur ElevenLabs, 502", async () => {
  const enPanne = { transcribe: async () => { throw Object.assign(new Error(), { statusCode: 429 }); } };
  for (const [tts, status] of [[null, 503], [enPanne, 502]]) {
    await withApp({ tts }, async ({ api, store }) => {
      const jeu = await store.createGame("Vocal");
      assert.equal((await api(`/api/jeux/${jeu.id}/transcription`, { method: "POST", body: Buffer.from([1]) })).status, status);
    });
  }
});

test("question vocale : consigne orale et effort réduit", async () => {
  const taches = [];
  await withApp({ runTask: async (t) => { taches.push(t); return { ok: true, text: "Oui." }; } }, async ({ post, store }) => {
    const jeu = await store.createGame("Vocal");
    await post(`/api/jeux/${jeu.id}/question`, { question: "x", vocal: true });
    await post(`/api/jeux/${jeu.id}/question`, { question: "x" });
    assert.match(taches[0].system, /voix haute/);
    assert.equal(taches[0].effort, "low");
    assert.doesNotMatch(taches[1].system, /voix haute/);
    assert.equal(taches[1].effort, "medium");
  });
});

async function attendre(fn) {
  for (let i = 0; i < 100; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error("trop long");
}

test("aide-mémoire : préparé en arrière-plan, une seule fois, puis périmé si le livret change", async () => {
  const vus = [];
  let repondre;
  const runTask = (o) => { vus.push(o); return new Promise((ok) => { repondre = ok; }); };
  await withApp({ runTask }, async ({ api, post, store }) => {
    await post("/api/jeux", { nom: "Catan" });
    assert.equal((await post("/api/jeux/catan/aide", {})).status, 409); // pas de livret
    await store.update("catan", (j) => { j.livret.push({ id: "p1", titre: "P1", texte: "Roll the dice." }); j.glossaire = { robber: "voleur" }; return j; });
    assert.equal((await post("/api/jeux/catan/aide", {})).status, 202);
    assert.equal((await post("/api/jeux/catan/aide", {})).status, 202);
    assert.equal(vus.length, 1);
    assert.match(vus[0].content[0].text, /Roll the dice[\s\S]*robber → voleur/);
    assert.equal(vus[0].expect, "json");
    assert.equal((await api("/api/jeux/catan/aide")).body.etat, "en cours");
    repondre({ ok: true, data: { sections: [{ titre: "Ton tour", etapes: true, points: ["Lance les dés.", " "] }, { titre: "Vide", etapes: false, points: [] }] } });
    const r = await attendre(async () => { const { body } = await api("/api/jeux/catan/aide"); return body.etat === "fini" && body; });
    assert.deepEqual(r.aide.sections, [{ titre: "Ton tour", etapes: true, points: ["Lance les dés."] }]);
    assert.equal(r.aide.perime, false);
    await store.update("catan", (j) => { j.livret.push({ id: "p2", titre: "P2", texte: "x" }); return j; });
    assert.equal((await api("/api/jeux/catan")).body.aide.perime, true);
  });
});

test("aide-mémoire : une erreur est signalée et l'ancien est gardé", async () => {
  await withApp({ runTask: async () => ({ ok: false, erreur: "Limite" }) }, async ({ api, post, store }) => {
    await post("/api/jeux", { nom: "Catan" });
    const sections = [{ titre: "T", etapes: false, points: ["a"] }];
    await store.update("catan", (j) => { j.livret.push({ id: "p1", titre: "P1", texte: "x" }); j.aide = { sections, date: "d", version: "p1" }; return j; });
    await post("/api/jeux/catan/aide", {});
    const r = await attendre(async () => { const { body } = await api("/api/jeux/catan/aide"); return body.etat === "erreur" && body; });
    assert.equal(r.erreur, "Limite");
    assert.deepEqual(r.aide.sections, sections);
  });
});

test("groupes : suppression avec copie de secours ; le dernier groupe reste", async () => {
  await withApp({}, async ({ api, post, store }) => {
    const jeu = (await post("/api/jeux", { nom: "Groupes" })).body;
    const b = (await post(`/api/jeux/${jeu.id}/groupes`, { nom: "Cousins" })).body;
    const copies = [];
    const vraie = store.corbeille;
    store.corbeille = async (...a) => { copies.push(a[1].nom); return vraie(...a); };
    const suppr = (g) => api(`/api/jeux/${jeu.id}/groupes/${g}`, { method: "DELETE" });
    assert.equal((await suppr("absent")).status, 404);
    assert.equal((await suppr(b.id)).status, 200);
    assert.deepEqual(copies, ["Cousins"]);
    const restants = (await store.getGame(jeu.id)).groupes;
    assert.deepEqual(restants.map((g) => g.id), [jeu.groupes[0].id]);
    assert.equal((await suppr(restants[0].id)).status, 409);
  });
});

test("anglais : glossaire, aide et voix séparés du français", async () => {
  const recus = [];
  const runTask = async (o) => { recus.push(o); return { ok: true, text: "Yes." }; };
  await withApp({ runTask }, async ({ api, post, store }) => {
    const en = { headers: { "X-Langue": "en", "Content-Type": "application/json" } };
    const jeu = (await post("/api/jeux", { nom: "Deux langues" })).body;
    await store.update(jeu.id, (g) => { g.glossaire = { Exhaust: "Épuiser" }; g.glossaireEn = { Erschöpfen: "Exhaust" }; return g; });
    const vueEn = (await api(`/api/jeux/${jeu.id}`, en)).body, vueFr = (await api(`/api/jeux/${jeu.id}`)).body;
    assert.deepEqual(vueEn.glossaire, { Erschöpfen: "Exhaust" });
    assert.deepEqual(vueFr.glossaire, { Exhaust: "Épuiser" });
    assert.ok(!("glossaireEn" in vueFr));
    await api(`/api/jeux/${jeu.id}/personnages`, { method: "PUT", ...en, body: JSON.stringify({ groupe: "", assigned: { orc: "v1" } }) });
    assert.deepEqual((await api(`/api/jeux/${jeu.id}`)).body.groupes[0].personnages, {});
    assert.equal((await api(`/api/jeux/${jeu.id}`, en)).body.groupes[0].personnages.assigned.orc, "v1");
    await api(`/api/jeux/${jeu.id}/question`, { method: "POST", ...en, body: JSON.stringify({ question: "How many dice?" }) });
    assert.match(recus[0].system, /Answer in English/);
    assert.match(recus[0].content[0].text, /PLAYER'S QUESTION/);
  });
});
