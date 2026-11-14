import assert from "node:assert/strict";
import test from "node:test";
import { createFrameGraphInvalidation, resolveFrameGraphInvalidationExecutionPlan } from "../js/core/map_renderer/scenario_refresh_plans.js";

import {
  DEFAULT_RENDER_INVALIDATION_PASSES,
  FIRST_FRAME_BASE_TARGET_RESOURCES,

  PASS_RESOURCE_MAP,
  RESOURCE_PASS_MAP,
  UNSUPPORTED_RENDER_PASS_INPUT_KEYS,
  getFirstFrameTargetResources,
  getTargetPassesForResources,
  getTargetResourcesForPasses,
  hasAnyTargetResource,
  resolveFirstFrameTargetResources,
} from "../js/core/map_renderer/render_invalidation_catalog.js";
import {
  RENDER_PASS_NAMES,
} from "../js/core/map_renderer/render_pass_catalog.js";

function buildReverseResourcePassMap(passResourceMap) {
  return Object.entries(passResourceMap).reduce((acc, [passName, resourceNames]) => {
    resourceNames.forEach((resourceName) => {
      if (!acc[resourceName]) acc[resourceName] = [];
      acc[resourceName].push(passName);
    });
    return acc;
  }, {});
}

test("pass resource map only references known render passes", () => {
  assert.deepEqual(Object.keys(PASS_RESOURCE_MAP), RENDER_PASS_NAMES);
  for (const passName of Object.keys(PASS_RESOURCE_MAP)) {
    assert.ok(
      RENDER_PASS_NAMES.includes(passName),
      `PASS_RESOURCE_MAP pass "${passName}" must exist in RENDER_PASS_NAMES.`,
    );
  }
});

test("resource pass map stays the reverse of pass resource map", () => {
  assert.deepEqual(RESOURCE_PASS_MAP, buildReverseResourcePassMap(PASS_RESOURCE_MAP));
});

test("pass and resource helpers preserve fan-out order", () => {
  assert.deepEqual(
    getTargetResourcesForPasses(["political", "labels"]),
    ["politicalBaseBuffer", "hitIndex", "labelBuffer"],
  );
  assert.deepEqual(
    getTargetPassesForResources(["contextScenarioBuffer"]),
    ["contextScenario"],
  );
});

test("default visual invalidation and first-frame catalogs keep current members", () => {
  assert.deepEqual(DEFAULT_RENDER_INVALIDATION_PASSES, ["political", "borders", "labels"]);
  assert.deepEqual(FIRST_FRAME_BASE_TARGET_RESOURCES, [
    "backgroundBuffer",
    "physicalBaseBuffer",
    "politicalBaseBuffer",
    "hitIndex",
    "borderBuffer",
    "interactionOverlay",
  ]);
});

test("first-frame helpers keep baseline resources narrow", () => {
  assert.deepEqual(getFirstFrameTargetResources(), [
    "backgroundBuffer",
    "physicalBaseBuffer",
    "politicalBaseBuffer",
    "hitIndex",
    "borderBuffer",
    "interactionOverlay",

  ]);
  assert.deepEqual(
    resolveFirstFrameTargetResources(
      ["contextBaseBuffer", "labelBuffer", "politicalBaseBuffer"],
    ),
    ["backgroundBuffer", "physicalBaseBuffer", "politicalBaseBuffer", "hitIndex", "borderBuffer", "interactionOverlay"],
  );
});

test("unsupported pass input keys and resource membership helper stay stable", () => {
  assert.deepEqual(UNSUPPORTED_RENDER_PASS_INPUT_KEYS, ["targetPasses", "legacyTargetPasses"]);
  assert.equal(hasAnyTargetResource(["hitIndex"], ["politicalBaseBuffer", "hitIndex"]), true);
  assert.equal(hasAnyTargetResource([], ["hitIndex"]), false);
});

test("population heatmap has a dedicated paint resource without political fill or hit-index fan-out", () => {
  assert.deepEqual(PASS_RESOURCE_MAP.populationHeatmap, ["populationHeatmapBuffer"]);
  assert.equal(Object.isFrozen(PASS_RESOURCE_MAP.populationHeatmap), true);
  const resources = getTargetResourcesForPasses(["populationHeatmap", "populationHeatmap"]);
  assert.deepEqual(resources, ["populationHeatmapBuffer"]);
  assert.deepEqual(getTargetPassesForResources(resources), ["populationHeatmap"]);
  const plan = resolveFrameGraphInvalidationExecutionPlan(createFrameGraphInvalidation({ targetResources: resources }));
  assert.deepEqual(plan.invalidationTargetPasses, ["populationHeatmap"]);
  assert.equal(plan.hasExplicitTargetResources, true);
  assert.equal(hasAnyTargetResource(resources, ["politicalBaseBuffer", "hitIndex", "contextBaseBuffer"]), false);
});
