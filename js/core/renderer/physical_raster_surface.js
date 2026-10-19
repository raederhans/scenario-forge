// Final physical pixels use exactly the native viewport grid. A separately
// rasterized world cannot reproduce native edge coverage after resampling.
export function planPhysicalViewportSurface(layout, transform, { maxBytes = 80 * 1024 * 1024 } = {}) {
  if (!layout || !transform || ![transform.k, transform.x, transform.y].every(Number.isFinite)
    || !(transform.k > 0) || !(maxBytes > 0) || !Number.isFinite(maxBytes)) return null;
  const { offsetX, offsetY, logicalWidth, logicalHeight, paddedWidth, paddedHeight,
    pixelWidth, pixelHeight, dpr } = layout;
  if (![offsetX, offsetY, logicalWidth, logicalHeight, paddedWidth, paddedHeight, dpr].every(Number.isFinite)
    || ![logicalWidth, logicalHeight, paddedWidth, paddedHeight, dpr].every(value => value > 0)
    || ![pixelWidth, pixelHeight].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  // Exact viewport preparation now owns one backing. The cache owner accounts
  // for inactive canvases and other in-flight layers before admitting it.
  const bytes = pixelWidth * pixelHeight * 4;
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes) return null;
  return {
    reference: { k: transform.k, x: transform.x, y: transform.y },
    layout: { offsetX, offsetY, logicalWidth, logicalHeight, paddedWidth, paddedHeight,
      pixelWidth, pixelHeight, dpr },
  };
}
