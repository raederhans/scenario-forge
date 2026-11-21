export function createDefaultSpecialZoneEditorState() {
  return {
    active: false,
    vertices: [],
    zoneType: "custom",
    label: "",
    selectedId: null,
    counter: 1,
  };
}

export function createDefaultOperationGraphicsEditorState() {
  return {
    active: false,
    mode: "idle",
    collection: "operationGraphics",
    points: [],
    kind: "attack",
    label: "",
    stylePreset: "attack",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  };
}

export function normalizeMapLabel(raw, id) {
  const numberInRange = (value, min, max, fallback) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  if (!Number.isFinite(raw?.lon) || !Number.isFinite(raw?.lat)) return null;
  return {
    id,
    text: String(raw.text ?? "").trim(),
    countryCode: String(raw.countryCode ?? "").trim().toUpperCase(),
    fallbackName: String(raw.fallbackName ?? "").trim(),
    lon: numberInRange(raw.lon, -180, 180),
    lat: numberInRange(raw.lat, -90, 90),
    size: numberInRange(raw.size, 0.12, 512, 18),
    rotation: numberInRange(raw.rotation, -180, 180, 0),
    tracking: numberInRange(raw.tracking, 0, 1, null),
    uppercase: typeof raw.uppercase === "boolean" ? raw.uppercase : null,
    colorMode: ["light", "dark"].includes(raw.colorMode) ? raw.colorMode : "auto",
  };
}

export function createDefaultMapLabelEditorState() {
  return { active: false, selectedId: null, draggingId: null, counter: 1 };
}

export function createDefaultUnitCounterEditorState({
  renderer = "game",
  presetId = "inf",
  organizationPct = 78,
  equipmentPct = 74,
} = {}) {
  return {
    active: false,
    renderer: String(renderer || "game"),
    label: "",
    sidc: "",
    symbolCode: "",
    nationTag: "",
    nationSource: "display",
    presetId: String(presetId || "inf"),
    iconId: "",
    unitType: "",
    echelon: "",
    subLabel: "",
    strengthText: "",
    layoutAnchor: { kind: "feature", key: "", slotIndex: null },
    attachment: null,
    baseFillColor: "",
    organizationPct: Number(organizationPct) || 78,
    equipmentPct: Number(equipmentPct) || 74,
    statsPresetId: "regular",
    statsSource: "preset",
    size: "medium",
    selectedId: null,
    returnSelectionId: null,
    counter: 1,
  };
}

export function createDefaultOperationalLineEditorState() {
  return {
    active: false,
    mode: "idle",
    points: [],
    kind: "frontline",
    label: "",
    stylePreset: "frontline",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  };
}

export function createDefaultStrategicOverlayUiState() {
  return {
    activeMode: "idle",
    modalOpen: false,
    modalSection: "line",
    modalEntityId: "",
    modalEntityType: "",
    counterEditorModalOpen: false,
    counterCatalogSource: "internal",
    counterCatalogCategory: "all",
    counterCatalogQuery: "",
    hoi4CounterCategory: "all",
    hoi4CounterQuery: "",
    hoi4CounterVariant: "small",
  };
}

export function createDefaultStrategicOverlayState(options = {}) {
  return {
    specialZoneEditor: createDefaultSpecialZoneEditorState(),
    operationGraphicsEditor: createDefaultOperationGraphicsEditorState(),
    mapLabelEditor: createDefaultMapLabelEditorState(),
    unitCounterEditor: createDefaultUnitCounterEditorState(options.unitCounterEditor),
    operationalLineEditor: createDefaultOperationalLineEditorState(),
    strategicOverlayUi: createDefaultStrategicOverlayUiState(),
  };
}

export function resetStrategicOverlayEditorState(
  target,
  {
    unitCounterRenderer = "game",
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  Object.assign(target, {
    specialZoneEditor: createDefaultSpecialZoneEditorState(),
    operationalLineEditor: createDefaultOperationalLineEditorState(),
    operationGraphicsEditor: createDefaultOperationGraphicsEditorState(),
    mapLabelEditor: createDefaultMapLabelEditorState(),
    unitCounterEditor: createDefaultUnitCounterEditorState({
      renderer: unitCounterRenderer,
    }),
    strategicOverlayUi: createDefaultStrategicOverlayUiState(),
  });
  return {
    specialZoneEditor: target.specialZoneEditor,
    operationalLineEditor: target.operationalLineEditor,
    operationGraphicsEditor: target.operationGraphicsEditor,
    mapLabelEditor: target.mapLabelEditor,
    unitCounterEditor: target.unitCounterEditor,
    strategicOverlayUi: target.strategicOverlayUi,
  };
}
