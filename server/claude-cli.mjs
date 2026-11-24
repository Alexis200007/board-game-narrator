// Tâches Claude via `claude -p` (abonnement Claude, sans clé API) :
// analyser une carte, extraire une page du livret, répondre à une question, résumer une partie.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANALYSIS_SCHEMA, SYSTEM_PROMPT, analysisSystem, validateAnalysis } from "../js/claude.js";
import { LABELS } from "./prompts-en.mjs";

const MODELS = new Set(["claude-opus-5", "claude-sonnet-5"]);
const EFFORTS = new Set(["low", "medium", "high"]);
export const CLAUDE_LOGIN_ERROR =
  "Claude n'est pas connecté sur l'ordinateur. Lance « claude auth login » dans un terminal, puis réessaie.";

/** systemFile remplace system quand les consignes sont trop longues pour la ligne de commande Windows. */
export function buildClaudeArgs(model, { system = SYSTEM_PROMPT, systemFile = null, schema = ANALYSIS_SCHEMA, effort = "low", partial = false } = {}) {
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--model", MODELS.has(model) ? model : "claude-opus-5",
    "--effort", EFFORTS.has(effort) ? effort : "low",
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    ...(systemFile ? ["--system-prompt-file", systemFile] : ["--system-prompt", system]),
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  if (partial) args.push("--include-partial-messages"); // réponse reçue au fil de l'écriture
  return args;
}

/** Morceau de texte d'une ligne stream-json (réponse en direct), ou null. */
export function textDeltaOf(raw) {
  try {
    const m = JSON.parse(raw);
    const d = m.type === "stream_event" && m.event?.type === "content_block_delta" ? m.event.delta : null;
    return d?.type === "text_delta" && typeof d.text === "string" ? d.text : null;
  } catch {
    return null;
  }
}

export function buildUserMessage(content) {
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

export function buildStdinMessage(base64, langue = "fr") {
  return buildUserMessage([
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
    { type: "text", text: LABELS[langue].photo },
  ]);
}

/**
 * Lit la sortie stream-json de `claude -p`.
 * expect = "analysis" (carte validée), "text" (réponse en texte libre).
 */
export function parseClaudeOutput(stdout, expect = "analysis") {
  let result = null;
  for (const raw of String(stdout).split("\n")) {
    if (!raw.trim()) continue;
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "result") result = msg;
    } catch {
      // ligne non JSON : ignorée
    }
  }
  if (!result) return { ok: false, erreur: "Claude n'a rien répondu. Réessaie." };

  if (result.is_error) {
    const text = String(result.result || "");
    if (/authenticat|oauth|log ?in|not logged/i.test(text)) return { ok: false, erreur: CLAUDE_LOGIN_ERROR };
    if (/limit/i.test(text)) return { ok: false, erreur: "Limite d'usage Claude atteinte. Réessaie plus tard." };
    return { ok: false, erreur: "Claude a rencontré une erreur. Réessaie." };
  }

  if (expect === "text") {
    const text = String(result.result || "").trim();
    return text ? { ok: true, text } : { ok: false, erreur: "Claude n'a rien répondu. Réessaie." };
  }

  let data = result.structured_output;
  if (data == null && typeof result.result === "string") {
    try { data = JSON.parse(result.result); } catch { data = null; }
  }
  if (expect === "json") {
    return data && typeof data === "object" ? { ok: true, data } : { ok: false, erreur: "La réponse de Claude est illisible. Réessaie." };
  }
  const checked = validateAnalysis(data);
  return checked.ok ? { ok: true, data: checked.data } : { ok: false, erreur: checked.erreur };
}

/** Lance une tâche `claude -p`. Ne lève jamais : rend { ok, data | text } ou { ok:false, erreur }. */
export function runClaudeTask({ content, system, schema = null, model, effort = "low", expect = "text", command = "claude", timeoutMs = 180_000, onText = null }) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let tmp = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (tmp) rmSync(tmp, { recursive: true, force: true });
      resolve(r);
    };
    let systemFile = null;
    if (system && system.length > 8000) {
      tmp = mkdtempSync(join(tmpdir(), "narrateur-"));
      systemFile = join(tmp, "consignes.txt");
      writeFileSync(systemFile, system, "utf8");
    }
    let child;
    try {
      child = spawn(command, buildClaudeArgs(model, { system, systemFile, schema, effort, partial: Boolean(onText) }), { shell: false, windowsHide: true });
    } catch {
      finish({ ok: false, erreur: "Claude Code est introuvable sur l'ordinateur." });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, erreur: "Claude a mis trop de temps à répondre. Réessaie." });
    }, timeoutMs);
    let pending = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!onText) return;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const l of lines) {
        const t = textDeltaOf(l);
        if (t) onText(t);
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      finish({ ok: false, erreur: "Claude Code est introuvable sur l'ordinateur." });
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish(parseClaudeOutput(out, expect));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buildUserMessage(content));
  });
}

/** Analyse d'une carte (photo JPEG en base64), avec le glossaire du jeu. */
export function runClaude(base64, model, glossaire = {}, { langue = "fr", ...opts } = {}) {
  return runClaudeTask({
    content: JSON.parse(buildStdinMessage(base64, langue)).message.content,
    system: analysisSystem(glossaire, langue),
    schema: ANALYSIS_SCHEMA,
    model,
    effort: "low",
    expect: "analysis",
    timeoutMs: 120_000,
    ...opts,
  });
}
