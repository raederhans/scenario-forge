import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { strFromU8, unzipSync } from "../vendor/fflate.browser.js";
import {
  buildExportArtifactManifest,
  buildExportArtifactPackage,
} from "../js/core/export_artifact_package.js";
import {
  EXPORT_FAILURE_KINDS,
  classifyExportFailure,
  createExportFailureToastHandler,
} from "../js/ui/toolbar/export_failure_handler.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { replaceExportWorkbenchUiState } from "../js/core/state/ui_state.js";
import {
  createExportWorkbenchController,
  getExportPreviewSourceKey,
  ensureExportWorkbenchUiState,
  getExportAnnotationCountSummary,
  getExportAnnotationFamilyCounts,
  resolveExportPassSequence,
} from "../js/ui/toolbar/export_workbench_controller.js";
import {
  buildBakePackMetadata,
  buildBakePackPackageFiles,
  buildExportAdjustmentFilter,
  buildExportArtifactProjectContext,
  buildExportArtifactScenarioContext,
  buildExportUiManifestSnapshot,
  buildPerLayerExportPlan,
  buildPerLayerPackageFiles,
  getBakePackLayerIds,
  getBakePassNamesForLayer,
  resolveExportBaseDimensions,
} from "../js/ui/toolbar/export_artifact_model.js";

function createExportWorkbenchControllerDependencies(overrides = {}) {
  return {
    state: {},
    t: (key) => key,
    showToast() {},
    showExportFailureToast() {},
    normalizeExportWorkbenchUiState,
    renderPassNames: [],
    buildCompositeSourceCanvas: async () => ({}),
    buildSingleExportSourceCanvas: async () => ({}),
    applyExportAdjustmentsToCanvas: (canvas) => canvas,
    buildPerLayerExportPackage: async () => ({}),
    buildBakePackPackage: async () => ({}),
    buildCompositeExportCanvas: async () => ({}),
    getSelectedExportScale: () => 2,
    triggerCanvasDownload() {},
    triggerBlobDownload() {},
    bakeLayer: async () => ({}),
    clearBakeCache() {},
    ...overrides,
  };
}

test("export artifact model projects deterministic canvas and pass inputs", () => {
  assert.deepEqual(resolveExportBaseDimensions(2, 0, 0, 2400, 1200), { width: 1200, height: 600 });
  assert.equal(buildExportAdjustmentFilter({
    adjustments: { brightness: 125, contrast: 110, saturation: 80, clarity: 150 },
  }), "brightness(1.250) contrast(1.166) saturate(0.800)");
  assert.equal(buildExportAdjustmentFilter({
    adjustments: { brightness: 0, contrast: 0, saturation: 0, clarity: 0 },
  }), "brightness(0.000) contrast(0.000) saturate(0.000)");
  assert.equal(buildExportAdjustmentFilter({
    adjustments: { brightness: null, contrast: "", saturation: undefined, clarity: "invalid" },
  }), "brightness(1.000) contrast(1.000) saturate(1.000)");

  const exportUi = {
    visibility: { background: true, political: true, context: false, effects: true },
    textVisibility: { "render-labels": false },
  };
  assert.deepEqual(getBakePassNamesForLayer("color", exportUi), [
    "background",
    "physicalBase",
    "political",
    "populationHeatmap",
    "effects",
    "dayNight",
  ]);
  assert.deepEqual(getBakePassNamesForLayer("composite", exportUi, {
    resolvePassSequence: () => ["background", "labels", "borders"],
    renderPassNames: ["background", "labels", "borders"],
  }), ["background", "borders"]);
});

