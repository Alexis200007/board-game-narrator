import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../server/app.mjs";
import { lireAcces, proteger } from "../server/acces.mjs";

const MDP = "un long mot de passe";
async function avec(fn, options = {}) {
  const dossier = options.dossier ?? mkdtempSync(join(tmpdir(), "acces-"));
  const srv = createServer(proteger(createHandler({ root: process.cwd(), connexion: true }), { motDePasse: MDP, dossier, page: "connexion.html", ...options }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const entrer = (motDePasse = MDP, headers = {}) => fetch(`${base}/api/connexion`, { method: "POST", headers, body: JSON.stringify({ motDePasse }) });
  try { await fn({ base, port, entrer, dossier }); } finally { srv.closeAllConnections(); srv.close(); }
}
const jeton = (r) => r.headers.get("set-cookie").split(";")[0];

test("accès : jamais ouvert au réseau sans mot de passe", () => {
  assert.equal(lireAcces({}).hote, "127.0.0.1");
  assert.throws(() => lireAcces({ HOST: "0.0.0.0" }), /APP_PASSWORD/);
  assert.throws(() => lireAcces({ HOST: "::" }), /APP_PASSWORD/);
  assert.throws(() => lireAcces({ HOST: "0.0.0.0", APP_PASSWORD: "court" }), /12/);
  assert.deepEqual(lireAcces({ HOST: "0.0.0.0", APP_PASSWORD: MDP, TRUST_PROXY: "1" }), { hote: "0.0.0.0", motDePasse: MDP, proxy: true });
});

test("accès : sans session, ni app, ni données, ni code", async () => {
  await avec(async ({ base }) => {
    const accueil = await (await fetch(base)).text();
    assert.match(accueil, /current-password/);
    assert.doesNotMatch(accueil, /app\.js/);
    for (const c of ["/api/jeux", "/api/etat", "/js/app.js", "/api/voix", "/api//jeux", "/%61pi/jeux"]) {
      const r = await fetch(base + c);
      assert.equal(r.status, 401, c);
    }
    assert.equal((await fetch(`${base}/api/parole`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
    assert.equal((await fetch(`${base}/api/sante`)).status, 200);
  });
});

test("accès : connexion, session, déconnexion ; un jeton modifié ou périmé est refusé", async () => {
  let t = 1_000_000;
  await avec(async ({ base, entrer }) => {
    assert.equal((await entrer("faux")).status, 401);
    const r = await entrer();
    assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
    const c = jeton(r), voir = (cookie) => fetch(`${base}/api/etat`, { headers: { cookie } });
    assert.equal((await (await voir(c)).json()).connexion, true);
    assert.equal((await voir(c.replace(/\d/, "9"))).status, 401);
    assert.equal((await voir("session=a.b.c")).status, 401);
    assert.equal((await voir("session=9999999999999..")).status, 401);
    const d = await fetch(`${base}/api/deconnexion`, { method: "POST", headers: { cookie: c } });
    assert.match(d.headers.get("set-cookie"), /Max-Age=0/);
    t += 20 * 24 * 3600_000;
    assert.ok((await voir(c)).headers.get("set-cookie"), "session prolongée");
    t += 11 * 24 * 3600_000;
    assert.equal((await voir(c)).status, 401);
  }, { maintenant: () => t });
});

test("accès : changer le mot de passe ferme les sessions ; redémarrer ne les ferme pas", async () => {
  let c;
  const dossier = mkdtempSync(join(tmpdir(), "acces-"));
  await avec(async ({ entrer }) => { c = jeton(await entrer()); }, { dossier });
  await avec(async ({ base }) => assert.equal((await fetch(`${base}/api/etat`, { headers: { cookie: c } })).status, 200), { dossier });
  await avec(async ({ base }) => assert.equal((await fetch(`${base}/api/etat`, { headers: { cookie: c } })).status, 401), { dossier, motDePasse: "un autre mot de passe" });
});

test("accès : essais limités par adresse ; une adresse inventée ne contourne pas la limite", async () => {
  await avec(async ({ entrer }) => {
    const codes = (await Promise.all(Array.from({ length: 12 }, (_, i) => entrer("faux", { "x-forwarded-for": `9.9.9.${i}, 1.2.3.4` })))).map((r) => r.status);
    assert.equal(codes.filter((x) => x === 401).length, 8);
    assert.equal(codes.filter((x) => x === 429).length, 4);
    assert.equal((await entrer(MDP, { "x-forwarded-for": "1.2.3.4" })).status, 429);
    assert.equal((await entrer(MDP, { "x-forwarded-for": "5.6.7.8" })).status, 200);
  }, { proxy: true });
});

test("accès : une autre page web ne peut rien déclencher", async () => {
  await avec(async ({ base, entrer }) => {
    const cookie = jeton(await entrer());
    const r = (origin) => fetch(`${base}/api/jeux`, { method: "POST", headers: { cookie, origin }, body: "{}" });
    assert.equal((await r("https://ailleurs.example")).status, 403);
    assert.equal((await r("null")).status, 403);
    assert.notEqual((await r(base)).status, 403);
  });
});

test("accès : cookie Secure dès que l'adresse n'est pas locale", async () => {
  await avec(async ({ port }) => {
    const c = await new Promise((ok) => {
      const q = request({ port, host: "127.0.0.1", path: "/api/connexion", method: "POST", headers: { host: "jeux.example.com" } }, (res) => { res.resume(); ok(res.headers["set-cookie"][0]); });
      q.end(JSON.stringify({ motDePasse: MDP }));
    });
    assert.match(c, /^__Host-session=.*; Secure$/);
  });
});
