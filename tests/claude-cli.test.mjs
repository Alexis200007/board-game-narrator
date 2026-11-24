import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, buildStdinMessage, parseClaudeOutput, CLAUDE_LOGIN_ERROR } from "../server/claude-cli.mjs";
import { ANALYSIS_SCHEMA } from "../js/claude.js";

const valid = {
  type: "carte",
  texte_original: "Draw 2 cards.",
  segments: [{ role: "regle", personnage: "", genre: "inconnu", ton: "", texte_fr: "Piochez 2 cartes." }],
};
const line = (o) => JSON.stringify(o);

test("arguments : aucun outil, schéma, effort bas, pas de --bare", () => {
  const args = buildClaudeArgs("claude-sonnet-5");
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], "-p");
  assert.equal(at("--tools"), "");
  assert.equal(at("--model"), "claude-sonnet-5");
  assert.equal(at("--effort"), "low");
  assert.equal(at("--input-format"), "stream-json");
  assert.equal(at("--output-format"), "stream-json");
  assert.deepEqual(JSON.parse(at("--json-schema")), ANALYSIS_SCHEMA);
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(!args.includes("--bare"));
});

test("arguments : modèle inconnu → Opus 5", () => {
  const args = buildClaudeArgs("rm -rf /");
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5");
});

test("message stdin : image puis texte, une ligne JSON", () => {
  const msg = buildStdinMessage("QUJD");
  assert.ok(msg.endsWith("\n"));
  const o = JSON.parse(msg);
  assert.equal(o.type, "user");
  assert.equal(o.message.content[0].type, "image");
  assert.equal(o.message.content[0].source.data, "QUJD");
  assert.equal(o.message.content[0].source.media_type, "image/jpeg");
  assert.equal(o.message.content[1].type, "text");
});

test("sortie : structured_output valide", () => {
  const out = [line({ type: "system", subtype: "init" }), line({ type: "result", subtype: "success", is_error: false, structured_output: valid })].join("\n");
  const r = parseClaudeOutput(out);
  assert.equal(r.ok, true);
  assert.equal(r.data.segments[0].texte_fr, "Piochez 2 cartes.");
});

test("sortie : résultat texte JSON sans structured_output", () => {
  const out = line({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(valid) });
  assert.equal(parseClaudeOutput(out).ok, true);
});

test("sortie : session expirée → message de connexion", () => {
  const out = line({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" });
  const r = parseClaudeOutput(out);
  assert.equal(r.ok, false);
  assert.equal(r.erreur, CLAUDE_LOGIN_ERROR);
});

test("sortie : limite d'usage atteinte", () => {
  const out = line({ type: "result", subtype: "success", is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm." });
  assert.match(parseClaudeOutput(out).erreur, /limite/i);
});

test("sortie : vide ou illisible ne lève pas", () => {
  assert.equal(parseClaudeOutput("").ok, false);
  assert.equal(parseClaudeOutput("pas du json\n{").ok, false);
});

test("sortie : aucun texte → message dédié", () => {
  const out = line({ type: "result", subtype: "success", is_error: false, structured_output: { ...valid, segments: [] } });
  assert.equal(parseClaudeOutput(out).erreur, "Aucun texte trouvé sur la photo. Réessaie de plus près.");
});

import { buildUserMessage } from "../server/claude-cli.mjs";
import { RULES_EXTRACT_SYSTEM, rulesQuestionSystem, SUMMARY_SYSTEM, MAX_LIVRET_CHARS, livretPourQuestion } from "../server/prompts.mjs";

test("arguments en mode texte : pas de schéma, consignes et effort choisis", () => {
  const args = buildClaudeArgs("claude-opus-5", { system: "SYS", schema: null, effort: "medium" });
  assert.ok(!args.includes("--json-schema"));
  assert.equal(args[args.indexOf("--system-prompt") + 1], "SYS");
  assert.equal(args[args.indexOf("--effort") + 1], "medium");
  assert.equal(args[args.indexOf("--tools") + 1], "");
});

test("message utilisateur générique", () => {
  const o = JSON.parse(buildUserMessage([{ type: "text", text: "Bonjour" }]));
  assert.deepEqual(o.message.content, [{ type: "text", text: "Bonjour" }]);
});

test("sortie en mode texte : rendue telle quelle", () => {
  const out = line({ type: "result", subtype: "success", is_error: false, result: "  Non, un héros épuisé ne peut pas attaquer.  " });
  assert.deepEqual(parseClaudeOutput(out, "text"), { ok: true, text: "Non, un héros épuisé ne peut pas attaquer." });
  assert.equal(parseClaudeOutput(line({ type: "result", is_error: false, result: "" }), "text").ok, false);
});

test("consignes : extraction, question, résumé", () => {
  assert.match(RULES_EXTRACT_SYSTEM, /anglais/);
  assert.match(rulesQuestionSystem(), /livret/);
  assert.match(SUMMARY_SYSTEM, /Précédemment/);
});

test("livret trop long : tronqué proprement", () => {
  const livret = Array.from({ length: 80 }, (_, i) => ({ titre: `Page ${i + 1}`, texte: "x".repeat(10_000) }));
  const t = livretPourQuestion(livret);
  assert.ok(t.length <= MAX_LIVRET_CHARS + 200);
  assert.match(t, /tronqué/);
  assert.match(livretPourQuestion([]), /Aucun livret/);
});

import { textDeltaOf } from "../server/claude-cli.mjs";

test("réponse en direct : option et lecture des morceaux de texte", () => {
  const args = buildClaudeArgs("claude-opus-5", { system: "S", schema: null, partial: true });
  assert.ok(args.includes("--include-partial-messages"));
  assert.ok(!buildClaudeArgs("claude-opus-5", { system: "S", schema: null }).includes("--include-partial-messages"));
  assert.equal(textDeltaOf(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Bon" } } })), "Bon");
  assert.equal(textDeltaOf(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } })), null);
  assert.equal(textDeltaOf(line({ type: "result", result: "x" })), null);
  assert.equal(textDeltaOf("pas du json"), null);
});
