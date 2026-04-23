import { createOperationGraphicsRuntimeDomain } from "./strategic_overlay_runtime/operation_graphics_runtime_domain.js";
import { createSpecialZonesRuntimeDomain } from "./strategic_overlay_runtime/special_zones_runtime_domain.js";
import { createUnitCounterRuntimeDomain } from "./strategic_overlay_runtime/unit_counter_runtime_domain.js";
import { createUnitCounterRuntimeHelpers } from "./strategic_overlay_runtime/unit_counter_runtime_helpers.js";

// Strategic overlay runtime owner for Batch 5.
// It owns editor-side mutations, history commits, and UI refresh ordering for
// the safest transaction lanes, while map_renderer.js keeps the stable facade.
export function createStrategicOverlayRuntimeOwner({
  state,
  constants = {},
  helpers = {},
} = {}) {
  // Batch 5 owner scope:
  // - editor-side strategic overlay transactions
  // - history / dirty / UI refresh ordering
  // - stable facade stays in map_renderer.js so callers keep the same imports
  const {
    defaultOperationGraphicKind = "offensive",
    defaultOperationalLineKind = "frontline",
    defaultSpecialZoneType = "custom",
    defaultCounterAttachmentKind = "operational-line",
    defaultHitSnapRadiusClickPx = 14,
    defaultUnitCounterEquipmentPct = 74,
    defaultUnitCounterMilstdSidc = "130310001412110000000000000000",
    defaultUnitCounterOrganizationPct = 78,
    defaultUnitCounterPresetId = "inf",
    defaultUnitCounterRenderer = "game",
  } = constants;

  const {
    assignUnitCounterEditorFromCounter = () => {},
    canonicalCountryCode = (value = "") => String(value || "").trim().toUpperCase(),
    captureHistoryState = () => ({}),
    commitHistoryEntry = () => {},
    ensureManualSpecialZoneCounter = () => {},
    ensureOperationGraphicCounter = () => {},
    ensureOperationGraphicsEditorState = () => {},
    ensureOperationalLineCounter = () => {},
    ensureOperationalLineEditorState = () => {},
    ensureSpecialZoneEditorState = () => {},
    ensureUnitCounterCounter = () => {},
    ensureUnitCounterEditorState = () => {},
    getDisplayOwnerCode = () => "",
    getFeatureOwnerCode = () => "",
    getHitFromEvent = () => null,
    getMapLonLatFromEvent = () => null,
    getManualSpecialZoneFeatures = () => [],
    getNormalizedUnitCounterCombatState = () => ({
      baseFillColor: "",
      equipmentPct: defaultUnitCounterEquipmentPct,
      organizationPct: defaultUnitCounterOrganizationPct,
      statsPresetId: "regular",
      statsSource: "preset",
    }),
    getOperationGraphicById = () => null,
    getOperationGraphicMinPoints = () => 2,
    getOperationalLineById = () => null,
    getOperationalLineMinPoints = () => 2,
    getUnitCounterCardModel = (value) => value,
    getUnitCounterPresetById = () => ({
      defaultRenderer: defaultUnitCounterRenderer,
      id: defaultUnitCounterPresetId,
    }),
    markDirty = () => {},
    normalizeOperationGraphicOpacity = (value) => Number(value) || 0,
    normalizeOperationGraphicStroke = (value) => String(value || "").trim(),
    normalizeOperationGraphicStylePreset = (value) => String(value || "").trim().toLowerCase(),
    normalizeOperationGraphicWidth = (value) => Number(value) || 0,
    normalizeOperationalLineStylePreset = (value, fallback = defaultOperationalLineKind) =>
      String(value || fallback).trim().toLowerCase(),
    normalizeUnitCounterBaseFillColor = (value) => String(value || "").trim(),
    normalizeUnitCounterNationSource = (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
    normalizeUnitCounterSizeToken = (value) => String(value || "medium").trim().toLowerCase(),
    normalizeUnitCounterStatPercent = (value, fallback = defaultUnitCounterOrganizationPct) => Number(value) || fallback,
    normalizeUnitCounterStatsPresetId = (value, fallback = "regular") => String(value || fallback).trim().toLowerCase(),
    renderNow = () => {},
    renderOperationGraphicsIfNeeded = () => {},
    renderSpecialZoneEditorOverlay = () => {},
    resetUnitCounterEditorState = () => {},
    showToast = () => {},
    t = (key) => String(key || ""),
    updateSpecialZoneEditorUI = () => {},
    updateStrategicOverlayUi = () => {},
  } = helpers;

  const specialZonesDomain = createSpecialZonesRuntimeDomain({
    state,
    defaultSpecialZoneType,
    ensureManualSpecialZoneCounter,
    ensureSpecialZoneEditorState,
    getMapLonLatFromEvent,
    getManualSpecialZoneFeatures,
    renderNow,
    renderSpecialZoneEditorOverlay,
    updateSpecialZoneEditorUI,
  });

  const operationGraphicsDomain = createOperationGraphicsRuntimeDomain({
    state,
    defaultOperationGraphicKind,
    captureHistoryState,
    commitHistoryEntry,
    ensureOperationGraphicCounter,
    ensureOperationGraphicsEditorState,
    getMapLonLatFromEvent,
    getOperationGraphicById,
    getOperationGraphicMinPoints,
    markDirty,
    normalizeOperationGraphicOpacity,
    normalizeOperationGraphicStroke,
    normalizeOperationGraphicStylePreset,
    normalizeOperationGraphicWidth,
    renderNow,
    renderOperationGraphicsIfNeeded,
    showToast,
    t,
    updateStrategicOverlayUi,
  });

  const unitCounterHelpers = createUnitCounterRuntimeHelpers({
    state,
    defaults: {
      defaultUnitCounterEquipmentPct,
      defaultUnitCounterOrganizationPct,
      defaultUnitCounterPresetId,
      defaultUnitCounterRenderer,
    },
    helpers: {
      canonicalCountryCode,
      ensureUnitCounterEditorState,
      getDisplayOwnerCode,
      getFeatureOwnerCode,
      getNormalizedUnitCounterCombatState,
      getUnitCounterCardModel,
      normalizeUnitCounterNationSource,
    },
  });

  const unitCounterDomain = createUnitCounterRuntimeDomain({
    state,
    defaults: {
      defaultCounterAttachmentKind,
      defaultHitSnapRadiusClickPx,
      defaultUnitCounterEquipmentPct,
      defaultUnitCounterMilstdSidc,
      defaultUnitCounterOrganizationPct,
      defaultUnitCounterPresetId,
      defaultUnitCounterRenderer,
    },
    helpers: {
      assignUnitCounterEditorFromCounter,
      canonicalCountryCode,
      captureHistoryState,
      commitHistoryEntry,
      ensureUnitCounterCounter,
      ensureUnitCounterEditorState,
      getHitFromEvent,
      getMapLonLatFromEvent,
      getNormalizedUnitCounterCombatState,
      getUnitCounterPresetById,
      markDirty,
      normalizeUnitCounterBaseFillColor,
      normalizeUnitCounterNationSource,
      normalizeUnitCounterSizeToken,
      normalizeUnitCounterStatPercent,
      normalizeUnitCounterStatsPresetId,
      renderNow,
      resetUnitCounterEditorState,
      resolveUnitCounterNationForPlacement: unitCounterHelpers.resolveUnitCounterNationForPlacement,
      updateStrategicOverlayUi,
    },
  });

  function appendOperationalLineVertexFromEvent(event) {
    ensureOperationalLineEditorState();
    if (!state.operationalLineEditor.active) return false;
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    state.operationalLineEditor.points.push(coord);
    state.operationalLinesDirty = true;
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function startOperationalLineDraw({
    kind = defaultOperationalLineKind,
    label = "",
    stylePreset = defaultOperationalLineKind,
    stroke = "",
    width = 0,
    opacity = 1,
  } = {}) {
    ensureOperationalLineEditorState();
    ensureOperationGraphicsEditorState();
    state.operationGraphicsEditor.selectedId = null;
    state.operationalLineEditor.active = true;
    state.operationalLineEditor.mode = "draw";
    state.operationalLineEditor.points = [];
    state.operationalLineEditor.kind = String(kind || defaultOperationalLineKind).trim().toLowerCase();
    state.operationalLineEditor.label = String(label || "");
    state.operationalLineEditor.stylePreset = normalizeOperationalLineStylePreset(stylePreset, kind);
    state.operationalLineEditor.stroke = normalizeOperationGraphicStroke(stroke);
    state.operationalLineEditor.width = normalizeOperationGraphicWidth(width);
    state.operationalLineEditor.opacity = normalizeOperationGraphicOpacity(opacity);
    state.operationalLineEditor.selectedId = null;
    state.operationalLineEditor.selectedVertexIndex = -1;
    state.strategicOverlayUi = {
      ...(state.strategicOverlayUi || {}),
      activeMode: state.operationalLineEditor.kind,
      modalEntityType: "operational-line",
      modalSection: "line",
    };
    state.operationalLinesDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function undoOperationalLineVertex() {
    ensureOperationalLineEditorState();
    if (!state.operationalLineEditor.active || !state.operationalLineEditor.points.length) return;
    state.operationalLineEditor.points.pop();
    state.operationalLinesDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function cancelOperationalLineDraw() {
    ensureOperationalLineEditorState();
    state.operationalLineEditor.active = false;
    state.operationalLineEditor.mode = state.operationalLineEditor.selectedId ? "edit" : "idle";
    state.operationalLineEditor.points = [];
    state.operationalLineEditor.selectedVertexIndex = -1;
    state.strategicOverlayUi = {
      ...(state.strategicOverlayUi || {}),
      activeMode: "idle",
    };
    state.operationalLinesDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function finishOperationalLineDraw() {
    ensureOperationalLineEditorState();
    const kind = String(state.operationalLineEditor.kind || defaultOperationalLineKind);
    const points = Array.isArray(state.operationalLineEditor.points) ? state.operationalLineEditor.points : [];
    if (!state.operationalLineEditor.active || points.length < getOperationalLineMinPoints(kind)) {
      return false;
    }
    ensureOperationalLineCounter();
    const before = captureHistoryState({ strategicOverlay: true });
    const id = `opl_${state.operationalLineEditor.counter}`;
    state.operationalLines.push({
      id,
      kind,
      label: String(state.operationalLineEditor.label || "").trim(),
      points: [...points],
      stylePreset: normalizeOperationalLineStylePreset(state.operationalLineEditor.stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(state.operationalLineEditor.stroke) || null,
      width: normalizeOperationGraphicWidth(state.operationalLineEditor.width),
      opacity: normalizeOperationGraphicOpacity(state.operationalLineEditor.opacity),
      attachedCounterIds: [],
    });
    state.operationalLineEditor.counter += 1;
    state.operationalLineEditor.selectedId = id;
    state.operationalLineEditor.active = false;
    state.operationalLineEditor.mode = "edit";
    state.operationalLineEditor.points = [...points];
    state.operationalLineEditor.selectedVertexIndex = -1;
    state.strategicOverlayUi = {
      ...(state.strategicOverlayUi || {}),
      activeMode: "idle",
      modalEntityId: id,
      modalEntityType: "operational-line",
      modalSection: "line",
    };
    state.operationalLinesDirty = true;
    commitHistoryEntry({
      kind: "create-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("create-operational-line");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function selectOperationalLineById(id) {
    ensureOperationalLineEditorState();
    ensureOperationGraphicsEditorState();
    state.operationGraphicsEditor.selectedId = null;
    const selectedId = String(id || "").trim();
    const line = getOperationalLineById(selectedId);
    state.operationalLineEditor.selectedId = selectedId || null;
    if (line) {
      state.operationalLineEditor.kind = String(line.kind || defaultOperationalLineKind);
      state.operationalLineEditor.label = String(line.label || "");
      state.operationalLineEditor.stylePreset = normalizeOperationalLineStylePreset(line.stylePreset, line.kind);
      state.operationalLineEditor.stroke = normalizeOperationGraphicStroke(line.stroke);
      state.operationalLineEditor.width = normalizeOperationGraphicWidth(line.width);
      state.operationalLineEditor.opacity = normalizeOperationGraphicOpacity(line.opacity);
      state.operationalLineEditor.points = Array.isArray(line.points) ? [...line.points] : [];
      state.operationalLineEditor.mode = "edit";
    } else {
      state.operationalLineEditor.points = [];
      state.operationalLineEditor.mode = "idle";
    }
    state.strategicOverlayUi = {
      ...(state.strategicOverlayUi || {}),
      modalEntityId: selectedId,
      modalEntityType: line ? "operational-line" : "",
      modalSection: "line",
    };
    state.operationalLinesDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function updateSelectedOperationalLine(partial = {}) {
    ensureOperationalLineEditorState();
    const selectedId = String(state.operationalLineEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const line = getOperationalLineById(selectedId);
    if (!line) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextKind = partial.kind
      ? String(partial.kind || defaultOperationalLineKind).trim().toLowerCase()
      : String(line.kind || defaultOperationalLineKind);
    if (partial.kind !== undefined) line.kind = nextKind;
    if (partial.label !== undefined) line.label = String(partial.label || "");
    if (partial.stylePreset !== undefined) line.stylePreset = normalizeOperationalLineStylePreset(partial.stylePreset, nextKind);
    if (partial.stroke !== undefined) line.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
    if (partial.width !== undefined) line.width = normalizeOperationGraphicWidth(partial.width);
    if (partial.opacity !== undefined) line.opacity = normalizeOperationGraphicOpacity(partial.opacity);
    if (Array.isArray(partial.attachedCounterIds)) {
      line.attachedCounterIds = partial.attachedCounterIds.map((value) => String(value || "").trim()).filter(Boolean);
    }
    selectOperationalLineById(selectedId);
    state.operationalLinesDirty = true;
    commitHistoryEntry({
      kind: "update-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("update-operational-line");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function deleteSelectedOperationalLine() {
    ensureOperationalLineEditorState();
    const selectedId = String(state.operationalLineEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextLines = (state.operationalLines || []).filter((entry) => String(entry?.id || "") !== selectedId);
    if (nextLines.length === (state.operationalLines || []).length) return false;
    state.operationalLines = nextLines;
    state.unitCounters = (state.unitCounters || []).map((counter) => {
      if (String(counter?.attachment?.lineId || "") !== selectedId) return counter;
      return {
        ...counter,
        attachment: null,
        layoutAnchor: {
          ...(counter.layoutAnchor || {}),
          kind: "feature",
          key: String(counter.anchor?.featureId || ""),
        },
      };
    });
    unitCounterDomain.syncOperationalLineAttachedCounterIds();
    state.operationalLineEditor.selectedId = null;
    state.operationalLineEditor.points = [];
    state.operationalLineEditor.mode = "idle";
    state.operationalLinesDirty = true;
    state.unitCountersDirty = true;
    commitHistoryEntry({
      kind: "delete-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-operational-line");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function cancelActiveStrategicInteractionModes() {
    let cancelled = false;
    if (state.unitCounterEditor?.active) {
      unitCounterDomain.cancelUnitCounterPlacement();
      cancelled = true;
    }
    if (state.operationalLineEditor?.active) {
      cancelOperationalLineDraw();
      cancelled = true;
    }
    if (state.operationGraphicsEditor?.active) {
      operationGraphicsDomain.cancelOperationGraphicDraw();
      cancelled = true;
    }
    return cancelled;
  }

  return {
    ...specialZonesDomain,
    ...operationGraphicsDomain,
    appendOperationalLineVertexFromEvent,
    cancelActiveStrategicInteractionModes,
    cancelOperationalLineDraw,
    ...unitCounterHelpers,
    ...unitCounterDomain,
    deleteSelectedOperationalLine,
    finishOperationalLineDraw,
    selectOperationalLineById,
    startOperationalLineDraw,
    undoOperationalLineVertex,
    updateSelectedOperationalLine,
  };
}
