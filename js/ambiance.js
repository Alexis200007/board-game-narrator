// Ambiance sonore sous la narration, par Web Audio (iOS ignore le volume d'un élément <audio>).

const VOLUME = 0.16;

export function createAmbiance() {
  let ctx = null;
  let current = null; // { nom, source, gain }
  const buffers = new Map(); // nom → Promise<AudioBuffer>

  function context() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  }

  function load(nom) {
    if (!buffers.has(nom)) {
      const p = fetch(`api/ambiance/${nom}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("ambiance indisponible"))))
        .then((buf) => context().decodeAudioData(buf));
      p.catch(() => buffers.delete(nom));
      buffers.set(nom, p);
    }
    return buffers.get(nom);
  }

  function fadeOut(ms = 1500) {
    if (!current) return;
    const { source, gain } = current;
    current = null;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
    source.stop(t + ms / 1000 + 0.05);
  }

  return {
    /** À appeler pendant un geste de l'utilisateur (exigence iOS). */
    unlock() {
      const c = context();
      if (c && c.state === "suspended") c.resume().catch(() => {});
    },
    /** Lance l'ambiance (ou la garde si c'est déjà la même). Une erreur n'empêche jamais la narration. */
    async play(nom) {
      if (!nom || nom === "aucune") return fadeOut();
      if (current?.nom === nom) return;
      const c = context();
      if (!c) return;
      let buffer;
      try { buffer = await load(nom); } catch { return; }
      fadeOut(1200);
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(VOLUME, c.currentTime + 1.5);
      source.connect(gain).connect(c.destination);
      source.start();
      current = { nom, source, gain };
    },
    fadeOut,
  };
}
