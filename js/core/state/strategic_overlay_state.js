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
    unitCounterEditor: createDefaultUnitCounterEditorState(options.unitCounterEditor),
    operationalLineEditor: createDefaultOperationalLineEditorState(),
    strategicOverlayUi: createDefaultStrategicOverlayUiState(),
  };
}
