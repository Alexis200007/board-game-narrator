// Stockage des profils de jeu sur le PC : un fichier JSON par jeu dans data/jeux/.
import { mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const VALID_ID = /^[a-z0-9-]{1,60}$/;

export function slugify(nom) {
  const s = String(nom).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return s || "jeu";
}

export function newPartie() {
  return { id: randomUUID().slice(0, 8), debut: new Date().toISOString(), cartes: [], discussion: [], resume: null };
}

export function newGroupe(nom = "Groupe principal", id = randomUUID().slice(0, 8)) {
  return { id, nom, parties: [newPartie()], personnages: {} };
}

/** Ancien format (parties directement dans le jeu) → un « Groupe principal » qui les reprend. */
export function normalizeGame(g) {
  if (!Array.isArray(g.groupes)) {
    const groupe = newGroupe("Groupe principal", "principal");
    if (Array.isArray(g.parties) && g.parties.length) groupe.parties = g.parties;
    groupe.personnages = g.personnages || {};
    g.groupes = [groupe];
  }
  delete g.parties;
  delete g.personnages;
  g.glossaire ||= {};
  g.livret ||= [];
  return g;
}

export function createStore(dataDir) {
  const dir = join(dataDir, "jeux");
  mkdirSync(dir, { recursive: true });
  const queues = new Map(); // id → dernière écriture en cours (les écritures d'un jeu passent l'une après l'autre)
  const file = (id) => join(dir, `${id}.json`);

  async function getGame(id) {
    if (!VALID_ID.test(id || "")) return null;
    try {
      return normalizeGame(JSON.parse(await readFile(file(id), "utf8")));
    } catch {
      return null;
    }
  }

  async function write(game) {
    const tmp = `${file(game.id)}.${randomUUID().slice(0, 6)}.tmp`;
    await writeFile(tmp, JSON.stringify(game, null, 1), "utf8");
    // Sous Windows, le renommage échoue (EPERM, EBUSY) si le fichier est lu au même moment : on réessaie.
    for (let essai = 1; ; essai++) {
      try {
        await rename(tmp, file(game.id));
        return;
      } catch (err) {
        if (essai >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
        await new Promise((r) => setTimeout(r, 15 * essai));
      }
    }
  }

  /** Lit, modifie avec fn(jeu) et réécrit le jeu, sans jamais mélanger deux écritures du même jeu. */
  function update(id, fn) {
    if (!VALID_ID.test(id || "")) return Promise.reject(new Error("Identifiant de jeu invalide."));
    const prev = queues.get(id) || Promise.resolve();
    const job = prev.then(async () => {
      const game = await getGame(id);
      if (!game) throw Object.assign(new Error("Jeu introuvable."), { status: 404 });
      const next = (await fn(game)) || game;
      await write(next);
      return next;
    });
    queues.set(id, job.catch(() => {}));
    return job;
  }

  async function listGames() {
    const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    const games = await Promise.all(ids.map(getGame));
    return games.filter(Boolean);
  }

  // Création sérialisée elle aussi, pour que deux « Gloomhaven » simultanés aient des identifiants distincts.
  let creating = Promise.resolve();
  function createGame(nom, groupe) {
    const job = creating.then(async () => {
      const base = slugify(nom);
      let id = base;
      for (let n = 2; (await getGame(id)) || id.length > 60; n++) id = `${base.slice(0, 55)}-${n}`;
      const game = { id, nom: String(nom).trim() || "Jeu", glossaire: {}, livret: [], groupes: [newGroupe(groupe)] };
      await write(game);
      return game;
    });
    creating = job.catch(() => {});
    return job;
  }

  /** Copie de secours d'un groupe supprimé, hors de l'app : data/corbeille. */
  async function corbeille(jeu, groupe) {
    const d = join(dataDir, "corbeille");
    mkdirSync(d, { recursive: true });
    await writeFile(join(d, `${jeu}-${Date.now()}-${randomUUID().slice(0, 6)}.json`), JSON.stringify({ jeu, groupe }, null, 1), "utf8");
  }

  return { listGames, createGame, getGame, update, corbeille };
}
