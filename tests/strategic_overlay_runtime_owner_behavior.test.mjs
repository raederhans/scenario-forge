import test from "node:test";
import assert from "node:assert/strict";

import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

test("operation graphic runtime owner commits history and dirty state on finish", () => {
  const historyEntries = [];
  const dirtyReasons = [];
  let uiRefreshCount = 0;
  let renderCount = 0;
  const runtimeState = {
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
    state: runtimeState,
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
  assert.equal(runtimeState.operationGraphics.length, 1);
  assert.equal(runtimeState.operationGraphics[0].id, "opg_2");
  assert.equal(runtimeState.operationGraphicsEditor.selectedId, "opg_2");
  assert.equal(runtimeState.operationGraphicsEditor.mode, "edit");
  assert.equal(historyEntries[0].kind, "finish-operation-graphic");
  assert.deepEqual(dirtyReasons, ["finish-operation-graphic"]);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("operation graphic runtime owner keeps warning path for invalid closed-style switch", () => {
  const toasts = [];
  const runtimeState = {
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
    state: runtimeState,
    helpers: {
      ensureOperationGraphicsEditorState: () => {},
      getOperationGraphicById: () => runtimeState.operationGraphics[0],
      getOperationGraphicMinPoints: (kind) => (kind === "encirclement" ? 3 : 2),
      showToast: (message, options) => toasts.push({ message, options }),
      t: (key) => key,
    },
  });

  assert.equal(owner.updateSelectedOperationGraphic({ kind: "encirclement" }), false);
  assert.equal(runtimeState.operationGraphics[0].kind, "front");
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].options.title, "More points required");
});

