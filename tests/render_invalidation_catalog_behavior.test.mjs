import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createFrameGraphInvalidation, resolveFrameGraphInvalidationExecutionPlan } from "../js/core/map_renderer/scenario_refresh_plans.js";
import { ensurePopulationHeatmapData, getPopulationHeatmapSnapshot } from "../js/core/population_spatial_runtime.js";
import { getPopulationViewportDetailTileIds } from "../js/core/renderer/population_heatmap_render_owner.js";
import { normalizePopulationStyle } from "../js/core/population_spatial_view_model.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/population_spatial_data.js";

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

function populationViewportPreparationHarness(loadTiles) {
  const geometry = "a".repeat(64);
  const runtimeState = { activeScenarioId: "modern_world", width: 100, height: 50, zoomTransform: { k: 4, x: 0, y: 0 },
    activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
    styleConfig: { population: normalizePopulationStyle({ enabled: true, mode: "heatmap" }) },
    populationRuntime: { status: "ready", data: { layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
      year: 2020, scenarioId: "modern_world", geometryVersion: geometry, raster: { detail_tiles: [
        { id: "visible", bounds: [-10_000_000, -10_000_000, 10_000_000, 10_000_000] },
      ] } } } };
  const projection = Object.assign(point => point, { invert: point => point });
  const invalidations = [], renders = [];
  const context = vm.createContext({
    runtimeState, rendererSurfaceHost: { getProjection: () => projection }, getPopulationViewportDetailTileIds,
    ensurePopulationHeatmapData: (state, options) => ensurePopulationHeatmapData(state, { ...options, loadTiles }),
    invalidateRenderPasses: (passes, reason) => {
      const resources = getTargetResourcesForPasses(passes);
      const plan = resolveFrameGraphInvalidationExecutionPlan(createFrameGraphInvalidation({ targetResources: resources, reason }));
      invalidations.push({ ...plan, reason, snapshot: getPopulationHeatmapSnapshot(runtimeState) });
    },
    requestRendererRender: reason => renders.push(reason), callRuntimeHook() {},
  });
  const renderer = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const preparation = renderer.match(/function preparePopulationViewportData\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(preparation);
  vm.runInContext(preparation, context);
  return { state: runtimeState, prepare: context.preparePopulationViewportData, invalidations, renders };
}

for (const fail of [false, true]) {
  test(`real viewport population ${fail ? "failure" : "publication"} invalidates only its dedicated raster pass on both loading and completion`, async () => {
    const requests = [];
    const h = populationViewportPreparationHarness(async (_raster, options) => {
      requests.push(options.detailTileIds);
      if (fail) throw new Error("tiles unavailable");
      return { overview: {}, detail: [] };
    });
    await h.prepare();
    assert.deepEqual(requests, [["visible"]]);
    assert.equal(h.invalidations.length, 2);
    assert.deepEqual(h.invalidations.map(entry => entry.snapshot.status), ["loading", fail ? "failed" : "ready"]);
    assert.ok(h.invalidations[1].snapshot.revision > h.invalidations[0].snapshot.revision);
    for (const entry of h.invalidations) {
      assert.deepEqual(entry.targetResources, ["populationHeatmapBuffer"]);
      assert.deepEqual(entry.invalidationTargetPasses, ["populationHeatmap"]);
      assert.equal(entry.reason, "population-tiles-ready");
    }
    assert.deepEqual(h.renders, ["population-tiles-ready", "population-tiles-ready"]);
  });
}

for (const change of ["scenario", "geometry"]) {
  test(`old population viewport publication after ${change} change cannot invalidate the new frame`, async () => {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    const h = populationViewportPreparationHarness(() => pending);
    const request = h.prepare();
    await Promise.resolve();
    if (change === "scenario") h.state.activeScenarioId = "hoi4_1939";
    else h.state.activeScenarioManifest.source.runtime_topology_sha256 = "b".repeat(64);
    finish({ overview: {}, detail: [] });
    assert.equal(await request, null);
    assert.equal(h.invalidations.length, 1, "only the original loading request invalidates; stale completion does not publish");
    assert.equal(h.renders.length, 1);
  });
}
