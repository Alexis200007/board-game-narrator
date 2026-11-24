import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCouts, coutUsage, coutResultat, soiree } from "../server/couts.mjs";
import { createEvaluations, evaluer } from "../server/evaluation.mjs";
import { texteQuestion } from "../server/prompts.mjs";
import { additionner } from "../js/couts.js";
import { createEcran } from "../js/ecran.js";

const dossier = () => mkdtempSync(join(tmpdir(), "couts-"));

test("coûts : tarif, cache et ligne de claude -p", () => {
  assert.equal(coutUsage("claude-sonnet-5", { input_tokens: 1e6, output_tokens: 1e5 }).toFixed(4), "3.0000");
  assert.equal(coutUsage("claude-opus-5", { cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 }).toFixed(4), "6.7500");
  assert.equal(coutUsage("inconnu", { input_tokens: 5 }), null);
  assert.equal(coutResultat('{"type":"result","total_cost_usd":0.02}'), 0.02);
  assert.equal(coutResultat("pas du json"), null);
});

test("coûts : une soirée finit à 5 h ; le compteur survit à un redémarrage et à un fichier abîmé", () => {
  assert.equal(soiree(new Date(2026, 10, 24, 1, 30).getTime()), "2026-11-23");
  assert.equal(soiree(new Date(2026, 10, 24, 19).getTime()), "2026-11-24");
  const d = dossier(), c = createCouts(d, { maintenant: () => new Date(2026, 10, 24, 20).getTime() });
  c.noter("carte", { usd: 0.02 }); c.noter("carte", { usd: 0.04 }); c.noter("voix", { caracteres: 300 });
  c.vider();
  const [s] = createCouts(d).lire();
  assert.equal(s.date, "2026-11-24");
  assert.deepEqual([s.lignes.carte.n, s.lignes.carte.usd.toFixed(2), s.lignes.voix.caracteres], [2, "0.06", 300]);
  assert.equal(additionner([s, s]).carte.n, 4);
  writeFileSync(join(d, "couts.json"), "{abîmé");
  assert.deepEqual(createCouts(d).lire(), []);
});

test("évaluation : signalement enregistré, réponses jugées, page vérifiée", async () => {
  const ev = createEvaluations(dossier());
  ev.ajouter("jeu", { question: "Q", attendu: "A", langue: "fr" });
  assert.equal(ev.ajouter("jeu", { question: "Q", attendu: "B", langue: "fr" }), 1);
  assert.equal(ev.lire("jeu")[0].attendu, "B");
  assert.throws(() => ev.lire("../x"));
  const jeu = { nom: "J", glossaire: {}, livret: [{ id: "p", source: "s", titre: "R, p. 1", texte: "=== p. 1 ===\nRoll two dice.\n" }] };
  const runTask = async (o) => o.expect === "json" ? { ok: true, data: { juste: /Deux/.test(o.content[0].text), raison: "r" } }
    : /panne/.test(o.content[0].text) ? { ok: false, erreur: "E" } : { ok: true, text: "Deux dés.\n[[L1 p. 1 | Roll two dice]]" };
  const r = await evaluer({ jeu, runTask, cas: [{ question: "Combien ?", attendu: "2", page: 1 }, { question: "Où ?", attendu: "x", page: 3 }, { question: "panne", attendu: "x" }] });
  assert.deepEqual([r.total, r.justes, r.pagesJustes, r.pagesVerifiees, r.erreurs], [3, 2, 1, 2, 1]);
});

test("question : le préfixe est le livret, identique d'une question à l'autre", () => {
  const jeu = { nom: "J", glossaire: {}, livret: [] };
  const a = texteQuestion({ jeu, question: "un" }), b = texteQuestion({ jeu, question: "deux", carte: "c", echanges: "e" });
  assert.equal(a.texte.slice(0, a.prefixe), b.texte.slice(0, b.prefixe));
  assert.match(b.texte, /QUESTION DU JOUEUR :\ndeux$/);
});

test("écran : allumé tant qu'une raison reste, repris au retour dans l'app", async () => {
  let demandes = 0, relaches = 0, retour;
  const doc = { visibilityState: "visible", addEventListener: (_, f) => { retour = f; } };
  const gardes = [];
  const verrou = { request: async () => { demandes++; const g = { addEventListener: (_, f) => { g.fin = f; }, release: async () => { relaches++; g.fin(); } }; gardes.push(g); return g; } };
  const e = createEcran({ doc, verrou }), souffle = () => new Promise((r) => setTimeout(r, 1));
  e.garder("lecture", true); e.garder("vocal", true); await souffle();
  assert.equal(demandes, 1);
  e.garder("lecture", false); await souffle();
  assert.equal(relaches, 0);
  gardes[0].fin(); retour(); await souffle();
  assert.equal(demandes, 2);
  e.garder("vocal", false); await souffle();
  assert.equal(relaches, 1);
  e.garder("x", true); e.garder("x", false); await souffle(); // relâché pendant la demande
  assert.equal(relaches, 2);
  createEcran({ doc, verrou: undefined }).garder("x", true); // ancien iPhone : sans effet
});
