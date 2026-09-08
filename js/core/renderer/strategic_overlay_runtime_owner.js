import { createOperationGraphicsRuntimeDomain } from "./strategic_overlay_runtime/operation_graphics_runtime_domain.js";
import { createSpecialZonesRuntimeDomain } from "./strategic_overlay_runtime/special_zones_runtime_domain.js";
import { createUnitCounterRuntimeDomain } from "./strategic_overlay_runtime/unit_counter_runtime_domain.js";
import { createUnitCounterRuntimeHelpers } from "./strategic_overlay_runtime/unit_counter_runtime_helpers.js";
import {
  commitStrategicOverlayCollectionsState,
  patchStrategicOverlayEntityState,
  patchStrategicOverlayEditorState,
  setStrategicOverlayDirtyState,
} from "../state/actions/strategic_overlay_actions.js";
import { commitSpecialZoneLayersState } from "../state/actions/special_zone_actions.js";

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
    normalizeSpecialZoneLayersState = (value) => value,
    normalizeUnitCounterBaseFillColor = (value) => String(value || "").trim(),
    normalizeUnitCounterNationSource = (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
    normalizeUnitCounterSizeToken = (value) => String(value || "medium").trim().toLowerCase(),
    normalizeUnitCounterStatPercent = (value, fallback = defaultUnitCounterOrganizationPct) => Number(value) || fallback,
    normalizeUnitCounterStatsPresetId = (value, fallback = "regular") => String(value || fallback).trim().toLowerCase(),
    refreshSpecialZonesWorkbenchUi = () => {},
    renderNow = () => {},
    renderOperationGraphicsIfNeeded = () => {},
    renderSpecialZonesIfNeeded = () => {},
    renderSpecialZoneEditorOverlay = () => {},
    resetUnitCounterEditorState = () => {},
    showToast = () => {},
    t = (key) => String(key || ""),
    updateSpecialZoneEditorUI = () => {},
    updateSpecialZoneLayerMembership = (layers) => layers,
    updateStrategicOverlayUi = () => {},
  } = helpers;

  let specialZoneMembershipDragSession = null;
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
    captureHistoryState: (options) => captureHistoryState({ ...options, strategicOverlay: ["operationGraphics"] }),
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
      captureHistoryState: (options) => captureHistoryState({ ...options, strategicOverlay: ["unitCounters", "operationalLines"] }),
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
    patchStrategicOverlayEditorState(state, "operationalLineEditor", { points: [...state.operationalLineEditor.points, coord] });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
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
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { selectedId: null });
    patchStrategicOverlayEditorState(state, "operationalLineEditor", {
      active: true,
      mode: "draw",
      points: [],
      kind: String(kind || defaultOperationalLineKind).trim().toLowerCase(),
      label: String(label || ""),
      stylePreset: normalizeOperationalLineStylePreset(stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(stroke),
      width: normalizeOperationGraphicWidth(width),
      opacity: normalizeOperationGraphicOpacity(opacity),
      selectedId: null,
      selectedVertexIndex: -1,
    });
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
      activeMode: state.operationalLineEditor.kind,
      modalEntityType: "operational-line",
      modalSection: "line",
    });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function undoOperationalLineVertex() {
    ensureOperationalLineEditorState();
    if (!state.operationalLineEditor.active || !state.operationalLineEditor.points.length) return;
    patchStrategicOverlayEditorState(state, "operationalLineEditor", { points: Array.from(state.operationalLineEditor.points).slice(0, -1) });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function cancelOperationalLineDraw() {
    ensureOperationalLineEditorState();
    patchStrategicOverlayEditorState(state, "operationalLineEditor", {
      active: false,
      mode: state.operationalLineEditor.selectedId ? "edit" : "idle",
      points: [],
      selectedVertexIndex: -1,
    });
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", { activeMode: "idle" });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function finishOperationalLineDraw() {
    ensureOperationalLineEditorState();
    const kind = String(state.operationalLineEditor.kind || defaultOperationalLineKind);
    const points = Array.isArray(state.operationalLineEditor.points) ? Array.from(state.operationalLineEditor.points) : [];
    if (!state.operationalLineEditor.active || points.length < getOperationalLineMinPoints(kind)) {
      return false;
    }
    ensureOperationalLineCounter();
    const before = captureHistoryState({ strategicOverlay: ["operationalLines"] });
    const id = `opl_${state.operationalLineEditor.counter}`;
    commitStrategicOverlayCollectionsState(state, {
      operationalLines: [...Array.from(state.operationalLines), {
        id,
        kind,
        label: String(state.operationalLineEditor.label || "").trim(),
        points: [...points],
        stylePreset: normalizeOperationalLineStylePreset(state.operationalLineEditor.stylePreset, kind),
        stroke: normalizeOperationGraphicStroke(state.operationalLineEditor.stroke) || null,
        width: normalizeOperationGraphicWidth(state.operationalLineEditor.width),
        opacity: normalizeOperationGraphicOpacity(state.operationalLineEditor.opacity),
        attachedCounterIds: [],
      }],
    });
    patchStrategicOverlayEditorState(state, "operationalLineEditor", {
      counter: state.operationalLineEditor.counter + 1,
      selectedId: id,
      active: false,
      mode: "edit",
      points: [...points],
      selectedVertexIndex: -1,
    });
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
      activeMode: "idle",
      modalEntityId: id,
      modalEntityType: "operational-line",
      modalSection: "line",
    });
    commitHistoryEntry({
      kind: "create-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: ["operationalLines"] }),
    });
    markDirty("create-operational-line");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function selectOperationalLineById(id) {
    ensureOperationalLineEditorState();
    ensureOperationGraphicsEditorState();
    patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { selectedId: null });
    const selectedId = String(id || "").trim();
    const line = getOperationalLineById(selectedId);
    const editorPatch = { selectedId: selectedId || null };
    if (line) {
      Object.assign(editorPatch, {
        kind: String(line.kind || defaultOperationalLineKind),
        label: String(line.label || ""),
        stylePreset: normalizeOperationalLineStylePreset(line.stylePreset, line.kind),
        stroke: normalizeOperationGraphicStroke(line.stroke),
        width: normalizeOperationGraphicWidth(line.width),
        opacity: normalizeOperationGraphicOpacity(line.opacity),
        points: Array.isArray(line.points) ? [...line.points] : [],
        mode: "edit",
      });
    } else {
      Object.assign(editorPatch, { points: [], mode: "idle" });
    }
    patchStrategicOverlayEditorState(state, "operationalLineEditor", editorPatch);
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
      modalEntityId: selectedId,
      modalEntityType: line ? "operational-line" : "",
      modalSection: "line",
    });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    updateStrategicOverlayUi();
    renderNow();
  }

  function updateSelectedOperationalLine(partial = {}) {
    ensureOperationalLineEditorState();
    const selectedId = String(state.operationalLineEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const line = getOperationalLineById(selectedId);
    if (!line) return false;
    const before = captureHistoryState({ strategicOverlay: ["operationalLines"] });
    const nextKind = partial.kind
      ? String(partial.kind || defaultOperationalLineKind).trim().toLowerCase()
      : String(line.kind || defaultOperationalLineKind);
    const entityPatch = {};
    if (partial.kind !== undefined) entityPatch.kind = nextKind;
    if (partial.label !== undefined) entityPatch.label = String(partial.label || "");
    if (partial.stylePreset !== undefined) entityPatch.stylePreset = normalizeOperationalLineStylePreset(partial.stylePreset, nextKind);
    if (partial.stroke !== undefined) entityPatch.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
    if (partial.width !== undefined) entityPatch.width = normalizeOperationGraphicWidth(partial.width);
    if (partial.opacity !== undefined) entityPatch.opacity = normalizeOperationGraphicOpacity(partial.opacity);
    if (Array.isArray(partial.attachedCounterIds)) {
      entityPatch.attachedCounterIds = partial.attachedCounterIds.map((value) => String(value || "").trim()).filter(Boolean);
    }
    patchStrategicOverlayEntityState(state, "operationalLines", selectedId, entityPatch);
    selectOperationalLineById(selectedId);
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    commitHistoryEntry({
      kind: "update-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: ["operationalLines"] }),
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
    const before = captureHistoryState({ strategicOverlay: ["operationalLines", "unitCounters"] });
    const nextLines = (state.operationalLines || []).filter((entry) => String(entry?.id || "") !== selectedId);
    if (nextLines.length === (state.operationalLines || []).length) return false;
    const nextCounters = (state.unitCounters || []).map((counter) => {
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
    commitStrategicOverlayCollectionsState(state, {
      operationalLines: nextLines,
      unitCounters: nextCounters,
    });
    unitCounterDomain.syncOperationalLineAttachedCounterIds();
    patchStrategicOverlayEditorState(state, "operationalLineEditor", { selectedId: null, points: [], mode: "idle" });
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    setStrategicOverlayDirtyState(state, "unitCountersDirty", true);
    commitHistoryEntry({
      kind: "delete-operational-line",
      before,
      after: captureHistoryState({ strategicOverlay: ["operationalLines", "unitCounters"] }),
    });
    markDirty("delete-operational-line");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function getActiveSpecialZoneMembershipLayerId() {
    const normalized = normalizeSpecialZoneLayersState(state.specialZoneLayers);
    return String(normalized?.activeLayerId || "").trim();
  }

  function resolveSpecialZoneMembershipClickMode({
    membershipTool = "multi",
    brushMode = "add",
  } = {}) {
    const normalizedTool = String(membershipTool || "multi").trim().toLowerCase();
    if (normalizedTool === "single") return "replace";
    if (normalizedTool === "brush") return String(brushMode || "add").trim().toLowerCase() === "remove" ? "remove" : "add";
    return "toggle";
  }

  function resolveSpecialZoneMembershipDragMode({
    membershipTool = "multi",
    brushMode = "add",
    altKey = false,
  } = {}) {
    const normalizedTool = String(membershipTool || "multi").trim().toLowerCase();
    if (normalizedTool === "brush") return String(brushMode || "add").trim().toLowerCase() === "remove" ? "remove" : "add";
    return altKey ? "remove" : "add";
  }

  function applySpecialZoneMembershipFeature(featureId = "", mode = "toggle", layerId = "") {
    const normalizedFeatureId = String(featureId || "").trim();
    const normalizedLayerId = String(layerId || "").trim();
    const normalizedMode = String(mode || "toggle").trim().toLowerCase();
    if (!normalizedFeatureId || !normalizedLayerId) return false;
    const normalizedLayers = normalizeSpecialZoneLayersState(state.specialZoneLayers);
    const nextLayers = updateSpecialZoneLayerMembership(
      normalizedLayers,
      normalizedLayerId,
      [normalizedFeatureId],
      normalizedMode,
    );
    commitSpecialZoneLayersState(state, nextLayers);
    markDirty(`special-zone-membership-${normalizedMode}`);
    return true;
  }

  function commitSpecialZoneMembershipClick({
    featureId = "",
    membershipTool = "multi",
    brushMode = "add",
  } = {}) {
    const layerId = getActiveSpecialZoneMembershipLayerId();
    if (!layerId) return false;
    const mode = resolveSpecialZoneMembershipClickMode({ membershipTool, brushMode });
    const before = captureHistoryState({ strategicOverlay: ["specialZoneLayers"] });
    if (!applySpecialZoneMembershipFeature(featureId, mode, layerId)) return false;
    commitHistoryEntry({
      kind: `special-zone-membership-${mode}`,
      before,
      after: captureHistoryState({ strategicOverlay: ["specialZoneLayers"] }),
    });
    renderSpecialZonesIfNeeded({ force: true });
    refreshSpecialZonesWorkbenchUi();
    return true;
  }

  function beginSpecialZoneMembershipDrag({
    membershipTool = "multi",
    brushMode = "add",
    altKey = false,
  } = {}) {
    const layerId = getActiveSpecialZoneMembershipLayerId();
    if (!layerId) {
      specialZoneMembershipDragSession = null;
      return false;
    }
    specialZoneMembershipDragSession = {
      before: captureHistoryState({ strategicOverlay: ["specialZoneLayers"] }),
      changed: false,
      layerId,
      mode: resolveSpecialZoneMembershipDragMode({ membershipTool, brushMode, altKey }),
      visited: new Set(),
    };
    return true;
  }

  function applySpecialZoneMembershipDragFeature(featureId = "") {
    if (!specialZoneMembershipDragSession) return false;
    const normalizedFeatureId = String(featureId || "").trim();
    if (!normalizedFeatureId || specialZoneMembershipDragSession.visited.has(normalizedFeatureId)) return false;
    specialZoneMembershipDragSession.visited.add(normalizedFeatureId);
    const changed = applySpecialZoneMembershipFeature(
      normalizedFeatureId,
      specialZoneMembershipDragSession.mode,
      specialZoneMembershipDragSession.layerId,
    );
    specialZoneMembershipDragSession.changed = specialZoneMembershipDragSession.changed || changed;
    return changed;
  }

  function hasSpecialZoneMembershipDragSession() {
    return !!specialZoneMembershipDragSession;
  }

  function finishSpecialZoneMembershipDrag() {
    const current = specialZoneMembershipDragSession;
    specialZoneMembershipDragSession = null;
    if (!current) return { active: false, changed: false };
    if (!current.changed) return { active: true, changed: false };
    commitHistoryEntry({
      kind: `special-zone-membership-drag-${current.mode}`,
      before: current.before,
      after: captureHistoryState({ strategicOverlay: ["specialZoneLayers"] }),
    });
    renderSpecialZonesIfNeeded({ force: true });
    refreshSpecialZonesWorkbenchUi();
    return { active: true, changed: true };
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
    applySpecialZoneMembershipDragFeature,
    beginSpecialZoneMembershipDrag,
    cancelActiveStrategicInteractionModes,
    cancelOperationalLineDraw,
    commitSpecialZoneMembershipClick,
    ...unitCounterHelpers,
    ...unitCounterDomain,
    deleteSelectedOperationalLine,
    finishOperationalLineDraw,
    finishSpecialZoneMembershipDrag,
    hasSpecialZoneMembershipDragSession,
    selectOperationalLineById,
    startOperationalLineDraw,
    undoOperationalLineVertex,
    updateSelectedOperationalLine,
  };
}
