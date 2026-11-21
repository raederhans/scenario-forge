import { getActiveRiverPack } from "./river_paint/partition_model.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { normalizeHexColor } from "./color_hex_utils.js";
import { createBorderIdentityResolver } from "./renderer/border_identity.js";
import { getScenarioCountryTags } from "./state/actions/scenario_activation_actions.js";

export const DEFAULT_LEGEND_CONFIG = Object.freeze({
  mode: "direct-area",
  continent: "all",
  useModernMajorOrder: false,
  maxItems: 15,
  title: "",
  exportBackground: "light",
  exportOpaque: false,
});

export const DEFAULT_LEGEND_CONTROL = Object.freeze({
  visible: true,
  collapsed: null,
  xRatio: 0.02,
  yRatio: 0.72,
  width: 240,
  // null 表示按内容自动高度；用户拖动调整后才记录具体高度。
  height: null,
  opacity: 0.9,
});

export const LEGEND_CONTROL_LIMITS = Object.freeze({
  minWidth: 180,
  maxWidth: 420,
  minHeight: 130,
  maxHeight: 560,
  minOpacity: 0.35,
  maxOpacity: 1,
});

export function normalizeColor(value) {
  return normalizeHexColor(value) || "";
}

export function normalizeLabels(value) {
  const labels = {};
  if (!value || typeof value !== "object") return labels;
  Object.entries(value).forEach(([color, label]) => {
    const key = normalizeColor(color);
    const text = String(label || "").trim();
    if (key && text) labels[key] = text;
  });
  return labels;
}

export function normalizeColorOrder(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const colors = [];
  for (const entry of value) {
    const color = normalizeColor(entry);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    colors.push(color);
  }
  return colors;
}

export function normalizeLegendConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const mode = String(source.mode || DEFAULT_LEGEND_CONFIG.mode).trim();
  const maxItems = Math.max(1, Math.min(30, Number(source.maxItems || DEFAULT_LEGEND_CONFIG.maxItems) || DEFAULT_LEGEND_CONFIG.maxItems));
  const continent = String(source.continent || DEFAULT_LEGEND_CONFIG.continent).trim().toLowerCase() || DEFAULT_LEGEND_CONFIG.continent;
  return {
    mode: ["weighted-random", "direct-area", "realm-area", "continent-area"].includes(mode)
      ? mode
      : DEFAULT_LEGEND_CONFIG.mode,
    continent,
    useModernMajorOrder: !!source.useModernMajorOrder,
    maxItems,
    title: String(source.title || "").trim(),
    exportBackground: ["dark", "none"].includes(source.exportBackground) ? source.exportBackground : "light",
    exportOpaque: source.exportOpaque === true,
  };
}

export function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeLegendControl(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    visible: source.visible !== false,
    collapsed: source.collapsed == null ? DEFAULT_LEGEND_CONTROL.collapsed : !!source.collapsed,
    xRatio: clampNumber(source.xRatio, DEFAULT_LEGEND_CONTROL.xRatio, 0, 1),
    yRatio: clampNumber(source.yRatio, DEFAULT_LEGEND_CONTROL.yRatio, 0, 1),
    width: Math.round(clampNumber(
      source.width,
      DEFAULT_LEGEND_CONTROL.width,
      LEGEND_CONTROL_LIMITS.minWidth,
      LEGEND_CONTROL_LIMITS.maxWidth
    )),
    height: source.height === null || source.height === undefined || source.height === ""
      || !Number.isFinite(Number(source.height))
      ? null
      : Math.round(clampNumber(
        source.height,
        LEGEND_CONTROL_LIMITS.minHeight,
        LEGEND_CONTROL_LIMITS.minHeight,
        LEGEND_CONTROL_LIMITS.maxHeight
      )),
    opacity: clampNumber(
      source.opacity,
      DEFAULT_LEGEND_CONTROL.opacity,
      LEGEND_CONTROL_LIMITS.minOpacity,
      LEGEND_CONTROL_LIMITS.maxOpacity
    ),
  };
}

function* legendPaintSurfaces(appState) {
  const pack = getActiveRiverPack(appState.riverPaint, appState.activeScenarioId, appState.scenarioBaselineHash || "");
  const splitParents = new Set(pack?.parents.map(parent => parent.parentId) || []);
  for (const [id, color] of Object.entries(appState.colors || {})) {
    if (!splitParents.has(id)) yield { id, color };
  }
  if (pack) {
    const boundary = getMapDataBoundary(appState);
    for (const parent of pack.parents) for (const cell of parent.cells) {
      yield {
        id: parent.parentId,
        color: boundary.paint.resolveRiverCellColor(cell.id).color || appState.colors?.[parent.parentId],
        geometry: cell.geometry,
      };
    }
  }
}

