import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("dirty and chrome callers delegate owned writes to target-first actions", () => {
  const dirty = read("js/core/dirty_state.js");
  const supportSurface = read("js/ui/toolbar/workspace_chrome_support_surface_controller.js");
  const scenarioContext = read("js/ui/toolbar/scenario_context_bar_controller.js");

  assert.match(dirty, /state\/actions\/ui_dirty_actions\.js/);
  assert.doesNotMatch(dirty, /state\/ui_state\.js/);
  assert.match(supportSurface, /state\/actions\/ui_chrome_actions\.js/);
  assert.match(supportSurface, /setRestoredSupportSurfaceViewState\(state, view\)/);
  assert.doesNotMatch(supportSurface, /state\.ui\.restoredSupportSurfaceViewFromUrl\s*=/);
  assert.match(scenarioContext, /patchUiChromeState\(runtimeState,/);
  assert.doesNotMatch(scenarioContext, /runtimeState\.ui\.scenarioBarCollapsed\s*=/);
});

test("export and transport owners delegate canonical state writes", () => {
  const exportOwner = read("js/ui/toolbar/export_workbench_controller.js");
  const transportStateOwner = read("js/ui/toolbar/transport_workbench_state_owner.js");
  const transportAppearance = read("js/ui/toolbar/transport_appearance_controller.js");
  const transportApplyBridge = read("js/ui/toolbar/transport_workbench_apply_bridge_owner.js");
  const legacyUiState = read("js/core/state/ui_state.js");

  assert.match(exportOwner, /state\/actions\/export_workbench_actions\.js/);
  assert.doesNotMatch(exportOwner, /replaceExportWorkbenchUiState/);
  assert.doesNotMatch(exportOwner, /(?:exportUi|state\.exportWorkbenchUi)\.(?:layerOrder|visibility|textVisibility|includeTextLayer|previewMode|previewLayerId|target|format|scale|adjustments|bakeCache|bakeArtifacts)\s*=(?!=)/);
  assert.match(transportStateOwner, /state\/actions\/transport_actions\.js/);
  assert.doesNotMatch(transportStateOwner, /runtimeState\.(?:transportWorkbenchUi|transportWorkbenchPointDeltas)\s*=/);
  assert.match(transportAppearance, /setTransportMasterVisibilityState\(runtimeState,/);
  assert.match(transportAppearance, /setTransportFamilyVisibilityState\(runtimeState,/);
  assert.doesNotMatch(transportAppearance, /runtimeState\.(?:showTransport|showAirports|showPorts|showRail|showRoad)\s*=/);
  assert.match(
    transportApplyBridge,
    /from\s+["']\.\.\/\.\.\/core\/state\/actions\/transport_actions\.js["']/,
  );
  assert.doesNotMatch(
    transportApplyBridge,
    /import\s*\{[^}]*applyTransportWorkbenchOverviewState[^}]*\}\s*from\s*["']\.\.\/\.\.\/core\/state\.js["']/s,
  );
  assert.doesNotMatch(legacyUiState, /function\s+applyTransportWorkbenchOverviewState\s*\(/);
});

test("file manager routes project visibility snapshots through the finite action surface", () => {
  const fileManager = read("js/core/file_manager.js");

  assert.match(fileManager, /state\/actions\/ui_visibility_actions\.js/);
  assert.match(fileManager, /captureUiVisibilityState\(/);
  assert.match(fileManager, /commitUiVisibilityState\(data\.layerVisibility,/);
});