test("export artifact model builds defensive package projections", () => {
  const exportUi = {
    target: "composite",
    format: "png",
    scale: "2",
    layerOrder: ["background", "effects"],
    visibility: { background: true, effects: true },
    textVisibility: { "render-labels": true, "svg-annotations": true },
    adjustments: { brightness: 100 },
    bakeArtifacts: [{ layerId: "color" }],
  };
  assert.deepEqual(getBakePackLayerIds(exportUi), ["color", "line", "text", "composite"]);
  assert.deepEqual(buildPerLayerExportPlan(exportUi), [
    { id: "background" },
    { id: "effects" },
    { id: "svg-annotations" },
  ]);
  assert.deepEqual(buildExportArtifactScenarioContext("tno_1962", 3, "baseline-1"), {
    id: "tno_1962",
    version: 3,
    baselineHash: "baseline-1",
  });
  assert.deepEqual(buildExportArtifactProjectContext(4, 5, 6), {
    dirtyRevision: 4,
    colorRevision: 5,
    topologyRevision: 6,
  });

  const snapshot = buildExportUiManifestSnapshot(exportUi);
  exportUi.layerOrder.push("political");
  exportUi.visibility.background = false;
  assert.deepEqual(snapshot.layerOrder, ["background", "effects"]);
  assert.equal(snapshot.visibility.background, true);

  const canvas = { width: 20, height: 10 };
  const blob = { type: "application/json" };
  assert.deepEqual(buildPerLayerPackageFiles([{ id: "background", canvas }]), [{
    path: "layers/map_layer_background.png",
    role: "layer",
    mime: "image/png",
    canvas,
  }]);
  assert.deepEqual(buildBakePackMetadata(exportUi, [{ id: "color" }], "2026-08-15T00:00:00.000Z").files, [
    "map_bake_color.png",
  ]);
  assert.deepEqual(buildBakePackPackageFiles([
    { id: "color", canvas },
    { id: "metadata", blob, extension: "json", fileStem: "map_bake_manifest" },
  ]), [
    { path: "layers/map_bake_color.png", role: "bake-layer", mime: "image/png", canvas },
    { path: "map_bake_manifest.json", role: "legacy-metadata", mime: "application/json", blob },
  ]);
});

test("export workbench controller validates required notification dependencies at construction", () => {
  assert.throws(
    () => createExportWorkbenchController(createExportWorkbenchControllerDependencies({ showToast: undefined })),
    /createExportWorkbenchController requires showToast to be a function\./,
  );
  assert.throws(
    () => createExportWorkbenchController(createExportWorkbenchControllerDependencies({ showExportFailureToast: undefined })),
    /createExportWorkbenchController requires showExportFailureToast to be a function\./,
  );
  assert.throws(
    () => createExportWorkbenchController(createExportWorkbenchControllerDependencies({ buildCompositeSourceCanvas: undefined })),
    /createExportWorkbenchController requires buildCompositeSourceCanvas to be a function\./,
  );

  const controller = createExportWorkbenchController(createExportWorkbenchControllerDependencies());

  assert.equal(typeof controller.bindExportWorkbenchEvents, "function");
  assert.equal(typeof controller.renderExportWorkbenchUi, "function");
  assert.equal(typeof controller.setExportBakeArtifacts, "function");
});

test("export workbench controller commits detached bake artifact metadata through its state action", () => {
  const runtimeState = {};
  const artifacts = [{
    layerId: "color",
    dependencies: ["color-revision:1"],
    canvasSize: { width: 800, height: 600 },
    dirtyFlag: true,
  }];
  const controller = createExportWorkbenchController(
    createExportWorkbenchControllerDependencies({ state: runtimeState }),
  );

  controller.setExportBakeArtifacts(artifacts);
  artifacts[0].dependencies.push("caller-mutation");

  assert.deepEqual(runtimeState.exportWorkbenchUi.bakeArtifacts[0].dependencies, ["color-revision:1"]);
});

