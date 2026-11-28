import test from "node:test";
import assert from "node:assert/strict";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";
import { ensureExportWorkbenchUiState } from "../js/core/state/actions/export_workbench_actions.js";

function createHarness(overrides = {}) {
  const state = {
    colorCanvas: { width: 200, height: 100 },
    renderPassCache: { signatures: { borders: "first" } },
  };
  const document = { getElementById: () => null, createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
  const runtime = createExportBakeRuntime({
    state,
    document,
    ensureExportWorkbenchUiState: () => ensureExportWorkbenchUiState(state),
    renderPassNames: ["background", "political", "lineEffects", "borders", "labels"],
    ensureScenarioPoliticalDetailForExport() {}, ensurePaintContoursReady() {},
    ensureCountryLabelsReadyForExport() {}, ensureBathymetryReadyForExport() {},
    ...overrides,
  });
  return { state, runtime };
}

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
