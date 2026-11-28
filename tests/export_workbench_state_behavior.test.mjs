import { createDeferredPromise as deferred } from "./helpers/deferred_promise.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "../vendor/fflate.browser.js";
import { buildExportArtifactPackage } from "../js/core/export_artifact_package.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { createExportWorkbenchController, ensureExportWorkbenchUiState } from "../js/ui/toolbar/export_workbench_controller.js";

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

function createHarness(overrides = {}) {
  const state = createState();
  const frames = [];
  const adjustments = [];
  const stage = { children: [], replaceChildren(...children) { this.children = children; } };
  const status = { textContent: "" };
  const controller = createExportWorkbenchController({
    state, t: (key) => key, showToast() {}, showExportFailureToast() {},
    normalizeExportWorkbenchUiState, renderPassNames: ["background"],
    exportWorkbenchPreviewStage: stage, exportWorkbenchPreviewState: status,
    exportWorkbenchOverlay: { classList: { toggle() {} }, setAttribute() {} },
    buildCompositeSourceCanvas() {},
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
    state, controller, stage, adjustments,
    async frame() {
      assert.ok(frames.length > 0, "a preview frame must be scheduled");
      frames.shift()(0);
      await new Promise(setImmediate);
    },
  };
}

test("a pending preview from the previous scenario cannot replace the new preview", async () => {
  const source = deferred();
  let builds = 0;
  const h = createHarness({
    buildSingleExportSourceCanvas() { builds += 1; return builds === 1 ? source.promise : Promise.resolve({ id: "new" }); },
  });
  const first = h.controller.renderExportWorkbenchPreview();
  await h.frame();
  h.state.activeScenarioId = "scene-b";
  const next = h.controller.renderExportWorkbenchPreview();
  source.resolve({ id: "old" });
  await new Promise(setImmediate);
  assert.equal(h.adjustments.length, 0);
  await h.frame();
  await Promise.all([first, next]);
  assert.equal(h.stage.children[0].source.id, "new");
  assert.equal(builds, 2);
});
