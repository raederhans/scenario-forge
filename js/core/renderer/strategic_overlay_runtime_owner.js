// Strategic overlay runtime owner for Batch 5.
// It owns editor-side mutations, history commits, and UI refresh ordering for
// the safest transaction lanes, while map_renderer.js keeps the stable facade.
export function createStrategicOverlayRuntimeOwner({
  state,
  constants = {},
  helpers = {},
} = {}) {
  const {
    defaultOperationGraphicKind = "offensive",
    defaultSpecialZoneType = "custom",
    defaultUnitCounterEquipmentPct = 74,
    defaultUnitCounterOrganizationPct = 78,
    defaultUnitCounterPresetId = "inf",
    defaultUnitCounterRenderer = "game",
  } = constants;

  const {
    canonicalCountryCode = (value = "") => String(value || "").trim().toUpperCase(),
    captureHistoryState = () => ({}),
    commitHistoryEntry = () => {},
    ensureManualSpecialZoneCounter = () => {},
    ensureOperationGraphicCounter = () => {},
    ensureOperationGraphicsEditorState = () => {},
    ensureSpecialZoneEditorState = () => {},
    ensureUnitCounterEditorState = () => {},
    getDisplayOwnerCode = () => "",
    getFeatureOwnerCode = () => "",
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
    normalizeUnitCounterNationSource = (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
    renderNow = () => {},
    renderOperationGraphicsIfNeeded = () => {},
    renderSpecialZoneEditorOverlay = () => {},
    showToast = () => {},
    t = (key) => String(key || ""),
    updateSpecialZoneEditorUI = () => {},
    updateStrategicOverlayUi = () => {},
  } = helpers;

  function appendSpecialZoneVertexFromEvent(event) {
    ensureSpecialZoneEditorState();
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    state.specialZoneEditor.vertices.push(coord);
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderSpecialZoneEditorOverlay();
    return true;
  }

  function startSpecialZoneDraw({ zoneType = defaultSpecialZoneType, label = "" } = {}) {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.active = true;
    state.specialZoneEditor.vertices = [];
    state.specialZoneEditor.zoneType = String(zoneType || defaultSpecialZoneType);
    state.specialZoneEditor.label = String(label || "");
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function undoSpecialZoneVertex() {
    ensureSpecialZoneEditorState();
    if (!state.specialZoneEditor.active || !state.specialZoneEditor.vertices.length) return;
    state.specialZoneEditor.vertices.pop();
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function cancelSpecialZoneDraw() {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.active = false;
    state.specialZoneEditor.vertices = [];
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function finishSpecialZoneDraw() {
    ensureSpecialZoneEditorState();
    const vertices = state.specialZoneEditor.vertices || [];
    if (!state.specialZoneEditor.active || vertices.length < 3) {
      cancelSpecialZoneDraw();
      return false;
    }

    ensureManualSpecialZoneCounter();
    const id = `manual_sz_${state.specialZoneEditor.counter}`;
    const zoneType = String(state.specialZoneEditor.zoneType || defaultSpecialZoneType);
    const labelText = String(state.specialZoneEditor.label || `${zoneType} zone`).trim() || `${zoneType} zone`;
    state.manualSpecialZones.features.push({
      type: "Feature",
      properties: {
        __source: "manual",
        claimants: [],
        cntr_code: "",
        id,
        label: labelText,
        name: labelText,
        type: zoneType,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0]]],
      },
    });
    state.specialZoneEditor.counter += 1;
    state.specialZoneEditor.selectedId = id;
    state.specialZoneEditor.active = false;
    state.specialZoneEditor.vertices = [];
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
    return true;
  }

  function selectSpecialZoneById(id) {
    ensureSpecialZoneEditorState();
    state.specialZoneEditor.selectedId = String(id || "").trim() || null;
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
  }

  function deleteSelectedManualSpecialZone() {
    ensureSpecialZoneEditorState();
    const selectedId = String(state.specialZoneEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = getManualSpecialZoneFeatures().length;
    state.manualSpecialZones.features = getManualSpecialZoneFeatures().filter(
      (feature) => String(feature?.properties?.id || "").trim() !== selectedId
    );
    if (before === state.manualSpecialZones.features.length) return false;
    state.specialZoneEditor.selectedId = null;
    state.specialZonesOverlayDirty = true;
    updateSpecialZoneEditorUI();
    renderNow();
    return true;
  }

  function appendOperationGraphicVertexFromEvent(event) {
    ensureOperationGraphicsEditorState();
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    state.operationGraphicsEditor.points.push(coord);
    state.operationGraphicsDirty = true;
    updateStrategicOverlayUi();
    renderOperationGraphicsIfNeeded({ force: true });
    return true;
  }

  function startOperationGraphicDraw({
    kind = defaultOperationGraphicKind,
    label = "",
    opacity = 1,
    stroke = "",
    stylePreset = defaultOperationGraphicKind,
    width = 0,
  } = {}) {
    ensureOperationGraphicsEditorState();
    state.operationGraphicsEditor.active = true;
    state.operationGraphicsEditor.mode = "draw";
    state.operationGraphicsEditor.points = [];
    state.operationGraphicsEditor.kind = String(kind || defaultOperationGraphicKind);
    state.operationGraphicsEditor.label = String(label || "");
    state.operationGraphicsEditor.stylePreset = normalizeOperationGraphicStylePreset(stylePreset, kind);
    state.operationGraphicsEditor.stroke = normalizeOperationGraphicStroke(stroke);
    state.operationGraphicsEditor.width = normalizeOperationGraphicWidth(width);
    state.operationGraphicsEditor.opacity = normalizeOperationGraphicOpacity(opacity);
    state.operationGraphicsEditor.selectedId = null;
    state.operationGraphicsEditor.selectedVertexIndex = -1;
    state.operationGraphicsDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function undoOperationGraphicVertex() {
    ensureOperationGraphicsEditorState();
    if (!state.operationGraphicsEditor.active || !state.operationGraphicsEditor.points.length) return;
    state.operationGraphicsEditor.points.pop();
    state.operationGraphicsDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function cancelOperationGraphicDraw() {
    ensureOperationGraphicsEditorState();
    state.operationGraphicsEditor.active = false;
    state.operationGraphicsEditor.mode = state.operationGraphicsEditor.selectedId ? "edit" : "idle";
    state.operationGraphicsEditor.points = [];
    state.operationGraphicsEditor.selectedVertexIndex = -1;
    state.operationGraphicsDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function finishOperationGraphicDraw() {
    ensureOperationGraphicsEditorState();
    const kind = String(state.operationGraphicsEditor.kind || defaultOperationGraphicKind);
    const minPoints = getOperationGraphicMinPoints(kind);
    const points = Array.isArray(state.operationGraphicsEditor.points) ? state.operationGraphicsEditor.points : [];
    if (!state.operationGraphicsEditor.active || points.length < minPoints) {
      cancelOperationGraphicDraw();
      return false;
    }
    ensureOperationGraphicCounter();
    const before = captureHistoryState({ strategicOverlay: true });
    const id = `opg_${state.operationGraphicsEditor.counter}`;
    state.operationGraphics.push({
      id,
      kind,
      label: String(state.operationGraphicsEditor.label || "").trim(),
      points: [...points],
      stylePreset: normalizeOperationGraphicStylePreset(state.operationGraphicsEditor.stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(state.operationGraphicsEditor.stroke) || null,
      width: normalizeOperationGraphicWidth(state.operationGraphicsEditor.width),
      opacity: normalizeOperationGraphicOpacity(state.operationGraphicsEditor.opacity),
    });
    state.operationGraphicsEditor.counter += 1;
    state.operationGraphicsEditor.selectedId = id;
    state.operationGraphicsEditor.active = false;
    state.operationGraphicsEditor.mode = "edit";
    state.operationGraphicsEditor.points = [...points];
    state.operationGraphicsEditor.selectedVertexIndex = -1;
    state.operationGraphicsDirty = true;
    commitHistoryEntry({
      kind: "finish-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("finish-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function selectOperationGraphicById(id) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(id || "").trim();
    const graphic = getOperationGraphicById(selectedId);
    state.operationGraphicsEditor.selectedId = selectedId || null;
    state.operationGraphicsEditor.selectedVertexIndex = -1;
    if (graphic) {
      state.operationGraphicsEditor.kind = String(graphic.kind || defaultOperationGraphicKind);
      state.operationGraphicsEditor.label = String(graphic.label || "");
      state.operationGraphicsEditor.stylePreset = normalizeOperationGraphicStylePreset(graphic.stylePreset, graphic.kind);
      state.operationGraphicsEditor.stroke = normalizeOperationGraphicStroke(graphic.stroke);
      state.operationGraphicsEditor.width = normalizeOperationGraphicWidth(graphic.width);
      state.operationGraphicsEditor.opacity = normalizeOperationGraphicOpacity(graphic.opacity);
      state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? [...graphic.points] : [];
      state.operationGraphicsEditor.mode = "edit";
    } else {
      state.operationGraphicsEditor.points = [];
      state.operationGraphicsEditor.mode = "idle";
    }
    state.operationGraphicsDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function deleteSelectedOperationGraphic() {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextGraphics = (state.operationGraphics || []).filter((entry) => String(entry?.id || "") !== selectedId);
    if (nextGraphics.length === (state.operationGraphics || []).length) return false;
    state.operationGraphics = nextGraphics;
    state.operationGraphicsEditor.selectedId = null;
    state.operationGraphicsEditor.points = [];
    state.operationGraphicsEditor.selectedVertexIndex = -1;
    state.operationGraphicsEditor.mode = "idle";
    state.operationGraphicsDirty = true;
    commitHistoryEntry({
      kind: "delete-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function updateSelectedOperationGraphic(partial = {}) {
    ensureOperationGraphicsEditorState();
    const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const target = (state.operationGraphics || []).find((entry) => String(entry?.id || "") === selectedId);
    if (!target) return false;
    const nextKind = partial.kind ? String(partial.kind || defaultOperationGraphicKind) : String(target.kind || defaultOperationGraphicKind);
    if (partial.kind && Array.isArray(target.points) && target.points.length < getOperationGraphicMinPoints(nextKind)) {
      showToast(t("Add more vertices before switching this graphic to a closed style.", "ui"), {
        title: t("More points required", "ui"),
        tone: "warning",
      });
      return false;
    }
    const before = captureHistoryState({ strategicOverlay: true });
    if (partial.kind) target.kind = nextKind;
    if (partial.label !== undefined) target.label = String(partial.label || "");
    if (partial.stylePreset !== undefined) target.stylePreset = normalizeOperationGraphicStylePreset(partial.stylePreset, target.kind);
    if (partial.stroke !== undefined) target.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
    if (partial.width !== undefined) target.width = normalizeOperationGraphicWidth(partial.width);
    if (partial.opacity !== undefined) target.opacity = normalizeOperationGraphicOpacity(partial.opacity);
    state.operationGraphicsEditor.points = Array.isArray(target.points) ? [...target.points] : [];
    selectOperationGraphicById(selectedId);
    state.operationGraphicsDirty = true;
    commitHistoryEntry({
      kind: "update-operation-graphic",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("update-operation-graphic");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function deleteSelectedOperationGraphicVertex() {
    ensureOperationGraphicsEditorState();
    const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
    const vertexIndex = Number(state.operationGraphicsEditor.selectedVertexIndex);
    if (!graphic || !Number.isInteger(vertexIndex) || vertexIndex < 0) return false;
    const minPoints = getOperationGraphicMinPoints(graphic.kind);
    if (!Array.isArray(graphic.points) || graphic.points.length <= minPoints) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    graphic.points.splice(vertexIndex, 1);
    state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? [...graphic.points] : [];
    state.operationGraphicsEditor.selectedVertexIndex = Math.min(vertexIndex, graphic.points.length - 1);
    state.operationGraphicsDirty = true;
    commitHistoryEntry({
      kind: "delete-operation-graphic-vertex",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-operation-graphic-vertex");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function getUnitCounterPreviewData(partialCounter = {}) {
    ensureUnitCounterEditorState();
    const nextCombatState = getNormalizedUnitCounterCombatState({
      baseFillColor: partialCounter.baseFillColor ?? state.unitCounterEditor?.baseFillColor ?? "",
      equipmentPct: partialCounter.equipmentPct ?? state.unitCounterEditor?.equipmentPct ?? defaultUnitCounterEquipmentPct,
      organizationPct: partialCounter.organizationPct ?? state.unitCounterEditor?.organizationPct ?? defaultUnitCounterOrganizationPct,
      statsPresetId: partialCounter.statsPresetId || state.unitCounterEditor?.statsPresetId || "regular",
      statsSource: partialCounter.statsSource || state.unitCounterEditor?.statsSource || "preset",
    });
    return getUnitCounterCardModel({
      renderer: partialCounter.renderer || state.unitCounterEditor?.renderer || defaultUnitCounterRenderer,
      sidc: partialCounter.sidc || partialCounter.symbolCode || state.unitCounterEditor?.sidc || state.unitCounterEditor?.symbolCode || "",
      symbolCode: partialCounter.symbolCode || partialCounter.sidc || state.unitCounterEditor?.symbolCode || state.unitCounterEditor?.sidc || "",
      nationTag: partialCounter.nationTag || state.unitCounterEditor?.nationTag || "",
      presetId: partialCounter.presetId || state.unitCounterEditor?.presetId || defaultUnitCounterPresetId,
      unitType: partialCounter.unitType || state.unitCounterEditor?.unitType || "",
      echelon: partialCounter.echelon || state.unitCounterEditor?.echelon || "",
      label: partialCounter.label || state.unitCounterEditor?.label || "",
      subLabel: partialCounter.subLabel || state.unitCounterEditor?.subLabel || "",
      strengthText: partialCounter.strengthText || state.unitCounterEditor?.strengthText || "",
      baseFillColor: nextCombatState.baseFillColor,
      organizationPct: nextCombatState.organizationPct,
      equipmentPct: nextCombatState.equipmentPct,
      statsPresetId: nextCombatState.statsPresetId,
      statsSource: nextCombatState.statsSource,
      size: partialCounter.size || state.unitCounterEditor?.size || "medium",
    });
  }

  function resolveUnitCounterNationForPlacement(featureId = "", manualTag = "", preferredSource = "display") {
    const normalizedFeatureId = String(featureId || "").trim();
    const normalizedManualTag = canonicalCountryCode(manualTag);
    if (normalizedManualTag) {
      return { tag: normalizedManualTag, source: "manual" };
    }
    const requestedSource = normalizeUnitCounterNationSource(preferredSource, "display");
    const feature = normalizedFeatureId ? state.landIndex?.get(normalizedFeatureId) || null : null;
    const displayTag = canonicalCountryCode(
      normalizedFeatureId ? getDisplayOwnerCode(feature, normalizedFeatureId) : ""
    );
    if (requestedSource === "display" && displayTag) {
      return { tag: displayTag, source: "display" };
    }
    const controllerTag = canonicalCountryCode(state.scenarioControllersByFeatureId?.[normalizedFeatureId] || "");
    if (requestedSource === "controller" && controllerTag) {
      return { tag: controllerTag, source: "controller" };
    }
    const ownerTag = canonicalCountryCode(getFeatureOwnerCode(normalizedFeatureId) || "");
    if (requestedSource === "controller" && ownerTag) {
      return { tag: ownerTag, source: "controller" };
    }
    if (requestedSource === "owner" && ownerTag) {
      return { tag: ownerTag, source: "owner" };
    }
    if (requestedSource === "display" && ownerTag) {
      return { tag: ownerTag, source: "display" };
    }
    if (requestedSource === "display" && controllerTag) {
      return { tag: controllerTag, source: "display" };
    }
    const activeTag = canonicalCountryCode(state.activeSovereignCode || state.selectedInspectorCountryCode || "");
    if (activeTag) {
      return { tag: activeTag, source: requestedSource };
    }
    return { tag: "", source: requestedSource };
  }

  return {
    appendOperationGraphicVertexFromEvent,
    appendSpecialZoneVertexFromEvent,
    cancelOperationGraphicDraw,
    cancelSpecialZoneDraw,
    deleteSelectedManualSpecialZone,
    deleteSelectedOperationGraphic,
    deleteSelectedOperationGraphicVertex,
    finishOperationGraphicDraw,
    finishSpecialZoneDraw,
    getUnitCounterPreviewData,
    resolveUnitCounterNationForPlacement,
    selectOperationGraphicById,
    selectSpecialZoneById,
    startOperationGraphicDraw,
    startSpecialZoneDraw,
    undoOperationGraphicVertex,
    undoSpecialZoneVertex,
    updateSelectedOperationGraphic,
  };
}
