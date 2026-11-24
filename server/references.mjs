// Pages du livret citées par Claude à la fin d'une réponse : [[L1 p. 64 | quelques mots exacts]]
// La marque n'est ni affichée ni lue ; elle devient une image sous la réponse.

/** Un code court par livret (L1, L2…) : toutes les parties d'un même PDF partagent le leur. */
export function codesLivret(livret = []) {
  const codes = new Map();
  for (const p of livret) {
    const source = p.source || p.id;
    if (!codes.has(source)) codes.set(source, `L${codes.size + 1}`);
  }
  return codes;
}

const MARQUE = /\[\[\s*(L\d+)(?:\s*,?\s*p(?:age)?\.?\s*(\d+))?\s*(?:\|\s*([^\]]*))?\]\]/gi;

/** Sépare la réponse de ses références ; garde seulement des pages qui existent, deux au plus. */
export function lireReferences(texte, livret = []) {
  const parCode = new Map([...codesLivret(livret)].map(([s, c]) => [c, s]));
  const refs = [];
  for (const [, code, page, citation] of texte.matchAll(MARQUE)) {
    const source = parCode.get(code.toUpperCase());
    if (!source) continue;
    const parts = livret.filter((p) => (p.source || p.id) === source);
    const photo = !parts[0].source;
    const n = photo ? 1 : Number(page);
    if (!photo && !parts.some((p) => p.texte.includes(`=== p. ${n} ===`))) continue;
    if (refs.length >= 2 || refs.some((r) => r.source === source && r.page === n)) continue;
    const titre = photo ? parts[0].titre : parts[0].titre.replace(/, p\. [\d–]+$/, "");
    refs.push({ source, page: n, photo, titre, citation: (citation || "").trim().replace(/^["«“\s]+|["»”\s]+$/g, "").slice(0, 300) });
  }
  return { texte: texte.replace(MARQUE, "").replace(/\[\[[^\]]*\]?$/, "").replace(/[ \t]+\n/g, "\n").trim(), refs };
}

/** Retient la marque pendant que la réponse s'écrit. Un saut de ligne part à sa place : la dernière phrase peut être lue tout de suite. */
export function createFiltreReferences(envoyer) {
  let attente = "", cache = false;
  return (morceau) => {
    if (cache) return;
    attente += morceau;
    const i = attente.indexOf("[[");
    if (i >= 0) {
      cache = true;
      envoyer(`${attente.slice(0, i).trimEnd()}\n`);
      return;
    }
    const garde = attente.endsWith("[") ? 1 : 0;
    const pret = attente.slice(0, attente.length - garde);
    attente = attente.slice(attente.length - garde);
    if (pret) envoyer(pret);
  };
}
