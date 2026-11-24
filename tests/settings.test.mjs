import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "../js/settings.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test("stockage qui lève une erreur → valeurs par défaut", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings({ ...DEFAULT_SETTINGS }, broken));
});

test("stockage absent → valeurs par défaut", () => {
  assert.deepEqual(loadSettings(undefined), DEFAULT_SETTINGS);
});

test("aller-retour et fusion avec les valeurs par défaut", () => {
  const s = memoryStorage();
  saveSettings({ ...DEFAULT_SETTINGS, model: "claude-sonnet-5", rate: 1.2 }, s);
  const out = loadSettings(s);
  assert.equal(out.model, "claude-sonnet-5");
  assert.equal(out.rate, 1.2);
});

test("JSON corrompu → valeurs par défaut", () => {
  const s = memoryStorage();
  s.setItem("narrateur-jeux:settings", "{pas du json");
  assert.deepEqual(loadSettings(s), DEFAULT_SETTINGS);
});
