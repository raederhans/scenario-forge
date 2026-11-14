const DISPLAY_MODE_VALUES = new Set(["inspect", "aggregate", "density"]);
const DISPLAY_PRESET_VALUES = new Set(["review_first", "balanced", "pattern_first", "extreme_density"]);
const LABEL_LEVEL_VALUES = new Set(["region", "anchor", "category"]);

const JAPAN_REGION_ANCHORS = [
  { id: "hokkaido", label: "\u5317\u6d77\u9053", bounds: { minLon: 139.0, maxLon: 146.5, minLat: 41.2, maxLat: 45.8 } },
  { id: "tohoku", label: "\u4e1c\u5317", bounds: { minLon: 139.0, maxLon: 142.6, minLat: 37.6, maxLat: 41.8 } },
  { id: "kanto", label: "\u5173\u4e1c", bounds: { minLon: 138.2, maxLon: 141.8, minLat: 34.9, maxLat: 37.6 } },
  { id: "chubu", label: "\u4e2d\u90e8", bounds: { minLon: 136.1, maxLon: 139.9, minLat: 34.6, maxLat: 37.7 } },
  { id: "kansai", label: "\u5173\u897f", bounds: { minLon: 134.2, maxLon: 136.8, minLat: 33.2, maxLat: 35.8 } },
  { id: "chugoku", label: "\u4e2d\u56fd\u5730\u65b9", bounds: { minLon: 131.0, maxLon: 135.6, minLat: 33.8, maxLat: 35.8 } },
  { id: "shikoku", label: "\u56db\u56fd", bounds: { minLon: 132.0, maxLon: 134.9, minLat: 32.5, maxLat: 34.6 } },
  { id: "kyushu", label: "\u4e5d\u5dde", bounds: { minLon: 128.8, maxLon: 132.7, minLat: 30.8, maxLat: 33.9 } },
];

