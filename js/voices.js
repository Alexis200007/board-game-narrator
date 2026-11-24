// Distribution des voix ElevenLabs selon le rôle et le personnage.

const genderOf = (v) => (v.labels?.gender || "").toLowerCase();
const isOld = (v) => /old|elder/.test((v.labels?.age || "").toLowerCase());

/** Choisit des voix par défaut à partir de la liste GET /v1/voices. */
export function pickDefaultVoices(voiceList) {
  const list = Array.isArray(voiceList) ? voiceList.filter((v) => v && v.voice_id) : [];
  const ids = list.map((v) => v.voice_id);
  const males = list.filter((v) => genderOf(v) === "male");
  const females = list.filter((v) => genderOf(v) === "female");
  const first = ids[0] || "";

  const narrateur = (males.find((v) => !isOld(v)) || males[0] || list[0])?.voice_id || first;
  const regle = (females[0] || list.find((v) => v.voice_id !== narrateur) || list[0])?.voice_id || first;
  const creature = (list.find(isOld) || males[males.length - 1] || list[0])?.voice_id || first;
  // Sans labels, tout reste sur la première voix ; les personnages piochent dans toute la liste.
  const noLabels = males.length === 0 && females.length === 0;
  const pool = (group) => {
    const all = group.map((v) => v.voice_id);
    const free = all.filter((id) => id !== narrateur && id !== regle && id !== creature);
    return free.length ? free : all.length ? all : ids;
  };

  return noLabels
    ? { narrateur: first, regle: first, homme: ids, femme: ids, creature: first }
    : { narrateur, regle, homme: pool(males), femme: pool(females), creature };
}

/**
 * Crée un distributeur de voix. Un personnage garde sa voix pour la partie.
 * `saved` = résultat d'un toJSON() précédent, pour reprendre la partie.
 */
export function createCaster(roles, saved) {
  let assigned = { ...(saved?.assigned || {}) };
  let counters = { homme: 0, femme: 0, ...(saved?.counters || {}) };

  function nextFrom(genre) {
    const voices = roles[genre];
    if (!voices || voices.length === 0) return roles.creature || roles.narrateur;
    const v = voices[counters[genre] % voices.length];
    counters[genre] += 1;
    return v;
  }

  return {
    voiceFor(segment) {
      if (!segment || segment.role === "regle") return roles.regle;
      if (segment.role !== "personnage") return roles.narrateur;
      const key = (segment.personnage || "").trim().toLowerCase();
      if (key && assigned[key]) return assigned[key];
      const genre = segment.genre === "homme" || segment.genre === "femme" ? segment.genre : null;
      const voice = genre ? nextFrom(genre) : roles.creature || roles.narrateur;
      if (key) assigned[key] = voice;
      return voice;
    },
    reset() {
      assigned = {};
      counters = { homme: 0, femme: 0 };
    },
    toJSON() {
      return { assigned: { ...assigned }, counters: { ...counters } };
    },
  };
}

// Distribution par défaut : voix francophones natives de la bibliothèque ElevenLabs,
// choisies pour leur rôle (consultées le 2026-11-20). Utilisables directement sur un forfait payant.
export const FRENCH_CAST = {
  narrateur: { id: "2AGrjHJgmTgUqzy68M9W", name: "Nicolas Petit, conteur grave" },
  regle: { id: "4FLkNETtL5THnClfpjpb", name: "Thomas, clair et posé (Québec)" },
  creature: { id: "kSNoLVC4Ox0vkBz1IKux", name: "Damien Doré, voix profonde" },
  homme: [
    { id: "4TfTGcPwoefWe878B0rm", name: "Troy, héros" },
    { id: "RBhYSNMNu6b2CGZ9Fn1M", name: "Félix, gouailleur (Québec)" },
    { id: "Xgb3SR8idOHy8scGICeJ", name: "Kevin, jeune et sérieux" },
    { id: "GFj5Qf6cNQ3Lgp8VKBwc", name: "Olivier, vieil excentrique" },
  ],
  femme: [
    { id: "ZYOBieLaunTiQrTrvNQq", name: "Morgane, très expressive" },
    { id: "K7gx0ylJdff0yjM2uVQS", name: "Jeanne Mance, claire (Québec)" },
    { id: "Yx2a8qp2EqI9c5i8MzBo", name: "Philippine, dynamique" },
    { id: "KmqhNPEmmOndTBOPk4mJ", name: "Lucie, douce" },
  ],
};

// Default English cast: ElevenLabs premade voices, available on every plan.
export const ENGLISH_CAST = {
  narrateur: { id: "JBFqnCBsd6RMkjVDRZzb", name: "George, storyteller" },
  regle: { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice, clear" },
  creature: { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum, husky" },
  homme: [
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian, deep" },
    { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam, energetic" },
    { id: "bIHbv24MWmeRgasZH58o", name: "Will, relaxed" },
    { id: "cjVigY5qzO86Huf0OWal", name: "Eric, smooth" },
  ],
  femme: [
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah, confident" },
    { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura, quirky" },
    { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica, playful" },
    { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily, velvety" },
  ],
};
const castDe = (langue) => (langue === "en" ? ENGLISH_CAST : FRENCH_CAST);

// Voix « premade » de secours, toujours disponibles, si une voix de la bibliothèque est refusée.
const PREMADE = {
  narrateur: "JBFqnCBsd6RMkjVDRZzb", // George, conteur
  regle: "Xb7hH8MSUJpSbSDYk0k2", // Alice, claire
  creature: "N2lVS1w4EtoT3dr4eOWO", // Callum, rauque
  homme: "nPczCjzI2devNBz1zQrb", // Brian
  femme: "EXAVITQu4vr4xnSDxMaL", // Sarah
};

export function defaultRoles(langue = "fr") {
  const c = castDe(langue);
  return {
    narrateur: c.narrateur.id,
    regle: c.regle.id,
    creature: c.creature.id,
    homme: c.homme.map((v) => v.id),
    femme: c.femme.map((v) => v.id),
  };
}

/** Voix premade équivalente, ou null si la voix est déjà une voix de secours. */
export function fallbackVoiceFor(voiceId) {
  if (Object.values(PREMADE).includes(voiceId)) return null;
  for (const role of ["narrateur", "regle", "creature"]) if (FRENCH_CAST[role].id === voiceId) return PREMADE[role];
  for (const g of ["homme", "femme"]) if (FRENCH_CAST[g].some((v) => v.id === voiceId)) return PREMADE[g];
  return PREMADE.narrateur;
}

/** Liste pour les menus des réglages : la distribution de la langue d'abord, puis les voix du compte. */
export function castVoiceOptions(accountVoices = [], langue = "fr") {
  const c = castDe(langue);
  const cast = [c.narrateur, c.regle, c.creature, ...c.homme, ...c.femme]
    .map((v) => ({ voice_id: v.id, name: v.name }));
  const ids = new Set(cast.map((v) => v.voice_id));
  return [...cast, ...accountVoices.filter((v) => v?.voice_id && !ids.has(v.voice_id))];
}
