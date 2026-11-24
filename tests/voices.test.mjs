import { test } from "node:test";
import assert from "node:assert/strict";
import { createCaster, pickDefaultVoices } from "../js/voices.js";

const roles = { narrateur: "N", regle: "R", homme: ["H1", "H2"], femme: ["F1", "F2"], creature: "C" };

test("même personnage, même voix, insensible à la casse", () => {
  const c = createCaster(roles);
  const a = c.voiceFor({ role: "personnage", personnage: "Gandalf", genre: "homme" });
  const b = c.voiceFor({ role: "personnage", personnage: "gandalf", genre: "homme" });
  assert.equal(a, b);
});

test("deux personnages féminins reçoivent des voix différentes", () => {
  const c = createCaster(roles);
  const a = c.voiceFor({ role: "personnage", personnage: "Arwen", genre: "femme" });
  const b = c.voiceFor({ role: "personnage", personnage: "Galadriel", genre: "femme" });
  assert.notEqual(a, b);
});

test("plus de personnages que de voix : jamais undefined", () => {
  const c = createCaster(roles);
  for (const n of ["A", "B", "C", "D", "E"]) {
    const v = c.voiceFor({ role: "personnage", personnage: n, genre: "homme" });
    assert.ok(["H1", "H2"].includes(v));
  }
});

test("narrateur, règle et genre inconnu", () => {
  const c = createCaster(roles);
  assert.equal(c.voiceFor({ role: "narrateur" }), "N");
  assert.equal(c.voiceFor({ role: "regle" }), "R");
  assert.equal(c.voiceFor({ role: "personnage", personnage: "Dragon", genre: "inconnu" }), "C");
});

test("reset vide la mémoire", () => {
  const c = createCaster(roles);
  c.voiceFor({ role: "personnage", personnage: "X", genre: "homme" });
  c.reset();
  assert.equal(c.voiceFor({ role: "personnage", personnage: "Y", genre: "homme" }), "H1");
});

test("toJSON / restauration de la mémoire", () => {
  const c = createCaster(roles);
  c.voiceFor({ role: "personnage", personnage: "A", genre: "homme" });
  const c2 = createCaster(roles, c.toJSON());
  assert.equal(c2.voiceFor({ role: "personnage", personnage: "B", genre: "homme" }), "H2");
  assert.equal(c2.voiceFor({ role: "personnage", personnage: "a", genre: "homme" }), "H1");
});

test("pickDefaultVoices avec labels", () => {
  const list = [
    { voice_id: "m1", name: "Adam", labels: { gender: "male", age: "middle aged" } },
    { voice_id: "f1", name: "Rachel", labels: { gender: "female", age: "young" } },
    { voice_id: "m2", name: "Old", labels: { gender: "male", age: "old" } },
  ];
  const r = pickDefaultVoices(list);
  assert.ok(r.homme.includes("m1"));
  assert.deepEqual(r.femme, ["f1"]);
  assert.equal(r.creature, "m2");
  assert.ok(r.narrateur && r.regle);
});

test("pickDefaultVoices sans labels : tout tombe sur la première voix", () => {
  const r = pickDefaultVoices([{ voice_id: "x", name: "X" }, { voice_id: "y", name: "Y" }]);
  assert.equal(r.narrateur, "x");
  assert.equal(r.regle, "x");
  assert.equal(r.creature, "x");
  assert.ok(r.homme.length > 0 && r.femme.length > 0);
});

import { FRENCH_CAST, defaultRoles, fallbackVoiceFor, castVoiceOptions } from "../js/voices.js";

test("distribution française par défaut", () => {
  const r = defaultRoles();
  assert.equal(r.narrateur, FRENCH_CAST.narrateur.id);
  assert.equal(r.regle, FRENCH_CAST.regle.id);
  assert.equal(r.creature, FRENCH_CAST.creature.id);
  assert.equal(r.homme.length, FRENCH_CAST.homme.length);
  assert.equal(r.femme.length, FRENCH_CAST.femme.length);
  const all = [r.narrateur, r.regle, r.creature, ...r.homme, ...r.femme];
  assert.equal(new Set(all).size, all.length, "aucune voix en double");
});

test("voix de secours : premade du même rôle ou du même genre", () => {
  const r = defaultRoles();
  assert.equal(fallbackVoiceFor(r.narrateur), "JBFqnCBsd6RMkjVDRZzb");
  assert.equal(fallbackVoiceFor(r.regle), "Xb7hH8MSUJpSbSDYk0k2");
  assert.equal(fallbackVoiceFor(r.femme[0]), "EXAVITQu4vr4xnSDxMaL");
  assert.equal(fallbackVoiceFor(r.homme[1]), "nPczCjzI2devNBz1zQrb");
  assert.equal(fallbackVoiceFor("inconnue"), "JBFqnCBsd6RMkjVDRZzb");
  assert.equal(fallbackVoiceFor("JBFqnCBsd6RMkjVDRZzb"), null, "pas de secours pour une voix déjà premade");
});

test("options de voix : distribution française puis voix du compte, sans doublon", () => {
  const opts = castVoiceOptions([{ voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", labels: { gender: "male" } }, { voice_id: FRENCH_CAST.narrateur.id, name: "x" }]);
  assert.equal(opts[0].voice_id, FRENCH_CAST.narrateur.id);
  assert.equal(new Set(opts.map((o) => o.voice_id)).size, opts.length);
  assert.ok(opts.some((o) => o.voice_id === "JBFqnCBsd6RMkjVDRZzb"));
});
