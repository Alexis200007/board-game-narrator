// Appels au serveur du PC. Toutes les erreurs remontent avec un message en français.
import { t, tErreur, enTeteLangue } from "./i18n.js";

const UNREACHABLE = "Impossible de joindre le serveur. Vérifie ta connexion (et Tailscale, si tu l'utilises).";

export async function api(path, { method = "GET", json, body, headers } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : headers), ...enTeteLangue },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    throw new Error(t(UNREACHABLE));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(tErreur(data?.erreur || `Erreur du serveur (${res.status}).`)), { status: res.status });
  return data;
}

/** Réponse en direct : onMorceau(texte) reçoit chaque morceau ; rend la réponse complète. */
async function lireFlux(url, json, onMorceau) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...enTeteLangue }, body: JSON.stringify(json) });
  } catch {
    throw new Error(t(UNREACHABLE));
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(tErreur(data?.erreur || `Erreur du serveur (${res.status}).`));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    tampon += decoder.decode(value, { stream: true });
    const lignes = tampon.split("\n");
    tampon = lignes.pop();
    for (const l of lignes) {
      if (!l.trim()) continue;
      const m = JSON.parse(l);
      if (m.morceau) onMorceau(m.morceau);
      if (m.erreur) throw new Error(tErreur(m.erreur));
      if (m.fin) return { reponse: m.reponse, refs: m.refs || [] };
    }
  }
  throw new Error(t("La réponse a été coupée. Réessaie."));
}

export const jeuxApi = {
  list: () => api("api/jeux").then((d) => d.jeux),
  create: (nom) => api("api/jeux", { method: "POST", json: { nom } }),
  get: (id) => api(`api/jeux/${id}`),
  nouvellePartie: (id, groupe) => api(`api/jeux/${id}/parties`, { method: "POST", json: { groupe } }),
  creerGroupe: (id, nom) => api(`api/jeux/${id}/groupes`, { method: "POST", json: { nom } }),
  renommerGroupe: (id, groupe, nom) => api(`api/jeux/${id}/groupes/${groupe}`, { method: "PUT", json: { nom } }),
  supprimerGroupe: (id, groupe) => api(`api/jeux/${id}/groupes/${groupe}`, { method: "DELETE" }),
  retirerTerme: (id, en) => api(`api/jeux/${id}/glossaire/${encodeURIComponent(en)}`, { method: "DELETE" }),
  personnages: (id, data) => api(`api/jeux/${id}/personnages`, { method: "PUT", json: data }),
  ajouterPage: (id, blob, titre, type, modele) =>
    api(`api/jeux/${id}/livret?titre=${encodeURIComponent(titre)}&modele=${encodeURIComponent(modele)}`, { method: "POST", body: blob, headers: { "Content-Type": type } }),
  travaux: (id) => api(`api/jeux/${id}/travaux`).then((d) => d.travaux),
  aide: (id) => api(`api/jeux/${id}/aide`),
  preparerAide: (id, modele) => api(`api/jeux/${id}/aide`, { method: "POST", json: { modele } }),
  ajouterImages: (id, source, pdf) => api(`api/jeux/${id}/livret/${source}/images`, { method: "POST", body: pdf, headers: { "Content-Type": "application/pdf" } }),
  retirerPage: (id, pageId) => api(`api/jeux/${id}/livret/${pageId}`, { method: "DELETE" }),
  directOuvrir: (id, groupe, partie) => api(`api/jeux/${id}/direct`, { method: "POST", json: { groupe, partie } }).then((d) => d.session),
  directJeton: (id, session) => api(`api/jeux/${id}/direct/${session}/jeton`, { method: "POST" }),
  directCouper: (id, session, entendu) => api(`api/jeux/${id}/direct/${session}/couper`, { method: "POST", json: { entendu } }),
  directFermer: (id, session) => fetch(`api/jeux/${id}/direct/${session}`, { method: "DELETE", keepalive: true }).catch(() => {}),
  directQuestion: (id, session, groupe, partie, question, onMorceau) =>
    lireFlux(`api/jeux/${id}/direct/${session}/question`, { groupe, partie, question }, onMorceau),
  questionFlux: (id, groupe, partie, question, modele, onMorceau) =>
    lireFlux(`api/jeux/${id}/question?flux=1`, { groupe, partie, question, modele }, onMorceau),
  question: (id, groupe, partie, question, modele) => api(`api/jeux/${id}/question`, { method: "POST", json: { groupe, partie, question, modele } }),
  signaler: (id, cas) => api(`api/jeux/${id}/evaluations`, { method: "POST", json: cas }),
  couts: () => api("api/couts"),
  resume: (id, groupe, modele) => api(`api/jeux/${id}/resume`, { method: "POST", json: { groupe, modele } }),
};
