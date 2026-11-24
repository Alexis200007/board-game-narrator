// Réglages → Coûts : la dernière soirée et les 30 dernières.
import { t, langue } from "./i18n.js";

const fmt = (v, plus = {}) => new Intl.NumberFormat(langue === "fr" ? "fr-CA" : "en-US", plus).format(v);
const dollars = (v) => `${fmt(v, { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 ? 3 : 2 })} $${langue === "fr" ? " US" : ""}`;
const CLAUDE = { carte: "Cartes", question: "Questions écrites", vocal: "Chat vocal", livret: "Lecture du livret", aide: "Aide-mémoire", resume: "Résumés" };

/** Additionne des soirées : type → { n, usd, caracteres, secondes }. */
export function additionner(soirees) {
  const total = {};
  for (const { lignes } of soirees) for (const [type, l] of Object.entries(lignes)) {
    const x = (total[type] ??= { n: 0, usd: 0, caracteres: 0, secondes: 0 });
    for (const k of Object.keys(x)) x[k] += l[k] || 0;
  }
  return total;
}
function ligne(nom, valeur, detail = "") {
  const d = Object.assign(document.createElement("div"), { className: "ligne" });
  const l = Object.assign(document.createElement("span"), { className: "libelle", textContent: nom });
  if (detail) l.append(Object.assign(document.createElement("small"), { textContent: detail }));
  d.append(l, Object.assign(document.createElement("span"), { className: "valeur", textContent: valeur }));
  return d;
}
function bloc(titre, total, tarifVoix) {
  const out = [Object.assign(document.createElement("h4"), { textContent: titre })];
  let somme = 0;
  for (const [type, nom] of Object.entries(CLAUDE)) {
    const l = total[type];
    if (!l) continue;
    somme += l.usd;
    out.push(ligne(t(nom), dollars(l.usd), type === "vocal" ? "" : l.n > 1 ? t("{n} fois, {prix} chacune", { n: l.n, prix: dollars(l.usd / l.n) }) : ""));
  }
  const c = total.voix?.caracteres || 0;
  if (c) {
    const prix = tarifVoix ? (c / 1000) * tarifVoix : null;
    if (prix !== null) somme += prix;
    out.push(ligne(t("Voix ElevenLabs"), prix === null ? t("{n} caractères", { n: fmt(c) }) : dollars(prix), prix === null ? "" : t("{n} caractères", { n: fmt(c) })));
  }
  if (total.ecoute) out.push(ligne(t("Écoute du chat vocal"), t("{n} min", { n: fmt(Math.max(1, Math.round(total.ecoute.secondes / 60))) })));
  if (total.ambiance) out.push(ligne(t("Ambiances créées"), fmt(total.ambiance.n)));
  out.push(ligne(tarifVoix ? t("Total Claude et voix") : t("Total Claude"), dollars(somme)));
  out.at(-1).classList.add("total");
  return out;
}
export async function afficherCouts(boite, lire) {
  const note = (x) => Object.assign(document.createElement("p"), { className: "note", textContent: x });
  try {
    const { mode, tarifVoix, soirees } = await lire();
    if (!soirees.length) return boite.replaceChildren(note(t("Rien pour l'instant. Le compteur démarre à la prochaine carte ou question.")));
    const date = new Date(`${soirees[0].date}T12:00:00`).toLocaleDateString(langue === "fr" ? "fr-CA" : "en-US", { day: "numeric", month: "long" });
    boite.replaceChildren(
      ...bloc(t("Soirée du {date}", { date }), additionner(soirees.slice(0, 1)), tarifVoix),
      ...(soirees.length > 1 ? bloc(t("Les {n} dernières soirées", { n: soirees.length }), additionner(soirees), tarifVoix) : []),
      note(mode === "api" ? t("Estimation au tarif public de l'API Claude. La facture d'Anthropic fait foi.") : t("Équivalent au tarif de l'API. Avec ton abonnement Claude, tu ne paies pas ces montants en plus.")));
  } catch (err) { boite.replaceChildren(note(err.message)); }
}
