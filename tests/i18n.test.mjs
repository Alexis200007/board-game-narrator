import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { t, tErreur } from "../js/i18n.js";
import { EN } from "../js/en.js";
import { analysisSystem } from "../js/claude.js";
import { directSystem, rulesQuestionSystem, aideSystem, summarySystem, livretPourQuestion } from "../server/prompts.mjs";
import { defaultRoles, ENGLISH_CAST, castVoiceOptions } from "../js/voices.js";

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("anglais : chaque texte traduit existe, avec les mêmes valeurs", () => {
  const manquants = [];
  for (const f of readdirSync(new URL("../js/", import.meta.url))) {
    for (const m of lire(`js/${f}`).matchAll(/\b(?:t|traduire|tErreur)\(("(?:[^"\\]|\\.)*")/g)) if (!(JSON.parse(m[1]) in EN)) manquants.push(`${f} ${m[1]}`);
  }
  assert.deepEqual(manquants, []);
  const valeurs = (s) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join();
  for (const [fr, en] of Object.entries(EN)) assert.equal(valeurs(en), valeurs(fr), fr);
});

test("anglais : tous les textes de la page sont traduits", () => {
  const corps = lire("index.html").split("<body>")[1].replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, "");
  const textes = [...corps.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  const attributs = [...corps.matchAll(/(?:placeholder|aria-label|alt)="([^"]+)"/g)].map((m) => m[1]);
  const libres = new Set(["Français", "English", "1,00×"]);
  assert.deepEqual([...textes, ...attributs].filter((x) => /\p{L}|\d/u.test(x) && !libres.has(x) && !(x in EN)), []);
});

test("anglais : toutes les erreurs du serveur sont traduites", () => {
  const manquantes = [];
  for (const f of readdirSync(new URL("../server/", import.meta.url))) {
    for (const m of lire(`server/${f}`).matchAll(/erreur: ("[^"]{6,}")/g)) if (!(JSON.parse(m[1]) in EN)) manquantes.push(m[1]);
  }
  assert.deepEqual(manquantes, []);
  assert.equal(tErreur("Erreur ElevenLabs (500)", "en"), "ElevenLabs error (500)");
  assert.equal(tErreur("Erreur du serveur (502).", "en"), "Server error (502)");
  assert.equal(tErreur("Jeu introuvable.", "fr"), "Jeu introuvable.");
  assert.equal(t("{n} cartes lues", { n: 3 }, "en"), "3 cards read");
  assert.equal(t("{n} cartes lues", { n: 3 }), "3 cartes lues");
});

test("anglais : consignes et voix de la bonne langue", () => {
  const jeu = { nom: "Essai", glossaire: {}, livret: [] };
  for (const s of [directSystem(jeu, "en"), rulesQuestionSystem({ vocal: true, langue: "en" }), aideSystem("en"), summarySystem("en"), analysisSystem({ a: "b" }, "en"), livretPourQuestion([], "en")]) {
    assert.doesNotMatch(s, /réponds|livret|français/i);
  }
  assert.match(directSystem(jeu), /français/);
  assert.equal(defaultRoles("en").narrateur, ENGLISH_CAST.narrateur.id);
  assert.notEqual(defaultRoles().narrateur, defaultRoles("en").narrateur);
  assert.equal(castVoiceOptions([], "en")[0].name, ENGLISH_CAST.narrateur.name);
});
