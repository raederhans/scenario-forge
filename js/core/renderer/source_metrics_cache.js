// Source revisions cover in-place edits; identity checks also cover replacements.
// Weak keys let old scenario topology leave memory without explicit cleanup.
export function createSourceMetricsCache() {
  let colorSource;
  let colorRevision;
  let hasColors = false;
  const topologyCounts = new WeakMap();

  function hasResolvedColors(colors, revision) {
    if (colorSource !== colors || colorRevision !== revision) {
      colorSource = colors;
      colorRevision = revision;
      hasColors = Object.keys(colors || {}).length > 0;
    }
    return hasColors;
  }

  function countArcs(arcs) {
    if (Number.isInteger(arcs)) return 1;
    if (!Array.isArray(arcs)) return 0;
    return arcs.reduce((sum, entry) => sum + countArcs(entry), 0);
  }

  function estimateTopologyObjectArcRefs(topology, objectName, revision) {
    const object = topology?.objects?.[objectName];
    if (!object || typeof object !== "object") return null;
    const source = object.geometries || object.arcs;
    const cached = topologyCounts.get(object);
    if (cached && cached.revision === revision && cached.source === source) return cached.total;
    const count = Array.isArray(object.geometries)
      ? object.geometries.reduce((sum, geometry) => sum + countArcs(geometry?.arcs), 0)
      : countArcs(object.arcs);
    const total = count > 0 ? count : null;
    topologyCounts.set(object, { revision, source, total });
    return total;
  }

  return { hasResolvedColors, estimateTopologyObjectArcRefs };
}
