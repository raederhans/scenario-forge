export function createDefaultDevState() {
  return {
    devHoverHit: null,
    devSelectedHit: null,
    devSelectionFeatureIds: new Set(),
    devSelectionOrder: [],
    devSelectionModeEnabled: false,
    devSelectionLimit: 200,
    devSelectionOverlayDirty: true,
    devSelectionSortMode: "selection",
    devClipboardPreviewFormat: "names_with_ids",
    devClipboardFallbackText: "",
    devRuntimeMeta: null,
    devRuntimeMetaError: "",
    devScenarioEditor: {
      targetOwnerCode: "",
      isSaving: false,
      lastSavedAt: "",
      lastSavedPath: "",
      lastSaveMessage: "",
      lastSaveTone: "",
    },
    devScenarioTagCreator: {
      tag: "",
      nameEn: "",
      nameZh: "",
      colorHex: "#5D7CBA",
      parentOwnerTag: "",
      selectedInspectorGroupId: "",
      inspectorGroupId: "",
      inspectorGroupLabel: "",
      inspectorGroupAnchorId: "",
      duplicateTag: false,
      tagLengthHint: "",
      isColorPopoverOpen: false,
      recentColors: [],
      recentColorsLoaded: false,
      isSaving: false,
      lastSavedAt: "",
      lastSavedPath: "",
      lastSaveMessage: "",
      lastSaveTone: "",
    },
    devScenarioCountryEditor: {
      tag: "",
      nameEn: "",
      nameZh: "",
      isSaving: false,
      lastSavedAt: "",
      lastSavedPath: "",
      lastSaveMessage: "",
      lastSaveTone: "",
    },
    devScenarioTagInspector: {
      threshold: 3,
      selectedTag: "",
    },
    devScenarioCapitalEditor: {
      tag: "",
      searchQuery: "",
      isSaving: false,
      lastSavedAt: "",
      lastSavedPath: "",
      lastSaveMessage: "",
      lastSaveTone: "",
    },
    devLocaleEditor: {
      featureId: "",
      en: "",
      zh: "",
      isSaving: false,
      lastSavedAt: "",
      lastSavedPath: "",
    },
    devScenarioDistrictEditor: {
      tag: "",
      tagMode: "auto",
      manualTag: "",
      inferredTag: "",
      templateTag: "",
      selectedDistrictId: "",
      nameEn: "",
      nameZh: "",
      loadedScenarioId: "",
      loadedTag: "",
      draftTag: null,
      isSaving: false,
      isTemplateSaving: false,
      isTemplateApplying: false,
      lastSavedAt: "",
      lastSavedPath: "",
      lastSaveMessage: "",
      lastSaveTone: "",
    },
  };
}

export function resetDevTransientImportState(
  target,
  {
    previewFormat = "names_with_ids",
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  Object.assign(target, {
    devHoverHit: null,
    devSelectedHit: null,
    devSelectionFeatureIds: new Set(),
    devSelectionOrder: [],
    devClipboardFallbackText: "",
    devClipboardPreviewFormat: String(previewFormat || "names_with_ids"),
  });
  return {
    devSelectionFeatureIds: target.devSelectionFeatureIds,
    devSelectionOrder: target.devSelectionOrder,
  };
}
