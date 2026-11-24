import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, NO_TEXT_ERROR } from "../js/claude.js";

test("validateAnalysis : segments vides → message français", () => {
  const r = validateAnalysis({ type: "carte", texte_original: "", segments: [] });
  assert.equal(r.ok, false);
  assert.equal(r.erreur, NO_TEXT_ERROR);
  assert.equal(NO_TEXT_ERROR, "Aucun texte trouvé sur la photo. Réessaie de plus près.");
});

test("validateAnalysis : null ou forme invalide ne lève pas", () => {
  assert.equal(validateAnalysis(null).ok, false);
  assert.equal(validateAnalysis("texte").ok, false);
  assert.equal(validateAnalysis({ segments: [{ role: "narrateur" }] }).ok, false);
});

test("validateAnalysis : réponse valide passe et normalise", () => {
  const r = validateAnalysis({
    type: "histoire",
    texte_original: "You enter the cave.",
    segments: [
      { role: "narrateur", personnage: "", genre: "inconnu", ton: "[tense]", texte_fr: "Vous entrez dans la grotte." },
      { role: "regle", personnage: "", genre: "inconnu", ton: "[shouting]", texte_fr: "Piochez une carte." },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.segments.length, 2);
  assert.equal(r.data.segments[1].ton, "", "le ton est toujours vide pour une règle");
});

import { AMBIANCES, analysisSystem } from "../js/claude.js";

const base = { type: "carte", texte_original: "x", segments: [{ role: "regle", personnage: "", genre: "inconnu", ton: "", texte_fr: "Piochez." }] };

test("validateAnalysis : garde glossaire et ambiance, remplace une ambiance inconnue", () => {
  const r = validateAnalysis({ ...base, glossaire: [{ en: "Exhaust", fr: "Épuiser" }, { en: "", fr: "x" }], ambiance: "foret" });
  assert.deepEqual(r.data.glossaire, [{ en: "Exhaust", fr: "Épuiser" }]);
  assert.equal(r.data.ambiance, "foret");
  assert.equal(validateAnalysis({ ...base, ambiance: "disco" }).data.ambiance, "aucune");
  assert.equal(validateAnalysis(base).data.ambiance, "aucune");
  assert.deepEqual(validateAnalysis(base).data.glossaire, []);
});

test("ambiances autorisées", () => {
  assert.deepEqual(AMBIANCES, ["aucune", "taverne", "foret", "donjon", "tempete", "combat", "ville", "mer", "mystere"]);
});

test("consignes d'analyse : contiennent le glossaire du jeu", () => {
  const s = analysisSystem({ Exhaust: "Épuiser", "Attack Modifier": "Modificateur d'attaque" });
  assert.match(s, /Exhaust → Épuiser/);
  assert.match(s, /Attack Modifier → Modificateur d'attaque/);
  assert.doesNotMatch(analysisSystem({}), /Glossaire de ce jeu/);
});
