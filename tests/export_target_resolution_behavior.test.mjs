import { THEMATIC_INDICATORS } from "../js/core/thematic_indicator_catalog.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EXPORT_RENDER_BUDGET_BYTES, estimateExportRenderBytes } from "../js/core/renderer/export_render_budget.js";
import { RENDER_PASS_OVERSCAN_RATIO_PER_SIDE, TRANSFORMED_FRAME_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";

test("river internal contours charge one border-sized RGBA scratch without changing the budget", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["borders", "borders"] };
  const overscan = TRANSFORMED_FRAME_PASS_NAMES.includes("borders") ? RENDER_PASS_OVERSCAN_RATIO_PER_SIDE : 0;
  const borderWidth = Math.floor((100 + 2 * Math.ceil(100 * overscan)) * 2);
  const borderHeight = Math.floor((80 + 2 * Math.ceil(80 * overscan)) * 2);
  assert.equal(estimateExportRenderBytes({ ...input, riverInternalContours: true })
    - estimateExportRenderBytes(input), borderWidth * borderHeight * 4);
  const noBorders = { ...input, passNames: ["political"] };
  assert.equal(estimateExportRenderBytes({ ...noBorders, riverInternalContours: true }), estimateExportRenderBytes(noBorders));
  assert.equal(EXPORT_RENDER_BUDGET_BYTES, 640 * 1024 * 1024);
});
import { getRiverPaintRuntime } from "../js/core/river_paint/runtime.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";
import { getBakePassNamesForLayer } from "../js/ui/toolbar/export_artifact_model.js";
import { EXPORT_MAIN_LAYER_MODEL_BY_ID, resolveExportPassSequence } from "../js/ui/toolbar/export_workbench_controller.js";
import {
  normalizeThematicWgiStyle, isThematicWgiRequested, isThematicWgiActive, getThematicWgiSignature,
} from "../js/core/thematic_wgi_view_model.js";
import { drawThematicWgiExportLegend } from "../js/core/renderer/thematic_wgi_export_legend.js";
import { THEMATIC_WGI_SCENARIO_IDS } from "../js/core/thematic_wgi_data.js";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { filterEnabledRenderPassNames } from "../js/core/map_renderer/render_pass_catalog.js";
import { normalizePopulationStyle, getPopulationViewModel, getPopulationSignature,
  isPopulationActive, isPopulationRequested } from "../js/core/population_spatial_view_model.js";
import { ensurePopulationData, ensurePopulationHeatmapData, getPopulationHeatmapSnapshot } from "../js/core/population_spatial_runtime.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/population_spatial_data.js";
import { drawPopulationExportLegend } from "../js/core/renderer/population_export_legend.js";
import { createPopulationHeatmapRenderOwner, getPopulationViewportDetailTileIds } from "../js/core/renderer/population_heatmap_render_owner.js";
import { callRuntimeHook } from "../js/core/state/index.js";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const start = source.indexOf("let exportRenderInProgress = false;");
const end = source.indexOf("\nfunction composeTransformedFrameToBuffer(", start);
assert.ok(start >= 0 && end > start);
const exportSource = source.slice(start, end);

