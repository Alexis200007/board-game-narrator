import { preparerDeconnexion } from "./acces.js";
import { createEcran } from "./ecran.js";
import { afficherCouts } from "./couts.js";
import { loadSettings, saveSettings } from "./settings.js";
import { t, tErreur, langue, enTeteLangue, traduirePage } from "./i18n.js";
import { createCaster, defaultRoles, fallbackVoiceFor, castVoiceOptions } from "./voices.js";
import { analyzeImage } from "./claude.js";
import { synthesize, listVoices, ttsText } from "./tts.js";
import { createPlayer } from "./player.js";
import { loadImage, cropAndResize } from "./image.js";
import { initialRect, moveRect, resizeRect, rescaleRect, toNaturalCrop } from "./crop.js";
import { jeuxApi } from "./api.js";
import { createLecteur, createDecoupeur, textePourVoix } from "./vocal.js";
import { createTranscription, createVeille, createPorte, createConfirmation, seuilParole, createVoixDirecte, ouvrirSon, sansEcho, estArret, assezPourCouper } from "./direct.js";
import { entrer, ouvrir, fermer, fenetreDouce, createFlot, parImage } from "./mouvement.js";
import { blocReferences, preparerVuePage, aSurprises } from "./references.js";
import { createAmbiance } from "./ambiance.js";

const $ = (id) => document.getElementById(id);
const CASTER_KEY = "narrateur-jeux:personnages";

traduirePage();
let settings = loadSettings();
if (settings.langue !== langue) { settings.langue = langue; saveSettings(settings); }
// Distribution française par défaut (voir js/voices.js) ; les choix des réglages la remplacent rôle par rôle.
if (!settings.voices.narrateur) { settings.voices = defaultRoles(langue); saveSettings(settings); }
let analysis = null;
let segmentVoices = [];
let lastJob = null; // { img, crop } pour « Réessayer »
let voiceList = [];
let currentGame = null; // profil du jeu actif (glossaire, livret, parties), partagé par le serveur
let cropTarget = "carte"; // "carte" : traduire ; "livret" : ajouter une page au livret
let narrationRun = 0;
const ambiance = createAmbiance();
const ecran = createEcran(); // reste allumé pendant une lecture, une attente ou une conversation
// Groupe actif de ce téléphone pour le jeu en cours (le premier groupe par défaut).
const currentGroupe = () => currentGame?.groupes.find((g) => g.id === settings.groupes?.[currentGame.id]) || currentGame?.groupes[0] || null;
const currentPartie = () => currentGroupe()?.parties.at(-1) || null;

const audio = $("audio");
audio.playbackRate = settings.rate;

let caster = makeCaster();

const player = createPlayer(audio, {
  fetchAudio: (i) => speakWithFallback(ttsText(analysis.segments[i]), segmentVoices[i]),
  onEtat(etat) {
    ecran.garder("lecture", etat === "lecture");
    $("btn-pause").hidden = etat === "fini";
    $("btn-pause").textContent = etat === "pause" ? t("Reprendre") : t("Pause");
    $("btn-replay").textContent = etat === "fini" ? t("Réécouter") : t("Au début");
  },
  // Courte respiration entre deux voix, presque rien quand la même voix continue.
  gapBefore: (i) => (segmentVoices[i] !== segmentVoices[i - 1] ? 350 : 80),
  onState(i, state, err) {
    const li = $("segments").children[i];
    if (!li) return;
    // Un seul passage en cours : celui qu'on quitte en touchant un autre s'éteint.
    if (state === "chargement") for (const x of $("segments").children) x.classList.remove("chargement", "lecture");
    li.classList.remove("chargement", "lecture", "fini", "erreur");
    li.classList.add(state);
    if (state === "lecture") li.scrollIntoView({ behavior: "smooth", block: "center" });
    if (state === "erreur" && err) showError(t("{erreur}. Le texte reste affiché.", { erreur: err.message.replace(/.$/, "") }), false);
  },
});

// Si une voix de la bibliothèque est refusée (forfait, voix retirée), on bascule sur une voix premade.
async function speakWithFallback(text, voiceId, options) {
  try {
    return await synthesize(text, voiceId, options);
  } catch (err) {
    const fallback = [402, 403, 404].includes(err.code) ? fallbackVoiceFor(voiceId) : null;
    if (!fallback) throw err;
    return synthesize(text, fallback, options);
  }
}

// ---------- Personnages (mémoire de la partie) ----------
function makeCaster() {
  let saved = currentGroupe()?.personnages?.assigned ? currentGroupe().personnages : null;
  if (!currentGame) {
    try { saved = JSON.parse(localStorage.getItem(CASTER_KEY) || "null"); } catch { saved = null; }
  }
  return createCaster(settings.voices, saved);
}
function saveCaster() {
  if (currentGame) {
    const groupe = currentGroupe();
    groupe.personnages = caster.toJSON();
    jeuxApi.personnages(currentGame.id, { groupe: groupe.id, ...groupe.personnages }).catch(() => {});
    return;
  }
  try { localStorage.setItem(CASTER_KEY, JSON.stringify(caster.toJSON())); } catch { /* stockage bloqué */ }
}

// ---------- Vues ----------
const TABS = ["home", "regles", "historique", "jeu"];
let resultReturn = "home"; // écran où « Retour » ramène depuis une carte lue
const VUES = ["home", "crop", "loading", "result", "jeu", "historique", "regles", "reglages", "aide"];
const PROFONDEUR = { crop: 1, loading: 2, result: 3, reglages: 4, aide: 1 }; // au-dessus des onglets
const defilement = {}; // position gardée pour chaque onglet
let vueActuelle = null;
const TITRES = { crop: t("Cadre le texte"), loading: "", result: t("Lecture"), reglages: t("Réglages"), aide: t("Mon tour") };
let titreLecture = t("Lecture");
function sensVers(view) {
  const a = PROFONDEUR[vueActuelle] || 0, b = PROFONDEUR[view] || 0;
  if (a || b) return view === "loading" || vueActuelle === "loading" ? 0 : Math.sign(b - a);
  return Math.sign(TABS.indexOf(view) - TABS.indexOf(vueActuelle));
}
function show(view) {
  const change = vueActuelle !== view;
  if (change && vueActuelle === "aide") arreterAide();
  if (change && TABS.includes(vueActuelle)) defilement[vueActuelle] = window.scrollY;
  ecran.garder("attente", view === "loading");
  const sens = vueActuelle ? sensVers(view) : 0;
  for (const v of VUES) $(`view-${v}`).hidden = v !== view;
  $("controls").hidden = view !== "result";
  $("crop-controls").hidden = view !== "crop";
  $("chat-form").hidden = view !== "regles";
  // Les onglets restent visibles sur les écrans principaux ; la lecture et le recadrage ont leur propre barre.
  const tab = TABS.includes(view) ? view : null;
  $("tabbar").hidden = !tab;
  majEntete(view);
  majBarreGroupe();
  for (const b of document.querySelectorAll(".tab")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (tab) $("tabbar").style.setProperty("--i", TABS.indexOf(tab));
  document.body.classList.toggle("has-controls", ["result", "crop"].includes(view));
  document.body.classList.toggle("has-tabbar", !$("tabbar").hidden);
  document.body.classList.toggle("has-chat", view === "regles");
  document.body.classList.toggle("cropping", view === "crop");
  if (change) window.scrollTo(0, (tab && defilement[tab]) || 0);
  if (change) entrer($(`view-${view}`), sens);
  vueActuelle = view;
}
/** Écrans principaux : le jeu. Ailleurs : une flèche de retour et le nom de l'écran. */
function majEntete(view) {
  const profond = !TABS.includes(view);
  $("btn-jeu").hidden = profond;
  $("titre-vue").hidden = !profond;
  $("titre-vue").textContent = view === "result" ? titreLecture : TITRES[view] ?? "";
  $("btn-retour").hidden = !profond || view === "loading";
  $("btn-settings").hidden = ["crop", "loading", "reglages"].includes(view);
}
const RETOURS = { reglages: () => closeSettings(), aide: () => retourAide(), result: () => retourLecture(), crop: () => { hideError(); if (cropTarget === "livret" && currentGame) return ouvrirJeu(); show("home"); } };
$("btn-retour").addEventListener("click", () => RETOURS[vueActuelle]?.());

// Question dans l'app : rend true ou le texte saisi, null si on annule.
let repondre = null;
function demander({ titre, texte = "", oui, danger = false, champ = null, max = 60 }) {
  repondre?.(null);
  $("demande-titre").textContent = frenchSpacing(titre);
  $("demande-texte").textContent = frenchSpacing(texte);
  $("demande-texte").hidden = !texte;
  $("demande-bloc").hidden = champ === null;
  $("demande-champ").maxLength = max;
  $("demande-champ").value = champ ?? "";
  $("demande-champ").setAttribute("aria-label", titre);
  $("demande-oui").textContent = oui;
  $("demande-oui").classList.toggle("btn-danger", danger);
  ouvrir($("demande"));
  $(champ === null ? "demande-titre" : "demande-champ").focus();
  return new Promise((r) => { repondre = (v) => { repondre = null; r(v); }; });
}
$("demande-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const valeur = $("demande-bloc").hidden ? true : $("demande-champ").value.trim();
  if (!valeur) return $("demande-champ").focus();
  repondre?.(valeur);
  fermer($("demande"));
});
$("demande-non").addEventListener("click", () => fermer($("demande")));
$("demande").addEventListener("close", () => repondre?.(null));

