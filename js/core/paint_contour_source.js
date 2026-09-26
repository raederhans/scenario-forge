// Geometry provenance is a sidecar, never saved/editable country metadata.
const precisionByGeometry = new WeakMap();
const registeredPayloads = new WeakMap();

export function getContourCoordinatePrecision(geometry) {
  return precisionByGeometry.get(geometry) ?? 7;
}

export function inheritContourCoordinatePrecision(source, target) {
  if (source && target && source !== target && precisionByGeometry.has(source)) {
    precisionByGeometry.set(target, precisionByGeometry.get(source));
  }
  return target;
}

export function registerContourSourcePrecision(payload, chunk) {
  // Only the explicitly declared coarse quantizer authorizes a lower-precision
  // join. Precision-preserved exceptions are detected from their actual vertices.
  const decimals = chunk?.coordinatePrecision ?? chunk?.lod_diagnostics?.round_decimals;
  const coarse = chunk?.lod === 'coarse' && decimals === 4;
  if (!payload || registeredPayloads.get(payload) === coarse) return;
  registeredPayloads.set(payload, coarse);
  function onGrid(value) {
    if (!Array.isArray(value)) return false;
    if (typeof value[0] === 'number') return value.length >= 2 && value.slice(0, 2).every(n =>
      Number.isFinite(n) && Math.abs(n * 1e4 - Math.round(n * 1e4)) < 1e-6);
    return value.length > 0 && value.every(onGrid);
  }
  for (const feature of payload.features || []) {
    const geometry = feature?.geometry;
    if (geometry) precisionByGeometry.set(geometry, coarse && onGrid(geometry.coordinates) ? 4 : 7);
  }
}
