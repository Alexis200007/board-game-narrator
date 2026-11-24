// Mouvement de l'interface : transitions d'écran, fermeture des fenêtres, texte qui s'écrit régulièrement.
// Seuls transform et opacity sont animés, pour rester fluide sur l'iPhone.

const calme = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Fait entrer un écran. sens : 1 = depuis la droite, -1 = depuis la gauche, 0 = fondu sur place. */
export function entrer(el, sens = 0) {
  if (calme() || !el.animate) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [{ opacity: 0, transform: sens ? `translateX(${sens * 18}px)` : "translateY(6px)" }, { opacity: 1, transform: "none" }],
    { duration: 240, easing: "cubic-bezier(.2, .8, .2, 1)" },
  );
}

/** Ouvre une fenêtre, même si elle était en train de se fermer. */
export function ouvrir(dialog) {
  dialog.classList.remove("sort");
  if (!dialog.open) dialog.showModal();
}

/** Ferme une fenêtre après son animation de sortie (jouée par la classe « sort »). */
export function fermer(dialog) {
  if (!dialog.open || dialog.classList.contains("sort")) return;
  if (calme()) return dialog.close();
  dialog.classList.add("sort");
  setTimeout(() => {
    if (!dialog.classList.contains("sort")) return; // rouverte entre-temps
    dialog.classList.remove("sort");
    if (dialog.open) dialog.close();
  }, 170);
}

/** Fermeture douce par Échap ou en touchant à côté de la fenêtre. */
export function fenetreDouce(dialog) {
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); fermer(dialog); });
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) fermer(dialog);
  });
}

/**
 * Étale un texte reçu par paquets : afficher(texte) est appelé à chaque image avec un peu plus de texte.
 * finir() rend une promesse tenue quand tout est affiché.
 */
export function createFlot(afficher, { image = (f) => requestAnimationFrame(f), cache = () => document.hidden || calme() } = {}) {
  let total = "", montre = 0, actif = false, fin = null, avant = 0;
  function pas() {
    const maintenant = performance.now();
    const dt = maintenant - avant;
    avant = maintenant;
    const reste = total.length - montre;
    if (reste > 0) {
      montre += cache() ? reste : Math.max(1, Math.ceil(reste * (1 - Math.exp(-dt / 230)))); // selon le temps écoulé, pas le nombre d'images
      afficher(total.slice(0, montre));
    }
    if (montre < total.length) return image(pas);
    actif = false;
    fin?.();
  }
  function lancer() {
    if (actif) return;
    actif = true;
    avant = performance.now();
    if (cache()) pas(); // page cachée : aucune image n'est dessinée
    else image(pas);
  }
  return {
    ajouter(morceau) { total += morceau; lancer(); },
    finir() { return new Promise((r) => { fin = r; lancer(); }); },
  };
}

/** Regroupe les appels : fn s'exécute au plus une fois par image. */
export function parImage(fn) {
  let prevu = false;
  return () => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; fn(); });
  };
}