let avisFin = null;
/** Petite confirmation en bas de l'écran. */
function avis(texte) {
  clearTimeout(avisFin);
  $("avis").textContent = frenchSpacing(texte);
  $("avis").classList.add("la");
  avisFin = setTimeout(() => $("avis").classList.remove("la"), 2600);
}
// Le sélecteur de groupe n'apparaît que sur les écrans principaux, quand un jeu est choisi.
function majBarreGroupe() {
  $("groupe-bar").hidden = !(currentGame || apercu) || $("tabbar").hidden;
}
function showError(message, withRetry = true) {
  $("error-text").textContent = frenchSpacing(message);
  $("btn-retry").hidden = !withRetry;
  $("error").hidden = false;
}
function hideError() { $("error").hidden = true; }
$("btn-error-fermer").addEventListener("click", hideError);

// ---------- iOS : débloquer l'audio pendant le geste de l'utilisateur ----------
const SILENCE = (() => {
  // WAV silencieux de 0,05 s, généré pour éviter un fichier externe.
  const rate = 8000, n = 400, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
})();
let unlocked = false;
function unlockAudio() {
  ambiance.unlock();
  if (unlocked) return;
  audio.src = SILENCE;
  audio.play().then(() => { unlocked = true; }).catch(() => {});
}
for (const id of ["photo-input", "photo-input-library", "photo-input-2", "photo-input-3"]) {
  $(id).addEventListener("click", unlockAudio);
  $(id).addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    // « Reprendre » garde la destination en cours (carte ou page du livret).
    if (file) handlePhoto(file, id === "photo-input-3" ? cropTarget : "carte");
  });
}

// ---------- Photo → sélection du texte ----------
let cropImg = null;
let cropBounds = null; // zone où la photo est affichée, en px dans la scène
let cropRect = null;

async function handlePhoto(file, target = "carte") {
  cropTarget = target;
  $("btn-crop-all").textContent = target === "livret" ? t("Page entière") : t("Photo entière");
  $("btn-crop-ok").textContent = target === "livret" ? t("Ajouter") : t("Traduire");
  hideError();
  player.clear();
  let img;
  try {
    img = await loadImage(file);
  } catch (err) {
    showError(err.message);
    return;
  }
  if (cropImg) URL.revokeObjectURL(cropImg.src);
  cropImg = img;
  $("crop-img").src = img.src;
  cropBounds = null; // le ResizeObserver place le cadre dès que la scène a sa vraie taille
  show("crop");
  layoutCrop();
}

// Calcule où la photo est dessinée (object-fit: contain) et replace le cadre.
function layoutCrop() {
  if (!cropImg || $("view-crop").hidden) return;
  const stage = $("crop-stage").getBoundingClientRect();
  if (stage.width < 10 || stage.height < 10) return;
  const k = Math.min(stage.width / cropImg.naturalWidth, stage.height / cropImg.naturalHeight);
  const w = cropImg.naturalWidth * k, h = cropImg.naturalHeight * k;
  const next = { x: (stage.width - w) / 2, y: (stage.height - h) / 2, w, h };
  // Nouvelle photo : cadre par défaut. Simple changement de taille (barre Safari, rotation) : on garde la sélection.
  cropRect = cropBounds && cropRect ? rescaleRect(cropRect, cropBounds, next) : initialRect(next);
  cropBounds = next;
  drawFrame();
}
function drawFrame() {
  const f = $("crop-frame").style;
  f.transform = `translate3d(${cropRect.x}px, ${cropRect.y}px, 0)`; f.width = `${cropRect.w}px`; f.height = `${cropRect.h}px`;
}
const dessinerCadre = parImage(drawFrame);
new ResizeObserver(layoutCrop).observe($("crop-stage"));

// Au doigt : un coin redimensionne, l'intérieur du cadre le déplace.
let drag = null;
$("crop-frame").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  drag = { handle: e.target.dataset.h || null, x: e.clientX, y: e.clientY, id: e.pointerId };
  $("crop-frame").setPointerCapture(e.pointerId);
});
$("crop-frame").addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  cropRect = drag.handle ? resizeRect(cropRect, drag.handle, dx, dy, cropBounds, 50) : moveRect(cropRect, dx, dy, cropBounds);
  dessinerCadre();
});
for (const ev of ["pointerup", "pointercancel"]) $("crop-frame").addEventListener(ev, () => { drag = null; });

$("btn-crop-ok").addEventListener("click", () => {
  unlockAudio();
  const crop = cropBounds ? toNaturalCrop(cropRect, cropBounds, { w: cropImg.naturalWidth, h: cropImg.naturalHeight }) : null;
  (cropTarget === "livret" ? addLivretPhoto : translate)({ img: cropImg, crop });
});
$("btn-crop-all").addEventListener("click", () => {
  unlockAudio();
  (cropTarget === "livret" ? addLivretPhoto : translate)({ img: cropImg, crop: null });
});

// ---------- Sélection → analyse → narration ----------
let traduction = 0; // « Annuler » : la réponse en retard n'ouvre rien
$("btn-annuler").addEventListener("click", () => { traduction++; $("btn-annuler").hidden = true; show("crop"); });
async function translate(job) {
  const moi = ++traduction;
  lastJob = job;
  hideError();
  player.clear();
  show("loading");
  $("btn-annuler").hidden = false;
  $("loading-text").textContent = t("Lecture de la carte");
  try {
    const image = await cropAndResize(job.img, job.crop);
    if (moi !== traduction) return;
    $("loading-text").textContent = t("Traduction en cours");
    const a = await analyzeImage(image, settings.model, { jeu: currentGame?.id, groupe: currentGroupe()?.id, partie: currentPartie()?.id });
    if (moi !== traduction) { if (currentGame) refreshGame(); return; }
    analysis = a;
  } catch (err) {
    if (moi !== traduction) return;
    $("btn-annuler").hidden = true;
    show("crop"); // on revient à la sélection pour réessayer ou recadrer
    showError(err.message || t("Une erreur est survenue."));
    return;
  }
  $("btn-annuler").hidden = true;
  playAnalysis(analysis);
  if (currentGame) refreshGame(); // glossaire et historique mis à jour par le serveur
}

/** Affiche une carte traduite et la raconte, avec son ambiance. */
function playAnalysis(a, from = "home", titre = t("Lecture")) {
  resultReturn = from;
  titreLecture = titre;
  analysis = a;
  segmentVoices = analysis.segments.map((s) => caster.voiceFor(s));
  saveCaster();
  renderResult();
  show("result");
  const run = ++narrationRun;
  if (settings.ambiance) ambiance.play(analysis.ambiance);
  else ambiance.fadeOut();
  player.playFrom(0, analysis.segments.length).then(() => {
    // L'ambiance s'éteint doucement un peu après la fin, sauf si une autre lecture a commencé.
    setTimeout(() => { if (run === narrationRun) ambiance.fadeOut(3000); }, 2500);
  });
}

// Typographie française : espace fine insécable avant ? ! ; : et dans les guillemets.
const frenchSpacing = (t) => langue !== "fr" ? t : t.replace(/\s+([?!;:»])/g, " $1").replace(/«\s+/g, "« ");

// Couleurs de pions classiques : une couleur par voix.
const PAWNS = ["#b8322a", "#2c64a8", "#d9a521", "#3a8a4c", "#7b4b9c", "#d8742a", "#4a4a4a", "#2a9a9a"];
function pawnColor(voiceId) {
  const v = settings.voices;
  const all = [...new Set([...(v.homme || []), ...(v.femme || []), v.creature].filter(Boolean))];
  const i = all.indexOf(voiceId);
  return PAWNS[(i < 0 ? 0 : i) % PAWNS.length];
}

function renderResult() {
  const ol = $("segments");
  ol.replaceChildren();
  analysis.segments.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = `line ${s.role}`;
    if (s.role !== "narrateur") {
      const who = document.createElement("span");
      who.className = "who";
      if (s.role === "personnage") {
        const pawn = document.createElement("span");
        pawn.className = "pawn";
        pawn.style.setProperty("--pawn", pawnColor(segmentVoices[i]));
        who.append(pawn, s.personnage || t("Personnage"));
      } else {
        who.textContent = t("Règle");
      }
      li.append(who);
    }
    const p = document.createElement("p");
    p.textContent = frenchSpacing(s.texte_fr);
    li.append(p);
    li.addEventListener("click", () => player.playFrom(i, 1));
    ol.append(li);
  });
  $("original").textContent = analysis.texte_original || t("Texte original indisponible.");
  showOriginal(false);
}

function showOriginal(on) {
  $("segments").hidden = on;
  $("original").hidden = !on;
  $("btn-toggle-original").textContent = on ? t("Revenir à la traduction") : t("Voir le texte anglais");
}
$("btn-toggle-original").addEventListener("click", () => showOriginal($("original").hidden));

$("btn-pause").addEventListener("click", () => {
  if (player.enPause) player.resume();
  else player.pause();
});
$("btn-replay").addEventListener("click", () => analysis && player.playFrom(0, analysis.segments.length));
$("btn-retry").addEventListener("click", () => {
  hideError();
  if (lastJob) (lastJob.livret ? addLivretPhoto : translate)(lastJob);
});

// ---------- Réglages ----------
async function ensureVoices() {
  voiceList = await listVoices();
}

