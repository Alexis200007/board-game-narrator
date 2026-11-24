// Accès protégé par mot de passe, pour un serveur ouvert sur Internet (APP_PASSWORD).
// Sans APP_PASSWORD (ordinateur à la maison, Tailscale), rien de ce fichier ne sert.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIPv6 } from "node:net";

export const LONGUEUR_MIN = 12;
const DUREE_MS = 30 * 24 * 3600_000;
const ESSAIS = 8, FENETRE_MS = 15 * 60_000;
// Nécessaires avant la connexion : le téléphone les demande sans cookie.
const LIBRES = new Set(["/icon.svg", "/icon-180.png", "/manifest.webmanifest"]);
const LOCALES = new Set(["127.0.0.1", "::1", "localhost"]);

/** Réglages réseau ; refuse d'ouvrir l'app au réseau sans mot de passe. */
export function lireAcces(env = process.env) {
  const hote = (env.HOST || "127.0.0.1").trim();
  const motDePasse = env.APP_PASSWORD || "";
  if (motDePasse && motDePasse.length < LONGUEUR_MIN) throw new Error(`APP_PASSWORD doit avoir au moins ${LONGUEUR_MIN} caractères. / APP_PASSWORD must be at least ${LONGUEUR_MIN} characters.`);
  if (!motDePasse && !LOCALES.has(hote)) throw new Error(`HOST=${hote} ouvre l'app au réseau : APP_PASSWORD est obligatoire. / APP_PASSWORD is required when HOST is not local.`);
  return { hote, motDePasse, proxy: env.TRUST_PROXY === "1" };
}

function secretDe(dossier) {
  const f = join(dossier, "secret-session");
  if (!existsSync(f)) {
    mkdirSync(dossier, { recursive: true });
    writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return readFileSync(f, "utf8").trim();
}

/** Adresse du visiteur. Derrière un proxy, la dernière de la liste : celle que le proxy a vue. */
export function adresse(req, proxy) {
  const suite = proxy ? String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean) : [];
  const ip = (suite.at(-1) || req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
  return isIPv6(ip) ? ip.split(":").slice(0, 4).join(":") : ip; // un abonné IPv6 a tout un bloc
}

const egaux = (a, b) => a.length === b.length && timingSafeEqual(a, b);

function corps(req, max = 4096) {
  return new Promise((rendre, refuser) => {
    let t = "", taille = 0;
    req.on("data", (d) => { taille += d.length; if (taille <= max) t += d; });
    req.on("end", () => rendre(taille > max ? "" : t));
    req.on("error", refuser);
  });
}

/** Entoure le serveur : rien ne passe sans session valide. */
export function proteger(handler, { motDePasse, dossier, proxy = false, page, maintenant = Date.now }) {
  // Changer le mot de passe ferme toutes les sessions.
  const cle = createHmac("sha256", secretDe(dossier)).update(motDePasse).digest();
  const signer = (t) => createHmac("sha256", cle).update(t);
  const attendu = signer(`mdp ${motDePasse}`).digest();
  const essais = new Map(); // adresse → { n, fin }

  function session(req) {
    const brut = /(?:^|;\s*)(?:__Host-)?session=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
    const [fin, alea, signature] = brut.split(".");
    if (!signature || !egaux(Buffer.from(signature), Buffer.from(signer(`${fin}.${alea}`).digest("base64url")))) return 0;
    return Number(fin) > maintenant() ? Number(fin) : 0;
  }
  function cookie(req, valeur, duree) {
    const local = LOCALES.has((req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, ""));
    return `${local ? "" : "__Host-"}session=${valeur}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(duree / 1000)}${local ? "" : "; Secure"}`;
  }
  function ouvrir(req) {
    const t = `${maintenant() + DUREE_MS}.${randomBytes(12).toString("base64url")}`;
    return cookie(req, `${t}.${signer(t).digest("base64url")}`, DUREE_MS);
  }
  const json = (res, code, o, entetes = {}) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...entetes });
    res.end(JSON.stringify(o));
  };

  async function connexion(req, res) {
    const qui = adresse(req, proxy), t = maintenant();
    if (essais.size > 5000) for (const [k, e] of essais) if (e.fin < t) essais.delete(k);
    let e = essais.get(qui);
    if (!e || e.fin < t) essais.set(qui, e = { n: 0, fin: t + FENETRE_MS });
    if (e.n >= ESSAIS) { req.resume(); return json(res, 429, { erreur: "trop" }, { "Retry-After": Math.ceil((e.fin - t) / 1000) }); }
    e.n++; // compté avant de vérifier : des essais simultanés ne passent pas sous la limite
    let donne = "";
    try { donne = String(JSON.parse(await corps(req)).motDePasse ?? ""); } catch { /* refusé plus bas */ }
    if (!egaux(signer(`mdp ${donne}`).digest(), attendu)) {
      console.warn(`Connexion refusée (${qui})`);
      return json(res, 401, { erreur: "faux" });
    }
    essais.delete(qui);
    json(res, 200, { ok: true }, { "Set-Cookie": ouvrir(req) });
  }

  return async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    const chemin = req.url.split("?")[0];
    const lecture = req.method === "GET" || req.method === "HEAD";
    try {
      if (chemin === "/api/sante" && lecture) return json(res, 200, { ok: true });
      // Une autre page web ne peut pas agir à la place du joueur.
      const origine = req.headers.origin;
      if (!lecture) {
        let hoteOrigine = null;
        if (origine) try { hoteOrigine = new URL(origine).host; } catch { hoteOrigine = ""; }
        if ((hoteOrigine !== null && hoteOrigine !== req.headers.host) || req.headers["sec-fetch-site"] === "cross-site") { req.resume(); return json(res, 403, { erreur: "Origine refusée." }); }
      }
      if (chemin === "/api/connexion" && req.method === "POST") return await connexion(req, res);
      if (lecture && LIBRES.has(chemin)) return await handler(req, res);
      const fin = session(req);
      if (!fin) {
        if (lecture && !chemin.startsWith("/api/") && !chemin.startsWith("/js/")) {
          const html = await readFile(page);
          res.writeHead(chemin === "/" || chemin === "/index.html" ? 200 : 401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(html);
        }
        // Un gros envoi refusé n'est pas reçu en entier.
        if (Number(req.headers["content-length"] || 0) > 1024 * 1024 || req.headers["transfer-encoding"]) res.setHeader("Connection", "close");
        else req.resume();
        return json(res, 401, { erreur: "Connecte-toi d'abord." }, { "X-Connexion": "1" });
      }
      if (chemin === "/api/deconnexion" && req.method === "POST") return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) });
      if (fin - maintenant() < DUREE_MS / 2) res.setHeader("Set-Cookie", ouvrir(req));
      return await handler(req, res);
    } catch {
      if (!res.headersSent) json(res, 500, { erreur: "Erreur du serveur." });
      else res.destroy();
    }
  };
}
