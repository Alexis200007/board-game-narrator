import { test } from "node:test";
import assert from "node:assert/strict";
import { ttsText, errorMessageFor } from "../js/tts.js";
import { createPlayer } from "../js/player.js";

test("ttsText avec et sans ton", () => {
  assert.equal(ttsText({ role: "narrateur", ton: "[whispers]", texte_fr: "Silence." }), "[whispers] Silence.");
  assert.equal(ttsText({ role: "narrateur", ton: "", texte_fr: "Silence." }), "Silence.");
});

test("ttsText d'une règle n'a jamais de balise", () => {
  const t = ttsText({ role: "regle", ton: "[shouting]", texte_fr: "Piochez deux cartes." });
  assert.ok(!t.includes("["));
});

test("messages d'erreur ElevenLabs", () => {
  assert.equal(errorMessageFor(401, ""), "Clé ElevenLabs invalide");
  assert.equal(errorMessageFor(429, ""), "Quota ElevenLabs atteint");
  assert.equal(errorMessageFor(402, ""), "Voix non disponible avec ce forfait ElevenLabs");
  assert.equal(errorMessageFor(401, '{"detail":{"status":"quota_exceeded"}}'), "Quota ElevenLabs atteint");
});

// Faux élément <audio> : "joue" instantanément et déclenche "ended".
function fakeAudio() {
  const listeners = {};
  const el = {
    src: "",
    played: [],
    addEventListener: (t, fn) => ((listeners[t] ||= []).push(fn)),
    removeEventListener: (t, fn) => (listeners[t] = (listeners[t] || []).filter((f) => f !== fn)),
    play() {
      el.played.push(el.src);
      queueMicrotask(() => (listeners.ended || []).forEach((f) => f()));
      return Promise.resolve();
    },
    pause() {},
  };
  return el;
}

test("player : joue tout, continue après une erreur, précharge", async () => {
  globalThis.URL.createObjectURL = (b) => `blob:${b}`;
  globalThis.URL.revokeObjectURL = () => {};
  const audio = fakeAudio();
  const states = [];
  const fetched = [];
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const player = createPlayer(audio, {
    fetchAudio: async (i) => {
      fetched.push(i);
      if (i === 1) throw new Error("boom");
      return `b${i}`;
    },
    onState: (i, s) => {
      states.push(`${i}:${s}`);
      if (i === 2 && s === "fini") resolveDone();
    },
  });
  player.playFrom(0, 3);
  await done;
  assert.deepEqual(audio.played, ["blob:b0", "blob:b2"]);
  assert.ok(states.includes("1:erreur"));
  assert.ok(states.includes("0:fini"));
  assert.deepEqual([...new Set(fetched)].sort(), [0, 1, 2]);
});

test("player : précharge tous les passages dès le début, 3 à la fois au maximum", async () => {
  globalThis.URL.createObjectURL = (b) => `blob:${b}`;
  globalThis.URL.revokeObjectURL = () => {};
  const audio = fakeAudio();
  let inFlight = 0, maxInFlight = 0;
  const started = [];
  const player = createPlayer(audio, {
    concurrency: 3,
    fetchAudio: async (i) => {
      started.push(i);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return `b${i}`;
    },
  });
  const done = player.playFrom(0, 6);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(started, [0, 1, 2], "les 3 premiers partent tout de suite");
  await done;
  assert.equal(maxInFlight, 3);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
});

test("player : pause demandée entre deux passages", async () => {
  globalThis.URL.createObjectURL = (b) => `blob:${b}`;
  globalThis.URL.revokeObjectURL = () => {};
  const audio = fakeAudio();
  const gaps = [];
  const player = createPlayer(audio, {
    fetchAudio: async (i) => `b${i}`,
    gapBefore: (i) => { gaps.push(i); return i === 1 ? 60 : 0; },
  });
  const t0 = Date.now();
  await player.playFrom(0, 3);
  assert.deepEqual(gaps, [1, 2], "pas de pause avant le premier passage");
  assert.ok(Date.now() - t0 >= 55, "la pause de 60 ms a eu lieu");
});
