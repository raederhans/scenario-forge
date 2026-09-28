import { isLakeRegion } from "./effective_water_regions.js";

// Stable IDs from the shared global lake collection. Keep this explicit so
// small Natural Earth lakes and scenario waters do not gain noisy outlines.
const OUTLINED_LAKE_IDS = new Set([
  "lake_baikal",
  "lake_superior", "lake_michigan", "lake_huron", "lake_erie", "lake_ontario",
  "lake_saimaa", "lake_paijanne", "lake_inari", "lake_pielinen",
  "lake_vanern", "lake_vattern", "lake_ladoga", "lake_onega",
  "ne_lake_1159126725", // Qinghai Hu
  "ne_lake_1159114015", // Poyang Hu
  "ne_lake_1159116351", // Dongting Hu
  "ne_lake_1159113611", // Tai Hu
]);

const MIN_SCREEN_SPAN_PX = 8;

export function shouldDrawLakeOutline(feature, bounds, k, config) {
  if (config?.outlineEnabled === false || !isLakeRegion(feature)) return false;
  const id = String(feature?.properties?.id || feature?.id || "").trim();
  if (!OUTLINED_LAKE_IDS.has(id)) return false;
  const scale = Number(k);
  if (!Number.isFinite(scale) || scale <= 0 || !bounds) return false;
  const width = Number(bounds.maxX) - Number(bounds.minX);
  const height = Number(bounds.maxY) - Number(bounds.minY);
  return Number.isFinite(width) && Number.isFinite(height)
    && Math.max(width, height) * scale >= MIN_SCREEN_SPAN_PX;
}
