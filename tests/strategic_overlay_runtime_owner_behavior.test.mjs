import test from "node:test";
import assert from "node:assert/strict";

import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

test("operation graphic runtime owner commits history and dirty state on finish", () => {
  const historyEntries = [];
  const dirtyReasons = [];
  let uiRefreshCount = 0;
  let renderCount = 0;
  const state = {
    operationGraphics: [],
    operationGraphicsDirty: false,
    operationGraphicsEditor: {
      active: true,
      counter: 2,
      kind: "offensive",
      label: "Arrow",
      opacity: 0.7,
      points: [[10, 20], [30, 40]],
      selectedId: null,
      selectedVertexIndex: -1,
      stroke: "#112233",
      stylePreset: "offensive",
      width: 3,
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state,
    helpers: {
      captureHistoryState: (payload) => ({ snapshot: payload }),
      commitHistoryEntry: (entry) => historyEntries.push(entry),
      ensureOperationGraphicCounter: () => {},
      ensureOperationGraphicsEditorState: () => {},
      getOperationGraphicMinPoints: () => 2,
      markDirty: (reason) => dirtyReasons.push(reason),
      normalizeOperationGraphicOpacity: (value) => Number(value),
      normalizeOperationGraphicStroke: (value) => String(value),
      normalizeOperationGraphicStylePreset: (value) => String(value),
      normalizeOperationGraphicWidth: (value) => Number(value),
      renderNow: () => {
        renderCount += 1;
      },
      updateStrategicOverlayUi: () => {
        uiRefreshCount += 1;
      },
    },
  });

  assert.equal(owner.finishOperationGraphicDraw(), true);
  assert.equal(state.operationGraphics.length, 1);
  assert.equal(state.operationGraphics[0].id, "opg_2");
  assert.equal(state.operationGraphicsEditor.selectedId, "opg_2");
  assert.equal(state.operationGraphicsEditor.mode, "edit");
  assert.equal(historyEntries[0].kind, "finish-operation-graphic");
  assert.deepEqual(dirtyReasons, ["finish-operation-graphic"]);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("operation graphic runtime owner keeps warning path for invalid closed-style switch", () => {
  const toasts = [];
  const state = {
    operationGraphics: [{
      id: "opg_1",
      kind: "front",
      label: "Front",
      opacity: 1,
      points: [[0, 0], [1, 1]],
      selectedId: null,
      stroke: "#334455",
      stylePreset: "front",
      width: 2,
    }],
    operationGraphicsEditor: {
      active: false,
      kind: "front",
      label: "Front",
      mode: "edit",
      opacity: 1,
      points: [[0, 0], [1, 1]],
      selectedId: "opg_1",
      selectedVertexIndex: -1,
      stroke: "#334455",
      stylePreset: "front",
      width: 2,
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state,
    helpers: {
      ensureOperationGraphicsEditorState: () => {},
      getOperationGraphicById: () => state.operationGraphics[0],
      getOperationGraphicMinPoints: (kind) => (kind === "encirclement" ? 3 : 2),
      showToast: (message, options) => toasts.push({ message, options }),
      t: (key) => key,
    },
  });

  assert.equal(owner.updateSelectedOperationGraphic({ kind: "encirclement" }), false);
  assert.equal(state.operationGraphics[0].kind, "front");
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].options.title, "More points required");
});

test("special zone runtime owner creates manual feature and preserves isolated semantics", () => {
  let uiRefreshCount = 0;
  let renderCount = 0;
  const state = {
    manualSpecialZones: { type: "FeatureCollection", features: [] },
    specialZonesOverlayDirty: false,
    specialZoneEditor: {
      active: true,
      counter: 1,
      label: "Buffer",
      selectedId: null,
      vertices: [[0, 0], [1, 0], [1, 1]],
      zoneType: "custom",
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state,
    helpers: {
      ensureManualSpecialZoneCounter: () => {},
      ensureSpecialZoneEditorState: () => {},
      renderNow: () => {
        renderCount += 1;
      },
      updateSpecialZoneEditorUI: () => {
        uiRefreshCount += 1;
      },
    },
  });

  assert.equal(owner.finishSpecialZoneDraw(), true);
  assert.equal(state.manualSpecialZones.features.length, 1);
  assert.equal(state.manualSpecialZones.features[0].properties.id, "manual_sz_1");
  assert.equal(state.specialZoneEditor.selectedId, "manual_sz_1");
  assert.equal(state.specialZoneEditor.active, false);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("unit counter nation resolution keeps controller fallback source semantics", () => {
  const state = {
    activeSovereignCode: "FRA",
    landIndex: new Map([["feature-1", { id: "feature-1" }]]),
    scenarioControllersByFeatureId: { "feature-1": "" },
    selectedInspectorCountryCode: "",
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state,
    helpers: {
      canonicalCountryCode: (value) => String(value || "").trim().toUpperCase(),
      getDisplayOwnerCode: () => "",
      getFeatureOwnerCode: (featureId) => (featureId ? "ENG" : ""),
      normalizeUnitCounterNationSource: (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
    },
  });

  assert.deepEqual(
    owner.resolveUnitCounterNationForPlacement("feature-1", "", "controller"),
    { tag: "ENG", source: "controller" },
  );
  assert.deepEqual(
    owner.resolveUnitCounterNationForPlacement("", "", "controller"),
    { tag: "FRA", source: "controller" },
  );
});

test("unit counter preview seeds editor defaults before reading preview data", () => {
  let ensureCount = 0;
  const state = {};

  const owner = createStrategicOverlayRuntimeOwner({
    state,
    helpers: {
      ensureUnitCounterEditorState: () => {
        ensureCount += 1;
        state.unitCounterEditor = {
          renderer: "game",
          sidc: "",
          symbolCode: "",
          nationTag: "",
          presetId: "inf",
          unitType: "",
          echelon: "",
          label: "",
          subLabel: "",
          strengthText: "",
          baseFillColor: "",
          organizationPct: 78,
          equipmentPct: 74,
          statsPresetId: "regular",
          statsSource: "preset",
          size: "medium",
        };
      },
      getNormalizedUnitCounterCombatState: (value) => value,
      getUnitCounterCardModel: (value) => value,
    },
  });

  const preview = owner.getUnitCounterPreviewData();
  assert.equal(ensureCount, 1);
  assert.equal(state.unitCounterEditor.presetId, "inf");
  assert.equal(preview.renderer, "game");
  assert.equal(preview.organizationPct, 78);
});
