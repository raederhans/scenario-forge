import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  createPopulationHeatmapRenderOwner, rasterizePopulationDensity, getPopulationViewportDetailTileIds,
  POPULATION_SCREEN_SAMPLE_BUDGET, POPULATION_EXPORT_SAMPLE_BUDGET,
} from "../js/core/renderer/population_heatmap_render_owner.js";
import { getPopulationDensityColor } from "../js/core/population_spatial_view_model.js";
import { estimateExportRenderBytes } from "../js/core/renderer/export_render_budget.js";
import { RENDER_PASS_NAMES, TRANSFORMED_FRAME_PASS_NAMES, INTERACTION_COMPOSITE_PASS_NAMES,
  filterEnabledRenderPassNames } from "../js/core/map_renderer/render_pass_catalog.js";
import { IDLE_RENDER_PASS_DEFINITIONS } from "../js/core/renderer/render_pipeline_catalog.js";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function projection(point) { return point; }
projection.invert = (point) => point;

test("real spatial samples within one country retain different density pixels and missing stays distinct from zero", () => {
  const result = rasterizePopulationDensity({ width: 3, height: 1, matrix: identity, projection,
    sampleDensity: (lon) => [{ status: "ok", density: 0 }, { status: "ok", density: 1000 }, { status: "no_data", density: null }][Math.floor(lon)] });
  assert.equal(result.sampled, 2);
  assert.equal(result.data[3], 255);
  assert.equal(result.data[7], 255);
  assert.equal(result.data[11], 0);
  assert.notDeepEqual([...result.data.slice(0, 3)], [...result.data.slice(4, 7)]);
});

test("DPR, pan, zoom, overscan and export context matrices inverse to the same geographic position", () => {
  const samples = [];
  for (const scale of [1, 2, 4]) {
    const matrix = { a: scale, b: 0, c: 0, d: scale, e: 0.5 - 12 * scale, f: 0.5 - 23 * scale };
    const result = rasterizePopulationDensity({ width: 1, height: 1, matrix, projection,
      sampleDensity: (lon, lat) => { samples.push([lon, lat]); return 50; } });
    assert.equal(result.sampled, 1);
  }
  assert.deepEqual(samples, [[12, 23], [12, 23], [12, 23]]);
  const shear = { a: 2, b: 1, c: 1, d: 3, e: -1.5, f: -3.5 };
  rasterizePopulationDensity({ width: 1, height: 1, matrix: shear, projection,
    sampleDensity: (lon, lat) => { assert.deepEqual([lon, lat], [0.4, 1.2]); return 50; } });
});

test("inverse projection exterior and non-finite coordinates never paint plausible wrapped globe data", () => {
  const wrapped = () => [90, 90];
  wrapped.invert = () => [0, 0];
  for (const invalid of [wrapped, { invert: () => [Infinity, 0] }, { invert: () => [181, 0] }]) {
    const result = rasterizePopulationDensity({ width: 1, height: 1, matrix: identity, projection: invalid,
      sampleDensity: () => assert.fail("invalid coordinates must not sample") });
    assert.equal(result.data[3], 0);
  }
});

test("density color agrees with the feature-density legend bins", () => {
  const result = rasterizePopulationDensity({ width: 1, height: 1, matrix: identity, projection,
    sampleDensity: () => ({ status: "ok", density: 200 }) });
  assert.equal(`#${[...result.data.slice(0, 3)].map((value) => value.toString(16).padStart(2, "0")).join("")}`, getPopulationDensityColor(200));
});

function harness({ status = "ready", mask = true, width = 2, height = 1 } = {}) {
  const calls = { allocations: 0, samples: 0, clips: 0, saves: 0, restores: 0, draws: 0, metrics: [] };
  const state = { activeScenarioId: "modern_world", topologyRevision: 1,
    styleConfig: { population: { enabled: true, mode: "heatmap", opacity: 0.8 } } };
  let snapshot = { status, revision: 1, version: "ghsl-r2023a-e2020-v1" };
  let projectionKey = "equalEarth", exporting = false;
  const context = { canvas: { width, height }, getTransform: () => identity,
    save: () => { calls.saves++; }, restore: () => { calls.restores++; },
    setTransform() {}, drawImage: () => { calls.draws++; } };
  const owner = createPopulationHeatmapRenderOwner({ state,
    getters: { getContext: () => context, getProjection: () => projection, getProjectionKey: () => projectionKey,
      getSnapshot: () => snapshot, sampleDensity: () => { calls.samples++; return { status: "ok", density: 50 }; },
      getMaskInfo: () => mask ? { collection: {} } : null, isExportRendering: () => exporting },
    helpers: { applyLandMask: () => { calls.clips++; return mask; }, recordMetric: (...args) => calls.metrics.push(args),
      createCanvas: () => { calls.allocations++; return { getContext: () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
      }) }; } },
  });
  return { state, context, calls, owner, setSnapshot: (value) => { snapshot = value; },
    setProjectionKey: (value) => { projectionKey = value; }, setExporting: (value) => { exporting = value; } };
}

test("one bounded surface is reused until tile revision, projection, scenario or transform identity changes", () => {
  const h = harness();
  assert.equal(h.owner.draw().status, "ready");
  h.owner.draw();
  assert.equal(h.calls.allocations, 1);
  assert.equal(h.calls.clips, 2, "land mask is applied even for cache replay");
  h.setSnapshot({ status: "ready", revision: 2, version: "ghsl-r2023a-e2020-v1" });
  h.owner.draw();
  h.setProjectionKey("orthographic"); h.owner.draw();
  h.state.activeScenarioId = "tno_1962"; h.owner.draw();
  assert.equal(h.calls.allocations, 4);
  assert.equal(h.calls.saves, h.calls.restores);
  h.owner.invalidate();
  assert.equal(h.owner.getCacheInfo(), null);
});

