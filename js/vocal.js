// Assistant vocal : découpage des réponses en phrases et session audio iOS.

/**
 * Coupe un texte qui arrive par morceaux en phrases complètes, prêtes à être lues.
 * Une phrase n'est rendue que si la suivante a commencé (pour ne pas couper « p. 12 » ou « 1.5 »).
 */
export function createDecoupeur(minLongueur = 12, { debutVite = false } = {}) {
  let tampon = "", premier = debutVite;
  return {
    ajouter(morceau) {
      tampon += morceau;
      const phrases = [];
      let debut = 0;
      for (const m of tampon.matchAll(/[.!?…]+[»")]*\s+(?=[A-ZÀ-ÖØ-Þ«"(\d])|\n+/g)) {
        const finPhrase = m.index + m[0].length;
        const bout = tampon.slice(debut, finPhrase).trim();
        if (bout.length < minLongueur || /(^|[\s(])(p|pp|no|ex|fig|art|M)\.$/.test(bout)) continue;
        phrases.push(bout);
        debut = finPhrase;
      }
      tampon = tampon.slice(debut);
      if (phrases.length) premier = false;
      // Conversation en direct : la voix commence dès la première virgule.
      const virgule = premier ? tampon.match(/^.{24,}?[,;:]\s+(?=\S)/) : null;
      if (virgule) {
        premier = false;
        phrases.push(virgule[0].trim());
        tampon = tampon.slice(virgule[0].length);
      }
      return phrases;
    },
    fin() {
      const reste = tampon.trim();
      tampon = "";
      return reste ? [reste] : [];
    },
  };
}

/** Texte à dire : sans mise en forme ni puces, qui s'entendraient mal. */
export function textePourVoix(t) {
  return t.replace(/[*_#`]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
}

/** Session audio iOS : haut-parleur normal pour la lecture, micro seulement pendant l'écoute. */
export function modeAudio(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* ancien iOS */ }
}

/** Lit des phrases à la suite sur l'élément <audio> déjà débloqué ; chacune est préparée d'avance. */
export function createLecteur(audioEl, synthetiser) {
  let essai = 0, file = Promise.resolve(), finir = null, erreur = null;
  function jouer(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const fin = () => {
        audioEl.removeEventListener("ended", fin);
        audioEl.removeEventListener("error", fin);
        finir = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      finir = fin;
      audioEl.addEventListener("ended", fin);
      audioEl.addEventListener("error", fin);
      audioEl.src = url;
      Promise.resolve(audioEl.play()).catch((err) => { if (finir === fin) erreur ||= err; fin(); });
    });
  }
  return {
    dire(phrase, onDebut = () => {}) {
      const mien = essai;
      const audio = synthetiser(phrase);
      audio.catch(() => {});
      file = file.then(async () => {
        if (mien !== essai) return;
        try {
          const blob = await audio;
          if (mien !== essai) return;
          onDebut();
          await jouer(blob);
        } catch (err) {
          if (mien === essai) erreur ||= err;
        }
      });
    },
    /** Attend la fin de tout ce qui a été demandé ; rend la première erreur de voix, s'il y en a une. */
    async attendre() {
      await file;
      const e = erreur;
      erreur = null;
      return e;
    },
    couper() {
      essai++;
      audioEl.pause();
      finir?.();
      erreur = null;
      file = Promise.resolve();
    },
  };
}