function fillVoiceSelects() {
  const status = $("voices-status");
  for (const role of ["narrateur", "regle", "creature"]) {
    const sel = $(`voice-${role}`);
    sel.replaceChildren(...castVoiceOptions(voiceList, langue).map((v) => {
      const o = document.createElement("option");
      o.value = v.voice_id;
      const g = v.labels?.gender ? ` (${v.labels.gender === "female" ? t("femme") : v.labels.gender === "male" ? t("homme") : v.labels.gender})` : "";
      o.textContent = `${v.name}${g}`;
      return o;
    }));
    sel.value = settings.voices[role] || "";
    sel.disabled = false;
  }
  status.textContent = t("Voix françaises par défaut. Les personnages reçoivent automatiquement une voix selon leur genre.");
}

async function refreshVoices() {
  $("voices-status").textContent = t("Chargement des voix…");
  try {
    await ensureVoices();
    fillVoiceSelects();
  } catch (err) {
    voiceList = [];
    fillVoiceSelects();
    $("voices-status").textContent = t("{erreur}. Les voix françaises par défaut restent disponibles.", { erreur: err.message.replace(/.$/, "") });
  }
}

const fmtVitesse = (v) => `${langue === "fr" ? v.toFixed(2).replace(".", ",") : v.toFixed(2)}×`;
let retourReglages = "home"; // écran d'où l'on vient
function openSettings() {
  const courant = ["home", "regles", "historique", "jeu", "result", "aide"].find((v) => !$(`view-${v}`).hidden);
  if (courant) retourReglages = courant;
  hideError();
  $("set-langue").value = langue;
  $("set-model").value = settings.model;
  $("set-rate").value = settings.rate;
  $("set-ambiance").checked = settings.ambiance;
  $("rate-out").textContent = fmtVitesse(Number(settings.rate));
  fillVoiceSelects();
  show("reglages");
  afficherCouts($("couts"), jeuxApi.couts);
  if (voiceList.length === 0) refreshVoices();
}
function closeSettings() {
  if (retourReglages === "result" && analysis) return show("result");
  if (retourReglages === "regles" && currentGame) return openRegles();
  if (retourReglages === "historique" && currentGame) return openHistorique();
  if (retourReglages === "aide" && currentGame) return ouvrirAide();
  if (retourReglages === "jeu" && currentGame) { renderJeu(); return show("jeu"); }
  show("home");
}

// Chaque réglage s'enregistre dès qu'il change.
function enregistrer() { saveSettings(settings); }
$("btn-settings").addEventListener("click", openSettings);
$("set-rate").addEventListener("input", (e) => {
  settings.rate = Number(e.target.value);
  $("rate-out").textContent = fmtVitesse(settings.rate);
  audio.playbackRate = settings.rate;
  enregistrer();
});
$("set-ambiance").addEventListener("change", (e) => {
  settings.ambiance = e.target.checked;
  if (!settings.ambiance) ambiance.fadeOut();
  enregistrer();
});
$("set-langue").addEventListener("change", (e) => {
  // Chaque langue garde ses voix ; la page repart dans la nouvelle langue.
  const voixPar = { ...(settings.voixPar || {}), [langue]: settings.voices };
  settings = { ...settings, langue: e.target.value, voixPar, voices: voixPar[e.target.value] || defaultRoles(e.target.value) };
  enregistrer();
  location.reload();
});
$("set-model").addEventListener("change", (e) => { settings.model = e.target.value; enregistrer(); });
for (const role of ["narrateur", "regle", "creature"]) {
  $(`voice-${role}`).addEventListener("change", (e) => {
    if (!e.target.value) return;
    settings.voices = { ...settings.voices, [role]: e.target.value };
    enregistrer();
    caster = makeCaster();
  });
}
$("btn-new-game").addEventListener("click", async () => {
  if (!await demander({ titre: t("Oublier les voix ?"), texte: t("Les personnages de ce groupe recevront de nouvelles voix à la prochaine carte."), oui: t("Oublier"), danger: true })) return;
  caster.reset();
  saveCaster();
  avis(t("Voix des personnages oubliées"));
});

// Le débit est réinitialisé par iOS à chaque nouvelle source.
audio.addEventListener("loadedmetadata", () => { audio.playbackRate = settings.rate; });

// ---------- Profil de jeu ----------
const LOCALE = langue === "fr" ? "fr-CA" : navigator.language?.startsWith("en") ? navigator.language : "en-US";
const fmtDate = (iso) => new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "long" });
const fmtHeure = (iso) => new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
const firstLine = (a) => frenchSpacing(a.segments[0]?.texte_fr || "").slice(0, 140);

let jeuPret = Promise.resolve();
let choixJeu = 0; // le dernier jeu choisi l'emporte, même si une réponse plus ancienne arrive après
async function selectGame(id, { quiet = false } = {}) {
  const choix = ++choixJeu;
  let jeu = null, erreur = null;
  try {
    jeu = id ? await jeuxApi.get(id) : null;
  } catch (err) {
    erreur = err;
  }
  if (choix !== choixJeu) return;
  hideError();
  currentGame = jeu;
  settings.jeuActif = currentGame?.id || "";
  saveSettings(settings);
  caster = makeCaster();
  updateHome();
  redessinerVue();
  if (erreur && !quiet) showError(erreur.message, false);
}

/** Après un changement de jeu : l'écran ouvert montre tout de suite le nouveau jeu. */
function redessinerVue() {
  for (const t of TABS) delete defilement[t]; // nouveau contenu : on repart du haut
  const avant = vueActuelle;
  dessinerVue();
  if (avant === vueActuelle) {
    if (avant !== "regles") window.scrollTo(0, 0);
    entrer($(`view-${avant}`));
  }
}
function dessinerVue() {
  const vue = ["regles", "historique", "jeu", "result", "aide"].find((v) => !$(`view-${v}`).hidden);
  if (!vue) return;
  if (vue === "result") { player.stop(); ambiance.fadeOut(); return show("home"); } // carte de l'ancien jeu
  if (!currentGame) return show("home");
  if (vue === "regles") return openRegles();
  if (vue === "historique") return openHistorique();
  if (vue === "aide") return ouvrirAide();
  ouvrirJeu();
}
function ouvrirJeu() {
  $("jeu-travaux").replaceChildren(); // ceux du nouveau jeu arrivent avec suivreTravaux
  renderJeu();
  show("jeu");
  refreshGame();
  suivreTravaux();
}

async function refreshGame() {
  if (!currentGame) return;
  const id = currentGame.id;
  try {
    const jeu = await jeuxApi.get(id);
    if (currentGame?.id !== id) return; // on a changé de jeu entre-temps
    currentGame = jeu;
    updateHome();
    if (!$("view-jeu").hidden) renderJeu();
  } catch { /* on garde la version en mémoire */ }
}

// Dernier nom de jeu et de groupe affichés : l'en-tête est déjà en place à l'ouverture, rien ne saute.
const APERCU_KEY = "narrateur-jeux:apercu";
let apercu = null;
try { apercu = settings.jeuActif ? JSON.parse(localStorage.getItem(APERCU_KEY) || "null") : null; } catch { /* stockage bloqué */ }
function afficherApercu() {
  if (!apercu) return;
  $("titre-jeu").textContent = apercu.jeu;
  $("titre-groupe").textContent = apercu.groupe;
  majBarreGroupe();
}

function updateHome() {
  apercu = null;
  $("titre-jeu").textContent = currentGame ? currentGame.nom : t("Choisir un jeu");
  const groupe = currentGroupe();
  try { localStorage.setItem(APERCU_KEY, JSON.stringify(currentGame ? { jeu: currentGame.nom, groupe: groupe.nom } : null)); } catch { /* stockage bloqué */ }
  $("titre-groupe").textContent = groupe?.nom || "";
  $("btn-groupe").setAttribute("aria-label", t("Groupe : {nom}. Changer de groupe", { nom: groupe?.nom || "" }));
  majBarreGroupe();
  const parties = currentGroupe()?.parties || [];
  const precedente = parties.length >= 2 ? parties.at(-2) : null;
  // « Précédemment… » au début d'une partie, s'il y a une partie précédente à raconter.
  $("btn-precedemment").hidden = !(precedente?.cartes.length && currentPartie().cartes.length === 0);
}

