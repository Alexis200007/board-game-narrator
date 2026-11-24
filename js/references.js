// Pages du livret montrées sous une réponse, et leur vue agrandie.
import { t } from "./i18n.js";
import { ouvrir, fermer, fenetreDouce } from "./mouvement.js";

const $ = (id) => document.getElementById(id);
const base = (jeu, ref) => `api/jeux/${jeu}/livret/${ref.source}/page/${ref.page}`;
const libelle = (ref) => (ref.photo ? ref.titre : t("Livret, p. {n}", { n: ref.page }));
/** Campagnes « Legacy » : une page peut dévoiler une règle pas encore débloquée. */
export const aSurprises = (jeu) => /legacy|pand[eé]mi/i.test([jeu.nom, ...jeu.livret.map((p) => p.titre)].join(" "));

function poserCadres(feuille, boites) {
  for (const [x, y, l, h] of boites) {
    const c = Object.assign(document.createElement("span"), { className: "ref-cadre" });
    c.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${l * 100}%;height:${h * 100}%`;
    feuille.append(c);
  }
}

/** Bloc des pages citées. surprise : page floutée jusqu'à ce qu'on la touche. */
export function blocReferences(jeu, refs, { surprise = false, disponibles = null, ajouter = null, onTaille = () => {} } = {}) {
  const bloc = Object.assign(document.createElement("div"), { className: "refs" });
  for (const ref of refs) {
    if (disponibles && !disponibles.has(ref.source)) {
      bloc.append(Object.assign(document.createElement("p"), { className: "ref-sans", textContent: libelle(ref) }));
      if (ajouter && !ref.photo) bloc.append(ajouter(ref));
      continue;
    }
    const b = Object.assign(document.createElement("button"), { type: "button", className: "ref" });
    const vue = Object.assign(document.createElement("span"), { className: "ref-vue" });
    const feuille = Object.assign(document.createElement("span"), { className: "ref-feuille" });
    const img = Object.assign(document.createElement("img"), { alt: "", decoding: "async" });
    const legende = Object.assign(document.createElement("span"), { className: "ref-legende" });
    const action = document.createElement("small");
    legende.append(libelle(ref), action);
    feuille.append(img);
    vue.append(feuille);
    b.append(vue, legende);
    let boites = [], cache = surprise;
    const dire = () => { action.textContent = cache ? t("Peut dévoiler une surprise. Touche pour voir.") : t("Touche pour agrandir"); b.classList.toggle("cache", cache); };
    const centrer = () => {
      if (!img.naturalWidth) return;
      const h = feuille.offsetHeight, v = vue.clientHeight;
      const milieu = boites.length ? (Math.min(...boites.map((x) => x[1])) + Math.max(...boites.map((x) => x[1] + x[3]))) / 2 : 0;
      feuille.style.transform = `translateY(${-Math.max(0, Math.min(h - v, milieu * h - v / 2))}px)`;
    };
    dire();
    img.addEventListener("load", () => { b.classList.add("pret"); centrer(); onTaille(); });
    img.addEventListener("error", () => b.replaceWith(Object.assign(document.createElement("p"), { className: "ref-sans", textContent: libelle(ref) })));
    img.src = base(jeu.id, ref);
    if (ref.citation && !ref.photo) {
      fetch(`${base(jeu.id, ref)}/repere?q=${encodeURIComponent(ref.citation)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        boites = d?.boites || [];
        poserCadres(feuille, boites);
        centrer();
      }).catch(() => {});
    }
    b.addEventListener("click", () => {
      if (cache) { cache = false; dire(); return; }
      agrandir(img.src, libelle(ref), boites);
    });
    bloc.append(b);
  }
  return bloc;
}

// ---------- Vue agrandie : pincer ou toucher deux fois pour zoomer ----------
let zoom = 1;
function zoomer(z, cx, cy) {
  const d = $("page-defile"), f = $("page-feuille");
  const avant = zoom;
  zoom = Math.max(1, Math.min(4, z));
  const r = d.getBoundingClientRect();
  const x = cx - r.left, y = cy - r.top;
  const k = zoom / avant;
  const gx = d.scrollLeft + x, gy = d.scrollTop + y;
  f.style.width = `${zoom * 100}%`;
  d.scrollLeft = gx * k - x;
  d.scrollTop = gy * k - y;
}
function agrandir(src, titre, boites) {
  const f = $("page-feuille");
  zoom = 1;
  f.style.width = "100%";
  const img = Object.assign(document.createElement("img"), { alt: titre, src });
  f.replaceChildren(img);
  poserCadres(f, boites);
  $("page-titre").textContent = titre;
  ouvrir($("page-dialog"));
  const placer = () => {
    const d = $("page-defile");
    d.scrollLeft = 0;
    d.scrollTop = boites.length ? Math.max(0, boites[0][1] * f.offsetHeight - d.clientHeight / 3) : 0;
  };
  if (img.complete) placer();
  else img.addEventListener("load", placer, { once: true });
}

export function preparerVuePage() {
  const d = $("page-defile");
  let ecart = 0, depart = 1, dernierTouche = 0;
  const distance = (d2) => Math.hypot(d2[0].clientX - d2[1].clientX, d2[0].clientY - d2[1].clientY);
  d.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) { ecart = distance(e.touches); depart = zoom; }
  }, { passive: true });
  d.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !ecart) return;
    e.preventDefault();
    zoomer(depart * (distance(e.touches) / ecart), (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
  }, { passive: false });
  d.addEventListener("touchend", (e) => { if (e.touches.length < 2) ecart = 0; });
  d.addEventListener("click", (e) => {
    const t = performance.now();
    if (t - dernierTouche < 320) { dernierTouche = 0; zoomer(zoom > 1.2 ? 1 : 2.4, e.clientX, e.clientY); } else dernierTouche = t;
  });
  $("page-fermer").addEventListener("click", () => fermer($("page-dialog")));
  fenetreDouce($("page-dialog"));
}
