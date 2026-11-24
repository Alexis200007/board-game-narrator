import { test } from "node:test";
import assert from "node:assert/strict";
import { createFlot } from "../js/mouvement.js";

test("flot : texte étalé sur plusieurs images, sans rien perdre", async () => {
  const vus = [];
  const f = createFlot((t) => vus.push(t), { image: (g) => setTimeout(g, 0), cache: () => false });
  f.ajouter("Bonjour, ");
  f.ajouter("voici une réponse assez longue pour prendre plusieurs images.");
  await f.finir();
  assert.equal(vus.at(-1), "Bonjour, voici une réponse assez longue pour prendre plusieurs images.");
  assert.ok(vus.length > 5);
  for (let i = 1; i < vus.length; i++) assert.ok(vus[i].startsWith(vus[i - 1]));
});

test("flot : page cachée, tout est affiché tout de suite", async () => {
  const vus = [];
  const f = createFlot((t) => vus.push(t), { image: () => { throw new Error("aucune image"); }, cache: () => true });
  f.ajouter("abc");
  f.ajouter("def");
  await f.finir();
  assert.equal(vus.at(-1), "abcdef");
});

test("flot : sans texte, finir se termine", async () => {
  await createFlot(() => {}, { image: (g) => setTimeout(g, 0), cache: () => false }).finir();
});
