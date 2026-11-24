import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { ouvrirConversation, createConversations } from "../server/direct.mjs";
import { sansEcho, estArret, assezPourCouper, createVeille, createPorte, createConfirmation, texteEntendu, createVoixDirecte } from "../js/direct.js";

/** Faux `claude` : garde ce qu'il reçoit ; dire() et finir() jouent ses réponses. */
function fauxClaude() {
  const e = new EventEmitter();
  e.stdout = new EventEmitter(); e.stderr = new EventEmitter();
  e.stdin = Object.assign(new EventEmitter(), { write: (l) => e.recu.push(JSON.parse(l)), end() {} });
  e.recu = [];
  e.kill = () => {};
  e.dire = (text) => e.stdout.emit("data", JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }) + "\n");
  e.finir = (result, is_error = false) => e.stdout.emit("data", JSON.stringify({ type: "result", result, is_error }) + "\n");
  e.lancer = () => e;
  return e;
}
const souffle = () => new Promise((r) => setTimeout(r, 5));
const texteDe = (m) => m.message?.content[0].text;

test("conversation : préparation, réponse au fil, coupure, suite avec ce qui a été entendu", async () => {
  const c = fauxClaude();
  const conv = ouvrirConversation({ system: "s", contexte: "CTX", lancer: c.lancer });
  await souffle();
  assert.match(texteDe(c.recu[0]), /CTX/);
  c.finir("ok");
  const recus = [];
  const p = conv.demander("Combien ?", (t) => recus.push(t));
  await souffle();
  assert.equal(texteDe(c.recu[1]), "Combien ?");
  c.dire("Deux actions. ");
  conv.couper("Deux");
  assert.equal(c.recu[2].request.subtype, "interrupt");
  c.dire("perdu");
  c.finir("", true);
  assert.deepEqual(await p, { ok: true, text: "Deux actions.", coupe: true });
  assert.deepEqual(recus, ["Deux actions. "]);
  const q = conv.demander("Et le combat ?", () => {});
  await souffle();
  assert.match(texteDe(c.recu[3]), /entendu seulement : « Deux »[^]*Et le combat/);
  c.finir("Voilà.");
  assert.equal((await q).text, "Voilà.");
  const z = conv.demander("z", () => {});
  await souffle();
  assert.equal(texteDe(c.recu[4]), "z");
  conv.fermer();
  assert.equal((await z).ok, false);
});

test("conversation : question coupée pendant la préparation, jamais envoyée", async () => {
  const c = fauxClaude();
  const conv = ouvrirConversation({ system: "s", contexte: "", lancer: c.lancer });
  const a = conv.demander("première", () => {});
  conv.couper("");
  const b = conv.demander("complète", () => {});
  await souffle();
  c.finir("ok");
  assert.equal((await a).coupe, true);
  await souffle();
  assert.equal(c.recu.length, 2);
  assert.match(texteDe(c.recu[1]), /complète ou remplace sa question[^]*complète$/);
  conv.fermer();
  await b;
});

test("conversations : deux au plus, réservées à leur jeu, fermées si inactives", async () => {
  const fermees = [];
  const cs = createConversations({ inactiviteMs: 20, ouvrir: ({ nom, onFermee }) => ({ fermer() { fermees.push(nom); onFermee(); } }) });
  cs.creer("a", "jeu", { nom: "a" }); cs.creer("b", "jeu", { nom: "b" }); cs.creer("c", "jeu", { nom: "c" });
  assert.deepEqual(fermees, ["a"]);
  assert.equal(cs.trouver("b", "autre"), null);
  assert.ok(cs.trouver("b", "jeu"));
  await new Promise((r) => { const i = setInterval(() => {}, 5); setTimeout(() => { clearInterval(i); r(); }, 80); });
  assert.deepEqual(fermees.sort(), ["a", "b", "c"]);
});

