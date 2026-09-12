function normalizeOwnerCode(rawCode) {
  return String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export function resolvePaletteLibraryApplyTarget(inputs) {
  const {
    devSelectedHit,
    hoveredId: rawHoveredId,
    selectedInspectorCountryCode,
    landIndex,
  } = inputs;
  // Explicit selection takes precedence over hover, then the inspector owner.
  const selectedHitId = String(devSelectedHit?.id || "").trim();
  if (selectedHitId && landIndex?.has(selectedHitId)) {
    return { type: "feature", featureIds: [selectedHitId] };
  }
  const hoveredId = String(rawHoveredId || "").trim();
  if (hoveredId && landIndex?.has(hoveredId)) {
    return { type: "feature", featureIds: [hoveredId] };
  }
  const ownerCode = normalizeOwnerCode(selectedInspectorCountryCode);
  return ownerCode ? { type: "owner", ownerCode } : null;
}

export function getFeatureIdsForOwnerColorRefresh(inputs, ownerCode) {
  const {
    sovereigntyByFeatureId,
    ownerToFeatureIds,
    countryToFeatureIds,
    landIndex,
  } = inputs;
  const normalizedOwner = normalizeOwnerCode(ownerCode);
  if (!normalizedOwner) return [];
  // These indexes become available at different points during import and scenario
  // activation. Preserve their union without scanning the geometry collection.
  const ids = new Set();
  if (sovereigntyByFeatureId && typeof sovereigntyByFeatureId === "object") {
    Object.entries(sovereigntyByFeatureId).forEach(([featureId, rawOwner]) => {
      if (normalizeOwnerCode(rawOwner) === normalizedOwner) ids.add(featureId);
    });
  }
  for (const index of [ownerToFeatureIds, countryToFeatureIds]) {
    const indexedIds = index instanceof Map ? index.get(normalizedOwner) : null;
    if (Array.isArray(indexedIds) || indexedIds instanceof Set) {
      indexedIds.forEach((featureId) => ids.add(featureId));
    }
  }
  return Array.from(ids)
    .map((featureId) => String(featureId || "").trim())
    .filter((featureId) => featureId && landIndex?.has(featureId));
}