export function getLegendPaintColors(appState) {
  const colors = new Set();
  for (const surface of legendPaintSurfaces(appState)) {
    const color = normalizeColor(surface.color);
    if (color) colors.add(color);
  }
  return colors;
}

function rankLegendEditorColors(appState, getFeatureArea) {
  const tags = getScenarioCountryTags(appState.scenarioCountriesByTag);
  const resolveOwner = createBorderIdentityResolver({
    sovereignBaseColors: appState.sovereignBaseColors,
    getCountryTags: () => tags,
    getReferenceOwner: getMapDataBoundary(appState).reference.getBaseGroupCode,
    getOverrideColor: (_, color) => color,
  });
  const totals = new Map();
  let useArea = true;
  for (const surface of legendPaintSurfaces(appState)) {
    const color = normalizeColor(surface.color);
    if (!color) continue;
    const geometry = surface.geometry || appState.landIndex?.get(surface.id)?.geometry;
    if (!geometry) useArea = false;
    const area = geometry ? getFeatureArea({ type: "Feature", geometry }) : 0;
    const owner = resolveOwner(surface.id, color);
    const entry = totals.get(color) || { color, area: 0, count: 0, owners: new Map() };
    entry.area += area;
    entry.count++;
    if (!owner.startsWith("color:")) {
      const share = entry.owners.get(owner) || { area: 0, count: 0 };
      share.area += area;
      share.count++;
      entry.owners.set(owner, share);
    }
    totals.set(color, entry);
  }
  const weight = useArea ? "area" : "count";
  return [...totals.values()].sort((a, b) => b[weight] - a[weight]).slice(0, 200).map(entry => {
    const [owner] = [...entry.owners.keys()].sort((a, b) =>
      entry.owners.get(b)[weight] - entry.owners.get(a)[weight] || a.localeCompare(b));
    return { color: entry.color, owner };
  });
}

const editorRankings = new WeakMap();

export function getLegendEditorEntries(appState, getFeatureArea, getCountryName) {
  let ranking;
  if (Number.isFinite(appState.colorRevision)) {
    const inputs = [
      appState.colorRevision, appState.colors, appState.sovereignBaseColors, appState.visualOverrides,
      appState.sceneGeneration, appState.scenarioDataGeneration, appState.activeScenarioId,
      appState.topologyRevision, appState.landIndex, appState.mapSemanticMode,
      appState.scenarioCountriesByTag, appState.scenarioBaselineOwnersByFeatureId, appState.scenarioAutoShellOwnerByFeatureId,
      appState.riverPaint, appState.scenarioBaselineHash, getFeatureArea,
    ];
    const cached = editorRankings.get(appState);
    if (cached && inputs.every((value, index) => value === cached.inputs[index])) {
      ranking = cached.ranking;
    } else {
      ranking = rankLegendEditorColors(appState, getFeatureArea);
      editorRankings.set(appState, { inputs, ranking });
    }
  } else {
    ranking = rankLegendEditorColors(appState, getFeatureArea);
  }
  return ranking.map(({ color, owner }) => ({ color, countryName: owner ? getCountryName(appState, owner) : "" }));
}

export function filterLegendEditorEntries(entries, labels, query) {
  const search = query.trim().toLowerCase();
  return entries.filter(({ color, countryName }) =>
    countryName.toLowerCase().includes(search) || (labels[color] || "").toLowerCase().includes(search));
}

export function getUniqueLegendColors(appState) {
  if (!appState?.colors) return [];
  const maxItems = Number(appState.legendConfig?.maxItems || DEFAULT_LEGEND_CONFIG.maxItems);
  const colors = [];
  const seen = new Set();
  const availableColors = getLegendPaintColors(appState);
  for (const value of normalizeColorOrder(appState.legendColorOrder)) {
    const color = normalizeColor(value);
    if (!color || seen.has(color) || !availableColors.has(color)) continue;
    seen.add(color);
    colors.push(color);
    if (colors.length >= maxItems) return colors;
  }
  for (const color of availableColors) {
    if (!color || seen.has(color)) continue;
    seen.add(color);
    colors.push(color);
    if (colors.length >= maxItems) break;
  }
  return colors;
}

export function getLegendColorRevisionKey(appState) {
  return JSON.stringify([
    Number(appState.colorRevision), appState.sceneGeneration == null ? null : Number(appState.sceneGeneration),
    appState.scenarioDataGeneration == null ? null : Number(appState.scenarioDataGeneration),
    String(appState.activeScenarioId || ""), Number(appState.legendConfig.maxItems), normalizeColorOrder(appState.legendColorOrder),
    String(appState.riverPaint?.pack?.packId || ""), String(appState.scenarioBaselineHash || ""),
  ]);
}
