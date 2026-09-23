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
  EXPORT_ARTIFACT_DOWNLOAD_PHASES,
  createExportArtifactDownloadTransaction,
} from "../js/ui/toolbar/export_artifact_download_transaction.js";
import {
  EXPORT_FAILURE_KINDS,
  classifyExportFailure,
  createExportFailureToastHandler,
} from "../js/ui/toolbar/export_failure_handler.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { replaceExportWorkbenchUiState } from "../js/core/state/ui_state.js";
import {
  createExportWorkbenchController,
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

test("export artifact download transaction records the artifact and download lifecycle", async () => {
  const lifecycle = [];
  const downloads = [];
  const toasts = [];
  const exportUi = { target: "per-layer", format: "jpg" };
  const transaction = createExportArtifactDownloadTransaction({
    getExportUi: () => exportUi,
    getSelectedExportScale: () => 2,
    buildPerLayerExportPackage: async (ui, scale) => {
      assert.equal(ui, exportUi);
      assert.equal(scale, 2);
      return { blob: { id: "layers" }, extension: "zip", fileStem: "map_layers" };
    },
    buildBakePackPackage: async () => assert.fail("unexpected bake package"),
    buildCompositeExportCanvas: async () => assert.fail("unexpected composite canvas"),
    triggerBlobDownload: async (...args) => downloads.push(args),
    triggerCanvasDownload: async () => assert.fail("unexpected canvas download"),
    showToast: (...args) => toasts.push(args),
    showExportFailureToast: () => assert.fail("unexpected export failure"),
    t: (key) => key,
    onLifecycle: (entry) => lifecycle.push(entry),
  });

  const receipt = await transaction.run();

  assert.deepEqual(receipt, {
    status: "ready",
    target: "per-layer",
    scale: 2,
    extension: "zip",
    fileStem: "map_layers",
  });
  assert.equal(exportUi.scale, "2");
  assert.deepEqual(downloads, [[{ id: "layers" }, "zip", "map_layers"]]);
  assert.deepEqual(lifecycle.map((entry) => entry.phase), [
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.ARTIFACT_READY,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.DOWNLOADING,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.READY,
  ]);
  assert.equal(toasts.at(-1)[1].tone, "success");
  assert.equal(transaction.getJobsInFlight(), 0);
});

test("export artifact download transaction fails with stage-aware taxonomy", async () => {
  const lifecycle = [];
  const failures = [];
  const transaction = createExportArtifactDownloadTransaction({
    getExportUi: () => ({ target: "composite", format: "png" }),
    getSelectedExportScale: () => 1,
    buildPerLayerExportPackage: async () => assert.fail("unexpected layer package"),
    buildBakePackPackage: async () => assert.fail("unexpected bake package"),
    buildCompositeExportCanvas: async () => ({ id: "canvas" }),
    triggerBlobDownload: async () => assert.fail("unexpected blob download"),
    triggerCanvasDownload: async () => { throw new Error("browser rejected the download"); },
    showToast() {},
    showExportFailureToast: (error) => failures.push(error),
    t: (key) => key,
    onLifecycle: (entry) => lifecycle.push(entry),
  });

  const receipt = await transaction.run();

  assert.deepEqual(receipt, {
    status: "failed",
    target: "composite",
    failureKind: EXPORT_FAILURE_KINDS.DOWNLOAD_FAILED,
  });
  assert.equal(failures[0].exportStage, "download");
  assert.deepEqual(lifecycle.map((entry) => entry.phase), [
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.ARTIFACT_READY,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.DOWNLOADING,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.FAILED,
  ]);
  assert.equal(classifyExportFailure(failures[0]), EXPORT_FAILURE_KINDS.DOWNLOAD_FAILED);
});

test("export artifact download transaction preserves explicit failure kinds across stage wrapping", async () => {
  const failures = [];
  const invalidParameters = new Error("invalid export scale");
  invalidParameters.exportKind = EXPORT_FAILURE_KINDS.INVALID_PARAMS;
  Object.freeze(invalidParameters);
  const transaction = createExportArtifactDownloadTransaction({
    getExportUi: () => ({ target: "composite", format: "png" }),
    getSelectedExportScale: () => 1,
    buildPerLayerExportPackage: async () => assert.fail("unexpected layer package"),
    buildBakePackPackage: async () => assert.fail("unexpected bake package"),
    buildCompositeExportCanvas: async () => { throw invalidParameters; },
    triggerBlobDownload: async () => assert.fail("unexpected blob download"),
    triggerCanvasDownload: async () => assert.fail("download must not start"),
    showToast() {},
    showExportFailureToast: (error) => failures.push(error),
    t: (key) => key,
  });

  const receipt = await transaction.run();

  assert.equal(receipt.failureKind, EXPORT_FAILURE_KINDS.INVALID_PARAMS);
  assert.equal(failures[0].exportKind, EXPORT_FAILURE_KINDS.INVALID_PARAMS);
  assert.equal(failures[0].exportStage, "artifact");
  assert.equal(failures[0].cause, invalidParameters);
});

test("concurrent export lifecycle events retain their originating transaction IDs", async () => {
  const lifecycle = [];
  const pendingArtifacts = [];
  const transaction = createExportArtifactDownloadTransaction({
    getExportUi: () => ({ target: "composite", format: "png" }),
    getSelectedExportScale: () => 1,
    buildPerLayerExportPackage: async () => assert.fail("unexpected layer package"),
    buildBakePackPackage: async () => assert.fail("unexpected bake package"),
    buildCompositeExportCanvas: () => new Promise((resolve) => pendingArtifacts.push(resolve)),
    triggerBlobDownload: async () => assert.fail("unexpected blob download"),
    triggerCanvasDownload: async () => {},
    showToast() {},
    showExportFailureToast: () => assert.fail("unexpected export failure"),
    t: (key) => key,
    onLifecycle: (entry) => lifecycle.push(entry),
    maxConcurrentJobs: 2,
  });

  const first = transaction.run();
  const second = transaction.run();
  assert.deepEqual(lifecycle.map(({ phase, transactionId }) => [phase, transactionId]), [
    [EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING, 1],
    [EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING, 2],
  ]);

  pendingArtifacts[1]({ id: "second" });
  await second;
  pendingArtifacts[0]({ id: "first" });
  await first;

  for (const transactionId of [1, 2]) {
    assert.deepEqual(
      lifecycle.filter((entry) => entry.transactionId === transactionId).map((entry) => entry.phase),
      [
        EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING,
        EXPORT_ARTIFACT_DOWNLOAD_PHASES.ARTIFACT_READY,
        EXPORT_ARTIFACT_DOWNLOAD_PHASES.DOWNLOADING,
        EXPORT_ARTIFACT_DOWNLOAD_PHASES.READY,
      ],
    );
  }
});

test("export artifact download transaction rejects incomplete package artifacts before download", async () => {
  const lifecycle = [];
  const failures = [];
  const transaction = createExportArtifactDownloadTransaction({
    getExportUi: () => ({ target: "bake-pack" }),
    getSelectedExportScale: () => 1,
    buildPerLayerExportPackage: async () => assert.fail("unexpected layer package"),
    buildBakePackPackage: async () => ({}),
    buildCompositeExportCanvas: async () => assert.fail("unexpected composite canvas"),
    triggerBlobDownload: async () => assert.fail("download must not start"),
    triggerCanvasDownload: async () => assert.fail("unexpected canvas download"),
    showToast() {},
    showExportFailureToast: (error) => failures.push(error),
    t: (key) => key,
    onLifecycle: (entry) => lifecycle.push(entry),
  });

  const receipt = await transaction.run();

  assert.equal(receipt.failureKind, EXPORT_FAILURE_KINDS.ARTIFACT_FAILED);
  assert.equal(failures[0].exportStage, "artifact");
  assert.deepEqual(lifecycle.map((entry) => entry.phase), [
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.PREPARING,
    EXPORT_ARTIFACT_DOWNLOAD_PHASES.FAILED,
  ]);
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
