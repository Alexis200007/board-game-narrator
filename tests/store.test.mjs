import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, slugify } from "../server/store.mjs";

const fresh = () => createStore(mkdtempSync(join(tmpdir(), "narrateur-")));

test("identifiant tiré du nom", () => {
  assert.equal(slugify("Gloomhaven 2"), "gloomhaven-2");
  assert.equal(slugify("  Les Aventuriers du Rail ! "), "les-aventuriers-du-rail");
  assert.equal(slugify("Éclipse : Ère"), "eclipse-ere");
  assert.equal(slugify("!!!"), "jeu");
});

test("créer, lire et lister des jeux ; identifiants uniques", async () => {
  const s = fresh();
  const a = await s.createGame("Gloomhaven");
  const b = await s.createGame("Gloomhaven");
  assert.equal(a.id, "gloomhaven");
  assert.equal(b.id, "gloomhaven-2");
  assert.deepEqual(a.glossaire, {});
  assert.equal(a.groupes[0].parties.length, 1, "une première partie est créée");
  assert.deepEqual((await s.listGames()).map((g) => g.id).sort(), ["gloomhaven", "gloomhaven-2"]);
  assert.equal((await s.getGame("gloomhaven")).nom, "Gloomhaven");
});

test("identifiant invalide refusé", async () => {
  const s = fresh();
  assert.equal(await s.getGame("../../windows"), null);
  await assert.rejects(() => s.update("../x", (g) => g), /invalide/);
});

test("écritures simultanées : aucune perdue", async () => {
  const s = fresh();
  const g = await s.createGame("Test");
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    s.update(g.id, (jeu) => { jeu.glossaire[`mot${i}`] = `fr${i}`; return jeu; })));
  assert.equal(Object.keys((await s.getGame(g.id)).glossaire).length, 20);
});

test("fichier corrompu : jeu manquant, pas de plantage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "narrateur-"));
  const s = createStore(dir);
  writeFileSync(join(dir, "jeux", "casse.json"), "{pas du json");
  assert.equal(await s.getGame("casse"), null);
  assert.deepEqual(await s.listGames(), []);
});

test("groupes : un jeu neuf a un groupe principal avec une partie", async () => {
  const s = fresh();
  const g = await s.createGame("Gloomhaven");
  assert.equal(g.groupes.length, 1);
  assert.equal(g.groupes[0].nom, "Groupe principal");
  assert.equal(g.groupes[0].parties.length, 1);
  assert.deepEqual(g.groupes[0].personnages, {});
  assert.equal(g.parties, undefined);
});

test("ancien format : parties et personnages déplacés dans le groupe principal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "narrateur-"));
  const s = createStore(dir);
  const ancien = { id: "ancien", nom: "Ancien", glossaire: { Loot: "Butin" }, personnages: { assigned: { a: "V" }, counters: {} }, livret: [],
    parties: [{ id: "p1", debut: "2026-11-23T10:00:00Z", cartes: [{ date: "x", analyse: {} }], discussion: [], resume: null }] };
  writeFileSync(join(dir, "jeux", "ancien.json"), JSON.stringify(ancien));
  const g = await s.getGame("ancien");
  assert.equal(g.groupes.length, 1);
  assert.equal(g.groupes[0].parties[0].id, "p1");
  assert.equal(g.groupes[0].parties[0].cartes.length, 1);
  assert.deepEqual(g.groupes[0].personnages, { assigned: { a: "V" }, counters: {} });
  assert.equal(g.parties, undefined);
  assert.deepEqual(g.glossaire, { Loot: "Butin" });
});
