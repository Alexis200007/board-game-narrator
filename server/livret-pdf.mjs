// Livret en PDF : le texte est lu directement dans le fichier (rapide, gratuit) ;
// seules les pages sans texte (scans, images) partent à Claude, en petits morceaux.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";

/** Texte de chaque page : [{ page, texte }]. */
export async function extractPdfText(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    await task.destroy().catch(() => {});
    throw new Error("Ce fichier n'est pas un PDF lisible.");
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let texte = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      texte += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ page: n, texte: texte.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim() });
    page.cleanup();
  }
  await task.destroy();
  return pages;
}

/**
 * Regroupe les pages lisibles en blocs d'au plus maxChars caractères ;
 * les pages avec trop peu de texte (moins de minChars) seront lues par Claude.
 */
export function planLivret(pages, { maxChars = 15_000, minChars = 40 } = {}) {
  const textChunks = [];
  const ocrPages = [];
  let current = null;
  const flush = () => { if (current) textChunks.push(current); current = null; };
  for (const { page, texte } of pages) {
    if (texte.length < minChars) { ocrPages.push(page); flush(); continue; }
    const bloc = `=== p. ${page} ===\n${texte}\n`;
    if (current && current.texte.length + bloc.length > maxChars) flush();
    if (!current) current = { pages: [], texte: "" };
    current.pages.push(page);
    current.texte += bloc;
  }
  flush();
  return { textChunks, ocrPages };
}

/** Nouveau PDF ne contenant que les pages demandées (numérotées à partir de 1). */
export async function splitPdf(buffer, pageNumbers) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageNumbers.map((n) => n - 1));
  for (const p of copied) out.addPage(p);
  return Buffer.from(await out.save());
}

/** Paquets de pages à envoyer à Claude, chacun sous la limite d'envoi (en octets) et d'au plus maxPages. */
export async function ocrBatches(buffer, pageNumbers, { maxBytes = 25 * 1024 * 1024, maxPages = 10 } = {}) {
  const batches = [];
  let i = 0;
  while (i < pageNumbers.length) {
    let size = Math.min(maxPages, pageNumbers.length - i);
    let pdf;
    for (;;) {
      pdf = await splitPdf(buffer, pageNumbers.slice(i, i + size));
      if (pdf.length <= maxBytes || size === 1) break;
      size = Math.max(1, Math.floor(size / 2));
    }
    if (pdf.length > maxBytes) throw new Error(`La page ${pageNumbers[i]} du PDF est trop lourde pour être lue.`);
    batches.push({ pages: pageNumbers.slice(i, i + size), pdf });
    i += size;
  }
  return batches;
}