// Choix du jeu : la dernière liste connue s'affiche tout de suite, puis se met à jour.
for (const id of ["jeux-dialog", "groupes-dialog", "demande"]) fenetreDouce($(id));
preparerVuePage();
preparerDeconnexion($("btn-deconnexion"));
$("jeux-dialog").querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); fermer($("jeux-dialog")); });
let derniersJeux = null;
function openGamePicker() {
  $("jeu-nom").value = "";
  if (derniersJeux) afficherJeux(derniersJeux);
  else $("jeux-list").replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: t("Chargement…") }));
  ouvrir($("jeux-dialog"));
  jeuxApi.list().then((jeux) => {
    if (JSON.stringify(jeux) === JSON.stringify(derniersJeux)) return;
    derniersJeux = jeux;
    afficherJeux(jeux);
  }).catch((err) => {
    if (derniersJeux) return;
    $("jeux-list").replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: err.message }));
  });
}
function afficherJeux(jeux) {
    const items = jeux.map((j) => {
      const li = document.createElement("li");
      if (j.id === currentGame?.id) li.className = "actif";
      const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: j.nom });
      b.addEventListener("click", () => { fermer($("jeux-dialog")); if (j.id !== currentGame?.id) selectGame(j.id); });
      if (j.id === currentGame?.id) b.setAttribute("aria-current", "true");
      li.append(b);
      return li;
    });
    if (currentGame) {
      const li = document.createElement("li");
      const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: t("Sans jeu (traduction seulement)") });
      b.style.fontFamily = "var(--ui)";
      b.addEventListener("click", () => { fermer($("jeux-dialog")); selectGame(""); });
      li.append(b);
      items.push(li);
    }
    $("jeux-list").replaceChildren(...(items.length ? items : [Object.assign(document.createElement("li"), { className: "empty", textContent: t("Aucun jeu pour l'instant. Crée le premier ci-dessous.") })]));
}
$("btn-jeu").addEventListener("click", openGamePicker);
$("btn-creer-jeu").addEventListener("click", async () => {
  const nom = $("jeu-nom").value.trim();
  if (!nom) return $("jeu-nom").focus();
  try {
    const jeu = await jeuxApi.create(nom);
    fermer($("jeux-dialog"));
    await selectGame(jeu.id);
  } catch (err) {
    $("jeux-list").prepend(Object.assign(document.createElement("li"), { className: "empty", textContent: err.message }));
  }
});

// Onglets : Règles, Historique et Le jeu demandent d'abord de choisir un jeu.
for (const b of document.querySelectorAll(".tab")) {
  b.addEventListener("click", async () => {
    hideError();
    const tab = b.dataset.tab;
    if (tab === "historique" && vueActuelle === tab && histoFiltre) return openHistorique();
    if (tab === vueActuelle) return window.scrollTo({ top: tab === "regles" ? document.documentElement.scrollHeight : 0, behavior: "smooth" });
    if (tab === "home") return show("home");
    if (!currentGame) await jeuPret; // jeu encore en chargement à l'ouverture
    if (!currentGame) return openGamePicker();
    if (tab === "regles") return openRegles();
    if (tab === "historique") return openHistorique();
    ouvrirJeu();
  });
}
function retourLecture() {
  hideError();
  player.stop();
  ambiance.fadeOut();
  if (resultReturn === "historique" && currentGame) openHistorique();
  else show("home");
}

// Page du jeu : parties, livret, glossaire
function removeButton(label, onClick) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "remove" });
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}
const emptyItem = (text) => Object.assign(document.createElement("li"), { className: "empty", textContent: text });

let jeuAffiche = "";
const livretsOuverts = new Set();
const cartesLues = (n) => (!n ? t("Aucune carte lue") : n === 1 ? t("1 carte lue") : t("{n} cartes lues", { n }));
const nomDePartie = (p, n) => t("Partie {n}, {date}", { n, date: fmtDate(p.debut) });
function renderJeu() {
  const g = currentGame;
  const signature = JSON.stringify([g, currentGroupe().id]);
  if (signature === jeuAffiche) return; // rien de neuf : on ne touche pas à l'écran
  jeuAffiche = signature;

  const groupeActif = currentGroupe();
  $("jeu-groupes").replaceChildren(...g.groupes.map((gr) => {
    const li = document.createElement("li");
    if (gr.id === groupeActif.id) li.className = "actif";
    const n = gr.parties.reduce((t, p) => t + p.cartes.length, 0);
    const b = Object.assign(document.createElement("button"), { type: "button", className: "link grow" });
    const nom = Object.assign(document.createElement("span"), { className: "nom", textContent: gr.nom });
    if (gr.id === groupeActif.id) nom.append(Object.assign(document.createElement("span"), { className: "tag-actif", textContent: t("actif") }));
    b.append(nom, Object.assign(document.createElement("span"), { className: "meta", textContent: `${gr.parties.length > 1 ? t("{n} parties", { n: gr.parties.length }) : t("1 partie")}, ${cartesLues(n).toLowerCase()}` }));
    b.addEventListener("click", () => selectGroupe(gr.id));
    const renommer = removeButton(t("Renommer {nom}", { nom: gr.nom }), async () => {
      const nom = await demander({ titre: t("Nom du groupe"), oui: t("Renommer"), champ: gr.nom });
      if (!nom || nom === gr.nom) return;
      try { await jeuxApi.renommerGroupe(g.id, gr.id, nom); await refreshGame(); } catch (err) { showError(err.message, false); }
    });
    renommer.classList.add("renommer");
    renommer.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5l1-4.2L16 4.8a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.7 18.5l-4.2 1ZM14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
    li.append(b, renommer);
    if (g.groupes.length > 1) {
      li.append(removeButton(t("Supprimer le groupe {nom}", { nom: gr.nom }), async () => {
        const parties = gr.parties.length > 1 ? t("Ses {n} parties", { n: gr.parties.length }) : t("Sa partie");
        if (!await demander({ titre: t("Supprimer « {nom} » ?", { nom: gr.nom }), texte: t("{parties}, son historique et ses voix disparaîtront de l'app. Le livret et le glossaire restent.", { parties }), oui: t("Supprimer"), danger: true })) return;
        hideError();
        try {
          await jeuxApi.supprimerGroupe(g.id, gr.id);
          avis(t("Groupe « {nom} » supprimé", { nom: gr.nom }));
          const etaitActif = currentGroupe().id === gr.id;
          await refreshGame();
          if (etaitActif && currentGame?.id === g.id) selectGroupe(currentGame.groupes[0].id);
        } catch (err) { showError(err.message, false); }
      }));
    }
    return li;
  }));
  $("parties-titre").textContent = g.groupes.length > 1 ? t("Parties de « {nom} »", { nom: groupeActif.nom }) : t("Parties");

  $("jeu-parties").replaceChildren(...[...groupeActif.parties].reverse().map((p, idx) => {
    const li = document.createElement("li");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "link grow" });
    const nomPartie = Object.assign(document.createElement("span"), { className: "nom", textContent: nomDePartie(p, groupeActif.parties.length - idx) });
    if (idx === 0) nomPartie.append(Object.assign(document.createElement("span"), { className: "tag-actif", textContent: t("en cours") }));
    b.append(nomPartie,
      Object.assign(document.createElement("span"), { className: "meta", textContent: cartesLues(p.cartes.length) }));
    b.addEventListener("click", () => openHistorique(p.id));
    li.append(b);
    return li;
  }));

  // Un livret = une ligne ; ses sections s'ouvrent au besoin.
  const livrets = new Map();
  for (const page of g.livret) {
    const cle = page.source || page.id;
    if (!livrets.has(cle)) livrets.set(cle, []);
    livrets.get(cle).push(page);
  }
  const ligneSection = (page, titre) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "grow", textContent: titre }), removeButton(t("Retirer {nom}", { nom: page.titre }), async () => {
      if (!await demander({ titre: t("Retirer du livret ?"), texte: t("« {nom} » ne servira plus aux réponses.", { nom: page.titre }), oui: t("Retirer"), danger: true })) return;
      try { await jeuxApi.retirerPage(g.id, page.id); await refreshGame(); avis(t("Retiré du livret")); } catch (err) { showError(err.message, false); }
    }));
    return li;
  };
  $("jeu-livret").replaceChildren(...(g.livret.length ? [...livrets].map(([cle, pages]) => {
    if (pages.length < 2) return ligneSection(pages[0], frenchSpacing(pages[0].titre.replaceAll("_", " ")));
    const li = document.createElement("li");
    const d = Object.assign(document.createElement("details"), { className: "livret", open: livretsOuverts.has(cle) });
    d.addEventListener("toggle", () => livretsOuverts[d.open ? "add" : "delete"](cle));
    const s = document.createElement("summary");
    const nom = Object.assign(document.createElement("span"), { className: "grow", textContent: pages[0].titre.replace(/, p\. [\d–]+$/, "").replaceAll("_", " ") });
    nom.append(Object.assign(document.createElement("span"), { className: "meta", textContent: t("{n} sections", { n: pages.length }) }));
    s.append(nom);
    const ol = Object.assign(document.createElement("ol"), { className: "plain-list" });
    ol.append(...pages.map((p) => ligneSection(p, p.titre.match(/p\. [\d–]+$/)?.[0].replace(/^p\. (.*)/, (_, n) => t(n.includes("–") ? "Pages {p}" : t("Page {p}"), { p: n })) ?? p.titre)));
    d.append(s, ol);
    li.append(d);
    return li;
  }) : [emptyItem(t("Aucune page pour l'instant."))]));
  const sansImages = new Map(g.livret.filter((p) => p.source && !p.images).map((p) => [p.source, p.titre.replace(/, p\. [\d–]+$/, "")]));
  $("jeu-images").replaceChildren(...[...sansImages].map(([source, titre]) => ligneImages(g, source, titre)));

  const termes = Object.entries(g.glossaire).sort(([a], [b]) => a.localeCompare(b));
  $("jeu-glossaire").replaceChildren(...(termes.length ? termes.map(([en, fr]) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "en", textContent: en }),
      Object.assign(document.createElement("span"), { className: "fr", textContent: fr }),
      removeButton(t("Retirer {nom}", { nom: en }), async () => {
        try { await jeuxApi.retirerTerme(g.id, en); await refreshGame(); } catch (err) { showError(err.message, false); }
      }));
    return li;
  }) : [emptyItem(t("Le glossaire se remplit tout seul au fil des cartes lues."))]));
}

