// New subdivisions inherit saved parent colors until explicitly painted.
// Keep overrides keyed by durable IDs; do not expand or mutate saved projects.
export function resolveWaterRegionOverride(id, feature, featuresById, overrides, normalizeColor) {
  const visited = new Set();
  let currentId = String(id || "").trim();
  let currentFeature = feature || featuresById?.get(currentId);
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const color = normalizeColor(overrides?.[currentId], null);
    if (color) return color;
    currentId = String(currentFeature?.properties?.parent_id || "").trim();
    currentFeature = featuresById?.get(currentId);
  }
  return null;
}

export function expandWaterRegionColorDependents(ids, featuresById) {
  const result = new Set(ids);
  const children = new Map();
  for (const [id, feature] of featuresById || []) {
    const parent = String(feature?.properties?.parent_id || "").trim();
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(id);
  }
  const queue = [...result];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index]) || []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return [...result];
}
