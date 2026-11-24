// Dessine une page du livret PDF, ou y cherche un passage. Dans un fil à part : le serveur reste réactif.
import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

const dossier = (nom) => fileURLToPath(new URL(`../node_modules/pdfjs-dist/${nom}/`, import.meta.url)).split("\\").join("/");
const LARGEUR = 1500;

/** Lettres et chiffres seulement : les espaces et coupures du PDF ne comptent pas. */
const reduire = (t) => t.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Cadres (en fractions de la page) du passage cité, ou [] s'il n'est pas retrouvé. */
export function trouverPassage(items, citation, viewport) {
  let tout = "";
  const debuts = items.map((it) => { const d = tout.length; tout += reduire(it.str || ""); return d; });
  const q = reduire(citation || "");
  if (q.length < 8) return [];
  let a = tout.indexOf(q), n = q.length;
  // Citation légèrement retouchée ou coupée par une autre colonne : on garde le plus long bout retrouvé.
  if (a < 0) {
    n = 0;
    for (let i = 0; i + 16 <= q.length; i += 4) {
      const p = tout.indexOf(q.slice(i, i + 16));
      if (p < 0) continue;
      let fin = 16;
      while (i + fin < q.length && q[i + fin] === tout[p + fin]) fin++;
      let avant = 0;
      while (i - avant > 0 && p - avant > 0 && q[i - avant - 1] === tout[p - avant - 1]) avant++;
      if (avant + fin > n) { n = avant + fin; a = p - avant; }
    }
    if (n < 20) return [];
  }
  const boites = [];
  items.forEach((it, i) => {
    const long = (i + 1 < debuts.length ? debuts[i + 1] : tout.length) - debuts[i];
    const d = Math.max(a, debuts[i]), f = Math.min(a + n, debuts[i] + long);
    if (!long || f <= d) return;
    const [, , , , x, y] = it.transform;
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
    const g = x + (it.width * (d - debuts[i])) / long, dr = x + (it.width * (f - debuts[i])) / long;
    const [x1, y1] = viewport.convertToViewportPoint(g, y - h * 0.25);
    const [x2, y2] = viewport.convertToViewportPoint(dr, y + h);
    const b = [Math.min(x1, x2) / viewport.width, Math.min(y1, y2) / viewport.height, Math.abs(x2 - x1) / viewport.width, Math.abs(y2 - y1) / viewport.height];
    if (b.some((v) => !Number.isFinite(v))) return;
    boites.push(b.map((v) => Math.round(v * 10000) / 10000));
  });
  return boites;
}

if (parentPort && workerData?.chemin) {
  const { chemin, page, action, citation } = workerData;
  try {
    const doc = await getDocument({
      data: new Uint8Array(await readFile(chemin)), verbosity: 0, isEvalSupported: false, useSystemFonts: false,
      standardFontDataUrl: dossier("standard_fonts"), cMapUrl: dossier("cmaps"), wasmUrl: dossier("wasm"), iccUrl: dossier("iccs"),
    }).promise;
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    if (action === "repere") {
      parentPort.postMessage({ boites: trouverPassage((await p.getTextContent()).items, citation, base) });
    } else {
      const viewport = p.getViewport({ scale: LARGEUR / base.width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await p.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
      parentPort.postMessage({ image: canvas.toBuffer("image/jpeg", 85) });
    }
  } catch (err) {
    parentPort.postMessage({ erreur: err?.message || "Page illisible" });
  }
}
