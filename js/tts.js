// Narration : texte envoyé au serveur du PC, qui appelle ElevenLabs (modèle v4, balises d'émotion).
import { tErreur, enTeteLangue } from "./i18n.js";

/** Texte envoyé à ElevenLabs : la balise de ton précède la phrase. Jamais de ton pour une règle. */
export function ttsText(segment) {
  const ton = segment.role === "regle" ? "" : (segment.ton || "").trim();
  return ton ? `${ton} ${segment.texte_fr}` : segment.texte_fr;
}

export function errorMessageFor(status, bodyText) {
  if (status === 429 || /quota_exceeded/.test(bodyText || "")) return "Quota ElevenLabs atteint";
  if (status === 401) return "Clé ElevenLabs invalide";
  if (status === 402) return "Voix non disponible avec ce forfait ElevenLabs";
  if (status === 404) return "Voix ElevenLabs introuvable";
  return `Erreur ElevenLabs (${status})`;
}

async function apiError(res) {
  const body = await res.json().catch(() => null);
  return Object.assign(new Error(tErreur(body?.erreur || `Erreur du serveur (${res.status})`)), { code: body?.code ?? res.status });
}

/** Voix synthétisée par le serveur du PC (qui garde la clé ElevenLabs). */
export async function synthesize(text, voiceId, { rapide = false } = {}) {
  const res = await fetch("api/parole", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...enTeteLangue },
    body: JSON.stringify({ text, voiceId, ...(rapide ? { rapide } : {}) }),
  });
  if (!res.ok) throw await apiError(res);
  return res.blob();
}

export async function listVoices() {
  const res = await fetch("api/voix");
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return Array.isArray(data.voices) ? data.voices : [];
}
