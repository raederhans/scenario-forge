export function createDefaultScenarioReleasableIndex() {
  return {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };
}

export function createDefaultScenarioAuditUiState() {
  return {
    loading: false,
    loadedForScenarioId: "",
    errorMessage: "",
  };
}

export function createDefaultStateCatalog() {
  return {
    defaultReleasableCatalog: null,
    releasableCatalog: null,
    scenarioReleasableIndex: createDefaultScenarioReleasableIndex(),
    defaultReleasablePresetOverlays: {},
    scenarioReleasablePresetOverlays: {},
    releasableBoundaryVariantByTag: {},
    scenarioAudit: null,
    scenarioAuditUi: createDefaultScenarioAuditUiState(),
  };
}
