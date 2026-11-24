// Serveur du Narrateur, à lancer sur le PC : npm start
// (charge .env.local, où l'onboarding ElevenLabs a mis ELEVENLABS_API_KEY).
// Écoute seulement sur 127.0.0.1 ; l'iPhone y accède par `tailscale serve`.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHandler } from "./server/app.mjs";
import { runClaude, runClaudeTask } from "./server/claude-cli.mjs";
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

const handler = createHandler({ images, root, runClaude, runTask: runClaudeTask, tts, store, audioCache });
createServer((req, res) => {
  // Journal court : utile pour voir ce que l'iPhone demande vraiment.
  res.on("finish", () => console.log(`${req.method} ${req.url.split("?")[0]} → ${res.statusCode}  ${(req.headers["user-agent"] || "").match(/iPhone|Android|Windows|Mac/)?.[0] || ""}`));
  handler(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Narrateur prêt : http://localhost:${port}`);
  if (!tts) console.warn("Attention : ELEVENLABS_API_KEY absente (.env.local). Les voix ne marcheront pas.");
  console.log(`Pour l'iPhone : tailscale serve --bg ${port}`);
});