test("routes : ouvrir, question gardée dans le chat, couper, fermer, voix par morceaux", async () => {
  const faits = [];
  const conversations = createConversations({
    ouvrir: ({ system, onFermee }) => {
      faits.push(system);
      return {
        demander: async (q, f) => { f("Oui"); return { ok: true, text: "Oui", coupe: q === "coupe" }; },
        couper: (t) => faits.push("coupe " + t),
        fermer: onFermee,
      };
    },
  });
  const tts = { jetonTranscription: async () => "J", streamPcm: async function* () { yield Buffer.from([1, 2]); yield Buffer.from([3, 4]); } };
  const store = createStore(mkdtempSync(join(tmpdir(), "narrateur-")));
  const srv = createServer(createHandler({ root: process.cwd(), store, tts, conversations }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, o = {}) => fetch(base + p, { method: "POST", body: JSON.stringify(o) });
  try {
    const jeu = await store.createGame("Direct");
    const { session } = await (await post(`/api/jeux/${jeu.id}/direct`)).json();
    assert.match(faits[0], /conversation en direct[^]*LIVRET/);
    const b = `/api/jeux/${jeu.id}/direct/${session}`;
    assert.equal((await (await post(b + "/jeton")).json()).jeton, "J");
    const l = (await (await post(b + "/question", { question: "coupe" })).text()).trim().split("\n").map((x) => JSON.parse(x));
    assert.deepEqual(l, [{ morceau: "Oui" }, { fin: true, reponse: "Oui …" }]);
    assert.deepEqual((await store.getGame(jeu.id)).groupes[0].parties[0].discussion.map((m) => m.texte), ["coupe", "Oui …"]);
    await post(b + "/couper", { entendu: "O" });
    assert.equal(faits.at(-1), "coupe O");
    assert.deepEqual([...Buffer.from(await (await post("/api/parole-directe", { text: "a", voiceId: "v" })).arrayBuffer())], [1, 2, 3, 4]);
    assert.equal((await fetch(base + b, { method: "DELETE" })).status, 200);
    assert.equal((await post(b + "/question", { question: "x" })).status, 410);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test("écho : reconnaît sa propre voix, pas une vraie question", () => {
  const dit = "Tu peux faire deux actions par jour, puis tu te reposes au camp.";
  assert.equal(sansEcho("faire deux actions par jour puis", dit), "");
  assert.equal(sansEcho("et si je veux attaquer deux fois", dit), "et si je veux attaquer deux fois");
  assert.equal(sansEcho("attends", dit), "attends");
  assert.equal(sansEcho("deux actions par jour. Stop !", dit), "Stop");
  assert.equal(sansEcho("Tu peux, c'est-", dit), "c'est-");
  assert.ok(!assezPourCouper("c'est-"));
});

test("arrêt et coupure", () => {
  for (const t of ["Stop !", "Attends, attends.", "Ok, merci.", "C'est bon.", "Tais-toi"]) assert.ok(estArret(t), t);
  assert.ok(!estArret("Attends, et le combat ?"));
  assert.ok(assezPourCouper("Arrête"));
  assert.ok(assezPourCouper("et le combat"));
  assert.ok(!assezPourCouper("Hum."));
});

function veiller(v, niveaux) {
  let ms = 0;
  for (const [n, duree] of niveaux) for (const fin = ms + duree; ms < fin; ms += 20) if (v.mesurer(n, ms)) return ms;
  return null;
}
test("veille : ignore l'écho, entend le joueur vite, moins sensible après une fausse alerte", () => {
  assert.equal(veiller(createVeille(), [[0.03, 5000]]), null);
  const ms = veiller(createVeille(), [[0.005, 1100], [0.1, 1000]]);
  assert.ok(ms > 1200 && ms < 1500, String(ms));
  assert.equal(veiller(createVeille(), [[0.005, 1200], [0.1, 100], [0.005, 1000]]), null);
  const v = createVeille();
  v.fausseAlerte(); v.fausseAlerte();
  assert.equal(veiller(v, [[0.03, 1200], [0.08, 1000]]), null);
});

test("texte entendu : phrases finies et part de celle en cours", () => {
  const p = [{ texte: "Un deux.", echantillons: 100, finie: true }, { texte: "a b c d", echantillons: 100, finie: true }];
  assert.equal(texteEntendu(p, 150), "Un deux. a b");
  assert.equal(texteEntendu(p, 0), "");
  assert.equal(texteEntendu(p, 200), "Un deux. a b c d");
});

test("voix directe : dans l'ordre, octets impairs recollés, coupure", async () => {
  const recu = [];
  const port = { postMessage: (m) => recu.push(m.pcm ? [...new Uint8Array(m.pcm)] : m) };
  const reponses = { a: [[1], [2, 3, 4]], b: [[5, 6]] };
  const voix = createVoixDirecte(port, async (t) => {
    if (t === "a") await souffle();
    return new Response(new ReadableStream({ start(c) { for (const x of reponses[t]) c.enqueue(Uint8Array.from(x)); c.close(); } }));
  });
  voix.dire("a"); voix.dire("b");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(recu.flat(), [1, 2, 3, 4, 5, 6]);
  assert.ok(voix.phrases.every((p) => p.finie));
  voix.vider();
  assert.deepEqual(recu.at(-1), { vider: true });
  assert.equal(voix.dit, "");
});

test("veille : sourde au début de chaque réponse (annulation d'écho pas encore réglée)", () => {
  const v = createVeille();
  assert.equal(veiller(v, [[0.005, 450], [0.2, 400]]), null);
  v.recommencer();
  assert.equal(veiller(v, [[0.3, 500]]), null);
});

test("porte : jamais la voix de l'app, mais le début de la parole du joueur", () => {
  const p = createPorte(2), b = (n) => Uint8Array.from([n, n]).buffer, lire = (l) => l.map((x) => new Uint8Array(x)[0]);
  assert.deepEqual(lire(p.passer(b(1), true)), [0]);
  p.passer(b(2), true); p.passer(b(3), true);
  assert.deepEqual(lire(p.passer(b(4), false)), [2, 3, 4]);
  assert.deepEqual(lire(p.passer(b(5), false)), [5]);
  p.passer(b(6), true);
  p.oublier();
  assert.deepEqual(lire(p.passer(b(7), false)), [7]);
});

test("confirmation : l'écho qui s'éteint n'est pas une voix, une vraie parole oui", () => {
  const essai = (niveaux) => {
    const c = createConfirmation();
    let ms = 0, r = "attente";
    for (const [n, duree] of niveaux) for (const fin = ms + duree; ms < fin && r === "attente"; ms += 20) r = c.mesurer(n, ms);
    return r;
  };
  assert.equal(essai([[0.2, 280], [0.004, 1500]]), "rien");
  assert.equal(essai([[0.05, 1500]]), "humain");
  assert.equal(essai([[0.2, 300], [0.004, 200], [0.06, 400]]), "humain");
});
