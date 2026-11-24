import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createHandler } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { createImagesLivret } from "../server/images-livret.mjs";
import { extractPdfText, planLivret } from "../server/livret-pdf.mjs";
import { lireReferences, createFiltreReferences } from "../server/references.mjs";
import { livretPourQuestion, rulesQuestionSystem } from "../server/prompts.mjs";
import { aSurprises } from "../js/references.js";

const livret = [
  { id: "a", titre: "Regles, p. 1–2", source: "s1", texte: "=== p. 1 ===\nx\n=== p. 2 ===\ny" },
  { id: "b", titre: "Regles, p. 3", source: "s1", texte: "=== p. 3 ===\nz" },
  { id: "c", titre: "Page 3", texte: "photo" },
];

test("références : lues, retirées du texte, limitées aux pages qui existent", () => {
  const r = lireReferences("Oui.\n[[L1 p. 3 | \"the party may\"]]", livret);
  assert.equal(r.texte, "Oui.");
  assert.deepEqual(r.refs, [{ source: "s1", page: 3, photo: false, titre: "Regles", citation: "the party may" }]);
  assert.deepEqual(lireReferences("A [[L1 p. 9 | x]] [[L7 p. 1]]", livret), { texte: "A", refs: [] });
  assert.deepEqual(lireReferences("A [[L2 | mots]]", livret).refs.map((x) => [x.source, x.page, x.photo]), [["c", 1, true]]);
  assert.equal(lireReferences("A [[L1 p. 1]][[L1 p. 1]][[L1 p. 2]][[L1 p. 3]]", livret).refs.length, 2);
  assert.equal(lireReferences("Coupée ici [[L1 p. 3 | the", livret).texte, "Coupée ici");
});

test("filtre : la marque n'est jamais envoyée, quelle que soit la taille des morceaux", () => {
  const t = "Oui [sauf une fois]. Voilà.\n[[L1 p. 3 | mots]]";
  for (const pas of [1, 2, 5, 100]) {
    let s = "";
    const f = createFiltreReferences((m) => { s += m; });
    for (let i = 0; i < t.length; i += pas) f(t.slice(i, i + pas));
    assert.equal(s.trim(), "Oui [sauf une fois]. Voilà.");
    assert.ok(s.endsWith("\n"));
  }
});

test("consignes : codes des livrets et demande de marque", () => {
  assert.match(livretPourQuestion(livret), /\[L1\] Regles, p\. 3[^]*\[L2\] Page 3/);
  assert.match(rulesQuestionSystem(), /\[\[L1 p\. 64/);
});

test("jeu à surprises", () => {
  assert.ok(aSurprises({ nom: "X", livret: [{ titre: "Pandemic-Legacy" }] }));
  assert.ok(!aSurprises({ nom: "Gloomhaven", livret: [{ titre: "Rulebook" }] }));
});

async function pdf(textes) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of textes) d.addPage([612, 792]).drawText(t, { x: 50, y: 700, size: 12, font: f });
  return Buffer.from(await d.save());
}

test("images : PDF rattaché au livret, page dessinée, passage repéré, effacé avec le livret", async () => {
  const dir = mkdtempSync(join(tmpdir(), "narrateur-"));
  const store = createStore(dir);
  const images = createImagesLivret(join(dir, "livrets"));
  const runTask = async (o) => { o.onText?.("Oui.\n[[L1 p."); return { ok: true, text: "Oui.\n[[L1 p. 2 | the party may retreat]]" }; };
  const srv = createServer(createHandler({ root: process.cwd(), store, images, runTask }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const bon = await pdf(["First page with quite a lot of text about the game setup.", "Retreating: at the end of a round the party may retreat if all agree."]);
    const autre = await pdf(["Another rulebook entirely, nothing to do with this one at all.", "Second page of the other rulebook, still nothing to do."]);
    const jeu = await store.createGame("Images");
    const { textChunks } = planLivret(await extractPdfText(bon));
    await store.update(jeu.id, (j) => { j.livret.push({ id: "p1", titre: "R, p. 1–2", source: "src", texte: textChunks[0].texte }); return j; });
    const b = `${base}/api/jeux/${jeu.id}`;
    const envoyer = (p) => fetch(`${b}/livret/src/images`, { method: "POST", body: p });
    assert.equal((await fetch(`${b}/livret/src/page/2`)).status, 404);
    assert.equal((await envoyer(autre)).status, 409);
    assert.equal((await envoyer(Buffer.from("rien"))).status, 400);
    assert.equal((await envoyer(bon)).status, 200);
    assert.equal((await (await fetch(b)).json()).livret[0].images, true);
    const img = await fetch(`${b}/livret/src/page/2`);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    const octets = Buffer.from(await img.arrayBuffer());
    assert.deepEqual([...octets.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepEqual(Buffer.from(await (await fetch(`${b}/livret/src/page/2`)).arrayBuffer()), octets);
    assert.equal((await fetch(`${b}/livret/src/page/7`)).status, 404);
    assert.equal((await fetch(`${b}/livret/..%2Fjeux/page/1`)).status, 404);
    const { boites } = await (await fetch(`${b}/livret/src/page/2/repere?q=${encodeURIComponent("the party  may retreat")}`)).json();
    assert.equal(boites.length, 1);
    assert.ok(boites[0][0] > 0.2 && boites[0][1] > 0.08 && boites[0][1] < 0.14, JSON.stringify(boites));
    assert.deepEqual((await (await fetch(`${b}/livret/src/page/1/repere?q=${encodeURIComponent("completely absent words here")}`)).json()).boites, []);
    const flux = await (await fetch(`${b}/question?flux=1`, { method: "POST", body: JSON.stringify({ question: "x" }) })).text();
    const lignes = flux.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lignes[0].morceau, "Oui.\n");
    assert.deepEqual(lignes.at(-1).refs.map((r) => [r.source, r.page]), [["src", 2]]);
    const d = (await store.getGame(jeu.id)).groupes[0].parties[0].discussion.at(-1);
    assert.equal(d.texte, "Oui.");
    assert.equal(d.refs[0].page, 2);
    await fetch(`${b}/livret/p1`, { method: "DELETE" });
    assert.equal((await images.sources(jeu.id)).size, 0);
  } finally { srv.closeAllConnections(); srv.close(); }
});
