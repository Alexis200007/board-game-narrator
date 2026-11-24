// Schéma, consignes et validation de l'analyse (partagés par la page et le serveur du PC).
import { t, tErreur, enTeteLangue } from "./i18n.js";

export const NO_TEXT_ERROR = "Aucun texte trouvé sur la photo. Réessaie de plus près.";

export const AMBIANCES = ["aucune", "taverne", "foret", "donjon", "tempete", "combat", "ville", "mer", "mystere"];

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "texte_original", "segments", "glossaire", "ambiance"],
  properties: {
    type: { type: "string", enum: ["regle", "histoire", "carte", "mixte"] },
    texte_original: { type: "string" },
    glossaire: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["en", "fr"],
        properties: { en: { type: "string" }, fr: { type: "string" } },
      },
    },
    ambiance: { type: "string", enum: AMBIANCES },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "personnage", "genre", "ton", "texte_fr"],
        properties: {
          role: { type: "string", enum: ["narrateur", "personnage", "regle"] },
          personnage: { type: "string" },
          genre: { type: "string", enum: ["homme", "femme", "inconnu"] },
          ton: { type: "string" },
          texte_fr: { type: "string" },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = `Tu es le narrateur et traducteur d'une famille qui joue à des jeux de société en anglais. Un des joueurs ne parle que français : ta traduction et ta narration lui permettent de suivre la partie en temps réel.

On te donne la photo d'un texte de jeu (carte, règle, livret d'histoire, plateau). Lis tout le texte lisible, puis :

1. Traduis en français naturel et fluide, facile à comprendre à l'oral.
2. Les règles et les effets de cartes doivent garder leur sens exact. Ne résume pas et n'ajoute rien. Quand un mot-clé ou un nom de carte apparaît en anglais sur le matériel de jeu, garde le terme anglais entre parenthèses après la traduction la première fois, par exemple « Épuiser (Exhaust) », pour que le joueur le reconnaisse sur la table.
3. Découpe le texte en segments dans l'ordre de lecture :
   - "narrateur" pour la narration et les descriptions d'ambiance;
   - "personnage" pour chaque réplique dite par un personnage, avec son nom dans "personnage" (garde le nom propre tel quel) et son genre dans "genre" ("inconnu" pour une créature ou si on ne sait pas);
   - "regle" pour les règles, effets, coûts et instructions de jeu.
   Hors des répliques, "personnage" vaut "" et "genre" vaut "inconnu".
   Ne laisse jamais une incise seule comme « gronde le Dragon. » après une réplique : comme dans un livre audio, fais annoncer la réplique par le narrateur avant (« Le Dragon gronde : »), puis donne la réplique au personnage.
4. "ton" sert à jouer le texte à voix haute : 0 à 2 balises audio ElevenLabs v3 en anglais entre crochets, choisies selon l'émotion du passage, par exemple [whispers], [excited], [tense], [sad], [angry], [laughs], [shouting], [mysterious], [calm]. Pour "regle", "ton" est toujours "".
5. "texte_original" contient le texte anglais lu sur la photo.
6. S'il n'y a aucun texte lisible, renvoie une liste "segments" vide.
7. "glossaire" liste seulement les mots-clés de règles propres à ce jeu que tu viens de traduire : actions, états, ressources, types de cartes, souvent écrits en majuscules ou en gras sur le matériel (ex. Exhaust, Loot, Advantage). Forme : { "en": terme anglais, "fr": traduction choisie }. Jamais de mots courants (hero, door, card, draw au sens ordinaire), jamais de noms de personnages ni de lieux. Au plus 5 entrées ; une liste vide est normale.
8. "ambiance" est le décor sonore qui convient le mieux au passage : taverne, foret, donjon, tempete, combat, ville, mer, mystere, ou aucune (règles pures, ou rien d'évocateur).

N'écris les nombres et symboles de jeu (coûts, dégâts, icônes) en toutes lettres que si ça aide à la lecture à voix haute.`;

export const SYSTEM_PROMPT_EN = `You are the narrator and translator for people playing board games. One of the players only reads English: your translation and narration let them follow the game in real time.

You are given a photo of a game text (card, rule, story book, board), in any language. Read all legible text, then:

1. Translate it into natural, fluent English that is easy to follow by ear. If the text is already in English, keep it word for word.
2. Rules and card effects must keep their exact meaning. Don't summarise and add nothing. When a keyword or card name is printed in another language on the components, keep the original term in parentheses after the translation the first time, for example "Exhaust (Erschöpfen)", so the player recognises it on the table.
3. Split the text into segments in reading order, with the text in "texte_fr" (the field name is historical: the text is in English):
   - "narrateur" for narration and flavour descriptions;
   - "personnage" for each line spoken by a character, with their name in "personnage" (keep proper names as they are, translate common nouns: "The innkeeper") and their gender in "genre": "homme" (male), "femme" (female), or "inconnu" for a creature or when unknown;
   - "regle" for rules, effects, costs and game instructions.
   Outside spoken lines, "personnage" is "" and "genre" is "inconnu".
   Never leave a tag such as "growls the Dragon." alone after a line: as in an audiobook, have the narrator introduce the line first ("The Dragon growls:"), then give the line to the character.
4. "ton" is used to act the text aloud: 0 to 2 ElevenLabs v3 audio tags in brackets, chosen from the emotion of the passage, for example [whispers], [excited], [tense], [sad], [angry], [laughs], [shouting], [mysterious], [calm]. For "regle", "ton" is always "".
5. "texte_original" holds the original text read in the photo.
6. If there is no legible text, return an empty "segments" list.
7. "glossaire" lists only the rules keywords specific to this game that you have just translated: actions, states, resources, card types, often in capitals or bold on the components. Form: { "en": term as printed, "fr": chosen English translation }. Never ordinary words, never names of characters or places. At most 5 entries; an empty list is normal, and it is always empty when the text is already in English.
8. "ambiance" is the soundscape that best fits the passage: taverne (tavern), foret (forest), donjon (dungeon), tempete (storm), combat (battle), ville (town), mer (sea), mystere (mystery), or aucune (none: pure rules, or nothing evocative).

Spell out numbers and game symbols (costs, damage, icons) only if it helps when read aloud.`;

/** Consignes d'analyse, avec le glossaire du jeu pour garder les mêmes traductions d'une carte à l'autre. */
export function analysisSystem(glossaire = {}, l = "fr") {
  const base = l === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT;
  const entries = Object.entries(glossaire);
  if (entries.length === 0) return base;
  return `${base}

${l === "en" ? "Glossary of this game: use exactly these translations when these terms appear." : "Glossaire de ce jeu : utilise exactement ces traductions quand ces termes apparaissent."}
${entries.map(([en, fr]) => `- ${en} → ${fr}`).join("\n")}`;
}

const ROLES = new Set(["narrateur", "personnage", "regle"]);

export function validateAnalysis(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.segments)) {
    return { ok: false, erreur: "Réponse inattendue de Claude. Réessaie." };
  }
  const segments = [];
  for (const s of obj.segments) {
    if (!s || !ROLES.has(s.role) || typeof s.texte_fr !== "string") {
      return { ok: false, erreur: "Réponse inattendue de Claude. Réessaie." };
    }
    if (!s.texte_fr.trim()) continue;
    segments.push({
      role: s.role,
      personnage: typeof s.personnage === "string" ? s.personnage : "",
      genre: ["homme", "femme"].includes(s.genre) ? s.genre : "inconnu",
      ton: s.role === "regle" ? "" : typeof s.ton === "string" ? s.ton.trim() : "",
      texte_fr: s.texte_fr.trim(),
    });
  }
  if (segments.length === 0) return { ok: false, erreur: NO_TEXT_ERROR };
  return {
    ok: true,
    data: {
      type: obj.type || "mixte",
      texte_original: typeof obj.texte_original === "string" ? obj.texte_original : "",
      segments,
      glossaire: (Array.isArray(obj.glossaire) ? obj.glossaire : [])
        .filter((g) => g && typeof g.en === "string" && typeof g.fr === "string" && g.en.trim() && g.fr.trim())
        .map((g) => ({ en: g.en.trim(), fr: g.fr.trim() })),
      ambiance: AMBIANCES.includes(obj.ambiance) ? obj.ambiance : "aucune",
    },
  };
}

/** Envoie la photo (JPEG) au serveur du PC, qui lance `claude -p`. Lève une Error en français. */
export async function analyzeImage(jpegBlob, model, { jeu = "", groupe = "", partie = "" } = {}) {
  let res;
  try {
    res = await fetch(`api/analyser?modele=${encodeURIComponent(model)}&jeu=${encodeURIComponent(jeu)}&groupe=${encodeURIComponent(groupe)}&partie=${encodeURIComponent(partie)}`, { method: "POST", body: jpegBlob, headers: enTeteLangue });
  } catch {
    throw new Error(t("Impossible de joindre le serveur. Vérifie ta connexion (et Tailscale, si tu l'utilises)."));
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(tErreur(body?.erreur || `Erreur du serveur (${res.status}).`));
  const result = validateAnalysis(body.data);
  if (!result.ok) throw new Error(tErreur(result.erreur));
  return result.data;
}