/** Livret lu avant que l'app garde les pages : on ajoute le même PDF, sans relecture. */
function choixPdf(g, source, fini = () => {}) {
  const b = Object.assign(document.createElement("label"), { className: "small-btn" });
  const champ = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf", hidden: true });
  const mot = Object.assign(document.createElement("span"), { textContent: t("Choisir le PDF") });
  b.append(champ, mot);
  champ.addEventListener("change", async () => {
    const f = champ.files?.[0];
    if (!f) return;
    hideError();
    mot.textContent = t("Envoi…");
    champ.disabled = true;
    try { await jeuxApi.ajouterImages(g.id, source, f); await refreshGame(); await fini(); }
    catch (err) { mot.textContent = t("Choisir le PDF"); champ.disabled = false; champ.value = ""; showError(err.message, false); }
  });
  return b;
}
function ligneImages(g, source, titre) {
  const li = document.createElement("li");
  const texte = Object.assign(document.createElement("span"), { className: "grow", textContent: t("Montrer les pages dans les réponses") });
  texte.append(Object.assign(document.createElement("span"), { className: "meta", textContent: t("Choisis de nouveau le PDF « {titre} »", { titre }) }));
  li.append(texte, choixPdf(g, source));
  return li;
}

// Lecture d'un livret PDF en arrière-plan : progression affichée dans « Le jeu ».
let suiviTravaux = null;
async function suivreTravaux() {
  if (!currentGame || suiviTravaux) return;
  const tick = async () => {
    const id = currentGame?.id;
    if (!id) { clearInterval(suiviTravaux); suiviTravaux = null; return; }
    let travaux = [];
    try { travaux = await jeuxApi.travaux(id); } catch { /* on réessaie au prochain tour */ }
    if (currentGame?.id !== id) return; // jeu changé : le prochain tour suivra le nouveau
    const box = $("jeu-travaux");
    // Les lignes restent en place d'un tour à l'autre : la barre avance en douceur.
    const anciens = new Map([...box.children].map((li) => [li.dataset.id, li]));
    const visibles = travaux.filter((t) => t.etat !== "fini");
    for (const [cle, li] of anciens) if (!visibles.some((t) => t.id === cle)) li.remove();
    for (const tr of visibles) {
      const li = anciens.get(tr.id) || document.createElement("li");
      li.dataset.id = tr.id;
      const texte = li.firstChild || li.appendChild(document.createTextNode(""));
      li.className = tr.etat === "erreur" ? "travail erreur" : "travail";
      texte.data = tr.etat === "erreur"
        ? t("« {titre} » : {erreur}", { titre: tr.titre, erreur: tErreur(tr.erreur) })
        : t("Lecture de « {titre} » : {faites} sur {total} pages", tr);
      let bar = li.querySelector(".barre");
      if (tr.etat === "en cours") {
        if (!bar) li.append(bar = Object.assign(document.createElement("span"), { className: "barre" }));
        bar.style.setProperty("--p", (tr.faites / Math.max(1, tr.total)).toFixed(3));
      } else bar?.remove();
      if (!li.isConnected) box.append(li);
    }
    const enCours = travaux.some((t) => t.etat === "en cours");
    await refreshGame();
    if (!enCours) { clearInterval(suiviTravaux); suiviTravaux = null; }
  };
  suiviTravaux = setInterval(tick, 2500);
  tick();
}

// Groupes : chaque téléphone retient le sien, par jeu.
function selectGroupe(id) {
  settings.groupes = { ...(settings.groupes || {}), [currentGame.id]: id };
  saveSettings(settings);
  caster = makeCaster(); // chaque groupe a les voix de ses propres personnages
  updateHome();
  if (!$("view-jeu").hidden) renderJeu(); // on garde la position dans la page
  else redessinerVue();
}

// Sélecteur de groupe (sous le nom du jeu)
$("btn-groupe").addEventListener("click", async () => {
  await jeuPret;
  if (!currentGame) return openGamePicker();
  $("groupes-nom").value = "";
  $("groupes-erreur").hidden = true;
  $("groupes-jeu").textContent = t("Pour {jeu}. Chaque groupe a ses parties, son historique et sa discussion.", { jeu: currentGame.nom });
  const actif = currentGroupe().id;
  $("groupes-list").replaceChildren(...currentGame.groupes.map((gr) => {
    const li = document.createElement("li");
    if (gr.id === actif) li.className = "actif";
    const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: gr.nom });
    if (gr.id === actif) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => { fermer($("groupes-dialog")); if (gr.id !== actif) selectGroupe(gr.id); });
    li.append(b);
    return li;
  }));
  ouvrir($("groupes-dialog"));
});
$("btn-groupes-fermer").addEventListener("click", () => fermer($("groupes-dialog")));
$("groupes-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("groupes-nom").value.trim();
  if (!nom) return $("groupes-nom").focus();
  try {
    const groupe = await jeuxApi.creerGroupe(currentGame.id, nom);
    await refreshGame();
    fermer($("groupes-dialog"));
    selectGroupe(groupe.id);
    avis(t("Groupe « {nom} » créé", { nom: groupe.nom }));
  } catch (err) {
    $("groupes-erreur").textContent = err.message;
    $("groupes-erreur").hidden = false;
  }
});
$("groupe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("groupe-nom").value.trim();
  if (!nom) return $("groupe-nom").focus();
  try {
    const groupe = await jeuxApi.creerGroupe(currentGame.id, nom);
    $("groupe-nom").value = "";
    $("groupe-nom").blur();
    await refreshGame();
    selectGroupe(groupe.id);
    avis(t("Groupe « {nom} » créé", { nom: groupe.nom }));
  } catch (err) { showError(err.message, false); }
});

$("btn-nouvelle-partie").addEventListener("click", async () => {
  const titre = currentGame.groupes.length > 1 ? t("Nouvelle partie pour « {nom} » ?", { nom: currentGroupe().nom }) : t("Nouvelle partie ?");
  if (!await demander({ titre, texte: t("La partie actuelle reste dans l'historique."), oui: t("Commencer") })) return;
  try {
    await jeuxApi.nouvellePartie(currentGame.id, currentGroupe().id);
    await refreshGame();
    show("home");
    avis(t("Nouvelle partie commencée"));
  } catch (err) { showError(err.message, false); }
});

// Livret : photo (avec le cadre de sélection) ou PDF
$("livret-photo").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (file) handlePhoto(file, "livret");
});
$("livret-pdf").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  await uploadLivret(file, file.name.replace(/\.pdf$/i, ""), "application/pdf");
});

async function addLivretPhoto(job) {
  lastJob = { ...job, livret: true };
  const blob = await cropAndResize(job.img, job.crop, 2000); // plus grand : le texte du livret est petit
  await uploadLivret(blob, t("Page {n}", { n: currentGame.livret.length + 1 }), "image/jpeg", true);
}

async function uploadLivret(blob, titre, type, fromCrop = false) {
  hideError();
  show("loading");
  const isPdf = type === "application/pdf";
  $("loading-text").textContent = isPdf ? t("Envoi du livret") : t("Lecture de la page du livret");
  try {
    await jeuxApi.ajouterPage(currentGame.id, blob, titre, type, settings.model);
    await refreshGame();
    renderJeu();
    show("jeu");
    if (isPdf) suivreTravaux(); // la lecture continue en arrière-plan sur le PC
  } catch (err) {
    show(fromCrop ? "crop" : "jeu");
    showError(err.message, fromCrop);
  }
}

