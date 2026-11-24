import { test } from "node:test";
import assert from "node:assert/strict";
import { createElevenTts } from "../server/eleven.mjs";

test("speak : modèle v4, français, réglages de voix, MP3", async () => {
  const calls = [];
  const client = {
    textToSpeech: {
      convert: async (voiceId, req) => {
        calls.push([voiceId, req]);
        return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([7, 8])); c.close(); } });
      },
    },
  };
  const tts = createElevenTts(client);
  const buf = await tts.speak("[whispers] Bonjour", "V1");
  assert.deepEqual([...buf], [7, 8]);
  const [voiceId, req] = calls[0];
  assert.equal(voiceId, "V1");
  assert.equal(req.text, "[whispers] Bonjour");
  assert.equal(req.modelId, "eleven_v4");
  assert.equal(req.languageCode, "fr");
  assert.equal(req.outputFormat, "mp3_44100_128");
  assert.deepEqual(req.voiceSettings, { stability: 0.5, similarityBoost: 0.75 });
});

test("listVoices : format attendu par la page", async () => {
  const client = { voices: { getAll: async () => ({ voices: [{ voiceId: "a", name: "George", category: "premade", labels: { gender: "male" } }] }) } };
  const voices = await createElevenTts(client).listVoices();
  assert.deepEqual(voices, [{ voice_id: "a", name: "George", category: "premade", labels: { gender: "male" } }]);
});

import { AMBIANCE_PROMPTS } from "../server/eleven.mjs";
import { AMBIANCES } from "../js/claude.js";

test("ambiance : SFX v3 en boucle de 20 s, une description par ambiance", async () => {
  assert.deepEqual(Object.keys(AMBIANCE_PROMPTS).sort(), AMBIANCES.filter((a) => a !== "aucune").sort());
  const calls = [];
  const client = { textToSoundEffects: { convert: async (req) => { calls.push(req); return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([9])); c.close(); } }); } } };
  const buf = await createElevenTts(client).ambiance("foret");
  assert.deepEqual([...buf], [9]);
  assert.equal(calls[0].modelId, "eleven_text_to_sound_v3");
  assert.equal(calls[0].loop, true);
  assert.equal(calls[0].durationSeconds, 20);
  assert.equal(calls[0].text, AMBIANCE_PROMPTS.foret);
});

test("speak rapide : même famille de voix que les cartes (v4), pour garder l'accent", async () => {
  let req;
  const client = { textToSpeech: { convert: async (_, r) => { req = r; return new Blob([new Uint8Array([1])]).stream(); } } };
  await createElevenTts(client).speak("Bonjour", "V1", { rapide: true });
  assert.equal(req.modelId, "eleven_v4_turbo");
  assert.equal(req.languageCode, "fr");
});