function harness({ failPass = false, failComposition = false, screenDpr = 1, budgetExceeded = false,
  contourStatus = "ready", politicalStatus = "ready", hgo = false,
  riverVisible = false, riverStatus = "ready", riverScratch = false } = {}) {
  const visibleCache = { canvases: { background: { width: 100, height: 50 } } };
  const runtimeState = {
    width: 100,
    height: 50,
    dpr: screenDpr,
    colorCanvas: { width: 100 * screenDpr, height: 50 * screenDpr },
    renderPassCache: visibleCache,
    zoomTransform: { k: 1, x: 0, y: 0 },
  };
  const calls = [];
  const scratchDisposals = [];
  const resourceBudget = createRuntimeResourceBudget();
  const renderCacheOwner = createRenderCacheOwner({ state: runtimeState, resourceBudget,
    constants: { renderPassNames: ["background", "borders"] },
    helpers: { ensureRenderPassCacheState: (state) => state.renderPassCache } });
  renderCacheOwner.syncSurfaceResourceAccounting();
  let allocatedCanvases = 0;
  const context = vm.createContext({
    runtimeState,
    getRenderCacheOwner: () => renderCacheOwner,
    assertPopulationHeatmapReadyForExport: () => ({ ready: true, status: "disabled" }),
    filterCurrentEnabledRenderPasses: (names) => filterEnabledRenderPassNames(names),
    getRiverPaintRuntime,
    isThematicWgiActive, isPopulationActive,
    EXPORT_RENDER_BUDGET_BYTES,
    estimateExportRenderBytes: (input) => budgetExceeded
      ? EXPORT_RENDER_BUDGET_BYTES + 1
      : estimateExportRenderBytes(input),
    document: {
      createElement: () => {
        allocatedCanvases += 1;
        return {
          width: 0,
          height: 0,
          getContext() { return { canvas: this, setTransform() {}, clearRect() {} }; },
        };
      },
    },
    isHgoRuntimePreviewReady: () => hgo,
    hasVisibleRiverPartitions: () => riverVisible,
    getRiverInternalContourOwner: () => ({
      diagnostics() { calls.push(`river-${riverStatus}`); return { status: riverStatus }; },
    }),
    riverContourRenderOwner: riverScratch ? {
      dispose() {
        calls.push("river-scratch-dispose");
        scratchDisposals.push({ cache: runtimeState.renderPassCache, dpr: runtimeState.dpr });
      },
    } : null,
    getPaintContourRuntimeOwner: () => ({
      diagnostics() { calls.push(`contours-${contourStatus}`); return { status: contourStatus }; },
    }),
    getPoliticalBorderRuntimeOwner: () => ({
      diagnostics() { calls.push(`political-${politicalStatus}`); return { status: politicalStatus }; },
    }),
    getRenderPipelinePassesOwner: () => ({
      ensureIdleRenderPasses: () => calls.push("screen-pass"),
      getIdleRenderPassDefinitions: () => [
        ["background", () => calls.push("draw-source")],
        ["borders", () => calls.push("draw-contours")],
      ],
    }),
    getRenderPassCacheHostOwner: () => ({
      prepareRenderPassHost: ({ passName, drawFn }) => {
        calls.push(`render-${passName}-${runtimeState.dpr}`);
        if (failPass) throw new Error("pass failed");
        runtimeState.renderPassCache.canvases[passName] = {
          width: Math.round(runtimeState.width * runtimeState.dpr),
          height: Math.round(runtimeState.height * runtimeState.dpr),
        };
        drawFn();
        return { skipped: false };
      },
    }),
    setPassReferenceTransform: (name, transform) => {
      runtimeState.renderPassCache.referenceTransforms[name] = transform;
    },
    composeRenderPassesToTarget: (target, names, _transform, options) => {
      calls.push(`compose-${target.canvas?.width || 0}`);
      if (failComposition) return { ok: false, reason: "missing-pass" };
      if (options?.requireAllPasses) {
        assert.equal(runtimeState.renderPassCache.canvases[names[0]].width, 200);
      }
      return { ok: true };
    },
    commitRenderPassCacheState: (state, cache) => { state.renderPassCache = cache; },
    createDefaultRenderPassCacheState: () => ({ canvases: {}, referenceTransforms: {} }),
  });
  vm.runInContext(exportSource, context);
  return { run: context.renderExportPassesToCanvas, context, runtimeState, visibleCache, calls, scratchDisposals, resourceBudget,
    allocatedCanvases: () => allocatedCanvases };
}

