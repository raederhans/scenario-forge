import test from "node:test";
import assert from "node:assert/strict";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";
import { ensureExportWorkbenchUiState } from "../js/core/state/actions/export_workbench_actions.js";

function createHarness(overrides = {}) {
  const state = {
    colorCanvas: { width: 200, height: 100 },
    renderPassCache: { signatures: { borders: "first" } },
  };
  const calls = [];
  const document = {
    getElementById: () => null,
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...args) => calls.push(["draw", ...args]) }),
    }),
  };
  const runtime = createExportBakeRuntime({
    state,
    document,
    ensureExportWorkbenchUiState: () => ensureExportWorkbenchUiState(state),
    renderPassNames: ["background", "political", "lineEffects", "borders", "labels"],
    ensureScenarioPoliticalDetailForExport: async () => { calls.push(["scenario"]); },
    ensurePaintContoursReady: async () => { calls.push(["contours"]); },
    ensureCountryLabelsReadyForExport: async passes => { calls.push(["labels", passes]); },
    ensureBathymetryReadyForExport: async (passes, ratio) => { calls.push(["bathymetry", passes, ratio]); },
    renderExportPassesToCanvas: (passes, options) => {
      calls.push(["render", passes, options]);
      return document.createElement("canvas");
    },
    ...overrides,
  });
  return { state, calls, runtime };
}

test("bake reuses its canvas until a dependency signature changes or the cache is cleared", async () => {
  const { state, calls, runtime } = createHarness();
  const first = await runtime.bakeLayer("line");
  assert.equal(state.exportWorkbenchUi.bakeArtifacts[0].dirtyFlag, true);
  assert.strictEqual(await runtime.bakeLayer("line"), first);
  assert.equal(state.exportWorkbenchUi.bakeArtifacts[0].dirtyFlag, false);
  assert.equal(calls.filter(([name]) => name === "render").length, 1);

  state.renderPassCache.signatures.borders = "second";
  const second = await runtime.bakeLayer("line");
  assert.notStrictEqual(second, first);
  assert.equal(state.exportWorkbenchUi.bakeArtifacts[0].dirtyFlag, true);
  assert.ok(state.exportWorkbenchUi.bakeArtifacts[0].dependencies.includes("passBorders:second"));
  runtime.clearExportBakeCache();
  assert.notStrictEqual(await runtime.bakeLayer("line"), second);
  assert.equal(calls.filter(([name]) => name === "render").length, 3);
});

test("failed bake preserves the last successful artifact and cache and permits a later bake", async () => {
  let fail = false;
  const { state, runtime } = createHarness({
    renderExportPassesToCanvas: () => {
      if (fail) throw new Error("render failed");
      return {};
    },
  });
  const first = await runtime.bakeLayer("line");
  const previousArtifacts = structuredClone(state.exportWorkbenchUi.bakeArtifacts);
  state.renderPassCache.signatures.borders = "second";
  fail = true;
  await assert.rejects(runtime.bakeLayer("line"), /render failed/);
  assert.deepEqual(state.exportWorkbenchUi.bakeArtifacts, previousArtifacts);
  state.renderPassCache.signatures.borders = "first";
  assert.strictEqual(await runtime.bakeLayer("line"), first);
  state.renderPassCache.signatures.borders = "second";
  fail = false;
  assert.notStrictEqual(await runtime.bakeLayer("line"), first);
});

test("composite waits for readiness and forwards target pixel ratio before rendering", async () => {
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const ready = new Promise(resolve => { release = resolve; });
  const { state, calls, runtime } = createHarness({
    ensureCountryLabelsReadyForExport: async () => { entered(); await ready; },
  });
  const ui = ensureExportWorkbenchUiState(state);
  ui.textVisibility["svg-annotations"] = false;
  ui.textVisibility["special-zones"] = false;
  const result = runtime.buildCompositeSourceCanvas(ui, { width: 400, height: 200, pixelRatio: 2 });
  await waiting;
  assert.equal(calls.some(([name]) => name === "render"), false);
  release();
  const canvas = await result;
  const bathymetryIndex = calls.findIndex(([name]) => name === "bathymetry");
  const renderIndex = calls.findIndex(([name]) => name === "render");
  assert.ok(bathymetryIndex < renderIndex);
  assert.equal(calls[bathymetryIndex][2], 2);
  assert.deepEqual(calls[renderIndex][2], { pixelRatio: 2 });
  assert.ok(canvas);
});
