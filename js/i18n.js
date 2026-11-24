// Langue de l'app (français ou anglais). Le texte français sert de clé.
import { loadSettings } from "./settings.js";
import { EN } from "./en.js";

export const LANGUES = ["fr", "en"];

/** Langue de ce téléphone : le choix des réglages, sinon celle du navigateur au premier lancement. */
function detecter() {
  if (typeof document === "undefined") return "fr";
  const { langue, voices } = loadSettings();
  if (LANGUES.includes(langue)) return langue;
  if (voices?.narrateur) return "fr"; // installations d'avant l'anglais
  return /^fr/i.test(navigator.language || "") ? "fr" : "en";
}
export const langue = detecter();

/** Texte dans la langue du téléphone ; les {noms} sont remplacés par leurs valeurs. */
export function t(cle, valeurs = {}, l = langue) {
  const texte = l === "en" ? EN[cle] ?? cle : cle;
  return texte.replace(/\{(\w+)\}/g, (tout, nom) => (nom in valeurs ? valeurs[nom] : tout));
}

const MOTIFS = [
  [/^Erreur ElevenLabs \((\d+)\)$/, "Erreur ElevenLabs ({n})"],
  [/^Erreur du serveur \((\d+)\)\.?$/, "Erreur du serveur ({n})"],
  [/^La page (\d+) du PDF est trop lourde pour être lue\.$/, "La page {n} du PDF est trop lourde pour être lue."],
];
/** Les messages du serveur arrivent en français. */
export function tErreur(message, l = langue) {
  if (l === "fr") return message;
  for (const [motif, cle] of MOTIFS) {
    const m = motif.exec(message);
    if (m) return t(cle, { n: m[1] }, l);
  }
  return t(message, {}, l);
}

/** À joindre à chaque demande : le serveur répond dans cette langue. */
export const enTeteLangue = { "X-Langue": langue };

/** Traduit les textes fixes de la page, une fois au démarrage. */
export function traduirePage() {
  document.documentElement.lang = langue;
  if (langue === "fr") return;
  document.title = t(document.title);
  const textes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (textes.nextNode()) {
    const n = textes.currentNode, brut = n.data.replace(/\s+/g, " ").trim();
    if (brut && brut in EN) n.data = n.data.replace(n.data.trim(), () => EN[brut]);
  }
  // « Reprendre » : la lecture (Resume) ou la photo (Retake).
  for (const n of document.getElementById("crop-controls").firstElementChild.childNodes) if (n.nodeType === 3 && n.data.trim()) n.data = "Retake";
  for (const attribut of ["placeholder", "aria-label", "alt"]) {
    for (const el of document.querySelectorAll(`[${attribut}]`)) el.setAttribute(attribut, t(el.getAttribute(attribut)));
  }
}
