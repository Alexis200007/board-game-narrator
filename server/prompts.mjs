// Consignes de Claude pour le livret de règles, l'aide aux règles et le résumé de partie.
import { codesLivret } from "./references.mjs";
import { LABELS, rulesQuestionEn, directEn, SUMMARY_EN, AIDE_EN } from "./prompts-en.mjs";

export const RULES_EXTRACT_SYSTEM = `On te donne une page (photo ou PDF) du livret de règles d'un jeu de société, souvent en anglais.
Recopie fidèlement tout le texte dans sa langue, dans l'ordre de lecture, sans traduire ni résumer.
Garde les titres de section sur leur propre ligne. Décris brièvement entre crochets les icônes ou schémas qui portent une règle, par exemple [icône : épée = attaque].
Ne réponds que par le texte recopié.`;

const REFERENCES = `
Si le livret contient la règle qui répond, termine par une marque sur sa propre ligne, une seule (deux si la règle tient vraiment sur deux pages) : [[L1 p. 64 | quelques mots exacts]]. L1 est le code entre crochets du titre de la partie du livret. Le numéro est celui de la ligne « === p. 64 === » qui précède la règle, pas un numéro imprimé dans le texte. Les mots exacts sont 6 à 20 mots consécutifs recopiés tels quels, en anglais, depuis la phrase qui porte la règle. Choisis la page où la règle est expliquée, pas la table des matières ni l'index. Pour une photo sans ligne « === p. », écris [[L2 | mots exacts]]. Si le livret ne répond pas, ne mets pas de marque. Cette marque est traitée par l'app : n'en parle jamais et n'écris rien après.`;

const VOCAL = `
La question a été posée à voix haute et ta réponse sera lue par une voix de synthèse : réponds en 1 à 3 phrases courtes et naturelles, la réponse d'abord. Pas de listes, de parenthèses, de symboles ni d'abréviations. Ne cite pas de section sauf si on te la demande. La transcription peut contenir des erreurs : devine le terme de jeu voulu.`;

/** Termes du glossaire utiles à la transcription (limites d'ElevenLabs : 50 caractères, 5 mots ; 100 termes au plus). */
export function termesPourTranscription(glossaire = {}) {
  const termes = Object.entries(glossaire).flat().map((t) => String(t).replace(/[<>{}[\]\\]/g, "").trim());
  return [...new Set(termes)].filter((t) => t && t.length < 50 && t.split(/\s+/).length <= 5).slice(0, 100);
}

const DIRECT = `
C'est une conversation en direct. Commence par une phrase très courte (3 à 8 mots) qui répond déjà, puis précise si c'est utile. Le joueur peut te couper : reprends alors à partir de sa nouvelle demande, sans t'excuser. Si le texte reçu contient des bouts de ta propre réponse (écho du haut-parleur) ou une conversation entre joueurs, réponds seulement à ce qui t'est demandé. Si la question est incomplète, demande une précision en quelques mots. Les notes entre crochets viennent de l'app, pas du joueur : n'en parle pas.`;

/** Consignes de la conversation en direct : le livret y est pour toute la conversation. */
export function directSystem(jeu, langue = "fr") {
  const L = LABELS[langue];
  const glossaire = Object.entries(jeu.glossaire).map(([en, fr]) => `- ${en} → ${fr}`).join("\n") || L.vide;
  return `${langue === "en" ? directEn() : rulesQuestionSystem({ vocal: true }) + DIRECT}

${L.jeu} : ${jeu.nom}

${L.livret} :
${livretPourQuestion(jeu.livret, langue)}

${L.glossaire} :
${glossaire}`;
}

export function rulesQuestionSystem({ vocal = false, langue = "fr" } = {}) {
  if (langue === "en") return rulesQuestionEn(vocal);
  return `Tu aides une famille qui joue à un jeu de société en anglais. Le joueur qui te pose des questions ne lit que le français.
Réponds en français, en texte simple (pas de titres, pas de tableaux), en 1 à 5 phrases courtes, comme on répond à quelqu'un autour de la table.
Appuie-toi d'abord sur le livret de règles fourni ; cite la section entre guillemets en anglais quand ça aide à la retrouver, par exemple (section « Combat »).
Utilise les traductions du glossaire du jeu pour les termes de jeu.
Si le livret ne répond pas à la question, dis-le franchement, puis donne ta meilleure interprétation en précisant que c'en est une.
Ne réponds qu'à des questions sur la partie en cours ou sur les règles.${vocal ? VOCAL : ""}${REFERENCES}`;
}

