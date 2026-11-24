// L'écran reste allumé pendant une lecture ou une conversation (iOS 18.4 ou plus pour l'app installée).
export function createEcran({ doc = globalThis.document, verrou = globalThis.navigator?.wakeLock } = {}) {
  const raisons = new Set();
  let garde = null, demande = null;
  async function ajuster() {
    if (demande) return; // la demande en cours rappellera ajuster()
    if (raisons.size && !garde && verrou && doc.visibilityState === "visible") {
      demande = verrou.request("screen");
      let g = null;
      try { g = await demande; } catch { /* batterie faible, ancien iOS : l'écran suit ses réglages */ }
      demande = null;
      if (!g) return;
      garde = g;
      g.addEventListener("release", () => { if (garde === g) garde = null; });
      if (!raisons.size) ajuster();
    } else if (!raisons.size && garde) {
      const g = garde;
      garde = null;
      g.release().catch(() => {});
    }
  }
  // iOS relâche l'écran quand on quitte l'app : on le reprend au retour.
  doc?.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") ajuster(); });
  return {
    garder(raison, oui) {
      if (oui) raisons.add(raison);
      else raisons.delete(raison);
      ajuster();
    },
  };
}
