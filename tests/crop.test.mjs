import { test } from "node:test";
import assert from "node:assert/strict";
import { initialRect, moveRect, resizeRect, toNaturalCrop } from "../js/crop.js";

const bounds = { x: 0, y: 100, w: 300, h: 400 }; // image affichée dans l'écran

test("cadre initial : marge de 8 % dans l'image", () => {
  assert.deepEqual(initialRect(bounds), { x: 24, y: 132, w: 252, h: 336 });
});

test("déplacer : reste dans l'image", () => {
  const r = { x: 50, y: 150, w: 100, h: 100 };
  assert.deepEqual(moveRect(r, 20, 30, bounds), { x: 70, y: 180, w: 100, h: 100 });
  assert.deepEqual(moveRect(r, -500, -500, bounds), { x: 0, y: 100, w: 100, h: 100 });
  assert.deepEqual(moveRect(r, 999, 999, bounds), { x: 200, y: 400, w: 100, h: 100 });
});

test("redimensionner par un coin, limité à l'image", () => {
  const r = { x: 50, y: 150, w: 100, h: 100 };
  assert.deepEqual(resizeRect(r, "se", 40, 20, bounds), { x: 50, y: 150, w: 140, h: 120 });
  assert.deepEqual(resizeRect(r, "nw", -10, -10, bounds), { x: 40, y: 140, w: 110, h: 110 });
  assert.deepEqual(resizeRect(r, "nw", -999, -999, bounds), { x: 0, y: 100, w: 150, h: 150 });
  assert.deepEqual(resizeRect(r, "se", 999, 999, bounds), { x: 50, y: 150, w: 250, h: 350 });
});

test("redimensionner : taille minimale respectée", () => {
  const r = { x: 50, y: 150, w: 100, h: 100 };
  const out = resizeRect(r, "se", -500, -500, bounds, 60);
  assert.equal(out.w, 60);
  assert.equal(out.h, 60);
  const out2 = resizeRect(r, "nw", 500, 500, bounds, 60);
  assert.deepEqual(out2, { x: 90, y: 190, w: 60, h: 60 });
});

test("conversion en pixels de la photo d'origine", () => {
  // image de 3000x4000 affichée en 300x400 → facteur 10
  const crop = toNaturalCrop({ x: 30, y: 150, w: 100, h: 200 }, bounds, { w: 3000, h: 4000 });
  assert.deepEqual(crop, { sx: 300, sy: 500, sw: 1000, sh: 2000 });
});

test("conversion : arrondie et bornée à l'image", () => {
  const crop = toNaturalCrop({ x: -5, y: 100, w: 400, h: 400 }, bounds, { w: 1000, h: 1333 });
  assert.equal(crop.sx, 0);
  assert.ok(crop.sx + crop.sw <= 1000);
  assert.ok(crop.sy + crop.sh <= 1333);
});

import { rescaleRect } from "../js/crop.js";

test("changement de taille de l'écran : la sélection suit la photo", () => {
  const oldB = { x: 0, y: 100, w: 300, h: 400 };
  const newB = { x: 10, y: 50, w: 150, h: 200 };
  assert.deepEqual(rescaleRect({ x: 30, y: 150, w: 100, h: 200 }, oldB, newB), { x: 25, y: 75, w: 50, h: 100 });
});
