export const DISPLAY_PIXEL_BUDGET = 6_000_000;

const DPR_CAPS = Object.freeze({
  performance: 1.25,
  balanced: 1.5,
  high: 2,
});

export function normalizeDisplayQuality(value, fallback = "high") {
  const normalizedFallback = String(fallback ?? "").trim().toLowerCase();
  const normalizedValue = String(value ?? "").trim().toLowerCase();
  if (Object.hasOwn(DPR_CAPS, normalizedValue)) return normalizedValue;
  return Object.hasOwn(DPR_CAPS, normalizedFallback) ? normalizedFallback : "high";
}

export function normalizeRenderingStyleConfig(value) {
  return { quality: normalizeDisplayQuality(value?.quality) };
}

export function resolveDisplayPixelRatio({
  quality = "high",
  devicePixelRatio = 1,
  width = 0,
  height = 0,
} = {}) {
  const device = Number(devicePixelRatio);
  const safeDeviceDpr = Number.isFinite(device) ? Math.max(1, device) : 1;
  const cssWidth = Number(width);
  const cssHeight = Number(height);
  const cssArea = cssWidth > 0 && cssHeight > 0 && Number.isFinite(cssWidth * cssHeight)
    ? cssWidth * cssHeight
    : 0;
  // This budget applies to the main surface. Overscanned pass caches multiply
  // its actual memory cost; DPR 1 is the floor for very large CSS viewports.
  const budgetDpr = cssArea > 0 ? Math.sqrt(DISPLAY_PIXEL_BUDGET / cssArea) : Infinity;
  return Math.max(1, Math.min(
    safeDeviceDpr,
    DPR_CAPS[normalizeDisplayQuality(quality)],
    budgetDpr,
  ));
}
