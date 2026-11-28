import assert from "node:assert/strict";
import test from "node:test";

import { createDayNightRuntimeOwner } from "../js/core/renderer/day_night_runtime_owner.js";
import { normalizeDayNightStyleConfig } from "../js/core/state_defaults.js";
import { createDayNightMask, getNightCoverage } from "../js/core/renderer/day_night_mask.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function normalizeLongitude(value) {
  let normalized = Number(value) || 0;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

test("summer solstice solar declination is between 23 and 24 degrees", () => {
  const owner = createDayNightRuntimeOwner({
    rendererSurfaceHost: {},
    getters: { getDayNightStyleConfigState() {}, isBootInteractionReady() {}, isRenderPhaseIdle() {} },
    helpers: { clamp, normalizeLongitude, normalizeDayNightStyleConfig, nowMs: Date.now, stableJson: JSON.stringify },
    effects: { drawNightLightsLayer() {}, invalidateRenderPasses() {}, renderFallback() {}, requestRender() {},
      setDayNightStyleConfig() {}, setPendingDayNightRefresh() {}, updateToolbarInputs() {} },
  });
  const manual = normalizeDayNightStyleConfig({ enabled: true, mode: "manual", manualUtcMinutes: 720 });
  const solar = owner.getCurrentSolarState(manual, new Date("2026-06-21T12:34:00.000Z"));
  assert.ok(solar.declinationDeg > 23 && solar.declinationDeg < 24);
});

test("night coverage changes continuously from sunset to deep night with no daylight spill", () => {
  const dotAt = (angle) => Math.sin(angle * Math.PI / 180);
  assert.equal(getNightCoverage(dotAt(20), 10), 0);
  assert.equal(getNightCoverage(0, 10), 0);
  const levels = [0, -1, -3, -5, -7, -9, -10].map((angle) => getNightCoverage(dotAt(angle), 10));
  assert.equal(levels.at(-1), 1);
  for (let index = 1; index < levels.length; index += 1) assert.ok(levels[index] > levels[index - 1]);
  assert.ok(getNightCoverage(dotAt(-0.01), 10) < 0.00001, "sunset must not introduce a visible brightness step");
  assert.ok(getNightCoverage(dotAt(-5), 20) < getNightCoverage(dotAt(-5), 10));
});

test("night mask leaves clipped or invalid projected regions transparent", () => {
  let image;
  const projection = (point) => point;
  projection.invert = ([x, y]) => x < -160 ? [NaN, NaN] : [x, y];
  projection.clipExtent = () => [[-180, -80], [180, 80]];
  const owner = createDayNightMask({ createCanvas: () => ({
    width: 0, height: 0, getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (value) => { image = value; },
    }),
  }) });
  const mask = owner.getMask({
    context: { canvas: { width: 360, height: 180 }, getTransform: () => ({ a: 1, b: 0, c: 0, d: -1, e: 180, f: 90 }) },
    projection, solarState: { subsolarLongitude: 0, declinationDeg: 0 },
  });
  assert.equal(image.data[(22 * mask.width) * 4 + 3], 0);
  assert.equal(image.data[(0 * mask.width + 10) * 4 + 3], 0);
  assert.equal(image.data[(22 * mask.width + 10) * 4 + 3], 255);
});
