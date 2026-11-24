// Conversation vocale en direct : micro toujours ouvert, transcription au fil de la parole,
// voix lue par morceaux, et coupure dès que le joueur parle.
import { modeAudio } from "./vocal.js";
import { t as traduire, langue } from "./i18n.js";

const mots = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) || [];

/**
 * Retire du début ce que l'app vient de dire (écho du haut-parleur) et rend la suite, dite par le joueur.
 * "" : tout est de l'écho. Moins de deux mots communs ne comptent pas.
 */
export function sansEcho(entendu, dit) {
  const brut = entendu.split(/\s+/).filter((m) => mots(m).length);
  const a = brut.map((m) => mots(m).join(" ")), b = dit.split(/\s+/).map((m) => mots(m).join(" ")).filter(Boolean);
  let avant = new Array(b.length + 1).fill(0), coupe = 0;
  a.forEach((m, i) => {
    const ligne = [0];
    for (let j = 1; j <= b.length; j++) ligne[j] = m === b[j - 1] ? avant[j - 1] + 1 : Math.max(avant[j], ligne[j - 1]);
    if (ligne[b.length] > avant[b.length] && ligne[b.length] >= 2 && ligne[b.length] / (i + 1) >= 0.7) coupe = i + 1;
    avant = ligne;
  });
  return brut.slice(coupe).join(" ");
}

const ARRET = /^(stop|arrete|arretez|attends|attend|attendez|non|pause|chut|tais toi|silence|une seconde|un instant|ok merci|merci|ok stop|c est bon|c est beau|c est correct|wait|hold on|hang on|no|shush|be quiet|quiet|one second|one sec|one moment|ok thanks|thanks|thank you|that s enough|that s fine|never mind)$/;
/** Le joueur veut seulement le silence : on se tait sans poser de question. */
export const estArret = (t) => ARRET.test(mots(t).filter((m, i, l) => m !== l[i - 1]).join(" "));

/** Assez de paroles pour couper la voix ? Un mot seul est souvent un bruit ou un « hum ». */
export const assezPourCouper = (t) => estArret(t) || t.split(/\s+/).filter((m) => mots(m).length).length >= 2;

/**
 * Le joueur parle-t-il pendant que l'app parle ? Le seuil suit l'écho du haut-parleur :
 * il faut nettement plus fort que ce que le micro entend d'habitude pendant la voix.
 */
export function createVeille({ confirmation = 180, plancher = 0.018, grace = 1000 } = {}) {
  const echos = [];
  let voix = 0, avant = null, facteur = 2.6, debut = null;
  return {
    mesurer(niveau, ms) {
      const dt = avant === null ? 0 : Math.min(100, ms - avant);
      avant = ms;
      debut ??= ms;
      const tri = [...echos].sort((a, b) => a - b);
      const seuil = Math.max(plancher, (tri[Math.floor(tri.length * 0.8)] ?? 0) * facteur);
      // Au début de chaque réponse, l'annulation d'écho du téléphone n'est pas encore réglée : on apprend seulement.
      const appris = echos.length >= 20 && ms - debut >= grace;
      if (appris && niveau > seuil) voix += dt;
      else {
        voix = Math.max(0, voix - dt / 2);
        echos.push(niveau);
        if (echos.length > 200) echos.shift();
      }
      if (voix < confirmation) return false;
      voix = 0;
      return true;
    },
    /** Pause pour rien : moins sensible ensuite. */
    fausseAlerte() { facteur = Math.min(4, facteur * 1.15); },
    recommencer() { voix = 0; avant = null; debut = null; },
  };
}

/**
 * Ce qui part à la transcription. Porte fermée (l'app parle) : du silence, jamais sa propre voix.
 * Les derniers 400 ms sont gardés, pour ne pas perdre le premier mot de celui qui coupe.
 */
export function createPorte(reserveMax = 4) {
  let reserve = [];
  return {
    passer(pcm, fermee) {
      if (fermee) {
        reserve.push(pcm);
        if (reserve.length > reserveMax) reserve.shift();
        return [new ArrayBuffer(pcm.byteLength)];
      }
      const envoi = [...reserve, pcm];
      reserve = [];
      return envoi;
    },
    /** La voix s'est terminée d'elle-même : la réserve n'est que de l'écho. */
    oublier() { reserve = []; },
  };
}

