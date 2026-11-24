// Pose au vrai Claude les questions de test d'un jeu et affiche le score.
//   npm run evaluer -- <jeu> [claude-sonnet-5]     (tes jeux : data/jeux, tests : data/evaluations)
//   npm run evaluer -- --demo [claude-sonnet-5]    (jeu inventé fourni avec l'app)
// Utilise ton abonnement ou ta clé (CLAUDE_MODE) : deux demandes par question.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaudeTask, modeClaude, MODELS } from "../server/claude-cli.mjs";
import { createStore } from "../server/store.mjs";
import { createEvaluations, evaluer } from "../server/evaluation.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const data = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(racine, "data");
const [cible, model = "claude-opus-5"] = process.argv.slice(2);
const sortir = (m) => { console.error(m); process.exit(2); };
if (!cible) sortir("Usage : npm run evaluer -- <jeu>|--demo [claude-opus-5|claude-sonnet-5]");
if (!MODELS.has(model)) sortir(`Modèle inconnu : ${model}`);

let jeu, cas;
if (cible === "--demo") ({ jeu, cas } = JSON.parse(readFileSync(resolve(racine, "tests/evaluation/lantern-road.json"), "utf8")));
else {
  jeu = await createStore(data).getGame(cible);
  if (!jeu) sortir(`Jeu introuvable : ${cible}`);
  cas = createEvaluations(resolve(data, "evaluations")).lire(cible);
  if (!cas.length) sortir("Aucun test pour ce jeu. Dans l'app, sous une réponse, touche « Réponse fausse ? » pour en ajouter.");
}
let runTask = runClaudeTask;
if (modeClaude() === "api") {
  const { createClaudeApi } = await import("../server/claude-api.mjs");
  runTask = createClaudeApi({ apiKey: process.env.ANTHROPIC_API_KEY }).runTask;
}
let usd = 0;
const r = await evaluer({
  jeu, cas, model, runTask: (o) => runTask({ ...o, onCout: (c) => { usd += c || 0; } }),
  onCas: (x) => console.log(`${x.erreur ? "!" : x.juste ? "✓" : "✗"} ${x.question}${x.page === false ? `  [page ${x.pages.join(", ") || "absente"}]` : ""}${x.juste ? "" : `\n    ${x.raison}`}`),
});
console.log(`\n${r.justes}/${r.total} réponses justes, ${r.pagesJustes}/${r.pagesVerifiees} bonnes pages${r.erreurs ? `, ${r.erreurs} erreur(s)` : ""}. ${model}, environ ${usd.toFixed(2)} $ US au tarif API.`);
if (cible !== "--demo") writeFileSync(resolve(data, "evaluations", `${cible}.resultat.json`), JSON.stringify({ date: new Date().toISOString(), model, ...r }, null, 1));
process.exit(r.justes === r.total && r.pagesJustes === r.pagesVerifiees ? 0 : 1);
