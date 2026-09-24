// Bounds are conservative projected bounds supplied by the existing renderer.
// No geometry projection or data mutation belongs in this policy.
export function planPoliticalRasterPatch(previous, entries, description, boundsForEntry, {
  maxCoverage = 0.18,
  maxTransientBytes = 64 * 1024 * 1024,
} = {}) {
  if (!previous || !Array.isArray(entries) || typeof boundsForEntry !== "function"
    || !description.patchKey || previous.patchKey !== description.patchKey
    || previous.entries.length !== entries.length) return null;
  const { width, height } = description;
  if (![width, height].every(v => Number.isInteger(v) && v > 0)) return null;
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const old = previous.entries[i], next = entries[i];
    if (old.id !== next.id || old.feature.geometry !== next.feature.geometry || old.geometryIdentity !== next.geometryIdentity
      || old.lineWidth !== next.lineWidth) return null;
    if (old.fillColor !== next.fillColor || old.strokeColor !== next.strokeColor) changed.push(i);
  }
  if (!changed.length) return null;
  const bounds = new Map();
  const getBounds = index => {
    if (bounds.has(index)) return bounds.get(index);
    const value = boundsForEntry(entries[index]);
    if (!value || ![value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite)
      || value.maxX < value.minX || value.maxY < value.minY) return null;
    bounds.set(index, value); return value;
  };
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const index of changed) {
    const b = getBounds(index);
    if (!b) return null;
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  const x = Math.max(0, Math.floor(minX)), y = Math.max(0, Math.floor(minY));
  const right = Math.min(width, Math.ceil(maxX)), bottom = Math.min(height, Math.ceil(maxY));
  const region = { x, y, width: right - x, height: bottom - y };
  if (region.width <= 0 || region.height <= 0) return null;
  const area = region.width * region.height;
  // Account for old frame + new composite + worker surface + cropped bitmap.
  if (area / (width * height) > maxCoverage || (3 * width * height + area) * 4 > maxTransientBytes) return null;
  const drawEntryIds = [];
  for (let i = 0; i < entries.length; i++) {
    const b = getBounds(i);
    if (!b) return null;
    if (b.maxX >= x && b.minX <= right && b.maxY >= y && b.minY <= bottom) drawEntryIds.push(entries[i].id);
  }
  if (!drawEntryIds.length || drawEntryIds.length >= entries.length) return null;
  return { region, drawEntryIds, changedCount: changed.length, coverage: area / (width * height),
    estimatedTransientBytes: (3 * width * height + area) * 4 };
}