/** Niveau à partir duquel quelqu'un parle, selon le bruit de la pièce. */
export const seuilParole = (bruit = 0.005) => Math.min(0.05, Math.max(0.012, bruit * 3));

/**
 * La voix vient d'être mise en pause : quelqu'un parle-t-il vraiment ? On laisse le haut-parleur se taire
 * (queue), puis il faut entendre une voix. mesurer(niveau, ms) rend "attente", "humain" ou "rien".
 */
export function createConfirmation({ bruit = 0.005, queue = 300, besoin = 160, fin = 1000 } = {}) {
  const seuil = seuilParole(bruit);
  let debut = null, avant = null, voix = 0;
  return {
    mesurer(niveau, ms) {
      debut ??= ms;
      const dt = avant === null ? 0 : Math.min(100, ms - avant);
      avant = ms;
      if (ms - debut >= queue && niveau > seuil) voix += dt;
      if (voix >= besoin) return "humain";
      return ms - debut >= fin ? "rien" : "attente";
    },
  };
}

/** Ce que le joueur a entendu, d'après les échantillons joués. */
export function texteEntendu(phrases, joues) {
  let debut = 0;
  const bouts = [];
  for (const p of phrases) {
    if (joues >= debut + p.echantillons && p.finie) bouts.push(p.texte);
    else {
      // Phrase encore en réception : on estime à 15 caractères par seconde.
      const total = p.finie ? p.echantillons : Math.max(p.echantillons, (p.texte.length / 15) * 24000);
      const part = total ? Math.max(0, Math.min(1, (joues - debut) / total)) : 0;
      const l = p.texte.split(" ");
      const n = Math.floor(l.length * part);
      if (n) bouts.push(l.slice(0, n).join(" "));
      break;
    }
    debut += p.echantillons;
  }
  return bouts.join(" ");
}

function enBase64(buf) {
  const o = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < o.length; i += 4096) s += String.fromCharCode(...o.subarray(i, i + 4096));
  return btoa(s);
}