test("export failure handler exposes a construction-validated taxonomy presenter", () => {
  assert.throws(
    () => createExportFailureToastHandler({ t: (key) => key }),
    /createExportFailureToastHandler requires showToast to be a function\./,
  );
  const toasts = [];
  const presentFailure = createExportFailureToastHandler({
    t: (key) => key,
    showToast: (...args) => toasts.push(args),
  });

  assert.equal(presentFailure({ exportStage: "artifact" }), EXPORT_FAILURE_KINDS.ARTIFACT_FAILED);
  assert.equal(toasts[0][1].title, "Export failed · Artifact unavailable");
  assert.equal(classifyExportFailure({ exportStage: "artifact", message: "out of memory" }), EXPORT_FAILURE_KINDS.OUT_OF_MEMORY);
  assert.equal(presentFailure({ exportKind: "invalid-params", message: "Export pixel budget exceeded (7600x5000)." }), EXPORT_FAILURE_KINDS.INVALID_PARAMS);
  assert.match(toasts[1][0], /7600x5000/);
  assert.match(toasts[1][0], /8K/);
  assert.equal(presentFailure({ exportStage: "artifact", message: "Export render budget exceeded (900 MiB estimated for 12 passes; limit 640 MiB)." }), EXPORT_FAILURE_KINDS.OUT_OF_MEMORY);
  assert.match(toasts[2][0], /Reduce export resolution/);
  assert.doesNotMatch(toasts[2][0], /passes|MiB/);
});

test("export workbench state normalizes legacy visibility and text aliases", () => {
  const normalized = normalizeExportWorkbenchUiState({
    target: "per-layer-png",
    layerVisibility: { paint: false, borders: true },
    textVisibility: {
      annotations: false,
      specialzones: true,
      text: false,
    },
    includeTextLayer: true,
    previewSource: "annotations",
    scale: "10",
    adjustments: {
      brightness: 240,
      contrast: -20,
      saturation: 143,
      clarity: 99,
    },
  });

  assert.equal(normalized.target, "per-layer");
  assert.equal(normalized.visibility.political, false);
  assert.equal(normalized.visibility.effects, true);
  assert.deepEqual(normalized.textVisibility, {
    "render-labels": false,
    "special-zones": true,
    "svg-annotations": false,
  });
  assert.equal(normalized.includeTextLayer, true);
  assert.equal(normalized.previewLayerId, "svg-annotations");
  assert.equal(normalized.scale, "2");
  assert.deepEqual(normalized.adjustments, {
    brightness: 200,
    contrast: 0,
    saturation: 143,
    clarity: 99,
  });
});

test("export workbench preserves explicit zero adjustment values", () => {
  const state = {
    exportWorkbenchUi: {
      adjustments: { brightness: 0, contrast: 0, saturation: 0, clarity: 0 },
    },
  };

  const normalized = ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState);

  assert.deepEqual(normalized.adjustments, {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    clarity: 0,
  });
});

test("export workbench restores defaults for empty adjustment values", () => {
  const state = {
    exportWorkbenchUi: {
      adjustments: { brightness: "", contrast: "   ", saturation: null, clarity: undefined },
    },
  };

  const normalized = ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState);

  assert.deepEqual(normalized.adjustments, {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    clarity: 100,
  });

  const legacyNormalized = ensureExportWorkbenchUiState({
    exportWorkbenchUi: {
      brightness: null,
      contrast: undefined,
      saturation: "",
      clarity: "   ",
    },
  }, normalizeExportWorkbenchUiState);

  assert.deepEqual(legacyNormalized.adjustments, {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    clarity: 100,
  });
});

test("replaceExportWorkbenchUiState writes normalized export workbench state", () => {
  const target = {};
  const nextState = replaceExportWorkbenchUiState(target, {
    includeTextLayer: false,
    textVisibility: {
      svg: true,
    },
  });

  assert.equal(target.exportWorkbenchUi, nextState);
  assert.equal(nextState.includeTextLayer, true);
  assert.equal(nextState.textVisibility["svg-annotations"], true);
});

