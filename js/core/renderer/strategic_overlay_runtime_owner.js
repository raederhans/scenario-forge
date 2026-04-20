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

  function syncOperationalLineAttachedCounterIds() {
    const attachedByLineId = new Map();
    (state.unitCounters || []).forEach((counter) => {
      const lineId = String(counter?.attachment?.lineId || "").trim();
      if (!lineId) return;
      if (!attachedByLineId.has(lineId)) {
        attachedByLineId.set(lineId, []);
      }
      attachedByLineId.get(lineId).push(String(counter.id || "").trim());
    });
    state.operationalLines = (state.operationalLines || []).map((line) => ({
      ...line,
      attachedCounterIds: attachedByLineId.get(String(line.id || "").trim()) || [],
    }));
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
    syncOperationalLineAttachedCounterIds();
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

  function placeUnitCounterFromEvent(event) {
    ensureUnitCounterEditorState();
    if (!state.unitCounterEditor.active) return false;
    const coord = getMapLonLatFromEvent(event);
    if (!coord) return false;
    ensureUnitCounterCounter();
    const hit = getHitFromEvent(event, {
      enableSnap: true,
      snapPx: defaultHitSnapRadiusClickPx,
      eventType: "unit-counter-place",
    });
    const featureId = hit?.targetType === "land" ? String(hit.id || "") : "";
    const requestedNationSource = normalizeUnitCounterNationSource(state.unitCounterEditor.nationSource, "display");
    const nationResolution = requestedNationSource === "manual"
      ? resolveUnitCounterNationForPlacement("", state.unitCounterEditor.nationTag, "manual")
      : resolveUnitCounterNationForPlacement(featureId, "", requestedNationSource);
    const preset = getUnitCounterPresetById(state.unitCounterEditor.presetId || defaultUnitCounterPresetId);
    const attachment = state.unitCounterEditor.attachment?.lineId
      ? {
        kind: String(state.unitCounterEditor.attachment.kind || defaultCounterAttachmentKind).trim().toLowerCase() || defaultCounterAttachmentKind,
        lineId: String(state.unitCounterEditor.attachment.lineId || "").trim(),
      }
      : null;
    const before = captureHistoryState({ strategicOverlay: true });
    const id = `unit_${state.unitCounterEditor.counter}`;
    const nextToken = String(
      state.unitCounterEditor.sidc
      || state.unitCounterEditor.symbolCode
      || preset.baseSidc
      || (String(state.unitCounterEditor.renderer || "").toLowerCase() === "milstd" ? defaultUnitCounterMilstdSidc : "")
    ).trim().toUpperCase();
    const normalizedCombatState = getNormalizedUnitCounterCombatState(state.unitCounterEditor);
    state.unitCounters.push({
      id,
      renderer: String(state.unitCounterEditor.renderer || preset.defaultRenderer || state.annotationView?.unitRendererDefault || defaultUnitCounterRenderer),
      sidc: nextToken,
      symbolCode: nextToken,
      label: String(state.unitCounterEditor.label || "").trim(),
      nationTag: nationResolution.tag,
      nationSource: requestedNationSource,
      presetId: preset.id,
      iconId: String(state.unitCounterEditor.iconId || preset.iconId || "").trim().toLowerCase(),
      unitType: String(state.unitCounterEditor.unitType || preset.unitType || "").trim().toUpperCase(),
      echelon: String(state.unitCounterEditor.echelon || preset.defaultEchelon || "").trim().toLowerCase(),
      subLabel: String(state.unitCounterEditor.subLabel || "").trim(),
      strengthText: String(state.unitCounterEditor.strengthText || "").trim(),
      baseFillColor: normalizedCombatState.baseFillColor,
      organizationPct: normalizedCombatState.organizationPct,
      equipmentPct: normalizedCombatState.equipmentPct,
      statsPresetId: normalizedCombatState.statsPresetId,
      statsSource: normalizedCombatState.statsSource,
      size: normalizeUnitCounterSizeToken(state.unitCounterEditor.size || "medium"),
      facing: 0,
      zIndex: state.unitCounters.length,
      anchor: {
        lon: coord[0],
        lat: coord[1],
        featureId,
      },
      layoutAnchor: {
        kind: attachment ? "attachment" : "feature",
        key: attachment?.lineId || featureId,
        slotIndex: null,
      },
      attachment,
    });
    state.unitCounterEditor.counter += 1;
    state.unitCounterEditor.selectedId = id;
    state.unitCounterEditor.returnSelectionId = null;
    state.unitCounterEditor.active = false;
    syncOperationalLineAttachedCounterIds();
    state.unitCountersDirty = true;
    state.operationalLinesDirty = true;
    commitHistoryEntry({
      kind: "place-unit-counter",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("place-unit-counter");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function startUnitCounterPlacement({
    renderer = defaultUnitCounterRenderer,
    label = "",
    sidc = "",
    symbolCode = "",
    nationTag = "",
    nationSource = "display",
    presetId = defaultUnitCounterPresetId,
    unitType = "",
    echelon = "",
    subLabel = "",
    strengthText = "",
    iconId = "",
    attachment = null,
    baseFillColor = "",
    organizationPct = defaultUnitCounterOrganizationPct,
    equipmentPct = defaultUnitCounterEquipmentPct,
    statsPresetId = "regular",
    statsSource = "preset",
    size = "medium",
  } = {}) {
    ensureUnitCounterEditorState();
    const returnSelectionId = String(state.unitCounterEditor.selectedId || "").trim() || null;
    resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
    const preset = getUnitCounterPresetById(presetId || defaultUnitCounterPresetId);
    const normalizedCombatState = getNormalizedUnitCounterCombatState({
      baseFillColor,
      organizationPct,
      equipmentPct,
      statsPresetId,
      statsSource,
    });
    state.unitCounterEditor.active = true;
    state.unitCounterEditor.renderer = String(renderer || preset.defaultRenderer || defaultUnitCounterRenderer);
    state.unitCounterEditor.label = String(label || "");
    state.unitCounterEditor.sidc = String(sidc || symbolCode || preset.baseSidc || "").trim().toUpperCase();
    state.unitCounterEditor.symbolCode = String(symbolCode || sidc || preset.baseSidc || "").trim().toUpperCase();
    state.unitCounterEditor.nationTag = canonicalCountryCode(nationTag || "");
    state.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(nationSource, "display");
    state.unitCounterEditor.presetId = preset.id;
    state.unitCounterEditor.iconId = String(iconId || preset.iconId || "").trim().toLowerCase();
    state.unitCounterEditor.unitType = String(unitType || preset.unitType || "").trim().toUpperCase();
    state.unitCounterEditor.echelon = String(echelon || preset.defaultEchelon || "").trim().toLowerCase();
    state.unitCounterEditor.subLabel = String(subLabel || "");
    state.unitCounterEditor.strengthText = String(strengthText || "");
    state.unitCounterEditor.layoutAnchor = {
      kind: attachment?.lineId ? "attachment" : "feature",
      key: String(attachment?.lineId || ""),
      slotIndex: null,
    };
    state.unitCounterEditor.attachment = attachment?.lineId
      ? {
        kind: String(attachment.kind || defaultCounterAttachmentKind).trim().toLowerCase() || defaultCounterAttachmentKind,
        lineId: String(attachment.lineId || "").trim(),
      }
      : null;
    state.unitCounterEditor.baseFillColor = normalizedCombatState.baseFillColor;
    state.unitCounterEditor.organizationPct = normalizedCombatState.organizationPct;
    state.unitCounterEditor.equipmentPct = normalizedCombatState.equipmentPct;
    state.unitCounterEditor.statsPresetId = normalizedCombatState.statsPresetId;
    state.unitCounterEditor.statsSource = normalizedCombatState.statsSource;
    state.unitCounterEditor.size = normalizeUnitCounterSizeToken(size || "medium");
    state.unitCounterEditor.selectedId = null;
    state.unitCounterEditor.returnSelectionId = returnSelectionId;
    state.unitCountersDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function cancelUnitCounterPlacement() {
    ensureUnitCounterEditorState();
    const returnSelectionId = String(state.unitCounterEditor.returnSelectionId || "").trim();
    if (returnSelectionId && (state.unitCounters || []).some((entry) => String(entry?.id || "") === returnSelectionId)) {
      state.unitCounterEditor.returnSelectionId = null;
      selectUnitCounterById(returnSelectionId);
      return;
    }
    resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
    state.unitCountersDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function selectUnitCounterById(id) {
    ensureUnitCounterEditorState();
    const selectedId = String(id || "").trim();
    const counter = (state.unitCounters || []).find((entry) => String(entry?.id || "") === selectedId) || null;
    if (counter) {
      state.unitCounterEditor.selectedId = selectedId || null;
      state.unitCounterEditor.returnSelectionId = null;
      assignUnitCounterEditorFromCounter(counter);
    } else {
      resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
    }
    state.unitCountersDirty = true;
    updateStrategicOverlayUi();
    renderNow();
  }

  function updateSelectedUnitCounter(partial = {}) {
    ensureUnitCounterEditorState();
    const selectedId = String(state.unitCounterEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const counter = (state.unitCounters || []).find((entry) => String(entry?.id || "") === selectedId);
    if (!counter) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    if (partial.renderer) counter.renderer = String(partial.renderer || defaultUnitCounterRenderer);
    if (partial.label !== undefined) counter.label = String(partial.label || "");
    if (partial.sidc !== undefined || partial.symbolCode !== undefined) {
      const nextToken = String(partial.sidc || partial.symbolCode || "").trim().toUpperCase();
      counter.sidc = nextToken;
      counter.symbolCode = nextToken;
    }
    if (partial.nationTag !== undefined) counter.nationTag = canonicalCountryCode(partial.nationTag || "");
    if (partial.nationSource !== undefined) {
      counter.nationSource = normalizeUnitCounterNationSource(partial.nationSource, "display");
    }
    if (partial.presetId !== undefined) counter.presetId = String(partial.presetId || defaultUnitCounterPresetId).trim().toLowerCase() || defaultUnitCounterPresetId;
    if (partial.iconId !== undefined) counter.iconId = String(partial.iconId || "").trim().toLowerCase();
    if (partial.unitType !== undefined) counter.unitType = String(partial.unitType || "").trim().toUpperCase();
    if (partial.echelon !== undefined) counter.echelon = String(partial.echelon || "").trim().toLowerCase();
    if (partial.subLabel !== undefined) counter.subLabel = String(partial.subLabel || "");
    if (partial.strengthText !== undefined) counter.strengthText = String(partial.strengthText || "");
    if (partial.baseFillColor !== undefined) counter.baseFillColor = normalizeUnitCounterBaseFillColor(partial.baseFillColor);
    if (partial.organizationPct !== undefined) counter.organizationPct = normalizeUnitCounterStatPercent(partial.organizationPct, defaultUnitCounterOrganizationPct);
    if (partial.equipmentPct !== undefined) counter.equipmentPct = normalizeUnitCounterStatPercent(partial.equipmentPct, defaultUnitCounterEquipmentPct);
    if (partial.statsPresetId !== undefined) counter.statsPresetId = normalizeUnitCounterStatsPresetId(partial.statsPresetId || "regular");
    if (partial.statsSource !== undefined) {
      counter.statsSource = ["preset", "random", "manual"].includes(String(partial.statsSource || "").trim().toLowerCase())
        ? String(partial.statsSource || "").trim().toLowerCase()
        : "preset";
    }
    if (partial.size) counter.size = normalizeUnitCounterSizeToken(partial.size || "medium");
    if (partial.attachment !== undefined) {
      counter.attachment = partial.attachment?.lineId
        ? {
          kind: String(partial.attachment.kind || defaultCounterAttachmentKind).trim().toLowerCase() || defaultCounterAttachmentKind,
          lineId: String(partial.attachment.lineId || "").trim(),
        }
        : null;
      counter.layoutAnchor = {
        ...(counter.layoutAnchor || {}),
        kind: counter.attachment ? "attachment" : "feature",
        key: counter.attachment?.lineId || String(counter.anchor?.featureId || ""),
        slotIndex: null,
      };
    }
    syncOperationalLineAttachedCounterIds();
    selectUnitCounterById(selectedId);
    state.unitCountersDirty = true;
    state.operationalLinesDirty = true;
    commitHistoryEntry({
      kind: "update-unit-counter",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("update-unit-counter");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function deleteSelectedUnitCounter() {
    ensureUnitCounterEditorState();
    const selectedId = String(state.unitCounterEditor.selectedId || "").trim();
    if (!selectedId) return false;
    const before = captureHistoryState({ strategicOverlay: true });
    const nextCounters = (state.unitCounters || []).filter((entry) => String(entry?.id || "") !== selectedId);
    if (nextCounters.length === (state.unitCounters || []).length) return false;
    state.unitCounters = nextCounters;
    resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
    syncOperationalLineAttachedCounterIds();
    state.unitCountersDirty = true;
    state.operationalLinesDirty = true;
    commitHistoryEntry({
      kind: "delete-unit-counter",
      before,
      after: captureHistoryState({ strategicOverlay: true }),
    });
    markDirty("delete-unit-counter");
    updateStrategicOverlayUi();
    renderNow();
    return true;
  }

  function cancelActiveStrategicInteractionModes() {
    let cancelled = false;
    if (state.unitCounterEditor?.active) {
      cancelUnitCounterPlacement();
      cancelled = true;
    }
    if (state.operationalLineEditor?.active) {
      cancelOperationalLineDraw();
      cancelled = true;
    }
    if (state.operationGraphicsEditor?.active) {
      cancelOperationGraphicDraw();
      cancelled = true;
    }
    return cancelled;
  }

  return {
    appendOperationalLineVertexFromEvent,
    appendOperationGraphicVertexFromEvent,
    appendSpecialZoneVertexFromEvent,
    cancelActiveStrategicInteractionModes,
    cancelOperationalLineDraw,
    cancelOperationGraphicDraw,
    cancelSpecialZoneDraw,
    cancelUnitCounterPlacement,
    deleteSelectedManualSpecialZone,
    deleteSelectedOperationalLine,
    deleteSelectedOperationGraphic,
    deleteSelectedOperationGraphicVertex,
    deleteSelectedUnitCounter,
    finishOperationalLineDraw,
    finishOperationGraphicDraw,
    finishSpecialZoneDraw,
    getUnitCounterPreviewData,
    placeUnitCounterFromEvent,
    resolveUnitCounterNationForPlacement,
    selectOperationalLineById,
    selectOperationGraphicById,
    selectSpecialZoneById,
    selectUnitCounterById,
    startOperationalLineDraw,
    startOperationGraphicDraw,
    startSpecialZoneDraw,
    startUnitCounterPlacement,
    syncOperationalLineAttachedCounterIds,
    undoOperationalLineVertex,
    undoOperationGraphicVertex,
    undoSpecialZoneVertex,
    updateSelectedOperationalLine,
    updateSelectedOperationGraphic,
    updateSelectedUnitCounter,
  };
}
