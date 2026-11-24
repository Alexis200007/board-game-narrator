// Calculs du cadre de sélection (coordonnées à l'écran → pixels de la photo).
// bounds = zone où l'image est affichée ; rect = cadre choisi, dans le même repère.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function initialRect(bounds, margin = 0.08) {
  return {
    x: Math.round(bounds.x + bounds.w * margin),
    y: Math.round(bounds.y + bounds.h * margin),
    w: Math.round(bounds.w * (1 - 2 * margin)),
    h: Math.round(bounds.h * (1 - 2 * margin)),
  };
}

export function moveRect(r, dx, dy, bounds) {
  return {
    x: clamp(r.x + dx, bounds.x, bounds.x + bounds.w - r.w),
    y: clamp(r.y + dy, bounds.y, bounds.y + bounds.h - r.h),
    w: r.w,
    h: r.h,
  };
}

/** handle ∈ "nw" | "ne" | "sw" | "se" */
export function resizeRect(r, handle, dx, dy, bounds, min = 40) {
  let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
  if (handle.includes("n")) top = clamp(top + dy, bounds.y, bottom - min);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, bounds.y + bounds.h);
  if (handle.includes("w")) left = clamp(left + dx, bounds.x, right - min);
  if (handle.includes("e")) right = clamp(right + dx, left + min, bounds.x + bounds.w);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Rectangle à découper dans la photo d'origine (natural = taille réelle en pixels). */
export function toNaturalCrop(r, bounds, natural) {
  const kx = natural.w / bounds.w;
  const ky = natural.h / bounds.h;
  const x0 = clamp(Math.round((r.x - bounds.x) * kx), 0, natural.w);
  const y0 = clamp(Math.round((r.y - bounds.y) * ky), 0, natural.h);
  const x1 = clamp(Math.round((r.x + r.w - bounds.x) * kx), x0 + 1, natural.w);
  const y1 = clamp(Math.round((r.y + r.h - bounds.y) * ky), y0 + 1, natural.h);
  return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0 };
}

/** Garde la même portion de photo quand la zone d'affichage change de taille. */
export function rescaleRect(r, oldB, newB) {
  const kx = newB.w / oldB.w, ky = newB.h / oldB.h;
  return {
    x: newB.x + (r.x - oldB.x) * kx,
    y: newB.y + (r.y - oldB.y) * ky,
    w: r.w * kx,
    h: r.h * ky,
  };
}