test("export workbench state normalizes layer order aliases and bake artifacts", () => {
  const normalized = normalizeExportWorkbenchUiState({
    layerOrder: ["paint", "background", "paint", "unknown"],
    bakeArtifacts: [
      {
        layerId: "color",
        updatedAt: 12.4,
        dependencies: ["a", "a", "b"],
        canvasSize: { width: 10.6, height: -3 },
      },
      { layerId: "unknown", dependencies: ["drop"] },
    ],
  });

  assert.deepEqual(normalized.layerOrder, ["political", "background", "context", "effects", "labels"]);
  assert.deepEqual(normalized.bakeArtifacts, [{
    layerId: "color",
    updatedAt: 12,
    dependencies: ["a", "b"],
    canvasSize: { width: 11, height: 0 },
    dirtyFlag: true,
  }]);
});

test("export pass sequence follows normalized order and visibility", () => {
  const passNames = ["background", "physicalBase", "political", "labels"];
  const sequence = resolveExportPassSequence({
    layerOrder: ["labels", "political", "background", "effects"],
    visibility: {
      labels: true,
      political: true,
      background: false,
      effects: true,
    },
  }, passNames);

  assert.deepEqual(sequence, ["labels", "physicalBase", "political"]);
});

test("export workbench state strips legacy runtime-only bake cache", () => {
  const existingCache = new Map([["color", { hash: "abc" }]]);
  const state = {
    exportWorkbenchUi: {
      bakeCache: existingCache,
      bakeArtifacts: [{ layerId: "text", dependencies: ["x", "x"], canvasSize: { width: 2, height: 3 } }],
    },
  };

  const normalized = ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState);

  assert.equal(Object.hasOwn(normalized, "bakeCache"), false);
  assert.equal(Object.hasOwn(state.exportWorkbenchUi, "bakeCache"), false);
  assert.deepEqual(normalized.bakeArtifacts, [{
    layerId: "text",
    updatedAt: 0,
    dependencies: ["x"],
    canvasSize: { width: 2, height: 3 },
    dirtyFlag: true,
  }]);

  const fromJson = ensureExportWorkbenchUiState(
    { exportWorkbenchUi: { bakeCache: {} } },
    normalizeExportWorkbenchUiState,
  );
  assert.equal(Object.hasOwn(fromJson, "bakeCache"), false);
});

test("export artifact package writes a zip manifest and payload files", async () => {
  const artifact = await buildExportArtifactPackage({
    artifactKind: "per-layer",
    fileStem: "map layers",
    scenario: { id: "tno_1962" },
    exportUi: { target: "per-layer" },
    files: [{
      path: "layers/political.png",
      role: "layer",
      mime: "image/png",
      text: "png-bytes",
    }],
  });
  const zipBytes = new Uint8Array(await artifact.blob.arrayBuffer());
  const entries = unzipSync(zipBytes);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));

  assert.equal(artifact.fileStem, "map-layers");
  assert.equal(manifest.artifactKind, "per-layer");
  assert.equal(manifest.scenario.id, "tno_1962");
  assert.equal(manifest.files[0].path, "layers/political.png");
  assert.equal(manifest.files[0].byteLength, 9);
  assert.equal(manifest.files[0].checksum, `sha256_${createHash("sha256").update("png-bytes").digest("hex")}`);
  assert.equal(strFromU8(entries["layers/political.png"]), "png-bytes");
});

test("export artifact package rejects payload manifest path collisions", async () => {
  await assert.rejects(
    () => buildExportArtifactPackage({
      artifactKind: "per-layer",
      files: [{
        path: "manifest.json",
        role: "metadata",
        mime: "application/json",
        text: "{}",
      }],
    }),
    /manifest path conflicts/
  );
});

test("export artifact manifest normalizes raw file entries", () => {
  const manifest = buildExportArtifactManifest({
    artifactKind: "project-json",
    files: [{
      path: "../Map Project.JSON",
      role: "Editable Project",
      mime: "application/json",
      byteLength: -1,
      dimensions: { width: "4.6", height: "bad" },
    }],
  });

  assert.equal(manifest.files[0].path, "map-project.json");
  assert.equal(manifest.files[0].role, "editable-project");
  assert.equal(manifest.files[0].mime, "application/json");
  assert.equal(Object.hasOwn(manifest.files[0], "byteLength"), false);
  assert.deepEqual(manifest.files[0].dimensions, { width: 5, height: 0 });
});

