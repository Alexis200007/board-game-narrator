// Serveur du Narrateur, à lancer sur le PC : npm start
// (charge .env.local, où l'onboarding ElevenLabs a mis ELEVENLABS_API_KEY).
// Écoute seulement sur 127.0.0.1 ; l'iPhone y accède par `tailscale serve`.
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

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const tts = process.env.ELEVENLABS_API_KEY ? createElevenTts(new ElevenLabsClient()) : null;
const dataDir = fileURLToPath(new URL("./data/", import.meta.url));
const store = createStore(dataDir); // profils de jeu : data/jeux/*.json
const audioCache = createAudioCache(fileURLToPath(new URL("./data/audio/", import.meta.url)));

const images = createImagesLivret(fileURLToPath(new URL("./data/livrets/", import.meta.url))); // PDF d'origine et pages dessinées

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

const handler = createHandler({ images, root, ...claude, claude: mode, tts, store, audioCache });
createServer((req, res) => {
  // Journal court : utile pour voir ce que l'iPhone demande vraiment.
  res.on("finish", () => console.log(`${req.method} ${req.url.split("?")[0]} → ${res.statusCode}  ${(req.headers["user-agent"] || "").match(/iPhone|Android|Windows|Mac/)?.[0] || ""}`));
  handler(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Narrateur prêt : http://localhost:${port}`);
  console.log(mode === "api" ? "Claude : API Anthropic, facturée à l'usage." : "Claude : abonnement, par Claude Code.");
  if (!tts) console.warn("Attention : ELEVENLABS_API_KEY absente (.env.local). Les voix ne marcheront pas.");
  console.log(`Pour l'iPhone : tailscale serve --bg ${port}`);
});
