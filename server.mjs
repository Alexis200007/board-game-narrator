// Serveur du Narrateur, à lancer sur le PC : npm start
// (charge .env.local, où l'onboarding ElevenLabs a mis ELEVENLABS_API_KEY).
// À la maison : écoute seulement sur 127.0.0.1 ; l'iPhone y accède par `tailscale serve`.
// Sur un serveur : HOST et APP_PASSWORD (voir docs/DEPLOY.md).
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHandler } from "./server/app.mjs";
import { runClaude, runClaudeTask, modeClaude } from "./server/claude-cli.mjs";
import { createConversations } from "./server/direct.mjs";
import { createStore } from "./server/store.mjs";
import { createAudioCache } from "./server/audio-cache.mjs";
import { createImagesLivret } from "./server/images-livret.mjs";
import { createElevenTts } from "./server/eleven.mjs";
import { lireAcces, proteger } from "./server/acces.mjs";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const tts = process.env.ELEVENLABS_API_KEY ? createElevenTts(new ElevenLabsClient()) : null;
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : fileURLToPath(new URL("./data/", import.meta.url));
const store = createStore(dataDir); // profils de jeu : data/jeux/*.json
const audioCache = createAudioCache(resolve(dataDir, "audio"));

const images = createImagesLivret(resolve(dataDir, "livrets")); // PDF d'origine et pages dessinées

// Claude par l'abonnement (claude -p) ou par l'API : voir CLAUDE_MODE dans .env.example.
const mode = modeClaude();
let claude = { runClaude, runTask: runClaudeTask, conversations: createConversations() };
if (mode === "api") {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("CLAUDE_MODE=api demande ANTHROPIC_API_KEY dans .env.local.");
    process.exit(1);
  }
  const { createClaudeApi } = await import("./server/claude-api.mjs");
  const api = createClaudeApi({ apiKey });
  claude = { runClaude: api.runClaude, runTask: api.runTask, conversations: createConversations({ ouvrir: api.ouvrir }) };
}

let acces;
try { acces = lireAcces(); } catch (err) { console.error(err.message); process.exit(1); }
let handler = createHandler({ images, root, ...claude, claude: mode, connexion: Boolean(acces.motDePasse), tts, store, audioCache });
if (acces.motDePasse) handler = proteger(handler, { ...acces, dossier: dataDir, page: fileURLToPath(new URL("./connexion.html", import.meta.url)) });
const serveur = createServer((req, res) => {
  // Journal court : utile pour voir ce que l'iPhone demande vraiment.
  if (req.url !== "/api/sante") res.on("finish", () => console.log(`${req.method} ${req.url.split("?")[0]} → ${res.statusCode}  ${(req.headers["user-agent"] || "").match(/iPhone|Android|Windows|Mac/)?.[0] || ""}`));
  handler(req, res);
}).listen(port, acces.hote, () => {
  console.log(`Narrateur prêt : http://${acces.hote === "127.0.0.1" ? "localhost" : acces.hote}:${port}${acces.motDePasse ? " (mot de passe demandé)" : ""}`);
  console.log(mode === "api" ? "Claude : API Anthropic, facturée à l'usage." : "Claude : abonnement, par Claude Code.");
  if (!tts) console.warn("Attention : ELEVENLABS_API_KEY absente (.env.local). Les voix ne marcheront pas.");
  if (!acces.motDePasse) console.log(`Pour l'iPhone : tailscale serve --bg ${port}`);
});
// Arrêt propre (Docker, hébergeur) : les réponses en cours ont quelques secondes pour finir.
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  claude.conversations.fermerTout();
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
