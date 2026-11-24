// Tâches Claude par l'API Anthropic (clé ANTHROPIC_API_KEY, facturée à l'usage) : même contrat que claude-cli.mjs.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYSIS_SCHEMA, analysisSystem, validateAnalysis } from "../js/claude.js";
import { MODELE_PAR_DEFAUT, EFFORTS, MODELS, buildStdinMessage } from "./claude-cli.mjs";
import { MODELE_DIRECT, PERDU } from "./direct.mjs";
import { coutUsage } from "./couts.mjs";
import { LABELS } from "./prompts-en.mjs";

const CACHE = { type: "ephemeral" };
const SORTIE_MAX = 32_000;

export const ERREURS_API = {
  cle: "Clé API Claude refusée. Vérifie ANTHROPIC_API_KEY dans .env.local sur l'ordinateur.",
  limite: "Limite de l'API Claude atteinte. Réessaie dans un moment.",
  credit: "Le crédit de l'API Claude est épuisé ou la demande est refusée. Vérifie ton compte Anthropic.",
  reseau: "Impossible de joindre l'API Claude. Vérifie la connexion Internet de l'ordinateur.",
  lourd: "La demande est trop lourde pour l'API Claude.",
  refus: "Claude a refusé de traiter ce texte.",
  coupe: "La réponse de Claude est trop longue et a été coupée. Réessaie.",
  delai: "Claude a mis trop de temps à répondre. Réessaie.",
  autre: "Claude a rencontré une erreur. Réessaie.",
  vide: "Claude n'a rien répondu. Réessaie.",
  illisible: "La réponse de Claude est illisible. Réessaie.",
};

/** Message en français pour une erreur du SDK. Le détail va au journal (jamais la clé). */
export function erreurApi(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return ERREURS_API.cle;
  if (err instanceof Anthropic.RateLimitError) return ERREURS_API.limite;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return ERREURS_API.delai;
  if (err instanceof Anthropic.APIConnectionError) return ERREURS_API.reseau;
  if (err instanceof Anthropic.APIError) {
    console.error(`API Claude : ${err.status ?? "?"} ${err.type ?? ""} ${err.requestID ?? ""}`);
    if (err.status === 413) return ERREURS_API.lourd;
    if (err.status === 402 || err.type === "billing_error" || err.status === 400) return ERREURS_API.credit;
  }
  return ERREURS_API.autre;
}

const texteDe = (message) => message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
/** Coût d'une demande, même coupée en route (au moins ce qui a été lu et écrit). */
function compter(flux, model, onCout) {
  const c = coutUsage(model, flux?.currentMessage?.usage ?? flux?.receivedMessages?.at(-1)?.usage);
  if (c) onCout(c);
}
const modele = (m) => (MODELS.has(m) ? m : MODELE_PAR_DEFAUT);

/** prefixe = début stable du texte (le livret) : mis en cache, les questions suivantes coûtent moins cher. */
export function contenuAvecCache(content, prefixe = 0) {
  const b = content[0];
  if (!prefixe || content.length !== 1 || b.type !== "text" || prefixe >= b.text.length) return content;
  return [{ type: "text", text: b.text.slice(0, prefixe), cache_control: CACHE }, { type: "text", text: b.text.slice(prefixe) }];
}

