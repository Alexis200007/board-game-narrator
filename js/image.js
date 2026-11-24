// Photo : chargement pour l'écran de sélection, puis découpe et réduction en JPEG ≤ max px.
import { t } from "./i18n.js";

export function loadImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("Impossible de lire cette photo. Essaie une autre photo.")));
    };
    img.src = url;
  });
}

/** crop = { sx, sy, sw, sh } en pixels de la photo, ou null pour la photo entière. */
export function cropAndResize(img, crop = null, max = 1600) {
  const c = crop || { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
  const scale = Math.min(1, max / Math.max(c.sw, c.sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(c.sw * scale);
  canvas.height = Math.round(c.sh * scale);
  canvas.getContext("2d").drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("Impossible de préparer la photo.")))), "image/jpeg", 0.85));
}
