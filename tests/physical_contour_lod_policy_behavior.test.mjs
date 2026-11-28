import test from "node:test";
import assert from "node:assert/strict";
import { resolveContourLodRequest } from "../js/core/renderer/physical_contour_lod_policy.js";

const state = (k, patch = {}) => ({ zoomTransform: { k }, styleConfig: { physical: { preset: "balanced", contourMinorVisible: true, ...patch } } });
const legacyContourState = (k, patch = {}) => ({
  zoomTransform: { k },
  styleConfig: { physical: { mode: "atlas_and_contours", ...patch } },
});

test("zoom selects major and minor contour detail", () => {
  assert.deepEqual(resolveContourLodRequest(state(3.5, { preset: "terrain_rich" })), ["physical_contours_mid_major"]);
  assert.deepEqual(resolveContourLodRequest(state(4, { preset: "terrain_rich" })), ["physical_contours_major", "physical_contours_minor"]);
});

test("explicitly disabled minor contours remain disabled after normalization", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(6, {
    preset: "terrain_rich",
    contourMinorVisible: false,
  })), ["physical_contours_major"]);
});
