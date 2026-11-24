// Cache audio sur le PC (data/audio) : une voix ou une ambiance déjà produite n'est jamais repayée.
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const audioKey = (...parts) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);

export function createAudioCache(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    async get(key) {
      try { return await readFile(join(dir, `${key}.mp3`)); } catch { return null; }
    },
    async put(key, buf) {
      await writeFile(join(dir, `${key}.mp3`), buf);
    },
  };
}