// Aide-mémoire : le déroulement du tour, tiré du livret une fois pour toutes
let aideRetour = "home";
let aideLue = null; // numéro de la section lue à voix haute
let aideEcoute = 0;
let aideParle = false; // faux tant que la voix se prépare
let aideTour = 0; // un seul suivi de préparation à la fois
const lecteurAide = createLecteur(audio, (t) => speakWithFallback(t, settings.voices.regle));
function arreterAide() {
  aideEcoute++;
  if (aideLue !== null) lecteurAide.couper();
  aideLue = null;
  majBoutonsAide();
}
function majBoutonsAide() {
  ecran.garder("aide", aideLue !== null);
  [...$("aide-sections").querySelectorAll(".aide-ecouter")].forEach((b, i) => { b.textContent = i !== aideLue ? t("Écouter") : aideParle ? t("Arrêter") : t("Un instant…"); });
}
async function lireAide(i, section) {
  const couper = i === aideLue;
  arreterAide();
  if (couper) return;
  hideError();
  player.stop();
  ambiance.fadeOut();
  unlockAudio();
  const moi = aideEcoute;
  aideLue = i;
  aideParle = false;
  majBoutonsAide();
  // Sans les mots anglais entre parenthèses. Une seule lecture par section : la voix enchaîne naturellement, sans trou entre les points.
  lecteurAide.dire([section.titre, ...section.points].map((t) => t.replace(/\s*\([^)]*\)/g, "")).map((t) => (/[.!?…]$/.test(t) ? t : `${t}.`)).join("\n"), () => { aideParle = true; majBoutonsAide(); });
  const err = await lecteurAide.attendre();
  if (moi !== aideEcoute) return;
  aideLue = null;
  majBoutonsAide();
  if (err) showError(err.message, false);
}
function ouvrirAide() {
  hideError();
  if (TABS.includes(vueActuelle)) aideRetour = vueActuelle;
  arreterAide();
  renderAide();
  show("aide");
  suivreAide();
}
function renderAide(etat = "", erreur = null) {
  const { aide, livret } = currentGame;
  const enCours = etat === "en cours";
  $("aide-etat").textContent = frenchSpacing(
    enCours ? t("Je lis le livret pour préparer l'aide-mémoire. Ça prend une minute ou deux ; tu peux continuer à jouer.")
    : erreur ? tErreur(erreur)
    : !livret.length ? t("Ajoute d'abord le livret de règles dans « Le jeu ».")
    : !aide ? t("Le déroulement du tour, les actions et la fin de partie de {jeu}, en français, à partir du livret.", { jeu: currentGame.nom })
    : aide.perime ? t("Le livret a changé depuis : tu peux refaire l'aide-mémoire.") : "");
  const b = $("btn-aide-preparer");
  b.hidden = enCours;
  b.textContent = !livret.length ? t("Ajouter le livret") : erreur ? t("Réessayer") : aide ? t("Refaire l'aide-mémoire") : t("Préparer l'aide-mémoire");
  b.classList.toggle("btn-primary", !aide || aide.perime || Boolean(erreur));
  $("aide-pied").hidden = !aide;
  $("view-aide").classList.toggle("a-fiche", Boolean(aide) && !aide.perime && !erreur);
  const cle = JSON.stringify([currentGame.id, aide?.date]);
  if ($("aide-sections").dataset.cle === cle) return; // fiche déjà affichée
  $("aide-sections").dataset.cle = cle;
  arreterAide();
  $("aide-sections").replaceChildren(...(aide?.sections || []).map((s, i) => {
    const art = Object.assign(document.createElement("article"), { className: "sheet panel aide-fiche" });
    const tete = Object.assign(document.createElement("div"), { className: "aide-tete" });
    const ecouter = Object.assign(document.createElement("button"), { type: "button", className: "small-btn aide-ecouter", textContent: t("Écouter") });
    ecouter.addEventListener("click", () => lireAide(i, s));
    tete.append(Object.assign(document.createElement("h3"), { textContent: frenchSpacing(s.titre) }), ecouter);
    const liste = document.createElement(s.etapes ? "ol" : "ul");
    liste.append(...s.points.map((p) => Object.assign(document.createElement("li"), { textContent: frenchSpacing(p) })));
    art.append(tete, liste);
    return art;
  }));
}
/** Suit la préparation tant que l'écran est ouvert ; elle continue sur l'ordinateur même si on le quitte. */
async function suivreAide() {
  const id = currentGame.id, moi = ++aideTour;
  for (;;) {
    let r = null;
    try { r = await jeuxApi.aide(id); } catch { /* on réessaie */ }
    if (moi !== aideTour || currentGame?.id !== id) return;
    if (r) currentGame.aide = r.aide;
    if (vueActuelle !== "aide") return;
    if (r) renderAide(r.etat, r.etat === "erreur" ? r.erreur : null);
    if (r && r.etat !== "en cours") return;
    if (!r) $("aide-etat").textContent = t("L'ordinateur ne répond pas. Je réessaie…");
    await new Promise((ok) => setTimeout(ok, 2500));
    if (moi !== aideTour || vueActuelle !== "aide") return;
  }
}
$("btn-aide").addEventListener("click", async () => {
  await jeuPret;
  if (!currentGame) return openGamePicker();
  ouvrirAide();
});
function retourAide() {
  hideError();
  if (aideRetour === "regles" && currentGame) return openRegles();
  if (aideRetour === "historique" && currentGame) return openHistorique();
  if (aideRetour === "jeu" && currentGame) return ouvrirJeu();
  show("home");
}
$("btn-aide-preparer").addEventListener("click", async () => {
  if (!currentGame.livret.length) return ouvrirJeu();
  const id = currentGame.id;
  aideTour++;
  renderAide("en cours");
  try {
    await jeuxApi.preparerAide(id, settings.model);
    if (currentGame?.id === id && vueActuelle === "aide") suivreAide();
  } catch (err) {
    if (currentGame?.id === id && vueActuelle === "aide") renderAide("erreur", err.message);
  }
});

// Historique : toutes les parties, la plus récente d'abord
let histoFiltre = null;
function openHistorique(partieId = null) {
  histoFiltre = partieId;
  hideError();
  if (partieId) delete defilement.historique;
  const box = $("historique");
  box.replaceChildren();
  const toutes = currentGroupe().parties;
  if (partieId && toutes.length > 1) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "reessayer histo-toutes", textContent: t("Voir toutes les parties") });
    b.addEventListener("click", () => { openHistorique(); window.scrollTo(0, 0); });
    box.append(b);
  }
  if (!partieId && !toutes.some((p) => p.cartes.length)) {
    const v = Object.assign(document.createElement("div"), { className: "vide" });
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: t("Lire une carte") });
    b.addEventListener("click", () => show("home"));
    v.append(Object.assign(document.createElement("h3"), { textContent: t("Aucune carte lue") }),
      Object.assign(document.createElement("p"), { textContent: t("Chaque carte photographiée se range ici. Tu pourras la relire et la réécouter.") }), b);
    box.append(v);
    return show("historique");
  }
  for (const [i, p] of [...toutes.entries()].reverse()) {
    if (partieId && p.id !== partieId) continue;
    box.append(Object.assign(document.createElement("h3"), { className: "histo-partie", textContent: nomDePartie(p, i + 1) }));
    if (!p.cartes.length) box.append(Object.assign(document.createElement("p"), { className: "histo-vide", textContent: t("Aucune carte lue pour l'instant.") }));
    for (const c of [...p.cartes].reverse()) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "histo-carte" });
      b.append(Object.assign(document.createElement("time"), { textContent: fmtHeure(c.date) }), firstLine(c.analyse));
      b.addEventListener("click", () => { unlockAudio(); playAnalysis(c.analyse, "historique"); });
      box.append(b);
    }
  }
  show("historique");
}

// Aide aux règles : une discussion en texte, comme un chat d'IA (réponse écrite en direct ; à voix haute avec le micro)
const ICONE_LIVRE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Zm0 0v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const SUGGESTIONS = [
  t("Combien d'actions je peux faire pendant mon tour ?"),
  t("Comment se déroule un combat ?"),
  t("Qu'est-ce qui se passe à la fin d'une manche ?"),
];
let chatOccupe = false;

const chat = () => $("chat");
const presDuBas = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
const versLeBas = (smooth = false) => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });

function msgJoueur(texte) {
  const li = Object.assign(document.createElement("li"), { className: "msg joueur" });
  li.append(Object.assign(document.createElement("div"), { className: "bulle", textContent: texte }));
  chat().append(li);
  return li;
}
/** « Réponse fausse ? » : la bonne réponse sert de test pour vérifier l'app. */
function boutonFaux(question, reponse) {
  const g = currentGame;
  const b = Object.assign(document.createElement("button"), { type: "button", className: "faux", textContent: frenchSpacing(t("Réponse fausse ?")) });
  b.addEventListener("click", async () => {
    const attendu = await demander({ titre: t("Quelle est la bonne réponse ?"), texte: t("Elle servira à tester l'app. Elle ne change pas les prochaines réponses."), oui: t("Enregistrer"), champ: "", max: 500 });
    if (!attendu) return;
    try { await jeuxApi.signaler(g.id, { question, reponse, attendu }); b.remove(); avis(t("Merci, c'est noté")); } catch (err) { showError(err.message, false); }
  });
  return b;
}
function msgAide(texte = "", refs = [], question = "") {
  const li = Object.assign(document.createElement("li"), { className: "msg aide" });
  const sig = Object.assign(document.createElement("div"), { className: "signature" });
  sig.innerHTML = `<span class="avatar">${ICONE_LIVRE}</span>`;
  sig.append(t("Aide aux règles"));
  const corps = Object.assign(document.createElement("div"), { className: "texte", textContent: frenchSpacing(texte) });
  li.append(sig, corps);
  if (refs.length) li.append(blocPages(refs));
  if (question) li.append(boutonFaux(question, texte));
  chat().append(li);
  return li;
}
/** Sous une réponse dont le livret n'a pas encore d'images : on choisit le PDF sur place. */
function ajoutDepuisReponse(ref) {
  const g = currentGame;
  const p = Object.assign(document.createElement("div"), { className: "ref-ajout" });
  p.append(Object.assign(document.createElement("span"), { textContent: frenchSpacing(t("Pour voir la page, ajoute une fois le PDF « {titre} ».", { titre: ref.titre })) }),
    choixPdf(g, ref.source, async () => { if (!$("view-regles").hidden) openRegles(); }));
  return p;
}
/** Pages du livret citées par une réponse. */
function blocPages(refs, options = {}) {
  const disponibles = new Set(currentGame.livret.filter((p) => p.images).map((p) => p.source || p.id));
  return blocReferences(currentGame, refs, { surprise: aSurprises(currentGame), disponibles, ajouter: ajoutDepuisReponse, ...options });
}