test("special zone runtime owner creates manual feature and preserves isolated semantics", () => {
  let uiRefreshCount = 0;
  let renderCount = 0;
  const runtimeState = {
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
    state: runtimeState,
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
  assert.equal(runtimeState.manualSpecialZones.features.length, 1);
  assert.equal(runtimeState.manualSpecialZones.features[0].properties.id, "manual_sz_1");
  assert.equal(runtimeState.specialZoneEditor.selectedId, "manual_sz_1");
  assert.equal(runtimeState.specialZoneEditor.active, false);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("operational line runtime owner commits history and updates modal selection on finish", () => {
  const historyEntries = [];
  const dirtyReasons = [];
  let uiRefreshCount = 0;
  let renderCount = 0;
  const runtimeState = {
    operationGraphicsEditor: {
      selectedId: "opg_selected",
    },
    operationalLines: [],
    operationalLinesDirty: false,
    operationalLineEditor: {
      active: true,
      counter: 3,
      kind: "frontline",
      label: "Baltic Screen",
      opacity: 0.82,
      points: [[8, 48], [13, 49], [18, 51]],
      selectedId: null,
      selectedVertexIndex: -1,
      stroke: "#6b7280",
      stylePreset: "frontline",
      width: 2.1,
    },
    strategicOverlayUi: {},
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      captureHistoryState: (payload) => ({ snapshot: payload }),
      commitHistoryEntry: (entry) => historyEntries.push(entry),
      ensureOperationalLineCounter: () => {},
      ensureOperationalLineEditorState: () => {},
      normalizeOperationalLineStylePreset: (value) => String(value),
      normalizeOperationGraphicOpacity: (value) => Number(value),
      normalizeOperationGraphicStroke: (value) => String(value),
      normalizeOperationGraphicWidth: (value) => Number(value),
      getOperationalLineMinPoints: () => 2,
      markDirty: (reason) => dirtyReasons.push(reason),
      renderNow: () => {
        renderCount += 1;
      },
      updateStrategicOverlayUi: () => {
        uiRefreshCount += 1;
      },
    },
  });

  assert.equal(owner.finishOperationalLineDraw(), true);
  assert.equal(runtimeState.operationalLines.length, 1);
  assert.equal(runtimeState.operationalLines[0].id, "opl_3");
  assert.equal(runtimeState.operationalLineEditor.selectedId, "opl_3");
  assert.equal(runtimeState.strategicOverlayUi.modalEntityId, "opl_3");
  assert.equal(historyEntries[0].kind, "create-operational-line");
  assert.deepEqual(dirtyReasons, ["create-operational-line"]);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("unit counter nation resolution keeps controller fallback source semantics", () => {
  const runtimeState = {
    activeSovereignCode: "FRA",
    landIndex: new Map([["feature-1", { id: "feature-1" }]]),
    scenarioControllersByFeatureId: { "feature-1": "" },
    selectedInspectorCountryCode: "",
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
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

test("unit counter runtime owner placement syncs line attachments and history", () => {
  const historyEntries = [];
  const dirtyReasons = [];
  let uiRefreshCount = 0;
  let renderCount = 0;
  const runtimeState = {
    HIT_SNAP_RADIUS_CLICK_PX: 10,
    annotationView: {
      unitRendererDefault: "game",
    },
    operationalLines: [{
      id: "opl_1",
      attachedCounterIds: [],
    }],
    operationalLinesDirty: false,
    unitCounters: [],
    unitCountersDirty: false,
    unitCounterEditor: {
      active: true,
      attachment: { kind: "operational-line", lineId: "opl_1" },
      baseFillColor: "#e8decd",
      counter: 1,
      echelon: "corps",
      equipmentPct: 73,
      iconId: "infantry",
      label: "1st Corps",
      nationSource: "display",
      nationTag: "",
      organizationPct: 84,
      presetId: "inf",
      renderer: "milstd",
      returnSelectionId: null,
      sidc: "",
      size: "medium",
      statsPresetId: "regular",
      statsSource: "preset",
      strengthText: "",
      subLabel: "Nord",
      symbolCode: "",
      unitType: "INF",
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    constants: {
      defaultUnitCounterMilstdSidc: "130310001412110000000000000000",
    },
    helpers: {
      captureHistoryState: (payload) => ({ snapshot: payload }),
      commitHistoryEntry: (entry) => historyEntries.push(entry),
      ensureUnitCounterCounter: () => {},
      ensureUnitCounterEditorState: () => {},
      getHitFromEvent: () => ({ id: "GER", targetType: "land" }),
      getMapLonLatFromEvent: () => [12, 48],
      getNormalizedUnitCounterCombatState: (value) => value,
      getUnitCounterPresetById: () => ({
        baseSidc: "",
        defaultEchelon: "corps",
        defaultRenderer: "milstd",
        iconId: "infantry",
        id: "inf",
        unitType: "INF",
      }),
      markDirty: (reason) => dirtyReasons.push(reason),
      normalizeUnitCounterNationSource: (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
      normalizeUnitCounterSizeToken: (value) => String(value),
      renderNow: () => {
        renderCount += 1;
      },
      updateStrategicOverlayUi: () => {
        uiRefreshCount += 1;
      },
      resolveUnitCounterNationForPlacement: undefined,
    },
  });

  assert.equal(owner.placeUnitCounterFromEvent({ type: "click" }), true);
  assert.equal(runtimeState.unitCounters.length, 1);
  assert.equal(runtimeState.unitCounters[0].attachment.lineId, "opl_1");
  assert.equal(runtimeState.unitCounters[0].layoutAnchor.kind, "attachment");
  assert.deepEqual(runtimeState.operationalLines[0].attachedCounterIds, ["unit_1"]);
  assert.equal(historyEntries[0].kind, "place-unit-counter");
  assert.deepEqual(dirtyReasons, ["place-unit-counter"]);
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});

test("unit counter preview seeds editor defaults before reading preview data", () => {
  let ensureCount = 0;
  const runtimeState = {};

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      ensureUnitCounterEditorState: () => {
        ensureCount += 1;
        runtimeState.unitCounterEditor = {
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
  assert.equal(runtimeState.unitCounterEditor.presetId, "inf");
  assert.equal(preview.renderer, "game");
  assert.equal(preview.organizationPct, 78);
});

test("cancel active strategic modes unwinds unit counter, line, and graphics editors", () => {
  const runtimeState = {
    operationGraphicsEditor: {
      active: true,
      mode: "draw",
      points: [[0, 0]],
      selectedId: null,
      selectedVertexIndex: 0,
    },
    operationalLineEditor: {
      active: true,
      mode: "draw",
      points: [[0, 0]],
      selectedId: null,
      selectedVertexIndex: 0,
    },
    strategicOverlayUi: {
      activeMode: "frontline",
    },
    unitCounterEditor: {
      active: true,
      returnSelectionId: null,
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      ensureOperationGraphicsEditorState: () => {},
      ensureOperationalLineEditorState: () => {},
      ensureUnitCounterEditorState: () => {},
      resetUnitCounterEditorState: () => {
        runtimeState.unitCounterEditor.active = false;
      },
      updateStrategicOverlayUi: () => {},
    },
  });

  assert.equal(owner.cancelActiveStrategicInteractionModes(), true);
  assert.equal(runtimeState.unitCounterEditor.active, false);
  assert.equal(runtimeState.operationalLineEditor.active, false);
  assert.equal(runtimeState.operationGraphicsEditor.active, false);
  assert.equal(runtimeState.strategicOverlayUi.activeMode, "idle");
});

test("cancel unit counter placement restores prior selection and clears active placement mode", () => {
  let uiRefreshCount = 0;
  let renderCount = 0;
  const runtimeState = {
    unitCounters: [{
      id: "unit_existing_1",
      renderer: "game",
      sidc: "INF",
      symbolCode: "INF",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      iconId: "infantry",
      unitType: "INF",
      echelon: "corps",
      label: "Existing Counter",
      organizationPct: 84,
      equipmentPct: 73,
      size: "medium",
      anchor: { lon: 12, lat: 48, featureId: "GER" },
    }],
    unitCounterEditor: {
      active: true,
      selectedId: null,
      returnSelectionId: "unit_existing_1",
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      assignUnitCounterEditorFromCounter: (counter) => {
        runtimeState.unitCounterEditor.label = String(counter.label || "");
      },
      ensureUnitCounterEditorState: () => {},
      renderNow: () => {
        renderCount += 1;
      },
      updateStrategicOverlayUi: () => {
        uiRefreshCount += 1;
      },
    },
  });

  owner.cancelUnitCounterPlacement();
  assert.equal(runtimeState.unitCounterEditor.active, false);
  assert.equal(runtimeState.unitCounterEditor.selectedId, "unit_existing_1");
  assert.equal(runtimeState.unitCounterEditor.returnSelectionId, null);
  assert.equal(runtimeState.unitCounterEditor.label, "Existing Counter");
  assert.equal(uiRefreshCount, 1);
  assert.equal(renderCount, 1);
});
