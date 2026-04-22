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

// Startup boot seeds the baseline releasable catalog once; keep that twin write
// in the catalog owner so bootstrap code only describes intent.
export function hydrateStartupReleasableCatalogState(target, releasableCatalog = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.defaultReleasableCatalog = releasableCatalog || null;
  target.releasableCatalog = releasableCatalog || null;
  return target.releasableCatalog;
}

export function hydrateScenarioReleasableCatalogState(
  target,
  {
    releasableCatalog = null,
    scenarioReleasableIndex = null,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.releasableCatalog = releasableCatalog || null;
  target.scenarioReleasableIndex =
    scenarioReleasableIndex && typeof scenarioReleasableIndex === "object"
      ? scenarioReleasableIndex
      : createDefaultScenarioReleasableIndex();
  return target.releasableCatalog;
}

export function setScenarioAuditState(target, scenarioAudit = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.scenarioAudit = scenarioAudit || null;
  return target.scenarioAudit;
}
