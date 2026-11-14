import test from "node:test";
import assert from "node:assert/strict";
import { resolveContourLodRequest } from "../js/core/renderer/physical_contour_lod_policy.js";

const state = (k, patch = {}) => ({ zoomTransform: { k }, styleConfig: { physical: { preset: "balanced", contourMinorVisible: true, ...patch } } });
const legacyContourState = (k, patch = {}) => ({
  zoomTransform: { k },
  styleConfig: { physical: { mode: "atlas_and_contours", ...patch } },
});

test("low LOD requests only major", () => {
  assert.deepEqual(resolveContourLodRequest(state(1.3)), ["physical_contours_low_major"]);
});

test("mid LOD loads minor only after preset zoom gate", () => {
  assert.deepEqual(resolveContourLodRequest(state(2.4)), ["physical_contours_mid_major"]);
  assert.deepEqual(resolveContourLodRequest(state(3, { preset: "political_clean" })), ["physical_contours_mid_major", "physical_contours_mid_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3, { contourMinorVisible: false })), ["physical_contours_mid_major"]);
});

test("high LOD upgrades to detail and preset controls minor", () => {
  assert.deepEqual(resolveContourLodRequest(state(3.2)), ["physical_contours_mid_major", "physical_contours_mid_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3.2, { contourMinorIntervalM: 100 })), ["physical_contours_mid_major", "physical_contours_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3.5, { preset: "terrain_rich" })), ["physical_contours_mid_major"]);
  assert.deepEqual(resolveContourLodRequest(state(4, { preset: "terrain_rich" })), ["physical_contours_major", "physical_contours_minor"]);
});

test("normalizes legacy contour styles with omitted minor fields", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(3.2)), [
    "physical_contours_mid_major",
    "physical_contours_mid_minor",
  ]);
});

test("terrain rich keeps 100m detail behind its high zoom gate", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(3.9, { preset: "terrain_rich" })), [
    "physical_contours_mid_major",
  ]);
  assert.deepEqual(resolveContourLodRequest(legacyContourState(4, {
    preset: "terrain_rich",
    contourMinorIntervalM: 100,
  })), ["physical_contours_major", "physical_contours_minor"]);
});

test("explicitly disabled minor contours remain disabled after normalization", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(6, {
    preset: "terrain_rich",
    contourMinorVisible: false,
  })), ["physical_contours_major"]);
});
