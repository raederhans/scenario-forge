import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppearancePresetFromRuntimeState,
  createDefaultAppearancePresetsState,
  createIntensityFieldsState,
  sampleIntensityField,
  state,
  state as fixtureState,
  updateIntensityFieldChannel,
  upsertAppearancePreset,
} from "../js/core/state.js";
import { applyAppearancePresetState } from "../js/core/state/actions/appearance_preset_actions.js";
import { normalizeSpecialZoneLayersState } from "../js/core/special_zone_layers.js";
import {
  createDefaultStyleConfig,
} from "../js/core/state/ui_state.js";
import {
  captureHistoryState,
  clearHistory,
  pushHistoryEntry,
  redoHistory,
  undoHistory,
} from "../js/core/history_manager.js";

function resetRuntimeAppearance() {
  globalThis.document = {
    getElementById: () => null,
  };
  clearHistory();
  state.appearancePresets = createDefaultAppearancePresetsState();
  state.styleConfig = createDefaultStyleConfig();
  state.showUrban = true;
  state.showPhysical = true;
  state.showRivers = true;
  state.showTransport = true;
  state.showStrategicResourceMarkers = false;
  state.strategicChoroplethMetric = "";
  state.intensityFields = createIntensityFieldsState();
}

function createPresetRuntime() {
  return {
    styleConfig: {
      ocean: {
        fillColor: "#112233",
      },
    },
    showUrban: false,
    showPhysical: true,
    showRivers: false,
    showTransport: true,
    showStrategicResourceMarkers: true,
    strategicChoroplethMetric: "steel",
    intensityFields: updateIntensityFieldChannel(
      createIntensityFieldsState(),
      "urbanGlow",
      (channel) => {
        channel.enabled = true;
        channel.points = [{ id: "glow", lon: 139.7, lat: 35.7, strength: 1.8, radiusDeg: 5 }];
      },
    ),
  };
}

test("history undo and redo restore appearance preset library changes", () => {
  resetRuntimeAppearance();
  const before = captureHistoryState({ appearancePresets: true });
  const preset = createAppearancePresetFromRuntimeState(createPresetRuntime(), {
    id: "history-preset",
    name: "History Preset",
    now: Date.UTC(2026, 5, 12),
  });
  state.appearancePresets = upsertAppearancePreset(state.appearancePresets, preset);
  const after = captureHistoryState({ appearancePresets: true });

  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "appearance-preset-save" } }), true);
  assert.equal(state.appearancePresets.byId["history-preset"].name, "History Preset");

  assert.equal(undoHistory(), true);
  assert.equal(state.appearancePresets.byId["history-preset"], undefined);

  assert.equal(redoHistory(), true);
  assert.equal(state.appearancePresets.byId["history-preset"].name, "History Preset");
});

test("history undo and redo restore applied appearance style, visibility, and intensity fields", () => {
  resetRuntimeAppearance();
  const preset = createAppearancePresetFromRuntimeState(createPresetRuntime(), {
    id: "history-preset",
    name: "History Preset",
    now: Date.UTC(2026, 5, 12),
  });
  const before = captureHistoryState({ appearanceState: true });
  applyAppearancePresetState(state, preset);
  const after = captureHistoryState({ appearanceState: true });

  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "appearance-preset-apply" } }), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#112233");
  assert.equal(state.showUrban, false);
  assert.equal(state.showStrategicResourceMarkers, true);
  assert.equal(state.strategicChoroplethMetric, "steel");
  assert.ok(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);

  assert.equal(undoHistory(), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#aadaff");
  assert.equal(state.showUrban, true);
  assert.equal(state.showStrategicResourceMarkers, false);
  assert.equal(state.strategicChoroplethMetric, "");
  assert.equal(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7), 1);

  assert.equal(redoHistory(), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#112233");
  assert.equal(state.showUrban, false);
  assert.equal(state.showStrategicResourceMarkers, true);
  assert.equal(state.strategicChoroplethMetric, "steel");
  assert.ok(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);
});

test("history undo and redo restore strategic overlay and special-zone snapshot state through actions", () => {
  resetRuntimeAppearance();
  fixtureState.annotationView = { zoom: 2, center: [10, 20] };
  fixtureState.operationalLines = [{ id: "line-before", points: [[1, 2], [3, 4]] }];
  fixtureState.operationGraphics = [{ id: "graphic-before", points: [[5, 6]] }];
  fixtureState.unitCounters = [{ id: "counter-before", anchor: [7, 8] }];
  fixtureState.specialZoneLayers = normalizeSpecialZoneLayersState({ topologyFingerprint: "before" });
  fixtureState.specialZoneMembershipBrushMode = "add";
  const before = captureHistoryState({ strategicOverlay: true });

  fixtureState.annotationView = { zoom: 5, center: [30, 40] };
  fixtureState.operationalLines = [{ id: "line-after", points: [[11, 12], [13, 14]] }];
  fixtureState.operationGraphics = [{ id: "graphic-after", points: [[15, 16]] }];
  fixtureState.unitCounters = [{ id: "counter-after", anchor: [17, 18] }];
  fixtureState.specialZoneLayers = normalizeSpecialZoneLayersState({ topologyFingerprint: "after" });
  fixtureState.specialZoneMembershipBrushMode = "remove";
  const after = captureHistoryState({ strategicOverlay: true });

  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "strategic-overlay-edit" } }), true);
  Object.assign(fixtureState, {
    frontlineOverlayDirty: false,
    operationalLinesDirty: false,
    operationGraphicsDirty: false,
    unitCountersDirty: false,
    specialZonesOverlayDirty: false,
  });

  assert.equal(undoHistory(), true);
  assert.deepEqual(fixtureState.annotationView, before.annotationView);
  assert.deepEqual(fixtureState.operationalLines, before.operationalLines);
  assert.deepEqual(fixtureState.operationGraphics, before.operationGraphics);
  assert.deepEqual(fixtureState.unitCounters, before.unitCounters);
  assert.deepEqual(fixtureState.specialZoneLayers, before.specialZoneLayers);
  assert.equal(fixtureState.specialZoneMembershipBrushMode, before.specialZoneMembershipBrushMode);
  assert.equal(fixtureState.frontlineOverlayDirty, true);
  assert.equal(fixtureState.operationalLinesDirty, true);
  assert.equal(fixtureState.operationGraphicsDirty, true);
  assert.equal(fixtureState.unitCountersDirty, true);
  assert.equal(fixtureState.specialZonesOverlayDirty, true);

  Object.assign(fixtureState, {
    frontlineOverlayDirty: false,
    operationalLinesDirty: false,
    operationGraphicsDirty: false,
    unitCountersDirty: false,
    specialZonesOverlayDirty: false,
  });
  assert.equal(redoHistory(), true);
  assert.deepEqual(fixtureState.annotationView, after.annotationView);
  assert.deepEqual(fixtureState.operationalLines, after.operationalLines);
  assert.deepEqual(fixtureState.operationGraphics, after.operationGraphics);
  assert.deepEqual(fixtureState.unitCounters, after.unitCounters);
  assert.deepEqual(fixtureState.specialZoneLayers, after.specialZoneLayers);
  assert.equal(fixtureState.specialZoneMembershipBrushMode, after.specialZoneMembershipBrushMode);
  assert.equal(fixtureState.frontlineOverlayDirty, true);
  assert.equal(fixtureState.operationalLinesDirty, true);
  assert.equal(fixtureState.operationGraphicsDirty, true);
  assert.equal(fixtureState.unitCountersDirty, true);
  assert.equal(fixtureState.specialZonesOverlayDirty, true);

});
