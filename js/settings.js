// Réglages persistés sur le téléphone (localStorage). Tout accès est protégé.

const KEY = "narrateur-jeux:settings";

export const DEFAULT_SETTINGS = Object.freeze({
  langue: "", // "fr" ou "en" ; vide : celle du navigateur
  model: "claude-opus-5",
  rate: 1,
  voices: {},
  ambiance: true,
  jeuActif: "",
  groupes: {}, // jeu → groupe actif sur ce téléphone
});

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Navigation privée ou stockage bloqué : les réglages restent en mémoire.
  }
}
