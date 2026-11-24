import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHandler } from "../server/app.mjs";

const valid = {
  type: "carte",
  texte_original: "Draw 2 cards.",
  segments: [{ role: "regle", personnage: "", genre: "inconnu", ton: "", texte_fr: "Piochez 2 cartes." }],
};

async function withServer(opts, fn) {
  const srv = createServer(createHandler({ root: process.cwd(), ...opts }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

test("analyser : passe l'image et le modèle au lanceur", async () => {
  const calls = [];
  const runClaude = async (b64, model) => { calls.push([b64, model]); return { ok: true, data: valid }; };
  await withServer({ runClaude }, async (base) => {
    const res = await fetch(`${base}/api/analyser?modele=claude-sonnet-5`, { method: "POST", body: Buffer.from("ABC") });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.segments.length, 1);
    assert.deepEqual(calls, [[Buffer.from("ABC").toString("base64"), "claude-sonnet-5"]]);
  });
});

test("analyser : erreur du lanceur → message français, statut 502", async () => {
  const runClaude = async () => ({ ok: false, erreur: "Claude n'est pas connecté." });
  await withServer({ runClaude }, async (base) => {
    const res = await fetch(`${base}/api/analyser`, { method: "POST", body: "x" });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).erreur, "Claude n'est pas connecté.");
  });
});

test("analyser : photo trop lourde refusée", async () => {
  await withServer({ runClaude: async () => ({ ok: true, data: valid }), maxBytes: 10 }, async (base) => {
    const res = await fetch(`${base}/api/analyser`, { method: "POST", body: "x".repeat(50) });
    assert.equal(res.status, 413);
  });
});

test("analyser : une seule analyse à la fois (file d'attente)", async () => {
  let running = 0, max = 0;
  const runClaude = async () => {
    running++; max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, 30));
    running--;
    return { ok: true, data: valid };
  };
  await withServer({ runClaude }, async (base) => {
    await Promise.all([1, 2, 3].map(() => fetch(`${base}/api/analyser`, { method: "POST", body: "x" }).then((r) => r.json())));
    assert.equal(max, 1);
  });
});

test("parole : sans ElevenLabs configuré → 503 avec message", async () => {
  await withServer({ tts: null }, async (base) => {
    const res = await fetch(`${base}/api/parole`, { method: "POST", body: JSON.stringify({ text: "Bonjour", voiceId: "v" }) });
    assert.equal(res.status, 503);
    assert.match((await res.json()).erreur, /ElevenLabs/);
  });
});

test("parole : rend l'audio produit par ElevenLabs", async () => {
  const seen = [];
  const tts = { speak: async (text, voiceId) => { seen.push([text, voiceId]); return Buffer.from([1, 2, 3]); } };
  await withServer({ tts }, async (base) => {
    const res = await fetch(`${base}/api/parole`, { method: "POST", body: JSON.stringify({ text: "Bonjour", voiceId: "VOICE1" }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(seen, [["Bonjour", "VOICE1"]]);
  });
});

test("parole : voix refusée → statut d'origine transmis pour la voix de secours", async () => {
  const tts = { speak: async () => { throw Object.assign(new Error("x"), { statusCode: 402 }); } };
  await withServer({ tts }, async (base) => {
    const res = await fetch(`${base}/api/parole`, { method: "POST", body: JSON.stringify({ text: "Bonjour", voiceId: "v" }) });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, 402);
    assert.ok(body.erreur);
  });
});

test("parole : texte vide refusé", async () => {
  await withServer({ tts: { speak: async () => Buffer.alloc(0) } }, async (base) => {
    const res = await fetch(`${base}/api/parole`, { method: "POST", body: JSON.stringify({ text: "  ", voiceId: "v" }) });
    assert.equal(res.status, 400);
  });
});

test("voix : erreur ElevenLabs traduite", async () => {
  const tts = { listVoices: async () => { throw Object.assign(new Error("x"), { statusCode: 401 }); } };
  await withServer({ tts }, async (base) => {
    const res = await fetch(`${base}/api/voix`);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).erreur, "Clé ElevenLabs invalide");
  });
});

test("fichiers : page servie, sortie du dossier interdite, fichiers serveur cachés", async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.notEqual((await fetch(`${base}/..%2F..%2Fwindows%2Fwin.ini`)).status, 200);
    assert.equal((await fetch(`${base}/config.local.json`)).status, 404);
    assert.equal((await fetch(`${base}/server/app.mjs`)).status, 404);
  });
});
