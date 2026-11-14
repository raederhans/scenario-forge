export function createInitialLoadState() {
  return {
    status: "idle",
    error: null,
    manifest: null,
    audit: null,
    previewStatus: "idle",
    fullStatus: "idle",
  };
}

export function createInitialRenderStats() {
  return {
    renderMode: "inspect",
    totalFeatures: 0,
    visibleFeatures: 0,
    filteredFeatures: 0,
    visibleLabels: 0,
    aggregateUnits: 0,
  };
}
