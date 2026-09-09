import { normalizeHexColor } from "./color_hex_utils.js";

export const DEFAULT_LEGEND_CONFIG = Object.freeze({
  mode: "weighted-random",
  continent: "all",
  useModernMajorOrder: false,
  maxItems: 15,
});

export const DEFAULT_LEGEND_CONTROL = Object.freeze({
  visible: true,
  collapsed: false,
  xRatio: 0.02,
  yRatio: 0.72,
  width: 240,
  height: 340,
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
    collapsed: !!source.collapsed,
    xRatio: clampNumber(source.xRatio, DEFAULT_LEGEND_CONTROL.xRatio, 0, 1),
    yRatio: clampNumber(source.yRatio, DEFAULT_LEGEND_CONTROL.yRatio, 0, 1),
    width: Math.round(clampNumber(
      source.width,
      DEFAULT_LEGEND_CONTROL.width,
      LEGEND_CONTROL_LIMITS.minWidth,
      LEGEND_CONTROL_LIMITS.maxWidth
    )),
    height: Math.round(clampNumber(
      source.height,
      DEFAULT_LEGEND_CONTROL.height,
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

export function getUniqueLegendColors(appState) {
  const maxItems = Number(appState?.legendConfig?.maxItems || DEFAULT_LEGEND_CONFIG.maxItems);
  const colors = [];
  if (!appState || !appState.colors) return colors;
  const seen = new Set();
  const availableColors = new Set(Object.values(appState.colors).map(normalizeColor).filter(Boolean));
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
  ]);
}
