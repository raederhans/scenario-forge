// Unit counter runtime mutations.
export function createUnitCounterRuntimeDomain({
  state,
  defaults = {},
  helpers = {},
} = {}) {
  const {
    defaultCounterAttachmentKind = "operational-line",
    defaultHitSnapRadiusClickPx = 14,
    defaultUnitCounterEquipmentPct = 74,
    defaultUnitCounterMilstdSidc = "130310001412110000000000000000",
    defaultUnitCounterOrganizationPct = 78,
    defaultUnitCounterPresetId = "inf",
    defaultUnitCounterRenderer = "game",
  } = defaults;

  const {
    assignUnitCounterEditorFromCounter = () => {},
    canonicalCountryCode = (value = "") => String(value || "").trim().toUpperCase(),
    captureHistoryState = () => ({}),
    commitHistoryEntry = () => {},
    ensureUnitCounterCounter = () => {},
    ensureUnitCounterEditorState = () => {},
    getHitFromEvent = () => null,
    getMapLonLatFromEvent = () => null,
    getNormalizedUnitCounterCombatState = () => ({
      baseFillColor: "",
      equipmentPct: defaultUnitCounterEquipmentPct,
      organizationPct: defaultUnitCounterOrganizationPct,
      statsPresetId: "regular",
      statsSource: "preset",
    }),
    getUnitCounterPresetById = () => ({
      defaultRenderer: defaultUnitCounterRenderer,
      id: defaultUnitCounterPresetId,
    }),
    markDirty = () => {},
    normalizeUnitCounterBaseFillColor = (value) => String(value || "").trim(),
    normalizeUnitCounterNationSource = (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
    normalizeUnitCounterSizeToken = (value) => String(value || "medium").trim().toLowerCase(),
    normalizeUnitCounterStatPercent = (value, fallback = defaultUnitCounterOrganizationPct) => Number(value) || fallback,
    normalizeUnitCounterStatsPresetId = (value, fallback = "regular") => String(value || fallback).trim().toLowerCase(),
    renderNow = () => {},
    resetUnitCounterEditorState = () => {},
    resolveUnitCounterNationForPlacement = () => ({ tag: "", source: "display" }),
    updateStrategicOverlayUi = () => {},
  } = helpers;

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
      state.unitCounterEditor.active = false;
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

  return {
    cancelUnitCounterPlacement,
    deleteSelectedUnitCounter,
    placeUnitCounterFromEvent,
    selectUnitCounterById,
    startUnitCounterPlacement,
    syncOperationalLineAttachedCounterIds,
    updateSelectedUnitCounter,
  };
}
