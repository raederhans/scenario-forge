// Visible ownership precedes interaction eligibility: an opaque support face
// can cover editable land without itself becoming an editable target.
export function resolveTopVisibleRiverCandidate(candidates, lonLat, { getDrawRank, geoContains }) {
  if (!Array.isArray(lonLat) || typeof geoContains !== 'function') return null;
  const ordered = [...candidates].sort((a, b) => getDrawRank(b.item) - getDrawRank(a.item));
  for (const candidate of ordered) {
    const feature = candidate.item?.feature;
    if (!feature?.geometry) continue;
    try {
      if (geoContains(feature, lonLat)) return { ...candidate, containsGeo: true,
        bboxArea: candidate.item.bboxArea ?? Infinity };
    } catch (_error) { /* Malformed geometry cannot own a visible hit. */ }
  }
  return null;
}
