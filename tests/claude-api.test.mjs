import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeApi, contenuAvecCache, ERREURS_API } from "../server/claude-api.mjs";
import { claudeEnv, modeClaude } from "../server/claude-cli.mjs";
import { EN } from "../js/en.js";

/** Faux serveur Anthropic derrière le vrai SDK : repondre(demande, res) choisit la réponse. */
async function avecApi(repondre, fn) {
  const recus = [];
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (d) => { b += d; });
    req.on("end", () => { const d = JSON.parse(b); recus.push({ chemin: req.url, cle: req.headers["x-api-key"] ?? req.headers.authorization?.replace("Bearer ", ""), ...d }); repondre(d, res, recus.length); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const client = new Anthropic({ apiKey: "essai", baseURL: `http://127.0.0.1:${srv.address().port}`, maxRetries: 0 });
  try { await fn(createClaudeApi({ client }), recus); } finally { srv.closeAllConnections(); srv.close(); }
}
const ev = (res, type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
function debut(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  ev(res, "message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  ev(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
}
const bout = (res, text) => ev(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text } });
function fin(res, stop_reason = "end_turn") {
  ev(res, "content_block_stop", { index: 0 });
  ev(res, "message_delta", { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 2 } });
  ev(res, "message_stop", {});
  res.end();
}
const texte = (...l) => (_, res) => { debut(res); l.forEach((t) => bout(res, t)); fin(res); };
const erreur = (code, type) => (_, res) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type, message: "x" } })); };
const demande = { content: [{ type: "text", text: "Bonjour" }], system: "S", model: "claude-sonnet-5" };

test("API : texte au fil de l'écriture", async () => {
  await avecApi(texte("Deux ", "actions."), async (api, recus) => {
    const l = [];
    assert.deepEqual(await api.runTask({ ...demande, onText: (t) => l.push(t) }), { ok: true, text: "Deux actions." });
    assert.deepEqual(l, ["Deux ", "actions."]);
    assert.equal(recus[0].model, "claude-sonnet-5");
    assert.equal(recus[0].cle, "essai");
    assert.deepEqual(recus[0].output_config, { effort: "low" });
  });
});

test("API : carte analysée, photo et schéma envoyés", async () => {
  const analyse = { type: "regle", texte_original: "Draw.", segments: [{ role: "regle", personnage: "", genre: "inconnu", ton: "", texte_fr: "Pioche." }], glossaire: [], ambiance: "aucune" };
  await avecApi(texte(JSON.stringify(analyse)), async (api, recus) => {
    const r = await api.runClaude("QUJD", "inconnu", {}, { langue: "en" });
    assert.equal(r.data.segments[0].texte_fr, "Pioche.");
    assert.equal(recus[0].model, "claude-opus-5");
    assert.equal(recus[0].output_config.format.type, "json_schema");
    assert.equal(recus[0].messages[0].content[0].source.data, "QUJD");
    assert.match(recus[0].system, /only reads English/);
  });
  await avecApi(texte("pas du json"), async (api) => assert.equal((await api.runClaude("QUJD")).erreur, ERREURS_API.illisible));
});

test("API : erreurs claires, refus et réponse coupée", async () => {
  for (const [code, type, attendu] of [[401, "authentication_error", "cle"], [429, "rate_limit_error", "limite"], [400, "invalid_request_error", "credit"], [413, "request_too_large", "lourd"], [529, "overloaded_error", "autre"]]) {
    await avecApi(erreur(code, type), async (api) => assert.equal((await api.runTask(demande)).erreur, ERREURS_API[attendu], String(code)));
  }
  for (const [raison, attendu] of [["refusal", "refus"], ["max_tokens", "coupe"]]) {
    await avecApi((_, res) => { debut(res); bout(res, "a"); fin(res, raison); }, async (api) => assert.equal((await api.runTask(demande)).erreur, ERREURS_API[attendu]));
  }
  await avecApi((_, res) => debut(res), async (api) => assert.equal((await api.runTask({ ...demande, timeoutMs: 60 })).erreur, ERREURS_API.delai));
  for (const e of Object.values(ERREURS_API)) assert.ok(e in EN, e);
});

test("API : le livret est mis en cache, la question non", () => {
  const c = contenuAvecCache([{ type: "text", text: "LIVRET question" }], 6);
  assert.deepEqual(c.map((b) => b.text), ["LIVRET", " question"]);
  assert.ok(c[0].cache_control && !c[1].cache_control);
  assert.equal(contenuAvecCache([{ type: "text", text: "a" }]).length, 1);
});

test("API : conversation en direct, coupure et suite", async () => {
  let coupee = false;
  await avecApi((d, res) => {
    if (d.max_tokens === 0) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", content: [], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 0 } })); }
    debut(res);
    res.on("close", () => { coupee = true; });
    if (/Combien/.test(JSON.stringify(d.messages.at(-1)))) return bout(res, "Deux actions. "); // reste ouverte
    bout(res, "Voilà."); fin(res);
  }, async (api, recus) => {
    const conv = api.ouvrir({ system: "LIVRET", contexte: "CTX" });
    await conv.pret;
    let recu;
    const premier = new Promise((r) => { recu = r; });
    const p = conv.demander("Combien ?", recu);
    assert.equal(await premier, "Deux actions. ");
    conv.couper("Deux");
    assert.deepEqual(await p, { ok: true, text: "Deux actions.", coupe: true });
    const q = await conv.demander("Et le combat ?", () => {});
    assert.equal(q.text, "Voilà.");
    assert.ok(coupee, "la demande coupée est fermée");
    const m = recus.at(-1).messages;
    assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
    assert.match(m[2].content, /entendu seulement : « Deux »[^]*Et le combat/);
    assert.equal(recus.at(-1).system[0].cache_control.type, "ephemeral");
    conv.fermer();
    assert.equal((await conv.demander("z", () => {})).ok, false);
  });
});

test("mode : abonnement par défaut, même avec une clé ; sa clé n'est pas donnée à claude -p", () => {
  assert.equal(modeClaude({}), "cli");
  assert.equal(modeClaude({ ANTHROPIC_API_KEY: "x" }), "cli");
  assert.equal(modeClaude({ CLAUDE_MODE: " API " }), "api");
  assert.throws(() => modeClaude({ CLAUDE_MODE: "autre" }), /CLAUDE_MODE/);
  assert.deepEqual(claudeEnv({ ANTHROPIC_API_KEY: "x", PATH: "p" }), { PATH: "p" });
});
