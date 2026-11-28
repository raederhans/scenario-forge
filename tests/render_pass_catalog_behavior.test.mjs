import assert from "node:assert/strict";
import test from "node:test";
import { filterEnabledRenderPassNames, INTERACTION_COMPOSITE_PASS_NAMES, RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";

test("disabled effects and context passes leave the required painter order intact", () => {
  assert.deepEqual(filterEnabledRenderPassNames(RENDER_PASS_NAMES), [
    "background", "political", "contextScenario", "borders", "labels",
  ]);
  assert.deepEqual(filterEnabledRenderPassNames(INTERACTION_COMPOSITE_PASS_NAMES), [
    "background", "political", "contextScenario",
  ]);
});

test("enabled loading layers remain required and contour-only keeps its contour pass", () => {
  const active = filterEnabledRenderPassNames(RENDER_PASS_NAMES, {
    showPhysical: true, physicalMode: "contours_only", showTransport: true,
    dayNightEnabled: true, textureMode: "graticule",
  });
  assert.ok(!active.includes("physicalBase"));
  for (const name of ["contextBase", "contextMarkers", "dayNight", "lineEffects", "textureLabels"]) {
    assert.ok(active.includes(name), name);
  }
  assert.ok(!active.includes("effects"));
  assert.deepEqual(filterEnabledRenderPassNames(["effects", "lineEffects", "textureLabels"], { textureMode: "paper" }), ["effects"]);
  assert.deepEqual(filterEnabledRenderPassNames(["effects", "lineEffects", "textureLabels"], { textureMode: "draft_grid" }), ["lineEffects"]);
});
