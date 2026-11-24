import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecoupeur, textePourVoix, createLecteur } from "../js/vocal.js";

function couper(texte, pas) {
  const d = createDecoupeur(), out = [];
  for (let i = 0; i < texte.length; i += pas) out.push(...d.ajouter(texte.slice(i, i + pas)));
  return [...out, ...d.fin()];
}

test("découpeur : mêmes phrases quelle que soit la taille des morceaux", () => {
  const t = "Oui, tu peux attaquer. Tu lances 1.5 dé, voir p. 12 du livret. Veux-tu un exemple ?";
  for (const pas of [1, 3, 10, 500]) {
    assert.deepEqual(couper(t, pas), ["Oui, tu peux attaquer.", "Tu lances 1.5 dé, voir p. 12 du livret.", "Veux-tu un exemple ?"]);
  }
});

test("découpeur : phrase très courte jointe à la suivante", () => {
  assert.deepEqual(couper("Oui. Deux actions par tour.", 4), ["Oui. Deux actions par tour."]);
  assert.deepEqual(couper("", 1), []);
});

test("textePourVoix : sans mise en forme", () => {
  assert.equal(textePourVoix("**Combat** :\n- lance `2` dés"), "Combat : lance 2 dés");
});

function fauxAudio() {
  const ec = { ended: new Set(), error: new Set() };
  return {
    joues: 0,
    pause() {},
    addEventListener: (t, f) => ec[t].add(f),
    removeEventListener: (t, f) => ec[t].delete(f),
    async play() { this.joues++; },
    terminer() { for (const f of [...ec.ended]) f(); },
  };
}
const attendre = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("lecteur : phrases dans l'ordre, même si la deuxième est prête avant", async () => {
  const a = fauxAudio(), ordre = [];
  const l = createLecteur(a, async (p) => { await attendre(p === "un" ? 20 : 1); return new Blob([p]); });
  l.dire("un", () => ordre.push("un"));
  l.dire("deux", () => ordre.push("deux"));
  await attendre(60);
  assert.deepEqual(ordre, ["un"]);
  a.terminer();
  await attendre();
  assert.deepEqual(ordre, ["un", "deux"]);
  a.terminer();
  assert.equal(await l.attendre(), null);
});

test("lecteur : couper arrête la suite ; une erreur de voix est signalée", async () => {
  const a = fauxAudio();
  const l = createLecteur(a, async (p) => { if (p === "x") throw new Error("Quota"); return new Blob([p]); });
  l.dire("un");
  l.dire("deux");
  await attendre();
  l.couper();
  await attendre();
  assert.equal(a.joues, 1);
  l.dire("x");
  assert.equal((await l.attendre()).message, "Quota");
});

// Niveaux mesurés sur une vraie voix douce (une question de 4 s) : elle avait été coupée avant la fin.
const VOIX_DOUCE = "0 0 0.005 0.038 0.021 0.018 0.021 0.023 0.023 0.01 0.024 0.008 0 0.006 0.006 0.009 0.002 0 0 0 0 0.014 0.005 0.011 0.001 0.007 0.043 0.027 0.037 0.001 0.006 0.029 0.01 0.026 0.022 0.021 0.013 0.016 0.016 0.003 0 0.008 0.015 0.009 0.006 0.007 0.02 0.013 0 0.003 0.022 0.016 0 0.029 0.014 0.014 0.009 0.016 0.007 0.005 0.009 0.017 0.022 0.034 0.032 0.022 0.018 0.003 0.002 0.016 0.001 0.006 0.003 0.012 0.012 0.002 0.002 0.003 0.002 0.001 0 0".split(" ").map(Number);

test("découpeur en direct : la voix part à la première virgule assez loin, une seule fois", () => {
  const d = createDecoupeur(12, { debutVite: true }), out = [];
  for (const c of "Oui, tu peux te retirer du combat, mais à la fin, avec l'accord. Voilà.") out.push(...d.ajouter(c));
  assert.deepEqual([...out, ...d.fin()], ["Oui, tu peux te retirer du combat,", "mais à la fin, avec l'accord.", "Voilà."]);
});