function accueilChat() {
  const n = currentGame.livret.length;
  const li = Object.assign(document.createElement("li"), { className: "chat-accueil" });
  const av = Object.assign(document.createElement("div"), { className: "grand-avatar" });
  av.innerHTML = ICONE_LIVRE;
  li.append(av,
    Object.assign(document.createElement("h2"), { textContent: frenchSpacing(t("Une question sur les règles ?")) }),
    Object.assign(document.createElement("p"), {
      textContent: n
        ? t(n > 1 ? "Je réponds à partir du livret de {jeu} ({n} sections) et de son glossaire." : "Je réponds à partir du livret de {jeu} (1 section) et de son glossaire.", { jeu: currentGame.nom, n })
        : t("Aucun livret ajouté : je répondrai de mémoire. Ajoute le livret dans « Le jeu » pour des réponses fiables."),
    }));
  const box = Object.assign(document.createElement("div"), { className: "suggestions" });
  for (const q of SUGGESTIONS) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "suggestion", textContent: q });
    b.addEventListener("click", () => envoyerQuestion(q));
    box.append(b);
  }
  li.append(box);
  chat().append(li);
}

function openRegles() {
  hideError();
  chat().replaceChildren();
  const discussion = currentPartie().discussion;
  let question = "";
  for (const m of discussion) {
    if (m.role === "joueur") msgJoueur(question = m.texte);
    else msgAide(m.texte, m.refs, question);
  }
  if (!discussion.length) accueilChat();
  show("regles");
  versLeBas();
}

const input = $("chat-input");
function majEnvoi() {
  $("chat-send").disabled = chatOccupe || !input.value.trim();
  $("chat-micro").disabled = chatOccupe;
}
function ajusterHauteur() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; }
input.addEventListener("input", () => { ajusterHauteur(); majEnvoi(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-form").requestSubmit(); }
});
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || chatOccupe) return;
  input.value = "";
  ajusterHauteur();
  envoyerQuestion(q);
});

/** Rend null, ou l'erreur affichée dans la discussion. */
async function envoyerQuestion(question, { flux = null, onTexte = () => {}, onRefs = () => {} } = {}) {
  if (chatOccupe) return;
  chatOccupe = true;
  majEnvoi();
  chat().querySelector(".chat-accueil")?.remove();
  const qLi = msgJoueur(question);
  const rep = msgAide();
  qLi.classList.add("nouveau");
  rep.classList.add("nouveau");
  const corps = rep.querySelector(".texte");
  corps.innerHTML = `<span class="points" aria-label="${t("Réponse en cours")}"><i></i><i></i><i></i></span>`;
  versLeBas(true);
  let commence = false;
  const flot = createFlot((t) => {
    const suivre = presDuBas();
    corps.textContent = frenchSpacing(t);
    if (suivre && !$("view-regles").hidden) versLeBas();
  });
  try {
    const envoi = flux || ((recevoir) => jeuxApi.questionFlux(currentGame.id, currentGroupe().id, currentPartie().id, question, settings.model, recevoir));
    const { reponse, refs } = await envoi((morceau) => {
      if (!commence) { commence = true; corps.textContent = ""; rep.classList.add("ecrit"); }
      flot.ajouter(morceau);
      onTexte(morceau);
    });
    if (!commence) flot.ajouter(reponse);
    if (refs.length) onRefs(refs);
    flot.finir().then(() => {
      rep.classList.remove("ecrit");
      corps.textContent = frenchSpacing(reponse);
      const suivre = presDuBas();
      if (refs.length) rep.append(blocPages(refs));
      if (reponse) rep.append(boutonFaux(question, reponse));
      if (suivre && !$("view-regles").hidden) versLeBas(true);
    });
    refreshGame();
    return null;
  } catch (err) {
    await flot.finir(); // sinon la fin du texte recouvrirait le message d'erreur
    rep.classList.remove("ecrit");
    rep.classList.add("erreur");
    corps.textContent = err.message;
    const b = Object.assign(document.createElement("button"), { type: "button", className: "reessayer", textContent: t("Réessayer") });
    b.addEventListener("click", () => { qLi.remove(); rep.remove(); envoyerQuestion(question); });
    rep.append(b);
    return err;
  } finally {
    chatOccupe = false;
    majEnvoi();
  }
}

// ---------- Conversation vocale en direct : on parle, il répond, et on peut le couper en parlant ----------
const ETATS = {
  ouverture: [t("Un instant…"), ""],
  ecoute: [t("Je t'écoute"), t("Parle quand tu veux")],
  reflexion: [t("Je cherche…"), t("Tu peux ajouter quelque chose")],
  parole: [t("Je réponds"), t("Parle pour me couper")],
  repos: [t("Touche le rond pour parler"), ""],
};
const ATTENTE_MS = 60_000; // sans parole : le micro se ferme (il coûte tant qu'il écoute)
let vocalEtat = "repos";
let direct = null; // conversation ouverte

function setVocal(etat, message = "") {
  vocalEtat = etat;
  ecran.garder("vocal", etat !== "repos");
  $("vocal-rond").dataset.etat = etat;
  $("vocal-rond").style.setProperty("--niveau", 0);
  $("vocal-rond").setAttribute("aria-label", { ecoute: t("Envoyer"), reflexion: t("Annuler"), parole: t("Couper la réponse") }[etat] || t("Parler"));
  $("vocal-etat").textContent = message || ETATS[etat][0];
  $("vocal-aide").textContent = message && etat === "repos" ? ETATS.repos[0] : ETATS[etat][1];
}
const niveauRond = (n, gain) => $("vocal-rond").style.setProperty("--niveau", Math.min(1, n * gain).toFixed(2));

function fermerDirect() {
  const d = direct;
  direct = null;
  ecran.garder("vocal", false);
  if (!d) return;
  clearInterval(d.horloge);
  clearTimeout(d.attente);
  clearTimeout(d.reprise);
  d.transcription?.fermer();
  d.voix?.vider();
  if (d.son) d.son.fermer();
  else d.ctx.close().catch(() => {});
  if (d.session) jeuxApi.directFermer(d.jeu, d.session);
}
function arretDirect(message = "") {
  fermerDirect();
  if ($("vocal").open) setVocal("repos", message);
}

async function commencerDirect() {
  fermerDirect();
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return setVocal("repos", t("Ce navigateur ne permet pas la conversation vocale."));
  const ctx = new AC(); // pendant le geste (exigence iOS)
  ctx.resume().catch(() => {});
  const d = { ctx, jeu: currentGame.id, groupe: currentGroupe().id, partie: currentPartie().id, veille: createVeille(), porte: createPorte(), bruits: [], silenceJusque: 0, voixMs: 0, tour: 0, derniere: performance.now(), dit: "", ditFin: 0, entendait: false };
  direct = d;
  const actif = () => direct === d;
  $("vocal-muet").setAttribute("aria-pressed", "false");
  $("vocal-muet").textContent = t("Couper le micro");
  setVocal("ouverture");
  try {
    // Micro et conversation se préparent ensemble.
    const ouverture = jeuxApi.directOuvrir(d.jeu, d.groupe, d.partie).then((s) => {
      if (actif()) d.session = s;
      else jeuxApi.directFermer(d.jeu, s);
      return s;
    });
    ouverture.catch(() => {});
    const son = await ouvrirSon(ctx, {
      onPcm: (pcm) => { if (actif()) for (const p of d.porte.passer(pcm, appParle(d))) d.transcription?.envoyer(p); },
      onNiveau: (n) => { if (actif()) niveauMicro(d, n); },
      onVoix: (v) => { if (actif()) etatVoix(d, v); },
    });
    if (!actif()) return son.fermer();
    d.son = son;
    d.voix = createVoixDirecte(son.port, async (text, signal) => {
      const res = await fetch("api/parole-directe", { method: "POST", signal, headers: { "Content-Type": "application/json", ...enTeteLangue }, body: JSON.stringify({ text, voiceId: settings.voices.regle }) });
      if (!res.ok) throw new Error(tErreur((await res.json().catch(() => null))?.erreur || t("La voix n'a pas répondu")));
      return res;
    });
    await ouverture;
    if (!actif()) return;
    d.transcription = createTranscription({
      jeton: () => jeuxApi.directJeton(d.jeu, d.session),
      onPartiel: (t) => { if (actif()) paroleEntendue(d, t, false); },
      onPhrase: (t) => { if (actif()) paroleEntendue(d, t, true); },
      onErreur: (err) => { if (actif()) arretDirect(err.message); },
    });
    d.horloge = setInterval(() => {
      if (vocalEtat === "ecoute" && performance.now() - d.derniere > ATTENTE_MS) arretDirect(t("Micro fermé, pas de parole"));
    }, 2000);
    setVocal("ecoute");
  } catch (err) {
    if (actif()) arretDirect(err.message || t("Une erreur est survenue."));
  }
}

