// Coverage is in CSS pixels at the surface's reference transform. Canvas size
// alone is not coverage: a composite can contain differently clipped passes.
export function getSurfaceCoverage(canvas, layout = {}) {
  if (!canvas) return null;
  const dpr = Math.max(1, Number(layout?.dpr || 1));
  const minX = -Number(layout?.offsetX || 0);
  const minY = -Number(layout?.offsetY || 0);
  return { minX, minY, maxX: minX + canvas.width / dpr, maxY: minY + canvas.height / dpr };
}

export function transformCoverage(coverage, reference, current) {
  if (!coverage || !reference || !current) return null;
  const scale = Number(current.k) / Number(reference.k);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const dx = Number(current.x) - Number(reference.x) * scale;
  const dy = Number(current.y) - Number(reference.y) * scale;
  return {
    minX: coverage.minX * scale + dx,
    minY: coverage.minY * scale + dy,
    maxX: coverage.maxX * scale + dx,
    maxY: coverage.maxY * scale + dy,
  };
}

export function intersectCoverage(left, right) {
  if (!left || !right) return null;
  return {
    minX: Math.max(left.minX, right.minX), minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX), maxY: Math.min(left.maxY, right.maxY),
  };
}

export function coversViewport(coverage, width, height) {
  return !!coverage && [coverage.minX, coverage.minY, coverage.maxX, coverage.maxY, width, height].every(Number.isFinite)
    && width > 0 && height > 0
    && coverage.minX <= 0 && coverage.minY <= 0
    && coverage.maxX >= width && coverage.maxY >= height;
}

export function surfaceCoversViewport(surface, currentTransform, identity) {
  const coverage = transformCoverage(
    surface.coverage || getSurfaceCoverage(surface.canvas, surface.layout || { dpr: surface.dpr }),
    surface.referenceTransform,
    currentTransform,
  );
  return coversViewport(coverage, identity.pixelWidth / identity.dpr, identity.pixelHeight / identity.dpr);
}
