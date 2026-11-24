// Images des livrets : le PDF d'origine (ou la photo) est gardé dans data/livrets/<jeu>/,
// et une page n'est dessinée que la première fois qu'on la montre.
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const SUR = /^[\w-]{1,80}$/;
const ouvrier = (donnees) => new Promise((resolve, reject) => {
  const w = new Worker(new URL("./page-worker.mjs", import.meta.url), { workerData: donnees });
  const minuteur = setTimeout(() => { w.terminate(); reject(new Error("Page trop longue à dessiner.")); }, 45_000);
  const finir = (fn) => { clearTimeout(minuteur); w.terminate(); fn(); };
  w.once("message", (m) => finir(() => (m.erreur ? reject(new Error(m.erreur)) : resolve(m))));
  w.once("error", (e) => finir(() => reject(e)));
});

export function createImagesLivret(dossier, { travailler = ouvrier } = {}) {
  const enCours = new Map(); // même page demandée deux fois : un seul dessin
  const reperes = new Map();
  let file = Promise.resolve(); // un dessin à la fois : les pages sont lourdes
  const aLaFile = (fn) => { const p = file.then(fn); file = p.catch(() => {}); return p; };
  const chemin = (jeu, nom) => {
    if (!SUR.test(jeu) || !/^[\w-]{1,100}\.(pdf|jpg)$/.test(nom)) throw new Error("Nom invalide.");
    return join(dossier, jeu, nom);
  };
  const lire = (f) => readFile(f).catch(() => null);
  async function ecrire(jeu, nom, buf) {
    const f = chemin(jeu, nom);
    await mkdir(join(dossier, jeu), { recursive: true });
    const tmp = `${f}.${process.pid}.${Math.round(performance.now() * 1000)}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, f);
  }
  async function fichiers(jeu) {
    if (!SUR.test(jeu)) return [];
    return readdir(join(dossier, jeu)).catch(() => []);
  }
  return {
    garderPdf: (jeu, source, pdf) => ecrire(jeu, `${source}.pdf`, pdf),
    garderPhoto: (jeu, id, jpg) => ecrire(jeu, `${id}.jpg`, jpg),
    /** Sources dont les images sont là. */
    async sources(jeu) {
      return new Set((await fichiers(jeu)).filter((f) => /^[\w-]+\.(pdf|jpg)$/.test(f) && !/--p\d+\.jpg$/.test(f)).map((f) => f.replace(/\.(pdf|jpg)$/, "")));
    },
    /** Image JPEG de la page, ou null si le livret n'a pas d'images. */
    async page(jeu, source, n) {
      if (!SUR.test(source)) return null;
      const photo = await lire(chemin(jeu, `${source}.jpg`));
      if (photo) return photo;
      const nom = `${source}--p${n}.jpg`;
      const faite = await lire(chemin(jeu, nom));
      if (faite) return faite;
      if (!(await fichiers(jeu)).includes(`${source}.pdf`)) return null;
      const cle = `${jeu}/${nom}`;
      if (!enCours.has(cle)) {
        enCours.set(cle, aLaFile(async () => {
          const { image } = await travailler({ chemin: chemin(jeu, `${source}.pdf`), page: n, action: "image" });
          const buf = Buffer.from(image);
          await ecrire(jeu, nom, buf);
          return buf;
        }).finally(() => enCours.delete(cle)));
      }
      return enCours.get(cle);
    },
    /** Cadres du passage cité sur la page ; [] si introuvable (page scannée, photo). */
    async repere(jeu, source, n, citation) {
      if (!SUR.test(source) || !citation || !(await fichiers(jeu)).includes(`${source}.pdf`)) return [];
      const cle = JSON.stringify([jeu, source, n, citation]);
      if (!reperes.has(cle)) {
        if (reperes.size > 300) reperes.clear();
        reperes.set(cle, aLaFile(() => travailler({ chemin: chemin(jeu, `${source}.pdf`), page: n, action: "repere", citation })).then((r) => r.boites, () => { reperes.delete(cle); return []; }));
      }
      return reperes.get(cle);
    },
    async retirer(jeu, source) {
      if (!SUR.test(source)) return;
      for (const f of await fichiers(jeu)) {
        if (f === `${source}.pdf` || f === `${source}.jpg` || f.startsWith(`${source}--p`)) await rm(join(dossier, jeu, f), { force: true });
      }
    },
  };
}
