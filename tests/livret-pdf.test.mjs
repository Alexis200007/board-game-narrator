import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText, planLivret, splitPdf } from "../server/livret-pdf.mjs";

export async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    if (text) page.drawText(text, { x: 50, y: 700, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

test("texte lu page par page, page sans texte vide", async () => {
  const pdf = await makePdf(["COMBAT RULES Each hero attacks once.", "", "SETUP Shuffle the deck."]);
  const pages = await extractPdfText(pdf);
  assert.equal(pages.length, 3);
  assert.match(pages[0].texte, /COMBAT RULES/);
  assert.equal(pages[1].texte, "");
  assert.match(pages[2].texte, /SETUP/);
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 3]);
});

test("plan : pages de texte regroupées, pages vides envoyées à Claude", () => {
  const pages = [
    { page: 1, texte: "a".repeat(100) },
    { page: 2, texte: "b".repeat(100) },
    { page: 3, texte: "" },
    { page: 4, texte: "court" },
    { page: 5, texte: "c".repeat(100) },
  ];
  const plan = planLivret(pages, { maxChars: 250, minChars: 20 });
  assert.deepEqual(plan.ocrPages, [3, 4]);
  assert.deepEqual(plan.textChunks.map((c) => c.pages), [[1, 2], [5]]);
  assert.match(plan.textChunks[0].texte, /=== p\. 1 ===/);
});

test("découpe : garde seulement les pages demandées", async () => {
  const pdf = await makePdf(["un", "deux", "trois", "quatre"]);
  const part = await splitPdf(pdf, [2, 4]);
  const doc = await PDFDocument.load(part);
  assert.equal(doc.getPageCount(), 2);
  const pages = await extractPdfText(part);
  assert.deepEqual(pages.map((p) => p.texte), ["deux", "quatre"]);
});

test("PDF illisible : erreur claire", async () => {
  await assert.rejects(() => extractPdfText(Buffer.from("pas un pdf")), /PDF/);
});
