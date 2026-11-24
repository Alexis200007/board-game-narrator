// Compteur : ce que coûtent les cartes, les questions et les voix, soirée par soirée (data/couts.json).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Dollars US par million de jetons (entrée, sortie). Le cache : 1,25× à l'écriture, 0,1× à la lecture.
export const TARIFS = { "claude-opus-5": [5, 25], "claude-sonnet-5": [2, 10] };

/** Coût en dollars d'un « usage » de l'API Claude, ou null si le modèle est inconnu. */
export function coutUsage(modele, u) {
  const t = TARIFS[modele];
  if (!t || !u) return null;
  const entree = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
  return (entree * t[0] + (u.output_tokens || 0) * t[1]) / 1e6;
}

/** Coût annoncé par une ligne « result » de claude -p, ou null. */
export function coutResultat(ligne) {
  try {
    const m = JSON.parse(ligne);
    return m.type === "result" && Number.isFinite(m.total_cost_usd) ? m.total_cost_usd : null;
  } catch { return null; }
}

/** Une soirée finit à 5 h du matin, pas à minuit. */
export function soiree(ms = Date.now()) {
  const d = new Date(ms - 5 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function createCouts(dossier, { maintenant = Date.now, delai = 1000 } = {}) {
  const f = join(dossier, "couts.json");
  let jours = {};
  try { if (existsSync(f)) jours = JSON.parse(readFileSync(f, "utf8")).jours || {}; } catch { console.error("couts.json illisible : le compteur repart de zéro."); }
  let minuteur = null;
  function ecrire() {
    clearTimeout(minuteur);
    minuteur = null;
    try {
      mkdirSync(dossier, { recursive: true });
      writeFileSync(`${f}.tmp`, JSON.stringify({ jours }), "utf8");
      renameSync(`${f}.tmp`, f);
    } catch { minuteur = setTimeout(ecrire, 5000); minuteur.unref?.(); } // fichier occupé : plus tard
  }
  return {
    /** type : carte, question, vocal, livret, aide, resume, voix, ambiance, ecoute. Ne lève jamais. */
    noter(type, { usd = 0, caracteres = 0, secondes = 0, n = 1 } = {}) {
      const j = (jours[soiree(maintenant())] ??= {});
      const l = (j[type] ??= { n: 0, usd: 0, caracteres: 0, secondes: 0 });
      l.n += n; l.usd += Number(usd) || 0; l.caracteres += caracteres; l.secondes += secondes;
      if (!minuteur) { minuteur = setTimeout(ecrire, delai); minuteur.unref?.(); }
    },
    /** Les 30 dernières soirées jouées, la plus récente d'abord. */
    lire() {
      return Object.entries(jours).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 30).map(([date, lignes]) => ({ date, lignes }));
    },
    vider() { if (minuteur) ecrire(); },
  };
}