test("loading and failed sources report status; exporting never silently produces an empty heatmap", () => {
  for (const status of ["loading", "failed", "source_pending"]) {
    const h = harness({ status });
    assert.equal(h.owner.draw().status, status);
    assert.equal(h.calls.allocations, 0);
    assert.equal(h.calls.metrics[0][2].status, status);
    assert.throws(() => h.owner.assertReadyForExport(), new RegExp(status));
    h.setExporting(true);
    assert.throws(() => h.owner.draw(), new RegExp(status));
  }
  const missingMask = harness({ mask: false });
  assert.equal(missingMask.owner.getReadiness().status, "mask-unavailable");
  assert.throws(() => missingMask.owner.assertReadyForExport(), /mask-unavailable/);
});

test("screen and export sample surfaces are bounded independently of target DPR", () => {
  const h = harness({ width: 2400, height: 1600 });
  h.owner.draw();
  let cache = h.owner.getCacheInfo();
  assert.ok(cache.width * cache.height <= POPULATION_SCREEN_SAMPLE_BUDGET);
  h.setExporting(true); h.owner.draw();
  cache = h.owner.getCacheInfo();
  assert.ok(cache.width * cache.height <= POPULATION_EXPORT_SAMPLE_BUDGET);
  assert.ok(cache.width * cache.height > POPULATION_SCREEN_SAMPLE_BUDGET);
  h.state.styleConfig.population.enabled = false;
  assert.equal(h.owner.draw().status, "disabled");
  assert.equal(h.owner.getCacheInfo(), null);
});

test("a failed detail request preserves the real overview but explicitly blocks export", () => {
  const h = harness();
  h.setSnapshot({ status: "ready", revision: 3, version: "ghsl-r2023a-e2020-v1",
    refinementStatus: "failed", error: "HTTP 404" });
  assert.equal(h.owner.draw(4).status, "ready");
  assert.equal(h.calls.metrics.at(-1)[2].refinementStatus, "failed");
  assert.throws(() => h.owner.assertReadyForExport(), /detail loading failed.*HTTP 404/);
});

test("all compositing paths contain the enabled heatmap after political and before borders", () => {
  for (const names of [RENDER_PASS_NAMES, TRANSFORMED_FRAME_PASS_NAMES, INTERACTION_COMPOSITE_PASS_NAMES,
    IDLE_RENDER_PASS_DEFINITIONS.map((entry) => entry.passName)]) {
    assert.ok(names.indexOf("populationHeatmap") > names.indexOf("political"));
    if (names.includes("borders")) assert.ok(names.indexOf("populationHeatmap") < names.indexOf("borders"));
    assert.equal(filterEnabledRenderPassNames(names).includes("populationHeatmap"), false);
    assert.equal(filterEnabledRenderPassNames(names, { populationHeatmapEnabled: true }).includes("populationHeatmap"), true);
  }
  const base = { width: 1200, height: 800, pixelRatio: 2, passNames: ["political"] };
  assert.ok(estimateExportRenderBytes({ ...base, passNames: ["political", "populationHeatmap"] })
    > estimateExportRenderBytes(base));
});

test("detail refinement selection uses projected viewport locations and caps downloads at 32 tiles", () => {
  const tiles = Array.from({ length: 100 }, (_, index) => ({ id: `tile-${index}`,
    bounds: [-1e7 + index * 200000, -1e6, -1e7 + (index + 1) * 200000, 1e6] }));
  const state = { width: 120, height: 60, zoomTransform: { k: 4, x: 0, y: 0 },
    populationRuntime: { data: { raster: { detail_tiles: tiles } } } };
  const ids = getPopulationViewportDetailTileIds(state, { projection });
  assert.ok(ids.length > 0 && ids.length <= 32);
  assert.ok(ids.includes("tile-50"), "real central Mollweide location selects the central source tile");
  state.zoomTransform.k = 1;
  assert.deepEqual(getPopulationViewportDetailTileIds(state, { projection }), []);
  state.zoomTransform.k = 4;
  assert.deepEqual(getPopulationViewportDetailTileIds(state, { projection: { invert: () => [Infinity, 0] } }), []);
});


test("current renderer river partition painting and hit routing yield to active thematic or population views", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const body = source.match(/function hasVisibleRiverPartitions\(\) \{([\s\S]*?)\n\}/)?.[1];
  const enabled = source.match(/function getRiverPaintRenderOwner\(\) \{[\s\S]*?isEnabled: \(\) => ([^\n]+),/)?.[1];
  assert.ok(body); assert.ok(enabled);
  const state = { strategicChoroplethMetric: "" };
  const visible = new Function("runtimeState", "debugMode", "isThematicWgiActive", "isPopulationActive", "getRiverPaintRuntime", body);
  const paintEnabled = new Function("runtimeState", "debugMode", "isThematicWgiActive", "isPopulationActive", `return ${enabled};`);
  for (const thematic of [false, true]) for (const population of [false, true]) {
    const args = [state, "PROD", () => thematic, () => population];
    assert.equal(visible(...args, () => ({ getActivePack: () => ({}) })), !thematic && !population);
    assert.equal(paintEnabled(...args), !thematic && !population);
  }
  assert.equal(visible(state, "PROD", () => false, () => false, () => ({ getActivePack: () => null })), false);
});
