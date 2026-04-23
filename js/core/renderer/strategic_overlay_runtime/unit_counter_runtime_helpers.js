// Unit counter stateless/runtime-read helpers.
export function createUnitCounterRuntimeHelpers({
  state,
  defaults = {},
  helpers = {},
} = {}) {
  const {
    defaultUnitCounterEquipmentPct = 74,
    defaultUnitCounterOrganizationPct = 78,
    defaultUnitCounterPresetId = "inf",
    defaultUnitCounterRenderer = "game",
  } = defaults;

  const {
    canonicalCountryCode = (value = "") => String(value || "").trim().toUpperCase(),
    ensureUnitCounterEditorState = () => {},
    getDisplayOwnerCode = () => "",
    getFeatureOwnerCode = () => "",
    getNormalizedUnitCounterCombatState = () => ({
      baseFillColor: "",
      equipmentPct: defaultUnitCounterEquipmentPct,
      organizationPct: defaultUnitCounterOrganizationPct,
      statsPresetId: "regular",
      statsSource: "preset",
    }),
    getUnitCounterCardModel = (value) => value,
    normalizeUnitCounterNationSource = (value, fallback = "display") => String(value || fallback).trim().toLowerCase(),
  } = helpers;

  function getUnitCounterPreviewData(partialCounter = {}) {
    // Preview keeps the legacy side effect: ensure editor state before read.
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
    getUnitCounterPreviewData,
    resolveUnitCounterNationForPlacement,
  };
}