export function createClaudeApi({ client = null, apiKey } = {}) {
  client ??= new Anthropic({ apiKey });

  /** Ne lève jamais : rend { ok, data | text } ou { ok:false, erreur }. */
  async function runTask({ content, system, schema = null, model, effort = "low", expect = "text", timeoutMs = 180_000, onText = null, prefixe = 0, onCout = () => {} }) {
    let minuteur, depasse = false, flux = null;
    try {
      flux = client.messages.stream({
        model: modele(model),
        max_tokens: SORTIE_MAX,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: contenuAvecCache(content, prefixe) }],
        output_config: { effort: EFFORTS.has(effort) ? effort : "low", ...(schema ? { format: { type: "json_schema", schema } } : {}) },
      });
      minuteur = setTimeout(() => { depasse = true; flux.abort(); }, timeoutMs);
      if (onText) flux.on("text", (t) => onText(t));
      const message = await flux.finalMessage();
      if (message.stop_reason === "refusal") return { ok: false, erreur: ERREURS_API.refus };
      if (message.stop_reason === "max_tokens") return { ok: false, erreur: ERREURS_API.coupe };
      const text = texteDe(message);
      if (!text) return { ok: false, erreur: ERREURS_API.vide };
      if (expect === "text") return { ok: true, text };
      let data = null;
      try { data = JSON.parse(text); } catch { /* signalé plus bas */ }
      if (!data || typeof data !== "object") return { ok: false, erreur: ERREURS_API.illisible };
      if (expect === "json") return { ok: true, data };
      const verifie = validateAnalysis(data);
      return verifie.ok ? { ok: true, data: verifie.data } : { ok: false, erreur: verifie.erreur };
    } catch (err) {
      return { ok: false, erreur: depasse ? ERREURS_API.delai : erreurApi(err) };
    } finally {
      clearTimeout(minuteur);
      compter(flux, modele(model), onCout);
    }
  }

  /** Analyse d'une carte (photo JPEG en base64), avec le glossaire du jeu. */
  function runClaude(base64, model, glossaire = {}, { langue = "fr", ...opts } = {}) {
    return runTask({
      content: JSON.parse(buildStdinMessage(base64, langue)).message.content,
      system: analysisSystem(glossaire, langue), schema: ANALYSIS_SCHEMA, model, effort: "low", expect: "analysis", timeoutMs: 120_000, ...opts,
    });
  }

  /** Conversation vocale en direct. Même contrat que ouvrirConversation (direct.mjs). */
  function ouvrir({ system, contexte, langue = "fr", delaiMs = 60_000, onFermee = () => {}, onCout = () => {} }) {
    const L = LABELS[langue];
    const messages = [];
    const base = {
      model: MODELE_DIRECT,
      system: [{ type: "text", text: system, cache_control: CACHE }, { type: "text", text: contexte || "-" }],
      output_config: { effort: "low" },
      cache_control: CACHE,
    };
    let tour = null, ferme = false, suite = Promise.resolve(), coupureEntendue = null, annulerAttente = null;
    const enchainer = (fn) => { const p = suite.then(fn); suite = p.catch(() => {}); return p; };
    // Le livret entre dans le cache pendant que le micro s'ouvre. Un échec n'empêche rien.
    const chauffe = new AbortController();
    const pret = enchainer(() => Promise.resolve(client.messages.create(
      { model: base.model, system: base.system, output_config: base.output_config, max_tokens: 0, messages: [{ role: "user", content: "-" }] },
      { signal: chauffe.signal, timeout: 15_000, maxRetries: 0 },
    )).then((m) => { const c = coutUsage(base.model, m.usage); if (c) onCout(c); return { ok: true, text: "" }; }, () => ({ ok: true, text: "" })));

    function interrompre() {
      if (!tour || tour.coupe) return;
      tour.coupe = true;
      tour.flux.abort();
    }
    function fermer() {
      if (ferme) return;
      ferme = true;
      chauffe.abort();
      tour?.flux.abort();
      onFermee();
    }
    async function envoyer(texte, onTexte) {
      if (ferme) return { ok: false, erreur: PERDU };
      const question = { role: "user", content: texte };
      let t = null, minuteur, depasse = false;
      try {
        t = tour = { coupe: false, texte: "", flux: client.messages.stream({ ...base, max_tokens: 8000, messages: [...messages, question] }) };
        minuteur = setTimeout(() => { depasse = true; t.flux.abort(); }, delaiMs);
        t.flux.on("text", (bout) => { if (!t.coupe && !ferme) { t.texte += bout; onTexte(bout); } });
        const message = await t.flux.finalMessage();
        if (t.coupe) return finCoupee();
        if (ferme) return { ok: false, erreur: PERDU };
        if (message.stop_reason === "refusal") return { ok: false, erreur: ERREURS_API.refus };
        const text = texteDe(message);
        if (!text) return { ok: false, erreur: ERREURS_API.vide };
        messages.push(question, { role: "assistant", content: message.content });
        return { ok: true, text };
      } catch (err) {
        if (t?.coupe) return finCoupee();
        if (ferme) return { ok: false, erreur: PERDU };
        return { ok: false, erreur: depasse ? ERREURS_API.delai : erreurApi(err) };
      } finally {
        clearTimeout(minuteur);
        compter(t?.flux, base.model, onCout);
        if (tour === t) tour = null;
      }
      // Coupée : l'historique garde ce qui a été écrit, sans plus.
      function finCoupee() {
        const ecrit = t.texte.trim();
        messages.push(question);
        if (ecrit) messages.push({ role: "assistant", content: ecrit });
        return { ok: true, text: ecrit, coupe: true };
      }
    }
    return {
      pret,
      get fermee() { return ferme; },
      demander(question, onTexte) {
        interrompre();
        annulerAttente?.();
        const attente = { annulee: false };
        annulerAttente = () => { attente.annulee = true; };
        return enchainer(async () => {
          if (attente.annulee) return { ok: true, text: "", coupe: true };
          const note = coupureEntendue === null ? "" : coupureEntendue ? L.coupe(coupureEntendue) : L.coupeAvant;
          coupureEntendue = null;
          return envoyer(note + question, onTexte);
        });
      },
      couper(entendu = "") {
        coupureEntendue = String(entendu).slice(-1500);
        annulerAttente?.();
        interrompre();
      },
      fermer,
    };
  }

  return { runTask, runClaude, ouvrir };
}