/** L'app fait du bruit : le micro n'est pas transmis. En pause (quelqu'un parle), il l'est. */
function appParle(d) {
  if (d.pause) return false;
  return performance.now() < d.silenceJusque || Boolean(d.voix?.phrases.some((p) => p.echantillons > 0));
}
const bruitPiece = (d) => (d.bruits.length ? Math.min(...d.bruits) : undefined);
function niveauMicro(d, n) {
  const maintenant = performance.now();
  // Temps de vraie parole au micro, quand l'app se tait : sans lui, une transcription est inventée.
  if (!appParle(d) && n > seuilParole(bruitPiece(d))) d.voixMs += Math.min(60, maintenant - (d.mesure ?? maintenant));
  d.mesure = maintenant;
  if (vocalEtat === "ecoute") {
    niveauRond(n, 6);
    d.bruits.push(n);
    if (d.bruits.length > 150) d.bruits.shift(); // 3 s
  }
  if (vocalEtat !== "parole" || d.muet) return;
  if (d.pause) {
    if (d.pause.humain) return;
    const avis = d.pause.controle.mesurer(n, performance.now());
    if (avis === "humain") {
      d.pause.humain = true;
      attendreConfirmation(d, 2800);
    } else if (avis === "rien" && !d.pause.valide) {
      // Personne ne parle : c'était l'écho, ou un seul mot déjà dit (« Stop »), que la transcription rendra tout de suite.
      d.pause.valide = true;
      d.transcription?.valider();
      attendreConfirmation(d, 700);
    }
    return;
  }
  // Il parle par-dessus la voix : silence tout de suite, la transcription confirmera.
  if (d.veille.mesurer(n, performance.now())) {
    d.voix.pause(true);
    d.pause = { humain: false, controle: createConfirmation({ bruit: bruitPiece(d) }) };
    setVocal("parole", t("Je t'écoute"));
  }
}
function attendreConfirmation(d, ms) {
  clearTimeout(d.reprise);
  d.reprise = setTimeout(() => {
    d.reprise = null;
    if (direct !== d || vocalEtat !== "parole") return;
    d.pause = null;
    d.porte.oublier();
    d.veille.recommencer();
    d.voixMs = 0;
    d.veille.fausseAlerte(); // un bruit : la voix reprend où elle était
    d.voix.pause(false);
    setVocal("parole");
  }, ms);
}

function etatVoix(d, { joues, vide, niveau }) {
  if (!d.voix) return;
  d.voix.progression(joues);
  if (joues > 0 && vocalEtat === "reflexion" && d.voix.phrases.length) {
    d.veille.recommencer();
    setVocal("parole");
  }
  if (vocalEtat === "parole") {
    if (!d.pause) niveauRond(niveau, 5);
    d.dit = d.voix.dit;
    d.ditFin = performance.now();
    if (vide && d.reponseFinie && d.voix.finie && !d.pause) finReponse(d);
  }
}
function finReponse(d) {
  const err = d.voix.erreur;
  d.voix.vider();
  d.porte.oublier();
  d.voixMs = 0;
  d.silenceJusque = performance.now() + 600; // le haut-parleur finit un peu après
  d.derniere = performance.now();
  if (err) $("vocal-aide").textContent = err.message;
  setVocal("ecoute");
}

/** Coupe la réponse : voix, texte et Claude. */
function couperReponse(d) {
  const entendu = d.voix.entendu();
  d.tour++;
  // Coupée au doigt : le haut-parleur vient à peine de se taire. Coupée à la voix : il se tait déjà.
  if (!d.pause) { d.porte.oublier(); d.silenceJusque = performance.now() + 300; }
  d.pause = null;
  clearTimeout(d.reprise); d.reprise = null;
  clearTimeout(d.attente);
  d.voix.vider();
  d.entendu = entendu;
  d.coupure = jeuxApi.directCouper(d.jeu, d.session, entendu).catch(() => {});
  d.derniere = performance.now();
  setVocal("ecoute");
}

function paroleEntendue(d, brut, finie) {
  let t = brut.trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return;
  const enReponse = vocalEtat === "parole" || vocalEtat === "reflexion";
  // Pendant la voix, rien ne compte sans vraie parole confirmée ; seul un « stop » passe avant.
  if (vocalEtat === "parole" && !d.pause) return;
  const parole = d.voixMs;
  if (finie) d.voixMs = 0;
  // La transcription invente parfois un mot (« Parfait. ») sur du silence ou un reste d'écho.
  if (parole < 120 && !d.pause) return;
  // Écho du haut-parleur, pendant la voix ou juste après.
  if (vocalEtat === "parole" || d.vientDeCouper || performance.now() - d.ditFin < 2500) {
    const reste = sansEcho(t, d.dit);
    if (!reste) return;
    // Quelques mots communs peuvent ouvrir une vraie question (« Tu peux… ») : on les garde.
    if (estArret(reste) || t.split(/\s+/).length - reste.split(/\s+/).length >= 4) t = reste;
    if (vocalEtat === "parole" && !(d.pause.humain ? assezPourCouper(reste) : estArret(reste))) return;
  }
  if (enReponse) {
    if (!assezPourCouper(t)) return;
    couperReponse(d);
    d.vientDeCouper = true;
  }
  d.derniere = performance.now();
  $("vocal-question").textContent = frenchSpacing(t);
  $("vocal-question").classList.toggle("provisoire", !finie);
  if (!finie) return;
  if (enReponse || d.vientDeCouper) {
    d.vientDeCouper = false;
    if (estArret(t)) { $("vocal-question").textContent = ""; return; }
  }
  poserQuestion(d, t);
}

async function poserQuestion(d, question) {
  const moi = ++d.tour;
  const actif = () => direct === d && d.tour === moi;
  d.reponseFinie = false;
  d.voix.vider();
  $("vocal-reponse").textContent = "";
  $("vocal-refs").replaceChildren();
  setVocal("reflexion");
  d.attente = setTimeout(() => { if (actif() && vocalEtat === "reflexion") $("vocal-etat").textContent = t("Je cherche dans le livret…"); }, 3000);
  await d.coupure; // la réponse d'avant doit être arrêtée d'abord
  await d.enCours;
  if (!actif()) return;
  const decoupeur = createDecoupeur(12, { debutVite: true });
  const flotVocal = createFlot((t) => {
    if (!actif()) return;
    $("vocal-reponse").textContent = frenchSpacing(t);
    $("vocal-texte").scrollTop = $("vocal-texte").scrollHeight;
  });
  const dire = (phrases) => { for (const p of phrases) { const t = textePourVoix(p); if (t) d.voix.dire(t); } };
  d.enCours = envoyerQuestion(question, {
    flux: (recevoir) => jeuxApi.directQuestion(d.jeu, d.session, d.groupe, d.partie, question, recevoir),
    onTexte: (m) => {
      if (!actif()) return;
      flotVocal.ajouter(m);
      dire(decoupeur.ajouter(m));
    },
    onRefs: (refs) => { if (actif()) $("vocal-refs").replaceChildren(blocPages(refs, { ajouter: null })); },
  });
  const err = await d.enCours;
  if (!actif()) return;
  if (err) return arretDirect(err.message);
  dire(decoupeur.fin());
  d.reponseFinie = true;
  // Voix impossible : la réponse reste écrite et l'écoute reprend.
  const veiller = setInterval(() => {
    if (!actif()) return clearInterval(veiller);
    if (vocalEtat !== "reflexion") return clearInterval(veiller);
    if (d.voix.erreur || !d.voix.phrases.length) {
      clearInterval(veiller);
      const msg = d.voix.erreur?.message;
      finReponse(d);
      if (msg) $("vocal-aide").textContent = t("{erreur}. La réponse reste écrite.", { erreur: msg.replace(/.$/, "") });
    }
  }, 200);
}

$("chat-micro").addEventListener("click", () => {
  if (chatOccupe) return;
  hideError();
  input.blur();
  player.stop();
  arreterAide();
  ambiance.fadeOut(300);
  $("vocal-question").textContent = "";
  $("vocal-reponse").textContent = "";
  $("vocal-refs").replaceChildren();
  ouvrir($("vocal"));
  commencerDirect();
});
$("vocal-rond").addEventListener("click", () => {
  if (direct?.ctx.state !== "running") direct?.ctx.resume?.().catch(() => {});
  if (vocalEtat === "ecoute") direct?.transcription?.valider();
  else if (vocalEtat === "parole" || vocalEtat === "reflexion") couperReponse(direct);
  else if (vocalEtat === "repos") commencerDirect();
});
$("vocal-muet").addEventListener("click", () => {
  if (!direct?.son) return;
  direct.muet = !direct.muet;
  direct.son.muet(direct.muet);
  direct.derniere = performance.now();
  $("vocal-muet").setAttribute("aria-pressed", String(direct.muet));
  $("vocal-muet").textContent = direct.muet ? t("Rouvrir le micro") : t("Couper le micro");
});
function finirVocal() {
  fermerDirect();
  fermer($("vocal"));
  versLeBas();
}
$("vocal-fin").addEventListener("click", finirVocal);
$("vocal").addEventListener("cancel", (e) => { e.preventDefault(); finirVocal(); });
// Écran verrouillé ou autre app : on relâche le micro.
document.addEventListener("visibilitychange", () => { if (document.hidden && $("vocal").open) finirVocal(); });

// « Précédemment… » : résumé de la partie précédente, raconté par le narrateur
$("btn-precedemment").addEventListener("click", async () => {
  unlockAudio();
  hideError();
  let texte = currentPartie().resume;
  if (!texte) {
    show("loading");
    $("loading-text").textContent = t("Le narrateur rassemble ses souvenirs");
    try {
      texte = (await jeuxApi.resume(currentGame.id, currentGroupe().id, settings.model)).texte;
      refreshGame();
    } catch (err) {
      show("home");
      showError(err.message, false);
      return;
    }
  }
  playAnalysis({
    type: "histoire",
    texte_original: t("Résumé de la partie précédente."),
    segments: [{ role: "narrateur", personnage: "", genre: "inconnu", ton: "[calm]", texte_fr: texte }],
    glossaire: [],
    ambiance: "mystere",
  }, "home", t("Précédemment…"));
});

afficherApercu();
show("home");
// Prépare les voix dès l'ouverture, pour que la première photo démarre plus vite.
ensureVoices().catch(() => {});
if (settings.jeuActif) jeuPret = selectGame(settings.jeuActif, { quiet: true });
else updateHome();
