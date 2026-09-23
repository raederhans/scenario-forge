import { normalizeStrategicValuesStyle, getStrategicValuesColorStops } from "./strategic_values_view_model.js";
import {
  buildStrategicChoroplethColorInput,
  isStrategicChoroplethMetric,
} from "./renderer/strategic_choropleth.js";
import { isScenarioStrategicValuesUsable } from "./scenario/strategic_values.js";

// Central color resolver for land features.
// It keeps canonical visual/owner state precedence in one small, testable place.

function readSafeColor(colorMap, key, getSafeColor) {
  if (!colorMap || typeof colorMap !== "object" || !key) return "";
  return getSafeColor(colorMap[key], "");
}

function defaultSafeColor(value, fallback = "") {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function parseHexColor(value) {
  const color = defaultSafeColor(value, "");
  if (!color) return null;
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}

function mixHexColor(left, right, amount) {
  const leftRgb = parseHexColor(left);
  const rightRgb = parseHexColor(right);
  if (!leftRgb || !rightRgb) return defaultSafeColor(right || left, "");
  const t = Math.min(1, Math.max(0, Number(amount) || 0));
  const channel = (start, end) => Math.round(start + ((end - start) * t)).toString(16).padStart(2, "0");
  return `#${channel(leftRgb.r, rightRgb.r)}${channel(leftRgb.g, rightRgb.g)}${channel(leftRgb.b, rightRgb.b)}`;
}

function resolveStrategicChoroplethColor(id, ctx, getSafeColor) {
  const runtimeState = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
  const metricId = String(runtimeState.strategicChoroplethMetric || "").trim().toLowerCase();
  const payload = runtimeState.scenarioStrategicValuesData;
  if (!metricId || !isStrategicChoroplethMetric(metricId) || !isScenarioStrategicValuesUsable(payload)) {
    return null;
  }
  if (runtimeState.activeScenarioId && payload.scenarioId !== runtimeState.activeScenarioId) return null;
  const input = buildStrategicChoroplethColorInput(payload, ctx.feature || id, metricId);
  const rawValue = payload.buckets?.[input.bucketId]?.[metricId];
  if (!input.bucketId || rawValue == null || rawValue === "" || !Number.isFinite(Number(rawValue))) {
    return null;
  }
  const style = normalizeStrategicValuesStyle(runtimeState.styleConfig?.strategicValues);
  if (style.opacity === 0) return null;
  const [lowColor, highColor] = getStrategicValuesColorStops(style.palette, input.metric?.family);
  const color = getSafeColor(mixHexColor(lowColor, highColor, input.t), "");
  return color
    ? {
      color: style.opacity < 1 ? mixHexColor(resolveBaseLandColor(id, ctx, getSafeColor).color || "#e5e7eb", color, style.opacity) : color,
      source: `strategic:${input.metricId}`,
      featureId: id,
      ownerCode: "",
    }
    : null;
}

function resolveFeatureColor(featureId, ctx = {}) {
  const id = String(featureId || "").trim();
  const runtimeState = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
  const getSafeColor = typeof ctx.getSafeColor === "function" ? ctx.getSafeColor : defaultSafeColor;
  const feature = ctx.feature || null;
  const atlantropaColorRule = String(feature?.properties?.atl_color_rule || "").trim().toLowerCase();
  if (atlantropaColorRule && atlantropaColorRule !== "owner") {
    const color = getSafeColor(
      typeof ctx.getAtlantropaRuleColor === "function"
        ? ctx.getAtlantropaRuleColor(atlantropaColorRule, feature, id)
        : "",
      "",
    );
    return {
      color: color || null,
      source: color ? `atlantropa:${atlantropaColorRule}` : "",
      featureId: id,
      ownerCode: "",
    };
  }

  if (typeof ctx.isOceanFeature === "function" && ctx.isOceanFeature(feature, id)) {
    const color = getSafeColor(
      typeof ctx.getOceanBaseFillColor === "function" ? ctx.getOceanBaseFillColor(feature, id) : "",
      "",
    );
    return {
      color,
      source: color ? "ocean" : "",
      featureId: id,
      ownerCode: "",
    };
  }

  const strategicColor = resolveStrategicChoroplethColor(id, ctx, getSafeColor);
  if (strategicColor) {
    return strategicColor;
  }

  return resolveBaseLandColor(id, ctx, getSafeColor);
}

function resolveBaseLandColor(id, ctx, getSafeColor) {
  const runtimeState = ctx.state || {};
  const feature = ctx.feature || null;
  const visualColor = readSafeColor(runtimeState.visualOverrides, id, getSafeColor);
  if (visualColor) {
    return { color: visualColor, source: "visualOverrides", featureId: id, ownerCode: "" };
  }

  const compatFeatureColor = readSafeColor(runtimeState.featureOverrides, id, getSafeColor);
  if (compatFeatureColor) {
    return { color: compatFeatureColor, source: "featureOverrides", featureId: id, ownerCode: "" };
  }

  const ownerCode = String(
    typeof ctx.getOwnerCode === "function" ? ctx.getOwnerCode(feature, id) : "",
  ).trim().toUpperCase();
  if (!ownerCode) {
    return { color: null, source: "", featureId: id, ownerCode: "" };
  }

  const ownerColor = readSafeColor(runtimeState.sovereignBaseColors, ownerCode, getSafeColor);
  if (ownerColor) {
    return { color: ownerColor, source: "sovereignBaseColors", featureId: id, ownerCode };
  }

  const compatOwnerColor = readSafeColor(runtimeState.countryBaseColors, ownerCode, getSafeColor);
  return {
    color: compatOwnerColor || null,
    source: compatOwnerColor ? "countryBaseColors" : "",
    featureId: id,
    ownerCode,
  };
}

export {
  resolveFeatureColor,
};
