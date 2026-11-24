// Conversation vocale en direct : un seul `claude -p` reste ouvert pendant toute la conversation,
// avec le livret déjà lu. Chaque question repart donc en une seconde environ, et on peut le couper.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeEnv, buildClaudeArgs, buildUserMessage, parseClaudeOutput, textDeltaOf } from "./claude-cli.mjs";
import { LABELS } from "./prompts-en.mjs";

export const MODELE_DIRECT = "claude-sonnet-5"; // le plus rapide qui reste fiable sur les règles
export const PERDU = "La conversation a été coupée. Touche le rond pour recommencer.";

/** Ouvre Claude et lui fait lire les consignes. Rend { pret, demander, couper, fermer, occupe }. */
export function ouvrirConversation({ system, contexte, langue = "fr", lancer = spawn, delaiMs = 60_000, onFermee = () => {} }) {
  const dossier = mkdtempSync(join(tmpdir(), "narrateur-direct-"));
  const consignes = join(dossier, "consignes.txt");
  writeFileSync(consignes, system, "utf8");
  const enfant = lancer("claude", buildClaudeArgs(MODELE_DIRECT, { systemFile: consignes, schema: null, effort: "low", partial: true }), { shell: false, windowsHide: true, env: claudeEnv() });
  let tampon = "", tour = null, ferme = false, suite = Promise.resolve(), numero = 0, coupureEntendue = null;

  function finir(r) {
    const t = tour;
    tour = null;
    if (!t) return;
    clearTimeout(t.minuteur);
    t.rendre(t.coupe ? { ok: true, text: t.texte.trim(), coupe: true } : r);
  }
  function fermer() {
    if (ferme) return;
    ferme = true;
    try { enfant.stdin.end(); } catch { /* déjà fermé */ }
    enfant.kill();
    finir({ ok: false, erreur: PERDU });
    // Windows garde parfois le fichier ouvert un instant.
    setTimeout(() => rmSync(dossier, { recursive: true, force: true, maxRetries: 3 }), 300).unref?.();
    onFermee();
  }
  enfant.stdout.on("data", (d) => {
    tampon += d;
    const lignes = tampon.split("\n");
    tampon = lignes.pop();
    for (const l of lignes) {
      const t = textDeltaOf(l);
      if (t && tour && !tour.coupe) { tour.texte += t; tour.onTexte(t); }
      else if (/"type":"result"/.test(l)) {
        let m = null;
        try { m = JSON.parse(l); } catch { /* ligne coupée */ }
        if (m?.type === "result") finir(parseClaudeOutput(l, "text"));
      }
    }
  });
  enfant.stderr.on("data", () => {});
  enfant.stdin.on("error", () => {});
  enfant.on("error", fermer);
  enfant.on("close", fermer);

  function envoyer(texte, onTexte) {
    return new Promise((rendre) => {
      if (ferme) return rendre({ ok: false, erreur: PERDU });
      tour = { rendre, onTexte, texte: "", coupe: false, minuteur: setTimeout(fermer, delaiMs) };
      enfant.stdin.write(buildUserMessage([{ type: "text", text: texte }]));
    });
  }
  function interrompre() {
    if (!tour || tour.coupe) return;
    tour.coupe = true;
    enfant.stdin.write(JSON.stringify({ type: "control_request", request_id: `c${++numero}`, request: { subtype: "interrupt" } }) + "\n");
  }
  const enchainer = (fn) => { const p = suite.then(fn); suite = p.catch(() => {}); return p; };
  const pret = enchainer(() => envoyer(`${contexte}\n\n${LABELS[langue].debut}`, () => {}));
  let enQuestion = false;

  return {
    pret,
    get fermee() { return ferme; },
    /** Pose une question. Une question en cours est coupée d'abord. Ne lève jamais. */
    demander(question, onTexte) {
      if (enQuestion) interrompre();
      const signal = { aborted: false };
      this.annulerAttente?.();
      this.annulerAttente = () => { signal.aborted = true; };
      return enchainer(async () => {
        if (signal.aborted) return { ok: true, text: "", coupe: true }; // coupée avant d'être posée
        const note = coupureEntendue === null ? "" : coupureEntendue
          ? LABELS[langue].coupe(coupureEntendue)
          : LABELS[langue].coupeAvant;
        coupureEntendue = null;
        enQuestion = true;
        try { return await envoyer(note + question, onTexte); } finally { enQuestion = false; }
      });
    },
    /** Arrête la réponse en cours ; entendu = ce que le joueur a eu le temps d'entendre. */
    couper(entendu = "") {
      coupureEntendue = String(entendu).slice(-1500);
      this.annulerAttente?.();
      if (enQuestion) interrompre();
    },
    fermer,
  };
}

/** Conversations ouvertes : fermées après un moment sans question, et deux au plus à la fois. */
export function createConversations({ ouvrir = ouvrirConversation, inactiviteMs = 4 * 60_000 } = {}) {
  const ouvertes = new Map();
  const toucher = (c) => {
    clearTimeout(c.minuteur);
    c.minuteur = setTimeout(() => c.conv.fermer(), inactiviteMs);
    c.minuteur.unref?.();
  };
  return {
    creer(id, jeu, options) {
      // Deux téléphones peuvent parler en même temps ; au-delà, la plus ancienne se ferme.
      const anciennes = [...ouvertes.values()];
      if (anciennes.length >= 2) anciennes[0].conv.fermer();
      const c = { id, jeu };
      c.conv = ouvrir({ ...options, onFermee: () => { clearTimeout(c.minuteur); ouvertes.delete(id); } });
      ouvertes.set(id, c);
      toucher(c);
      return c.conv;
    },
    trouver(id, jeu) {
      const c = ouvertes.get(id);
      if (!c || c.jeu !== jeu) return null;
      toucher(c);
      return c.conv;
    },
    fermerTout() { for (const c of [...ouvertes.values()]) c.conv.fermer(); },
  };
}
