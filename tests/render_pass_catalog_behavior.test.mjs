import assert from "node:assert/strict";
import test from "node:test";

import {
  filterEnabledRenderPassNames,
  INTERACTION_COMPOSITE_PASS_NAMES,
  RENDER_PASS_NAMES,
  RENDER_PASS_OVERSCAN_RATIO_PER_SIDE,
  TRANSFORM_REUSED_RENDER_PASS_NAMES,
  TRANSFORMED_FRAME_PASS_NAMES,
  VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES,
} from "../js/core/map_renderer/render_pass_catalog.js";

const EXPECTED_RENDER_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "borders",
  "textureLabels",
  "labels",
];

const EXPECTED_TRANSFORM_REUSED_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
];

const EXPECTED_INTERACTION_COMPOSITE_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
];

const EXPECTED_TRANSFORMED_FRAME_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "textureLabels",
  "labels",
];

function assertGroupedPassesExist(groupName, passNames) {
  for (const passName of passNames) {
    assert.ok(
      RENDER_PASS_NAMES.includes(passName),
      `${groupName} pass "${passName}" must exist in RENDER_PASS_NAMES.`,
    );
  }
}

test("render pass catalog preserves pass order and names", () => {
  assert.deepEqual(RENDER_PASS_NAMES, EXPECTED_RENDER_PASS_NAMES);
});

test("transform-reused passes stay a Set with the current members", () => {
  assert.ok(
    TRANSFORM_REUSED_RENDER_PASS_NAMES instanceof Set,
    "TRANSFORM_REUSED_RENDER_PASS_NAMES must remain a Set.",
  );
  assert.deepEqual([...TRANSFORM_REUSED_RENDER_PASS_NAMES], EXPECTED_TRANSFORM_REUSED_PASS_NAMES);
  assertGroupedPassesExist("transform reused", TRANSFORM_REUSED_RENDER_PASS_NAMES);
});

test("viewport-stable signature passes stay scoped to contextBase", () => {
  assert.ok(
    VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES instanceof Set,
    "VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES must remain a Set.",
  );
  assert.deepEqual([...VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES], ["contextBase"]);
  assertGroupedPassesExist("viewport-stable signature", VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES);
});

test("interaction composite passes preserve current subset order", () => {
  assert.deepEqual(INTERACTION_COMPOSITE_PASS_NAMES, EXPECTED_INTERACTION_COMPOSITE_PASS_NAMES);
  assertGroupedPassesExist("interaction composite", INTERACTION_COMPOSITE_PASS_NAMES);
});

test("transformed frame passes preserve current subset order", () => {
  assert.deepEqual(TRANSFORMED_FRAME_PASS_NAMES, EXPECTED_TRANSFORMED_FRAME_PASS_NAMES);
  assertGroupedPassesExist("transformed frame", TRANSFORMED_FRAME_PASS_NAMES);
});

test("render pass overscan ratio stays unchanged", () => {
  assert.equal(RENDER_PASS_OVERSCAN_RATIO_PER_SIDE, 0.15);
});

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


test("population heatmap visibility requires the explicit switch, including loading data", () => {
  assert.ok(!filterEnabledRenderPassNames(RENDER_PASS_NAMES).includes("populationHeatmap"));
  const enabled = filterEnabledRenderPassNames(RENDER_PASS_NAMES, { populationHeatmapEnabled: true });
  assert.equal(enabled.indexOf("populationHeatmap"), enabled.indexOf("political") + 1);
  assert.ok(enabled.indexOf("populationHeatmap") < enabled.indexOf("borders"));
  assert.ok(filterEnabledRenderPassNames(INTERACTION_COMPOSITE_PASS_NAMES, { populationHeatmapEnabled: true }).includes("populationHeatmap"));
});