test("export annotation family counts use strategic overlay selectors", () => {
  const selectorCounts = new Map([
    [".frontline-overlay-layer path, .frontline-labels-layer .frontline-label", 3],
    [".operational-lines-layer .operational-line", 2],
    [".operation-graphics-layer .operation-graphic", 4],
    [".unit-counters-layer .unit-counter", 5],
  ]);
  const mapSvg = {
    querySelectorAll: (selector) => ({ length: selectorCounts.get(selector) || 0 }),
  };

  assert.deepEqual(getExportAnnotationFamilyCounts(mapSvg), {
    frontlines: 3,
    "operational-lines": 2,
    "operation-graphics": 4,
    "unit-counters": 5,
  });
  assert.deepEqual(getExportAnnotationCountSummary(mapSvg), {
    count: 14,
    summary: "Frontlines: 3 · Operational lines: 2 · Operation graphics: 4 · Unit counters: 5",
    counts: {
      frontlines: 3,
      "operational-lines": 2,
      "operation-graphics": 4,
      "unit-counters": 5,
    },
  });
});

test("export workbench controller renders annotation family summaries", () => {
  const source = readFileSync(new URL("../js/ui/toolbar/export_workbench_controller.js", import.meta.url), "utf8");
  assert.match(source, /const getTextLayerSummary = \(entry\) => \{/);
  assert.match(source, /entry\.familyCounts/);
  assert.match(source, /EXPORT_ANNOTATION_FAMILY_VIEW_MODELS/);
  assert.match(source, /export-workbench-layer-meta/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createState() {
  return {
    activeScenarioId: "scene-a", scenarioDataGeneration: 1, sceneGeneration: 1,
    renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
    colorRevision: 1, topologyRevision: 1, dirtyRevision: 1,
    width: 800, height: 600, dpr: 1, colorCanvas: { width: 800, height: 600 },
    zoomTransform: { k: 1, x: 0, y: 0 }, renderPhase: "idle", styleConfig: {},
    renderPassCache: { dirty: { background: false }, signatures: { background: "background-a" } },
    exportWorkbenchUi: normalizeExportWorkbenchUiState({ previewMode: "layer", previewLayerId: "background" }),
  };
}

function createHarness(t, overrides = {}) {
  const oldDocument = globalThis.document;
  const svg = { outerHTML: "<svg><text>A</text></svg>" };
  globalThis.document = { getElementById: () => svg };
  t.after(() => { globalThis.document = oldDocument; });
  const state = createState();
  const frames = [];
  const sources = [];
  const adjustments = [];
  const stage = { children: [], replaceChildren(...children) { this.children = children; } };
  const status = { textContent: "" };
  const build = async (ui) => { const canvas = { id: sources.length }; sources.push({ ui, canvas }); return canvas; };
  const controller = createExportWorkbenchController({
    state, t: (key) => key, showToast() {}, showExportFailureToast() {},
    normalizeExportWorkbenchUiState, renderPassNames: ["background"],
    exportWorkbenchPreviewStage: stage, exportWorkbenchPreviewState: status,
    exportWorkbenchOverlay: { classList: { toggle() {} }, setAttribute() {} },
    buildCompositeSourceCanvas: build, buildSingleExportSourceCanvas: build,
    applyExportAdjustmentsToCanvas(source, ui) {
      const canvas = { source, brightness: ui.adjustments.brightness, classList: { add() {} } };
      adjustments.push(canvas);
      return canvas;
    },
    bakeLayer() {}, clearBakeCache() {},
    requestPreviewFrame: (callback) => frames.push(callback),
    ...overrides,
  });
  return {
    state, controller, stage, status, svg, sources, adjustments, frames,
    async frame() {
      assert.ok(frames.length > 0, "a preview frame must be scheduled");
      frames.shift()(0);
      await new Promise(setImmediate);
    },
  };
}

test("preview collapses a burst into one source and one latest adjustment draw", async (t) => {
  const h = createHarness(t);
  const promises = [];
  for (const brightness of [100, 110, 120, 130, 140]) {
    h.state.exportWorkbenchUi.adjustments.brightness = brightness;
    promises.push(h.controller.renderExportWorkbenchPreview());
  }
  assert.equal(h.frames.length, 1);
  await h.frame();
  await Promise.all(promises);
  assert.equal(h.sources.length, 1);
  assert.equal(h.adjustments.length, 1);
  assert.equal(h.stage.children[0].brightness, 140);
});

test("raster previews reuse the source across SVG edits without serializing SVG", async (t) => {
  const h = createHarness(t);
  let svgReads = 0;
  let markup = "<svg><text>A</text></svg>";
  Object.defineProperty(h.svg, "outerHTML", { get() { svgReads += 1; return markup; } });
  const draw = async () => { const p = h.controller.renderExportWorkbenchPreview(); await h.frame(); await p; };
  await draw();
  const firstSource = h.stage.children[0].source;
  h.state.exportWorkbenchUi.adjustments.contrast = 150;
  h.state.exportWorkbenchUi.scale = "4";
  h.state.exportWorkbenchUi.format = "jpg";
  await draw();
  assert.equal(h.sources.length, 1);
  assert.equal(h.stage.children[0].source, firstSource);
  h.state.scenarioDataGeneration += 1;
  await draw();
  assert.equal(h.sources.length, 2);
  markup = "<svg><text>B</text></svg>";
  await draw();
  assert.equal(h.sources.length, 2, "SVG changes do not affect a raster source");
  assert.equal(svgReads, 0);
});

test("SVG source edits invalidate annotation, special-zone and composite previews", async (t) => {
  const h = createHarness(t);
  const draw = async () => { const p = h.controller.renderExportWorkbenchPreview(); await h.frame(); await p; };
  for (const source of ["svg-annotations", "special-zones", "main"]) {
    h.state.exportWorkbenchUi.previewMode = source === "main" ? "main" : "layer";
    h.state.exportWorkbenchUi.previewLayerId = source;
    h.state.exportWorkbenchUi.textVisibility["svg-annotations"] = true;
    await draw();
    const firstSource = h.stage.children[0].source;
    h.svg.outerHTML = `<svg><text>${source}</text></svg>`;
    await draw();
    assert.notEqual(h.stage.children[0].source, firstSource, "same count with changed text must invalidate");
  }
});

test("in-flight requests are serialized and stale jobs skip adjustment work", async (t) => {
  const first = deferred();
  const builds = [];
  const h = createHarness(t, {
    buildSingleExportSourceCanvas(ui, id) {
      builds.push(id);
      return builds.length === 1 ? first.promise : Promise.resolve({ id });
    },
  });
  const p1 = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  h.state.exportWorkbenchUi.previewLayerId = "political";
  const p2 = h.controller.renderExportWorkbenchPreview();
  h.state.exportWorkbenchUi.previewLayerId = "labels";
  const p3 = h.controller.renderExportWorkbenchPreview();
  assert.deepEqual(builds, ["background"]);
  first.resolve({ id: "old" });
  await new Promise(setImmediate);
  assert.equal(h.adjustments.length, 0);
  await h.frame();
  await Promise.all([p1, p2, p3]);
  assert.deepEqual(builds, ["background", "labels"]);
  assert.equal(h.stage.children[0].source.id, "labels");
});

test("an in-flight source can serve the latest adjustment without rebuilding", async (t) => {
  const source = deferred();
  let builds = 0;
  const h = createHarness(t, { buildSingleExportSourceCanvas() { builds += 1; return source.promise; } });
  const first = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  h.state.exportWorkbenchUi.adjustments.brightness = 170;
  const latest = h.controller.renderExportWorkbenchPreview();
  source.resolve({ id: "shared" });
  await new Promise(setImmediate);
  await h.frame();
  await Promise.all([first, latest]);
  assert.equal(builds, 1);
  assert.equal(h.adjustments.length, 1);
  assert.equal(h.stage.children[0].brightness, 170);
});

test("close discards pending work and prevents an active source from repopulating the cache", async (t) => {
  const source = deferred();
  let builds = 0;
  const h = createHarness(t, {
    buildSingleExportSourceCanvas() { builds += 1; return builds === 1 ? source.promise : Promise.resolve({ id: "new" }); },
  });
  const first = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  h.controller.renderExportWorkbenchUi(false);
  source.resolve({ id: "closed" });
  await first;
  assert.equal(h.adjustments.length, 0);
  assert.equal(h.stage.children.length, 0);
  const reopen = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  await reopen;
  assert.equal(builds, 2);
  assert.equal(h.stage.children[0].source.id, "new");
  const pending = h.controller.renderExportWorkbenchPreview();
  h.controller.renderExportWorkbenchUi(false);
  await h.frame();
  await pending;
  assert.equal(builds, 2);
  assert.equal(h.stage.children.length, 0);
});

test("source failure is visible and retry starts a fresh build", async (t) => {
  t.mock.method(console, "error", () => {});
  let builds = 0;
  const h = createHarness(t, {
    async buildSingleExportSourceCanvas() {
      builds += 1;
      if (builds === 1) throw new Error("detail unavailable");
      return { id: "retry" };
    },
  });
  let p = h.controller.renderExportWorkbenchPreview();
  await h.frame(); await p;
  assert.match(h.status.textContent, /Preview unavailable/);
  p = h.controller.renderExportWorkbenchPreview();
  await h.frame(); await p;
  assert.equal(builds, 2);
  assert.equal(h.stage.children[0].source.id, "retry");
});

test("inputs changed during preparation are not cached under either scene", async (t) => {
  const source = deferred();
  let builds = 0;
  const h = createHarness(t, {
    buildSingleExportSourceCanvas() { builds += 1; return builds === 1 ? source.promise : Promise.resolve({ id: "current" }); },
  });
  const first = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  h.state.activeScenarioId = "scene-b";
  source.resolve({ id: "old" });
  await first;
  const next = h.controller.renderExportWorkbenchPreview();
  await h.frame(); await next;
  assert.equal(builds, 2);
});

test("source identity covers scenario epoch, geometry, viewport, style, pass, order and visibility; dirty passes never reuse", () => {
  const state = createState();
  const key = () => getExportPreviewSourceKey(state, state.exportWorkbenchUi, ["background"], "svg");
  let previous = key();
  for (const change of [
    () => { state.renderTransactionDiagnostics.scenarioApplyEpoch += 1; },
    () => { state.topologyRevision += 1; },
    () => { state.colorRevision += 1; },
    () => { state.zoomTransform.x += 0.001; },
    () => { state.colorCanvas.width += 1; },
    () => { state.styleConfig.ocean = { color: "red" }; },
    () => { state.renderPassCache.signatures.background = "background-b"; },
    () => { state.exportWorkbenchUi.layerOrder.reverse(); },
    () => { state.exportWorkbenchUi.visibility.political = false; },
    () => { state.exportWorkbenchUi.textVisibility["svg-annotations"] = false; },
  ]) {
    change();
    assert.notEqual(key(), previous);
    previous = key();
  }
  state.renderPassCache.dirty.background = true;
  assert.equal(key(), null);
  state.renderPassCache.dirty.background = false;
  state.renderPhase = "interacting";
  assert.equal(key(), null);
  state.renderPhase = "idle";
  for (const flag of ["scenarioApplyInFlight", "dynamicBordersDirty"]) {
    state[flag] = true;
    assert.equal(key(), null, flag);
    state[flag] = false;
  }
  state.runtimeChunkLoadState = { pendingPromotion: {} };
  assert.equal(key(), null);
  state.runtimeChunkLoadState = { promotionCommitInFlight: true };
  assert.equal(key(), null);
});