const JAPAN_SECONDARY_ANCHORS = [
  { label: "\u4e1c\u4eac\u6e7e\u6cbf\u5cb8", bounds: { minLon: 139.45, maxLon: 140.1, minLat: 35.1, maxLat: 35.85 } },
  { label: "\u5927\u962a\u6e7e\u6cbf\u5cb8", bounds: { minLon: 134.8, maxLon: 135.55, minLat: 34.25, maxLat: 34.9 } },
  { label: "\u6fd1\u6237\u5185\u6cbf\u5cb8", bounds: { minLon: 132.0, maxLon: 134.8, minLat: 33.7, maxLat: 34.6 } },
  { label: "\u4ed9\u53f0\u5468\u8fb9", bounds: { minLon: 140.5, maxLon: 141.4, minLat: 38.0, maxLat: 38.6 } },
  { label: "\u5317\u4e5d\u5dde\u5468\u8fb9", bounds: { minLon: 130.5, maxLon: 131.3, minLat: 33.6, maxLat: 34.2 } },
  { label: "\u540d\u53e4\u5c4b\u6e7e\u6cbf\u5cb8", bounds: { minLon: 136.65, maxLon: 137.15, minLat: 34.65, maxLat: 35.2 } },
  { label: "\u65b0\u6f5f\u5e73\u539f", bounds: { minLon: 138.6, maxLon: 139.4, minLat: 37.3, maxLat: 38.2 } },
  { label: "\u82e5\u72ed\u6e7e\u5468\u8fb9", bounds: { minLon: 135.4, maxLon: 136.4, minLat: 35.4, maxLat: 35.9 } },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function boundsContain(bounds, lon, lat) {
  if (!bounds) return false;
  return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
}

function buildLabelMergeCandidates(entries, { gridSize, labelAccessor, priorityAccessor, separation }) {
  const mergeBuckets = new Map();
  const mergeSize = Math.max(gridSize * separation * 1.6, 24);
  entries.forEach((entry) => {
    const label = String(labelAccessor?.(entry) || "").trim();
    const x = normalizeNumber(entry.screenX ?? entry.x);
    const y = normalizeNumber(entry.screenY ?? entry.y);
    const mergeKey = `${label}::${Math.round(x / mergeSize)}:${Math.round(y / mergeSize)}`;
    const priority = normalizeNumber(priorityAccessor?.(entry), 0);
    const previous = mergeBuckets.get(mergeKey);
    if (!previous || priority > previous.priority) {
      mergeBuckets.set(mergeKey, { priority, entry });
    }
  });
  return Array.from(mergeBuckets.values()).map((item) => item.entry);
}

export function normalizeTransportWorkbenchDisplayMode(value, fallback = "inspect") {
  const normalized = String(value || "").trim().toLowerCase();
  return DISPLAY_MODE_VALUES.has(normalized) ? normalized : fallback;
}

export function normalizeTransportWorkbenchDisplayPreset(value, fallback = "balanced") {
  const normalized = String(value || "").trim().toLowerCase();
  return DISPLAY_PRESET_VALUES.has(normalized) ? normalized : fallback;
}

export function normalizeTransportWorkbenchLabelLevel(value, fallback = "anchor") {
  const normalized = String(value || "").trim().toLowerCase();
  return LABEL_LEVEL_VALUES.has(normalized) ? normalized : fallback;
}

export function resolveTransportWorkbenchDisplayMode(config, familyId, scale, visibleCount) {
  const fallback = familyId === "mineral_resources"
    ? "aggregate"
    : familyId === "industrial_zones" || familyId === "logistics_hubs"
      ? "aggregate"
      : "inspect";
  const requestedMode = normalizeTransportWorkbenchDisplayMode(config?.displayMode, fallback);
  const preset = normalizeTransportWorkbenchDisplayPreset(config?.displayPreset, "balanced");
  const count = Math.max(0, normalizeNumber(visibleCount, 0));
  if (requestedMode === "density") return count > 0 ? "density" : fallback;
  if (requestedMode === "aggregate") return count > 0 ? "aggregate" : fallback;
  if (preset === "review_first") {
    if (scale >= 1.28 || count <= 160) return "inspect";
    return familyId === "energy_facilities" && count <= 260 ? "inspect" : "aggregate";
  }
  if (preset === "pattern_first") {
    if (familyId === "industrial_zones" && count > 480 && scale < 1.18) return "density";
    if (count > 220 && scale < 1.26) return "aggregate";
    return "inspect";
  }
  if (preset === "extreme_density") {
    if (count > 420 && scale < 1.28) return "density";
    if (count > 120) return "aggregate";
    return "inspect";
  }
  if (count > 360 && scale < 1.2) return familyId === "energy_facilities" ? "aggregate" : "density";
  if (count > 140 && scale < 1.34) return "aggregate";
  return fallback;
}

export function resolveTransportWorkbenchAggregateCellSize(config, scale, familyId) {
  const preset = normalizeTransportWorkbenchDisplayPreset(config?.displayPreset, "balanced");
  const base = familyId === "industrial_zones" ? 56 : familyId === "logistics_hubs" ? 46 : 40;
  const presetDelta = preset === "review_first"
    ? 8
    : preset === "pattern_first"
      ? -4
      : preset === "extreme_density"
        ? -8
        : 0;
  const scaleAdjustment = clamp((1.28 - normalizeNumber(scale, 1)) * 34, -8, 22);
  return Math.round(clamp(base + presetDelta + scaleAdjustment, 28, 88));
}

export function resolveTransportWorkbenchLabelBudget(config, familyId) {
  const budget = Math.round(normalizeNumber(config?.labelBudget, familyId === "mineral_resources" ? 7 : 9));
  return clamp(budget, 3, 18);
}

export function resolveTransportWorkbenchLabelSeparation(config) {
  return clamp(normalizeNumber(config?.labelSeparation, 1), 0.7, 1.8);
}

export function resolveTransportWorkbenchGeoLabel(lon, lat, categoryLabel, labelLevel = "anchor") {
  const region = JAPAN_REGION_ANCHORS.find((entry) => boundsContain(entry.bounds, lon, lat)) || JAPAN_REGION_ANCHORS[2];
  const anchor = JAPAN_SECONDARY_ANCHORS.find((entry) => boundsContain(entry.bounds, lon, lat));
  const normalizedLevel = normalizeTransportWorkbenchLabelLevel(labelLevel, "anchor");
  const geoLabel = anchor?.label || region.label;
  if (normalizedLevel === "region") return region.label;
  if (normalizedLevel === "category" && categoryLabel) return `${geoLabel}\u00b7${categoryLabel}`;
  return geoLabel;
}

export function aggregateTransportWorkbenchPoints(entries, {
  cellSize,
  categoryAccessor,
  categoryLabelAccessor,
  algorithm = "square",
  clusterRadius = null,
}) {
  const buckets = new Map();
  entries.forEach((entry) => {
    const feature = entry.feature || entry;
    const x = normalizeNumber(feature.x);
    const y = normalizeNumber(feature.y);
    let bucketKey = "";
    if (algorithm === "hex") {
      const rowHeight = Math.max(cellSize * 0.866, 1);
      const row = Math.round(y / rowHeight);
      const xOffset = row % 2 === 0 ? 0 : cellSize / 2;
      const col = Math.round((x - xOffset) / cellSize);
      bucketKey = `${row}:${col}`;
    } else {
      const divisor = algorithm === "cluster"
        ? Math.max(normalizeNumber(clusterRadius, cellSize), 18)
        : algorithm === "density_surface"
          ? Math.max(cellSize * 0.82, 18)
          : Math.max(cellSize, 18);
      bucketKey = `${Math.round(x / divisor)}:${Math.round(y / divisor)}`;
    }
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(entry);
  });

  return Array.from(buckets.values()).map((bucket, index) => {
    const total = bucket.length;
    const sums = bucket.reduce((acc, entry) => {
      const feature = entry.feature || entry;
      acc.x += normalizeNumber(feature.x);
      acc.y += normalizeNumber(feature.y);
      acc.lon += normalizeNumber(feature.lon);
      acc.lat += normalizeNumber(feature.lat);
      return acc;
    }, { x: 0, y: 0, lon: 0, lat: 0 });
    const categoryCounts = new Map();
    bucket.forEach((entry) => {
      const feature = entry.feature || entry;
      const category = String(categoryAccessor?.(feature) || "").trim();
      if (!category) return;
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    });
    const dominantCategory = Array.from(categoryCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || "";
    const dominantCategoryLabel = dominantCategory
      ? String(categoryLabelAccessor?.(dominantCategory) || dominantCategory).trim()
      : "";
    return {
      id: `aggregate-${index + 1}`,
      aggregateCount: total,
      x: sums.x / total,
      y: sums.y / total,
      lon: sums.lon / total,
      lat: sums.lat / total,
      dominantCategory,
      dominantCategoryLabel,
      sampleFeature: bucket[0]?.feature || bucket[0] || null,
      entries: bucket,
    };
  });
}

export function selectTransportWorkbenchLabels(entries, {
  gridSize,
  budget,
  labelAccessor,
  priorityAccessor,
  separation = 1,
  allowAggregation = true,
}) {
  const candidates = allowAggregation
    ? buildLabelMergeCandidates(entries, { gridSize, labelAccessor, priorityAccessor, separation })
    : [...entries];
  const usedBuckets = new Set();
  return candidates
    .sort((left, right) => {
      const rightPriority = normalizeNumber(priorityAccessor?.(right), 0);
      const leftPriority = normalizeNumber(priorityAccessor?.(left), 0);
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      return String(labelAccessor?.(left) || "").localeCompare(String(labelAccessor?.(right) || ""), "ja");
    })
    .filter((entry) => {
      const x = normalizeNumber(entry.screenX ?? entry.x);
      const y = normalizeNumber(entry.screenY ?? entry.y);
      const bucketKey = `${Math.round(x / (gridSize * separation))}:${Math.round(y / (gridSize * separation))}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    })
    .slice(0, budget);
}