/** Transcription ElevenLabs en direct, avec reconnexion. */
export function createTranscription({ jeton, onPartiel, onPhrase, onErreur }) {
  let ws = null, ferme = false, essais = 0, attente = [];
  async function connecter() {
    try {
      const { jeton: t, termes = [] } = await jeton();
      if (ferme) return;
      const q = new URLSearchParams({
        model_id: "scribe_v2_realtime", token: t, language_code: langue, audio_format: "pcm_16000",
        commit_strategy: "vad", vad_silence_threshold_secs: "0.6", no_verbatim: "true",
      });
      for (const terme of termes) q.append("keyterms", terme);
      const s = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`);
      ws = s;
      let derniereErreur = "";
      s.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.message_type === "session_started") {
          essais = 0;
          for (const p of attente) envoyer(p);
          attente = [];
        } else if (m.message_type === "partial_transcript") onPartiel(m.text || "");
        else if (m.message_type === "committed_transcript") onPhrase((m.text || "").trim());
        else if (m.error) derniereErreur = m.message_type;
      };
      s.onclose = () => {
        if (ferme || ws !== s) return;
        ws = null;
        if (derniereErreur === "quota_exceeded") return onErreur(new Error(traduire("Quota ElevenLabs atteint")));
        reessayer();
      };
    } catch (err) {
      if (!ferme) reessayer(err);
    }
  }
  function reessayer(err) {
    if (++essais > 3) return onErreur(err?.status ? err : new Error(traduire("L'écoute a été coupée. Touche le rond pour reprendre.")));
    setTimeout(() => { if (!ferme) connecter(); }, 300 * essais);
  }
  function envoyer(pcm, valider = false) {
    ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: enBase64(pcm), commit: valider, sample_rate: 16000 }));
  }
  connecter();
  return {
    envoyer(pcm) {
      if (ws?.readyState === 1) envoyer(pcm);
      else { attente.push(pcm); if (attente.length > 40) attente.shift(); } // 4 s gardées pendant la connexion
    },
    valider() { if (ws?.readyState === 1) envoyer(new ArrayBuffer(3200), true); },
    fermer() { ferme = true; attente = []; ws?.close(); },
  };
}

/** Voix lue par morceaux, dans l'ordre. synthetiser(texte, signal) rend une Response en PCM 24 kHz. */
export function createVoixDirecte(port, synthetiser) {
  let tour = 0, phrases = [], file = Promise.resolve(), controle = new AbortController(), joues = 0, erreur = null, enCours = 0;
  const places = [];
  const prendre = () => (enCours < 2 ? (enCours++, Promise.resolve()) : new Promise((r) => places.push(r)));
  const rendre = () => { const s = places.shift(); if (s) s(); else enCours--; };
  return {
    get phrases() { return phrases; },
    get erreur() { return erreur; },
    /** Rien à jouer et rien en préparation. */
    get finie() { return phrases.every((p) => p.finie) && joues >= phrases.reduce((s, p) => s + p.echantillons, 0) - 1300; },
    get dit() { return phrases.map((p) => p.texte).join(" "); },
    get commence() { return joues > 0; },
    entendu: () => texteEntendu(phrases, joues),
    progression(j) { joues = j; },
    dire(texte, pret = null) {
      const moi = tour, p = { texte, echantillons: 0, finie: false };
      phrases.push(p);
      const { signal } = controle;
      const reponse = pret ? Promise.resolve(pret) : prendre().then(() => synthetiser(texte, signal));
      reponse.catch(() => {});
      file = file.then(async () => {
        try {
          const r = await reponse;
          const lecteur = r.body.getReader();
          let reste = new Uint8Array(0);
          for (;;) {
            const { value, done } = await lecteur.read();
            if (done) break;
            if (moi !== tour) { lecteur.cancel().catch(() => {}); break; }
            const tout = new Uint8Array(reste.length + value.length);
            tout.set(reste); tout.set(value, reste.length);
            const pair = tout.length - (tout.length % 2);
            reste = tout.slice(pair);
            if (!pair) continue;
            const pcm = tout.slice(0, pair).buffer;
            p.echantillons += pair / 2;
            port.postMessage({ pcm }, [pcm]);
          }
        } catch (err) {
          if (moi === tour && err?.name !== "AbortError") erreur ||= err;
        } finally {
          p.finie = true;
          if (!pret) rendre();
        }
      });
    },
    pause(oui) { port.postMessage({ pause: oui }); },
    vider() {
      tour++;
      controle.abort();
      controle = new AbortController();
      phrases = []; joues = 0; erreur = null;
      file = Promise.resolve();
      port.postMessage({ vider: true });
    },
  };
}

/** Ouvre le micro et la voix sur le même contexte audio (annulation d'écho). ctx vient d'un geste du joueur. */
export async function ouvrirSon(ctx, { onNiveau, onPcm, onVoix }) {
  if (!navigator.mediaDevices?.getUserMedia || !ctx?.audioWorklet) throw new Error(traduire("Ce navigateur ne permet pas la conversation vocale."));
  modeAudio("play-and-record");
  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    modeAudio("playback");
    throw new Error(err?.name === "NotAllowedError"
      ? traduire("Le micro est refusé. Autorise-le dans les réglages de l'iPhone (Safari, Micro), puis réessaie.")
      : traduire("Aucun micro disponible."));
  }
  try {
    if (ctx.state !== "running") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
    await ctx.audioWorklet.addModule(new URL("./worklet-direct.js", import.meta.url));
    const source = ctx.createMediaStreamSource(flux);
    const capture = new AudioWorkletNode(ctx, "capture", { numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
    const voix = new AudioWorkletNode(ctx, "voix", { numberOfInputs: 0, outputChannelCount: [1] });
    capture.port.onmessage = ({ data }) => (data.pcm ? onPcm(data.pcm) : onNiveau(data.niveau));
    voix.port.onmessage = ({ data }) => onVoix(data);
    source.connect(capture);
    voix.connect(ctx.destination);
    return {
      port: voix.port,
      muet(oui) { flux.getAudioTracks().forEach((t) => { t.enabled = !oui; }); },
      fermer() {
        flux.getTracks().forEach((t) => t.stop());
        source.disconnect(); voix.disconnect();
        ctx.close().catch(() => {});
        modeAudio("auto");
      },
    };
  } catch (err) {
    flux.getTracks().forEach((t) => t.stop());
    modeAudio("auto");
    throw err;
  }
}
