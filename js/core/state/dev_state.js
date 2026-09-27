export function createDefaultDevState() {
  // devState 是 dev workspace 各个子编辑器共享的一份 runtime 草稿仓库。
  // 这里保留每个 editor 自己的 save/status 字段，避免导入、选区变化或面板切换时互相踩掉彼此状态。
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
  // import/reset 只清“与当前选区强耦合的临时态”。
  // editor 草稿和最近一次保存反馈继续保留，这样用户在导入后还能看见自己刚才的工作上下文。
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
