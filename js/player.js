// File de lecture : joue les segments à la suite sur un seul <audio> (exigence iOS),
// prépare tous les passages dès le départ (quelques requêtes à la fois) pour enchaîner sans trou,
// garde l'audio en cache pour rejouer sans repayer ElevenLabs.

export function createPlayer(audioEl, { fetchAudio, onState = () => {}, onEtat = () => {}, gapBefore = () => 0, concurrency = 3 }) {
  const cache = new Map(); // index → Promise<Blob>
  let run = 0; // incrémenté à chaque nouvelle lecture pour annuler la précédente
  let finishCurrent = null;
  let actif = false, enPause = false;
  const etat = (a, p) => { actif = a; enPause = p; onEtat(a ? (p ? "pause" : "lecture") : "fini"); };
  // Pause venue d'ailleurs (écouteurs, appel) pendant un passage.
  audioEl.addEventListener("pause", () => {
    if (finishCurrent && actif && !enPause && audioEl.paused && !audioEl.ended) etat(true, true);
  });

  // Limite le nombre de requêtes ElevenLabs simultanées (3 sur le forfait Starter).
  let active = 0;
  const waiting = [];
  function limited(task) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        task().then(resolve, reject).finally(() => {
          active--;
          waiting.shift()?.();
        });
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
  }

  function get(i) {
    if (!cache.has(i)) {
      const p = limited(() => fetchAudio(i));
      p.catch(() => cache.delete(i)); // un échec pourra être retenté plus tard
      cache.set(i, p);
    }
    return cache.get(i);
  }

  function playBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const done = () => {
        audioEl.removeEventListener("ended", done);
        audioEl.removeEventListener("error", done);
        finishCurrent = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      finishCurrent = done;
      audioEl.addEventListener("ended", done);
      audioEl.addEventListener("error", done);
      audioEl.src = url;
      if (!enPause) Promise.resolve(audioEl.play()).catch(() => { if (!enPause) done(); });
    });
  }

  async function playFrom(start, count) {
    const myRun = ++run;
    etat(true, false);
    audioEl.pause();
    finishCurrent?.();
    const end = start + count;
    for (let i = start; i < end; i++) get(i).catch(() => {}); // tout part dans l'ordre de lecture
    for (let i = start; i < end; i++) {
      if (myRun !== run) return;
      onState(i, "chargement");
      const next = get(i);
      const gap = i > start ? gapBefore(i) : 0;
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      if (myRun !== run) return;
      let blob;
      try {
        blob = await next;
      } catch (err) {
        if (myRun !== run) return;
        onState(i, "erreur", err);
        continue;
      }
      if (myRun !== run) return;
      onState(i, "lecture");
      await playBlob(blob);
      if (myRun !== run) return;
      onState(i, "fini");
    }
    etat(false, false);
  }

  return {
    playFrom,
    // En pause entre deux passages : le suivant attend.
    pause() { if (actif) etat(true, true); audioEl.pause(); },
    resume() {
      if (actif) etat(true, false);
      return finishCurrent || !actif ? Promise.resolve(audioEl.play()).catch(() => {}) : Promise.resolve();
    },
    get enPause() { return enPause; },
    stop() {
      run++;
      etat(false, false);
      audioEl.pause();
      finishCurrent?.();
    },
    clear() {
      this.stop();
      cache.clear();
    },
  };
}