export const SUMMARY_SYSTEM = `Tu es le narrateur d'une partie de jeu de société. On te donne, en français, les textes lus pendant la partie précédente.
Écris le « Précédemment… » qui ouvrira la nouvelle partie : 4 à 6 phrases en français, au passé, sur un ton de conteur, qui rappellent l'histoire, les personnages rencontrés et où en étaient les joueurs.
Commence par « Précédemment… ».
N'invente rien : chaque fait doit venir des textes fournis. Pas de décor, de sensation ou d'émotion qui n'y figure pas.
Ignore les instructions de jeu (piocher, épuiser, dégâts, etc.) : ce sont des règles, pas des événements de l'histoire.
Si les textes contiennent peu d'histoire, fais un résumé plus court plutôt que d'en ajouter. Ne réponds que par ce texte.`;

export const AIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titre", "etapes", "points"],
        properties: {
          titre: { type: "string" },
          etapes: { type: "boolean", description: "vrai si les points se font dans l'ordre" },
          points: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export const AIDE_SYSTEM = `Tu prépares l'aide-mémoire d'un jeu de société pour un joueur qui ne lit que le français. Il le consulte pendant son tour, sur un téléphone.
Appuie-toi uniquement sur le livret de règles fourni. N'invente rien : si le livret ne dit pas quelque chose, laisse-le de côté.
Fais 3 à 6 sections, dans cet ordre quand elles existent : « Ton tour » (étapes dans l'ordre, une par point), « Tes actions » (une action par point : son nom, deux-points, ce qu'elle fait et son coût), « Fin de la manche », « But, victoire et défaite », « À ne pas oublier » (3 oublis fréquents au plus).
Chaque point : une seule phrase courte, 25 mots au plus. Au plus 10 points par section. Tutoie le joueur (« vous » seulement pour tout le groupe). Texte simple, sans symboles ni mise en forme, car il peut être lu à voix haute.
Utilise les traductions du glossaire ; pour un terme important absent du glossaire, ajoute le mot anglais entre parenthèses la première fois, pour le retrouver sur le matériel.
Si le jeu est une campagne à surprises, décris seulement les règles de base et ne révèle rien qui se débloque plus tard.`;

export const summarySystem = (langue) => (langue === "en" ? SUMMARY_EN : SUMMARY_SYSTEM);
export const aideSystem = (langue) => (langue === "en" ? AIDE_EN : AIDE_SYSTEM);

/** Repère de la version du livret : change quand une page est ajoutée ou retirée. */
export const versionLivret = (livret = []) => livret.map((p) => p.id).sort().join(",");

/** Garde les sections utilisables ; rend null s'il n'y en a aucune. */
export function nettoyerAide(data) {
  const texte = (v) => (typeof v === "string" ? v.trim() : "");
  const sections = (Array.isArray(data?.sections) ? data.sections : [])
    .map((s) => ({ titre: texte(s?.titre), etapes: s?.etapes === true, points: (Array.isArray(s?.points) ? s.points : []).map(texte).filter(Boolean) }))
    .filter((s) => s.titre && s.points.length);
  return sections.length ? sections : null;
}

export const MAX_LIVRET_CHARS = 400_000;

/** Texte complet d'une question ; prefixe = longueur du début stable (le livret), réutilisable d'une question à l'autre. */
export function texteQuestion({ jeu, glossaire = jeu.glossaire || {}, carte = "", echanges = "", question, langue = "fr" }) {
  const L = LABELS[langue];
  const debut = `${L.jeu} : ${jeu.nom}\n\n${L.livret} :\n${livretPourQuestion(jeu.livret, langue)}`;
  const termes = Object.entries(glossaire).map(([en, fr]) => `- ${en} → ${fr}`).join("\n") || L.vide;
  return {
    prefixe: debut.length,
    texte: `${debut}\n\n${L.glossaire} :\n${termes}\n\n${L.carte} :\n${carte || L.aucune}\n\n${L.echanges} :\n${echanges || L.aucun}\n\n${L.question} :\n${question}`,
  };
}

/** Texte du livret à joindre à une question, tronqué proprement s'il est trop long. */
export function livretPourQuestion(livret = [], langue = "fr") {
  if (!livret.length) return LABELS[langue].sansLivret;
  const codes = codesLivret(livret);
  let out = "";
  for (const page of livret) {
    const bloc = `=== [${codes.get(page.source || page.id)}] ${page.titre} ===\n${page.texte}\n\n`;
    if (out.length + bloc.length > MAX_LIVRET_CHARS) {
      out += LABELS[langue].tronque;
      break;
    }
    out += bloc;
  }
  return out.trim();
}