for (const riverStatus of ["idle", "partial", "error"]) {
  test(`border export rejects ${riverStatus} river internal contours before allocation or cache mutation`, () => {
    const h = harness({ riverVisible: true, riverStatus, riverScratch: true });
    assert.throws(() => h.run(["borders"], { pixelRatio: 2 }), /River internal contours are not ready/);
    assert.equal(h.allocatedCanvases(), 0);
    assert.deepEqual(h.calls, ["contours-ready", `river-${riverStatus}`]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
    assert.equal(h.scratchDisposals.length, 0, "readiness failure preserves the current visible scratch");
  });
}

test("border export without visible river partitions does not depend on local contour readiness", () => {
  const h = harness({ riverStatus: "error" });
  assert.equal(h.run(["borders"], { pixelRatio: 2 }).width, 200);
  assert.deepEqual(h.calls, ["contours-ready", "political-ready", "render-borders-2", "draw-contours", "compose-200"]);
});

for (const [name, options, failure] of [
  ["successful export", {}, null],
  ["pass throw", { failPass: true }, /pass failed/],
  ["composition failure", { failComposition: true }, /Export composition failed/],
]) {
  test(`target-resolution river export disposes scratch after restoring the visible cache on ${name}`, () => {
    const h = harness({ riverVisible: true, riverScratch: true, ...options });
    if (failure) assert.throws(() => h.run(["borders"], { pixelRatio: 2 }), failure);
    else assert.equal(h.run(["borders"], { pixelRatio: 2 }).width, 200);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
    assert.equal(h.scratchDisposals.length, 1);
    assert.equal(h.scratchDisposals[0].cache, h.visibleCache, "cleanup follows cache restoration");
    assert.equal(h.scratchDisposals[0].dpr, 1, "cleanup follows DPR restoration");
    assert.equal(h.calls.at(-1), "river-scratch-dispose");
  });
}

for (const politicalStatus of ["pending", "error"]) {
  test(`border export rejects ${politicalStatus} political borders before allocation or cache mutation`, () => {
    const h = harness({ politicalStatus });
    assert.throws(() => h.run(["background", "borders"], { pixelRatio: 2 }),
      new RegExp(`Political borders are ${politicalStatus}`));
    assert.equal(h.allocatedCanvases(), 0);
    assert.deepEqual(h.calls, ["contours-ready", `political-${politicalStatus}`]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
    assert.equal(h.visibleCache.canvases.background.width, 100);
    assert.equal(h.resourceBudget.snapshot().categories.bitmaps, 100 * 50 * 4);
  });
}

test("disabled export passes use the active set and temporary surfaces leave only visible bytes", () => {
  const h = harness();
  const output = h.run(["background", "effects", "physicalBase"], { pixelRatio: 2 });
  assert.equal(output.width, 200);
  assert.deepEqual(h.calls, ["render-background-2", "draw-source", "compose-200"]);
  assert.equal(h.resourceBudget.snapshot().categories.bitmaps, 100 * 50 * 4);
});

for (const passName of ["political", "borders"]) {
  test(`${passName} export rejects loading river partitions before allocation or cache mutation`, () => {
    const h = harness();
    const runtime = getRiverPaintRuntime(h.runtimeState);
    runtime.enable(() => new Promise(() => {}));
    try {
      assert.throws(() => h.run([passName], { pixelRatio: 2 }), /River partitions are still loading/);
      assert.equal(h.allocatedCanvases(), 0);
      assert.deepEqual(h.calls, []);
      assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
      assert.equal(h.runtimeState.dpr, 1);
    } finally {
      runtime.cancel();
    }
  });
}

test("2x export redraws passes at target pixels and restores visible cache", () => {
  const h = harness();
  const result = h.run(["background"], { pixelRatio: 2 });
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
  assert.deepEqual(h.calls, ["render-background-2", "draw-source", "compose-200"]);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
  assert.equal(h.runtimeState.dpr, 1);
  assert.equal(h.visibleCache.canvases.background.width, 100);
});

test("matching screen and target DPR still redraws exact pass geometry", () => {
  const h = harness({ screenDpr: 2 });
  const result = h.run(["background"], { pixelRatio: 2 });
  assert.equal(result.width, 200);
  assert.deepEqual(h.calls, ["render-background-2", "draw-source", "compose-200"]);
  assert.equal(h.runtimeState.dpr, 2);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

test("4x full export is rejected by pass memory estimate before canvas allocation", () => {
  const estimate = estimateExportRenderBytes({
    width: 1280,
    height: 720,
    pixelRatio: 4,
    passNames: ["background", "physicalBase", "political", "contextBase", "contextScenario", "effects", "lineEffects", "contextMarkers", "dayNight", "borders", "textureLabels", "labels"],
  });
  assert.ok(estimate > EXPORT_RENDER_BUDGET_BYTES);
  const h = harness({ budgetExceeded: true });
  assert.throws(() => h.run(["background"], { pixelRatio: 4 }), /Export render budget exceeded/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

for (const [name, options, message] of [
  ["pass error", { failPass: true }, /pass failed/],
  ["composition error", { failComposition: true }, /Export composition failed/],
]) {
  test(`export restores visible cache after ${name}`, () => {
    const h = harness(options);
    assert.throws(() => h.run(["background"], { pixelRatio: 2 }), message);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
    assert.equal(h.visibleCache.canvases.background.width, 100);
    assert.equal(h.resourceBudget.snapshot().categories.bitmaps, 100 * 50 * 4);
  });
}

// Exercise the actual synchronous export entry, not a copy of the readiness guard.
for (const contourStatus of ["building", "error"]) {
  test(`border export rejects ${contourStatus} contours before allocation or cache mutation`, () => {
    const h = harness({ contourStatus });
    assert.throws(() => h.run(["background", "borders"], { pixelRatio: 2 }),
      new RegExp(`Paint contours are ${contourStatus}`));
    assert.equal(h.allocatedCanvases(), 0);
    assert.deepEqual(h.calls, [`contours-${contourStatus}`]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

for (const contourStatus of ["ready", "empty"]) {
  test(`border export accepts a ${contourStatus} contour graph at exact target resolution`, () => {
    const h = harness({ contourStatus });
    const canvas = h.run(["borders"], { pixelRatio: 2 });
    assert.equal(canvas.width, 200);
    assert.deepEqual(h.calls, [`contours-${contourStatus}`, "political-ready", "render-borders-2", "draw-contours", "compose-200"]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

test("HGO vector export does not depend on the separate land-contour worker", () => {
  const h = harness({ hgo: true, contourStatus: "error" });
  assert.ok(h.run(["borders"], { pixelRatio: 2 }));
  assert.deepEqual(h.calls, ["render-borders-2", "draw-contours", "compose-200"]);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

const toolbarSource = readFileSync(new URL("../js/ui/toolbar.js", import.meta.url), "utf8");
const compositeStart = toolbarSource.indexOf("  const buildCompositeSourceCanvas = async");
const compositeEnd = toolbarSource.indexOf("  const buildSingleExportSourceCanvas = async", compositeStart);
assert.ok(compositeStart >= 0 && compositeEnd > compositeStart);

for (const pixelRatio of [null, 2]) {
  test(`composite source owns one renderer canvas with ordered SVG overlays at ${pixelRatio ?? "screen"} resolution`, async () => {
    const h = harness();
    const events = [];
    const context = vm.createContext({
      ensureThematicWgiReadyForExport: async () => {},
      ensureScenarioPoliticalDetailForExport: async () => events.push("detail-ready"),
      ensurePaintContoursReady: async () => events.push("contours-ready"),
      ensureCountryLabelsReadyForExport: async () => events.push("labels-ready"),
      resolveExportPassSequence: () => ["background", "labels"],
      RENDER_PASS_NAMES: ["background", "labels"],
      SVG_ANNOTATION_VIEWPORT_SELECTOR: ".annotation-layer",
      renderExportPassesToCanvas: h.run,
      createExportError: (_kind, message) => new Error(message),
      drawSvgLayerToCanvas: async (canvas, ctx, options) => {
        assert.equal(ctx.canvas, canvas);
        (canvas.overlays ??= []).push(options.onlyViewportSelector);
      },
    });
    vm.runInContext(`${toolbarSource.slice(compositeStart, compositeEnd)}\nthis.buildComposite = buildCompositeSourceCanvas;`, context);
    const dimensions = pixelRatio === null ? null : { pixelRatio };
    const result = await context.buildComposite({ textVisibility: { "svg-annotations": true, "special-zones": true } }, dimensions);
    assert.equal(h.allocatedCanvases(), 1);
    assert.equal(result.width, pixelRatio === null ? 100 : 200);
    assert.deepEqual(result.overlays, [".annotation-layer", ".special-zones-layer"]);
    assert.deepEqual(events, ["detail-ready", "contours-ready", "labels-ready"]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.visibleCache.canvases.background.overlays, undefined);
    const rasterOnly = await context.buildComposite({ textVisibility: {} }, dimensions);
    assert.notEqual(rasterOnly, result);
    assert.equal(rasterOnly.overlays, undefined);
    assert.equal(h.allocatedCanvases(), 2);
  });
}

test("export budget reserves both regional bathymetry mask surfaces only with a background pass", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["background"] };
  assert.ok(estimateExportRenderBytes({ ...input, bathymetryCoverage: true })
    >= estimateExportRenderBytes(input) + 100 * 80 * 4 * 8);
  const withoutBackground = { ...input, passNames: ["labels"] };
  assert.equal(estimateExportRenderBytes({ ...withoutBackground, bathymetryCoverage: true }),
    estimateExportRenderBytes(withoutBackground));
});

test("physical brush exports account for scratch pixels and inverse projection cache", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["physicalBase"] };
  assert.ok(estimateExportRenderBytes({ ...input, physicalIntensity: true }) > estimateExportRenderBytes(input) + 100 * 80 * 4 * 8);
});

function thematicExportHarness({ status = "ready", language = "en", waitForData = null, metricId, scenarioId = "modern_world" } = {}) {
  const style = normalizeThematicWgiStyle({ enabled: true, metricId });
  const { enabled, ...identity } = style;
  const runtimeState = { activeScenarioId: scenarioId, styleConfig: { thematic: style },
    thematicWgiRuntime: { status, data: { ...identity, supportedScenarios: THEMATIC_WGI_SCENARIO_IDS }, revision: 1 }, currentLanguage: language,
    width: 100, height: 50, colorCanvas: { width: 100, height: 50 } };
  const events = [];
  const cache = new Map();
  const exportUi = { visibility: { background: true, political: true, context: false, effects: false }, textVisibility: {} };
  const createCanvas = () => {
    const canvas = { width: 100, height: 50, legendTexts: [] };
    const ctx = { save() {}, restore() {}, setTransform() {}, fillRect() {}, strokeRect() {},
      measureText: (text) => ({ width: text.length * 6 }),
      fillText(text) { canvas.legendTexts.push(text); },
      drawImage(source) { canvas.legendTexts.push(...(source.legendTexts || [])); } };
    canvas.getContext = () => ctx;
    return canvas;
  };
  const context = vm.createContext({
    runtimeState, document: { getElementById: () => null, createElement: createCanvas },
    ensureExportWorkbenchUiState: () => exportUi,
    ensureScenarioPoliticalDetailForExport: async () => events.push("detail"),
    ensurePaintContoursReady: async () => events.push("contours"),
    ensureCountryLabelsReadyForExport: async () => events.push("labels-ready"),
    isThematicWgiRequested, isThematicWgiActive, getThematicWgiSignature,
    getPopulationViewModel, isPopulationActive, getPopulationSignature, drawPopulationExportLegend,
    ensureThematicWgiData: async () => {
      events.push("readiness");
      if (waitForData) { await waitForData; runtimeState.thematicWgiRuntime.status = "ready"; }
    },
    getExportBakeVisibilitySignature: (ui) => JSON.stringify(ui),
    getBakePassNamesForLayer, EXPORT_MAIN_LAYER_MODEL_BY_ID, resolveExportPassSequence,
    RENDER_PASS_NAMES: ["background", "physicalBase", "political", "labels"],
    renderExportPassesToCanvas: (passes) => {
      events.push(`render:${passes.join(",")}`);
      return createCanvas();
    },
    createExportError: (code, message) => Object.assign(new Error(message), { code }),
    drawThematicWgiExportLegend, exportBakeCache: cache, writeBakeArtifactMeta() {},
    SVG_ANNOTATION_VIEWPORT_SELECTOR: ".annotation-layer", drawSvgLayerToCanvas: async () => {},
  });
  const dependencyStart = toolbarSource.indexOf("  const computeBakeHash =");
  const dependencyEnd = toolbarSource.indexOf("  const SVG_ANNOTATION_VIEWPORT_SELECTOR =", dependencyStart);
  const bakeStart = toolbarSource.indexOf("  const ensureThematicWgiReadyForExport =");
  const bakeEnd = toolbarSource.indexOf("  const applyExportAdjustmentsToCanvas =", bakeStart);
  const singleEnd = toolbarSource.indexOf("  const getSelectedExportScale =", compositeEnd);
  assert.ok(dependencyStart >= 0 && dependencyEnd > dependencyStart && bakeStart >= 0 && bakeEnd > bakeStart && singleEnd > compositeEnd);
  vm.runInContext(`${toolbarSource.slice(dependencyStart, dependencyEnd)}
    ${toolbarSource.slice(bakeStart, bakeEnd)}
    ${toolbarSource.slice(compositeStart, singleEnd)}
    this.bake = bakeLayer; this.composite = buildCompositeSourceCanvas;
    this.single = buildSingleExportSourceCanvas; this.dependencies = getLayerDependencyRevision;
    this.hash = computeBakeHash;`, context);
  return { context, runtimeState, events, cache, exportUi, createCanvas };
}

const thematicExportPaths = [
  ["composite", (h) => h.context.composite(h.exportUi)],
  ["single political", (h) => h.context.single(h.exportUi, "political")],
  ["color bake", (h) => h.context.bake("color", h.exportUi)],
  ["composite bake", (h) => h.context.bake("composite", h.exportUi)],
];

for (const [name, run] of thematicExportPaths) {
  for (const { metric, scenarioId } of THEMATIC_WGI_SCENARIO_IDS.flatMap((scenarioId) => THEMATIC_INDICATORS.map((metric) => ({ metric, scenarioId })))) {
    test(`${name} exports ${metric.labelEn} for ${scenarioId} with matching bins and source caption`, async () => {
      const h = thematicExportHarness({ metricId: metric.id, scenarioId });
      const canvas = await run(h);
      assert.ok(h.events.indexOf("readiness") < h.events.findIndex((event) => event.startsWith("render:")));
      assert.equal(canvas.legendTexts.filter((text) => text === metric.attribution).length, 1);
      assert.ok(canvas.legendTexts.join(" ").includes(`${metric.labelEn} · ${metric.year}`));
      assert.ok(canvas.legendTexts.includes("Source missing"));
      assert.ok(canvas.legendTexts.includes(metric.labels.at(-1)));
      if (scenarioId !== "modern_world") {
        assert.ok(canvas.legendTexts.join(" ").includes(`${metric.year} reference mapping, not a measurement for the scenario year.`));
      }
    });
  }

  for (const language of ["en", "zh"]) {
    test(`${name} rejects failed WGI in ${language} before rendering`, async () => {
      const h = thematicExportHarness({ status: "failed", language });
      await assert.rejects(run(h), language === "zh" ? /专题数据不可用/ : /Thematic data is unavailable/);
      assert.equal(h.events.some((event) => event.startsWith("render:")), false);
      assert.equal(h.cache.size, 0);
    });
  }

  test(`${name} waits for pending WGI before exporting political paint`, async () => {
    let resolve;
    const waitForData = new Promise((yes) => { resolve = yes; });
    const h = thematicExportHarness({ status: "loading", waitForData });
    const result = run(h);
    await new Promise((yes) => setImmediate(yes));
    assert.equal(h.events.some((event) => event.startsWith("render:")), false);
    resolve();
    assert.ok((await result).legendTexts.includes("Government effectiveness · 2024"));
  });
}

test("exports without political paint ignore unavailable WGI", async () => {
  const h = thematicExportHarness({ status: "failed" });
  h.exportUi.visibility.political = false;
  const canvases = await Promise.all([
    h.context.composite(h.exportUi), h.context.single(h.exportUi, "background"),
    h.context.bake("color", h.exportUi), h.context.bake("line", h.exportUi),
    h.context.bake("text", h.exportUi),
  ]);
  assert.equal(h.events.includes("readiness"), false);
  assert.ok(canvases.every((canvas) => canvas.legendTexts.length === 0));
});

test("color bake checks readiness before returning even an otherwise matching cache entry", async () => {
  const h = thematicExportHarness({ status: "failed" });
  const dependencies = h.context.dependencies("color", h.exportUi);
  const canvas = h.createCanvas();
  h.cache.set("color", { hash: h.context.hash(["color", "100x50", ...dependencies]), canvas });
  await assert.rejects(h.context.bake("color", h.exportUi), /Thematic data is unavailable/);
  assert.equal(h.cache.get("color").canvas, canvas);
  assert.equal(h.events.some((event) => event.startsWith("render:")), false);
});

for (const layer of ["color", "composite"]) {
  test(`${layer} bake invalidates cached political output when WGI revision, language or selection changes`, async () => {
    const h = thematicExportHarness();
    const first = await h.context.bake(layer, h.exportUi);
    assert.equal(await h.context.bake(layer, h.exportUi), first);
    h.runtimeState.thematicWgiRuntime.revision += 1;
    const revised = await h.context.bake(layer, h.exportUi);
    assert.notEqual(revised, first);
    h.runtimeState.currentLanguage = "zh";
    const chinese = await h.context.bake(layer, h.exportUi);
    assert.notEqual(chinese, revised);
    assert.ok(chinese.legendTexts.includes("政府效能 · 2024"));
    h.runtimeState.styleConfig.thematic.metricId = "wgi_rule_of_law_score_0_100";
    await assert.rejects(h.context.bake(layer, h.exportUi), /专题数据不可用/);
    h.runtimeState.thematicWgiRuntime.data = { ...h.runtimeState.thematicWgiRuntime.data,
      metricId: "wgi_rule_of_law_score_0_100" };
    const ruleOfLaw = await h.context.bake(layer, h.exportUi);
    assert.notEqual(ruleOfLaw, chinese);
    assert.ok(ruleOfLaw.legendTexts.includes("法治 · 2024"));
    assert.equal(ruleOfLaw.legendTexts.includes("政府效能 · 2024"), false);
    h.runtimeState.activeScenarioId = "hoi4_1939";
    const historical = await h.context.bake(layer, h.exportUi);
    assert.notEqual(historical, ruleOfLaw);
    assert.ok(historical.legendTexts.includes("2024 参考映射，非剧本年代测量值。"));
    h.runtimeState.scenarioBaselineOwnersByFeatureId = { austria: "GER" };
    assert.notEqual(await h.context.bake(layer, h.exportUi), historical);
    h.runtimeState.styleConfig.thematic.enabled = false;
    const disabled = await h.context.bake(layer, h.exportUi);
    assert.notEqual(disabled, ruleOfLaw);
    assert.deepEqual(disabled.legendTexts, []);
  });
}

function populationExportHarness({ mode = "density", statsWait = null, statsFailure = false,
  tilesWait = null, tilesFailure = false } = {}) {
  const h = thematicExportHarness({ scenarioId: "tno_1962" });
  const geometryVersion = "a".repeat(64);
  const state = h.runtimeState;
  state.styleConfig.thematic.enabled = false;
  state.styleConfig.population = normalizePopulationStyle({ enabled: true, mode });
  state.activeScenarioManifest = { source: { runtime_topology_sha256: geometryVersion } };
  state.scenarioBaselineOwnersByFeatureId = Object.freeze({ A: "AA" });
  state.zoomTransform = { k: 4, x: 0, y: 0 };
  const projection = Object.assign((point) => point, { invert: (point) => point });
  const data = { layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION, year: 2020,
    scenarioId: state.activeScenarioId, geometryVersion, byFeatureId: Object.freeze({ A: Object.freeze({
      feature_id: "A", population: 0, density: 0, land_area_km2: 1, coverage_fraction: 1, status: "ok", source_epoch: 2020 }) }),
    counts: { features: 1 }, raster: { overview_url: "overview.json", detail_tiles: [
      { id: "visible", url: "visible.json", bounds: [-10_000_000, -10_000_000, 10_000_000, 10_000_000] },
      { id: "far", url: "far.json", bounds: [100_000_000, 100_000_000, 120_000_000, 120_000_000] },
    ] } };
  const heatmapOwner = createPopulationHeatmapRenderOwner({ state, getters: {
    getSnapshot: () => getPopulationHeatmapSnapshot(state), getProjection: () => projection,
    getMaskInfo: () => ({ collection: { type: "FeatureCollection", features: [] } }),
  } });
  h.context.ensurePopulationData = (target, options) => ensurePopulationData(target, { ...options,
    loadData: async () => {
      h.events.push("population-statistics");
      if (statsWait) await statsWait;
      if (statsFailure) throw new Error("statistics offline");
      return data;
    } });
  h.context.ensurePopulationHeatmapData = (target, options) => ensurePopulationHeatmapData(target, { ...options,
    loadTiles: async (_raster, request) => {
      h.events.push(`population-tiles:${request.detailTileIds.join(",")}`);
      if (tilesWait) await tilesWait;
      if (tilesFailure) throw new Error("viewport tiles offline");
      return { overview: { bounds: [0, 0, 1, 1] }, detail: request.detailTileIds.map((id) => ({ id })) };
    } });
  Object.assign(h.context, { isPopulationRequested, getPopulationHeatmapSnapshot, getPopulationViewportDetailTileIds, callRuntimeHook,
    rendererSurfaceHost: { getProjection: () => projection },
    invalidateRenderPasses: () => h.events.push("tile-invalidated"), requestRendererRender: () => {},
    assertPopulationHeatmapReadyForExport: () => heatmapOwner.assertReadyForExport(),
    RENDER_PASS_NAMES: ["background", "physicalBase", "political", "populationHeatmap", "labels"],
  });
  // Execute the actual renderer viewport-await entry with real runtime fences and readiness.
  const readyStart = source.indexOf("function preparePopulationViewportData()");
  const readyEnd = source.indexOf("function drawPopulationHeatmapPass", readyStart);
  assert.ok(readyStart > 0 && readyEnd > readyStart);
  vm.runInContext(source.slice(readyStart, readyEnd).replace("export async function", "async function"), h.context);
  return h;
}

for (const [name, run] of thematicExportPaths) {
  for (const mode of ["density", "heatmap"]) {
    test(`population ${name} exports ${mode} with 2020 source and correct density denominator`, async () => {
      const h = populationExportHarness({ mode });
      const canvas = await run(h);
      assert.ok(canvas.legendTexts.includes("Population density · 2020"));
      assert.ok(canvas.legendTexts.includes("Not a scenario-year estimate"));
      assert.ok(canvas.legendTexts.includes("Epoch 2020 · CC BY 4.0"));
      assert.ok(canvas.legendTexts.some((text) => text.includes(mode === "heatmap" ? "valid raster area" : "modelled land")));
      if (mode === "heatmap") {
        assert.ok(h.events.includes("population-tiles:visible"));
        assert.equal(h.events.includes("population-tiles:visible,far"), false);
      }
    });
  }
  test(`population ${name} awaits pending full statistics before drawing`, async () => {
    let resolve; const statsWait = new Promise((yes) => { resolve = yes; });
    const h = populationExportHarness({ statsWait }); const output = run(h);
    await new Promise((yes) => setImmediate(yes));
    assert.equal(h.events.some((event) => event.startsWith("render:")), false);
    resolve(); assert.ok((await output).legendTexts.includes("Population density · 2020"));
  });
  test(`population ${name} rejects unavailable full statistics before drawing or caching`, async () => {
    const h = populationExportHarness({ statsFailure: true });
    await assert.rejects(run(h), /Population data is unavailable/);
    assert.equal(h.events.some((event) => event.startsWith("render:")), false);
    assert.equal(h.cache.size, 0);
  });
  test(`population ${name} waits for the current viewport heatmap detail before drawing`, async () => {
    let resolve; const tilesWait = new Promise((yes) => { resolve = yes; });
    const h = populationExportHarness({ mode: "heatmap", tilesWait }); const output = run(h);
    await new Promise((yes) => setImmediate(yes));
    assert.ok(h.events.includes("population-tiles:visible"));
    assert.equal(h.events.some((event) => event.startsWith("render:")), false);
    resolve(); assert.ok(await output);
  });
  test(`population ${name} rejects failed heatmap tiles before drawing or caching`, async () => {
    const h = populationExportHarness({ mode: "heatmap", tilesFailure: true });
    await assert.rejects(run(h), /Population heatmap detail loading failed: viewport tiles offline/);
    assert.equal(h.events.some((event) => event.startsWith("render:")), false);
    assert.equal(h.cache.size, 0);
  });
}


function activateReferenceDisplay(state, mode) {
  if (mode === "thematic") {
    const selection = normalizeThematicWgiStyle({ enabled: true });
    state.styleConfig = { thematic: selection };
    state.thematicWgiRuntime = { status: "ready", data: { ...selection, supportedScenarios: [state.activeScenarioId] } };
    assert.equal(isThematicWgiActive(state), true);
  } else if (mode !== "ordinary") {
    state.styleConfig = { population: normalizePopulationStyle({ enabled: true, mode }) };
    state.activeScenarioManifest = { source: { runtime_topology_sha256: "geometry-current" } };
    state.populationRuntime = { status: "ready", data: { layerId: POPULATION_LAYER_ID,
      dataVersion: POPULATION_DATA_VERSION, year: 2020, scenarioId: state.activeScenarioId, geometryVersion: "geometry-current" } };
    assert.equal(isPopulationActive(state), true);
  }
}

function installContourPreparation(h) {
  const functionSource = source.match(/async function ensurePaintContoursReady\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource);
  const calls = [];
  h.context.getPaintContourRuntimeOwner = () => ({ ensureReady: async () => calls.push("political-paint-contours") });
  h.context.getRiverInternalContourOwner = () => ({ ensureReady: async () => calls.push("river-internal-contours") });
  vm.runInContext(functionSource, h.context);
  return { calls, prepare: h.context.ensurePaintContoursReady };
}

for (const badPack of ["baseline-mismatch", "missing-geometry"]) {
  for (const mode of ["ordinary", "thematic", "density", "heatmap"]) {
    test(`${mode} contour preparation ${mode === "ordinary" ? "rejects" : "ignores hidden"} ${badPack} river partitions`, async () => {
      const h = harness();
      const { state } = await makeFixture();
      Object.assign(h.runtimeState, state);
      if (badPack === "baseline-mismatch") h.runtimeState.scenarioBaselineHash = "different-baseline";
      else h.runtimeState.landIndex = new Map();
      activateReferenceDisplay(h.runtimeState, mode);
      const preparation = installContourPreparation(h);
      if (mode === "ordinary") {
        await assert.rejects(preparation.prepare(), /Saved river partitions|River partition geometry is not ready/);
        assert.deepEqual(preparation.calls, []);
      } else {
        await preparation.prepare();
        assert.deepEqual(preparation.calls, ["political-paint-contours"]);
      }
    });
    test(`${mode} border export ${mode === "ordinary" ? "rejects" : "ignores hidden"} ${badPack} river partitions without losing political preparation`, async () => {
      const h = harness({ riverVisible: mode !== "ordinary", riverStatus: "error" });
      const { state } = await makeFixture();
      Object.assign(h.runtimeState, state);
      if (badPack === "baseline-mismatch") h.runtimeState.scenarioBaselineHash = "different-baseline";
      else h.runtimeState.landIndex = new Map();
      activateReferenceDisplay(h.runtimeState, mode);
      if (mode === "ordinary") {
        assert.throws(() => h.run(["borders"], { pixelRatio: 2 }), /Saved river partitions|River partition geometry is not ready/);
        assert.equal(h.allocatedCanvases(), 0);
        assert.deepEqual(h.calls, []);
      } else {
        assert.equal(h.run(["borders"], { pixelRatio: 2 }).width, 200);
        assert.deepEqual(h.calls, ["contours-ready", "political-ready", "render-borders-2", "draw-contours", "compose-200"]);
      }
    });
  }
}

test("ordinary contour preparation still waits for political and river internal contours", async () => {
  const h = harness();
  const preparation = installContourPreparation(h);
  await preparation.prepare();
  assert.deepEqual(preparation.calls, ["political-paint-contours", "river-internal-contours"]);
});


async function holdRiverLoadingForToolbar(h, t) {
  const runtime = getRiverPaintRuntime(h.runtimeState);
  let finish;
  const task = runtime.enable(() => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.diagnostics().status, "loading");
  t.after(async () => { runtime.cancel(); finish(null); await task; });
  const preparation = installContourPreparation(h);
  h.context.getRiverPaintRuntime = getRiverPaintRuntime;
  h.context.isHgoRuntimePreviewReady = () => false;
  h.context.ensurePaintContoursReady = async () => {
    h.events.push("contours");
    await preparation.prepare();
  };
  return preparation;
}

for (const [name, run] of thematicExportPaths) {
  test(`${name} awaits loading thematic data before contour readiness can reject the hidden loading river`, async (t) => {
    let finish; const waitForData = new Promise(resolve => { finish = resolve; });
    const h = thematicExportHarness({ status: "loading", waitForData });
    const preparation = await holdRiverLoadingForToolbar(h, t);
    const result = run(h);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.events.includes("readiness"), true);
    assert.equal(h.events.includes("contours"), false);
    finish(); await result;
    assert.ok(h.events.indexOf("readiness") < h.events.indexOf("contours"));
    assert.ok(h.events.indexOf("contours") < h.events.indexOf("labels-ready"));
    assert.ok(preparation.calls.length > 0);
    assert.ok(preparation.calls.every(value => value === "political-paint-contours"));
  });
  for (const mode of ["density", "heatmap"]) {
    test(`${name} awaits loading population ${mode} before contour readiness can reject the hidden loading river`, async (t) => {
      let finish; const statsWait = new Promise(resolve => { finish = resolve; });
      const h = populationExportHarness({ mode, statsWait });
      const preparation = await holdRiverLoadingForToolbar(h, t);
      const result = run(h);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.events.includes("population-statistics"), true);
      assert.equal(h.events.includes("contours"), false);
      finish(); await result;
      assert.ok(h.events.indexOf("population-statistics") < h.events.indexOf("contours"));
      assert.ok(h.events.indexOf("contours") < h.events.indexOf("labels-ready"));
      assert.ok(preparation.calls.length > 0);
      assert.ok(preparation.calls.every(value => value === "political-paint-contours"));
    });
  }
  test(`${name} preserves failed thematic loading errors ahead of hidden river preparation`, async (t) => {
    const h = thematicExportHarness({ status: "failed" });
    await holdRiverLoadingForToolbar(h, t);
    await assert.rejects(run(h), /Thematic data is unavailable/);
    assert.equal(h.events.includes("contours"), false);
    assert.equal(h.events.some(value => value.startsWith("render:")), false);
  });
}

test("text-only bake does not fetch unavailable thematic or population data", async () => {
  const h = populationExportHarness({ statsFailure: true });
  h.runtimeState.styleConfig.thematic = normalizeThematicWgiStyle({ enabled: true });
  h.runtimeState.thematicWgiRuntime.status = "failed";
  h.exportUi.textVisibility = { "render-labels": true };
  await h.context.bake("text", h.exportUi);
  assert.equal(h.events.includes("population-statistics"), false);
  assert.equal(h.events.includes("readiness"), false);
  assert.ok(h.events.indexOf("contours") < h.events.indexOf("labels-ready"));
});
