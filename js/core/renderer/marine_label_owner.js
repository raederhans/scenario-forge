import { claimScreenLabelPlacement } from "./screen_label_placement.js";

// Ordinary marine names use three map scales. The geometry and hit regions do
// not change with these presentation thresholds.
export function getMarineLabelMinScale(feature) {
  const props = feature?.properties || {};
  const id = String(props.id || feature?.id || "");
  if (!id.startsWith("marine_") && !id.startsWith("tno_")) return Infinity;
  const type = String(props.water_type || "").toLowerCase();
  const group = String(props.region_group || "").toLowerCase();
  if (!["marine_macro", "marine_detail", "ocean_macro"].includes(group)
    || ["tno_bosporus_dardanelles", "tno_sea_of_marmara", "tno_black_sea", "tno_sea_of_azov"].includes(id)) return Infinity;
  if (type === "ocean" || (type === "sea" && group === "marine_macro")) return 1;
  if (type === "sea" || ((type === "bay" || type === "gulf") && group === "marine_macro")) return 2.2;
  if (["bay", "gulf", "strait", "channel", "sound", "chokepoint"].includes(type)) return 4.5;
  return Infinity;
}

export function isMarineLabelEligible(feature, { showWaterRegions = false, openOceanRenderable = false } = {}) {
  if (!showWaterRegions || !Number.isFinite(getMarineLabelMinScale(feature))) return false;
  return String(feature?.properties?.water_type || "").toLowerCase() !== "ocean" || openOceanRenderable;
}

export function getMarineLabelName(feature, language = "en") {
  const props = feature?.properties || {};
  return String(String(language).startsWith("zh")
    ? (props.name_zh || props.label_zh || props.label || props.name || "")
    : (props.label || props.name_en || props.name || "")).trim();
}

export function drawMarineLabels(entries, {
  context, scale, width, height, language = "en", selectedId = "", occupiedBoxes = [],
  onPlaced = null,
} = {}) {
  if (!context || !Array.isArray(entries) || !entries.length || !(scale > 0)) return 0;
  const maxLabels = scale < 2.2 ? 20 : scale < 4.5 ? 35 : 55;
  const ordered = entries.filter((entry) => entry?.feature && entry?.anchor)
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)
      || getMarineLabelMinScale(a.feature) - getMarineLabelMinScale(b.feature)
      || Number(b.area || 0) - Number(a.area || 0)
      || String(a.id).localeCompare(String(b.id)));
  let drawn = 0;
  context.save();
  context.globalAlpha = 1;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  for (const entry of ordered) {
    if (drawn >= maxLabels) break;
    const selected = entry.id === selectedId;
    if (scale < getMarineLabelMinScale(entry.feature) && !selected) continue;
    const label = entry.label || getMarineLabelName(entry.feature, language);
    if (!label) continue;
    const fontPx = selected ? 14 : getMarineLabelMinScale(entry.feature) <= 1 ? 12 : 11;
    context.font = `${selected ? 600 : 500} ${fontPx / scale}px system-ui, sans-serif`;
    const textWidth = context.measureText(label).width * scale;
    const [x, y] = entry.screenPoint || [];
    if (![x, y].every(Number.isFinite)) continue;
    const box = { x: x - textWidth / 2 - 5, y: y - fontPx / 2 - 3, w: textWidth + 10, h: fontPx + 6 };
    const placement = claimScreenLabelPlacement([{ box }], occupiedBoxes, (candidate) => (
      candidate.x >= 2 && candidate.y >= 2
      && candidate.x + candidate.w <= width - 2 && candidate.y + candidate.h <= height - 2
    ));
    if (!placement) continue;
    if (typeof onPlaced === "function") onPlaced(entry);
    context.lineWidth = (selected ? 3.5 : 2.5) / scale;
    context.strokeStyle = "rgba(247, 251, 255, 0.9)";
    context.fillStyle = selected ? "rgba(15, 52, 80, 0.96)" : "rgba(31, 69, 98, 0.78)";
    context.strokeText(label, entry.anchor[0], entry.anchor[1]);
    context.fillText(label, entry.anchor[0], entry.anchor[1]);
    drawn += 1;
  }
  context.restore();
  return drawn;
}

export function chooseMarineFocusBounds(boundsList = []) {
  // Prefer one safe geometry part: unions can wrap across the date line and
  // produce a nearly world-wide viewport for a small strait or island group.
  return boundsList.filter((bounds) => bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite))
    .sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY))[0] || null;
}

export function findMarineInteriorAnchor({ centroid = null, bounds, transform, width, height, contains, gridSize = 3 } = {}) {
  if (!bounds || !transform || typeof contains !== "function" || !(transform.k > 0)) return null;
  const minX = Math.max(bounds.minX, (2 - transform.x) / transform.k);
  const maxX = Math.min(bounds.maxX, (width - 2 - transform.x) / transform.k);
  const minY = Math.max(bounds.minY, (2 - transform.y) / transform.k);
  const maxY = Math.min(bounds.maxY, (height - 2 - transform.y) / transform.k);
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const inside = (point) => Array.isArray(point) && point.every(Number.isFinite)
    && point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY
    && contains(point);
  if (inside(centroid)) return centroid;
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  if (inside(center)) return center;
  const steps = Math.max(1, Math.min(5, Math.floor(gridSize)));
  for (let iy = 0; iy < steps; iy += 1) {
    for (let ix = 0; ix < steps; ix += 1) {
      // The center was already rejected above. Odd grids include it again.
      if (steps % 2 === 1 && ix === (steps - 1) / 2 && iy === (steps - 1) / 2) continue;
      const point = [minX + (ix + 0.5) * (maxX - minX) / steps,
        minY + (iy + 0.5) * (maxY - minY) / steps];
      if (inside(point)) return point;
    }
  }
  return null;
}

export function createMarineInteriorAnchorResolver() {
  let projectionGeneration;
  let byPart = new WeakMap();
  return ({ part, generation, ...options }) => {
    if (generation !== projectionGeneration) {
      projectionGeneration = generation;
      byPart = new WeakMap();
    }
    const { bounds, centroid, transform, width, height, gridSize = 3 } = options;
    if (!part || !bounds || !transform) return null;
    const key = [transform.x, transform.y, transform.k, width, height, gridSize,
      bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, centroid?.[0], centroid?.[1]];
    const previous = byPart.get(part);
    if (previous && key.every((value, index) => Object.is(value, previous.key[index]))) return previous.anchor;
    const anchor = findMarineInteriorAnchor(options);
    // Keep only the latest viewport, including failed searches. Weak keys let
    // replaced scenario/chunk geometry go; panning does not grow a history cache.
    byPart.set(part, { key, anchor });
    return anchor;
  };
}
