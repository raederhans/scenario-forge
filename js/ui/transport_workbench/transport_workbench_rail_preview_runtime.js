import { normalizeTransportWorkbenchNumber as normalizeNumber } from "./transport_workbench_line_runtime_shared.js";

// Pure decision logic for the Japan rail workbench preview. No DOM, no carrier
// singleton access — every input (feature, config, scale) is passed in, so this
// layer is unit-testable in isolation. DOM rendering lives in
// transport_workbench_rail_preview_dom.js; lifecycle orchestration stays in
// transport_workbench_rail_preview.js.

export const DATA_ROW_LIMIT = 240;

export const LINE_CLASS_PRIORITY = {
  service: 1,
  branch: 2,
  trunk: 3,
  high_speed: 4,
};
const LINE_CLASS_STYLE = {
  high_speed: { stroke: "#0f766e", width: 3.2, opacityMultiplier: 1.0 },
  trunk: { stroke: "#1f2937", width: 2.35, opacityMultiplier: 0.96 },
  branch: { stroke: "#85644a", width: 1.45, opacityMultiplier: 0.82 },
  service: { stroke: "#94a3b8", width: 1.05, opacityMultiplier: 0.62 },
};
const IMPORTANCE_ORDER = {
  broad_major: 1,
  regional_core: 2,
  capital_core: 3,
};
const STATION_IMPORTANCE_STYLE = {
  broad_major: { sizeMultiplier: 0.92, labelScale: 0.95, minLabelScale: 1.22 },
  regional_core: { sizeMultiplier: 1.0, labelScale: 1.0, minLabelScale: 1.14 },
  capital_core: { sizeMultiplier: 1.22, labelScale: 1.12, minLabelScale: 1.06 },
};
const INACTIVE_STATUS = new Set(["disused", "abandoned", "construction"]);

export function normalizeRailSourceFlags(flags) {
  if (Array.isArray(flags)) return flags.filter(Boolean).map((value) => String(value));
  if (typeof flags === "string" && flags.trim()) {
    return flags.split("|").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeRailLineClass(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LINE_CLASS_PRIORITY[normalized] ? normalized : "trunk";
}

export function normalizeRailLineStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "active";
}

export function normalizeRailImportance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return IMPORTANCE_ORDER[normalized] ? normalized : "broad_major";
}

export function getLineVisibilityReason(feature, config, scale) {
  if (!config.status?.includes(feature.status)) return "status_filtered";
  if (!config.class?.includes(feature.lineClass)) return "class_filtered";
  if (feature.lineClass === "branch" && !config.showBranchAtCurrentZoom) return "branch_hidden";
  if (feature.lineClass === "branch" && scale < 1.06) return "zoom_gate";
  if (feature.lineClass === "service" && !config.showServiceLines) return "service_hidden";
  if (feature.lineClass === "service" && config.showServiceAtHighZoomOnly && scale < 1.45) return "zoom_gate";
  if (INACTIVE_STATUS.has(feature.status) && scale < 1.3) return "zoom_gate";
  return null;
}

export function getImportanceRank(feature) {
  return IMPORTANCE_ORDER[feature?.importance] || 1;
}

export function getImportanceThreshold(config) {
  return IMPORTANCE_ORDER[config?.importanceThreshold] || 1;
}

export function getLineOpacity(feature, config) {
  const baseOpacity = normalizeNumber(config.lineOpacity, 92) / 100;
  const classMultiplier = (LINE_CLASS_STYLE[feature.lineClass] || LINE_CLASS_STYLE.trunk).opacityMultiplier || 1;
  if (!INACTIVE_STATUS.has(feature.status)) return Math.max(0.2, baseOpacity * classMultiplier);
  const fadeStrength = normalizeNumber(config.inactiveFadeStrength, 72) / 100;
  return Math.max(0.1, baseOpacity * classMultiplier * (1 - fadeStrength));
}

export function getLineStyle(feature, config, selectedLineId) {
  const base = LINE_CLASS_STYLE[feature.lineClass] || LINE_CLASS_STYLE.trunk;
  const isSelected = selectedLineId && selectedLineId === feature.id;
  let stroke = base.stroke;
  if (config.statusEncoding === "line_style_plus_hue" && feature.status === "construction") {
    stroke = "#b45309";
  } else if (config.statusEncoding === "line_style_plus_hue" && feature.status === "abandoned") {
    stroke = "#7c3aed";
  }
  return {
    stroke,
    width: isSelected ? base.width + 1.1 : base.width,
    opacity: getLineOpacity(feature, config),
  };
}

export function getStationImportanceStyle(feature) {
  return STATION_IMPORTANCE_STYLE[feature?.importance] || STATION_IMPORTANCE_STYLE.broad_major;
}

export function shouldShowStation(feature, config, scale) {
  if (!config.showMajorStations) return false;
  if (getImportanceRank(feature) < getImportanceThreshold(config)) return false;
  return scale >= 0.98;
}

export function shouldShowStationLabel(feature, config, scale) {
  if (!config.showStationLabels) return false;
  return shouldShowStation(feature, config, scale) && scale >= getStationImportanceStyle(feature).minLabelScale;
}

export function formatLineVisibilityReason(reason) {
  const map = {
    status_filtered: "Filtered by status",
    class_filtered: "Filtered by class",
    branch_hidden: "Branch hidden",
    service_hidden: "Service hidden",
    zoom_gate: "Hidden by zoom gate",
  };
  return map[String(reason || "").trim()] || "Visible";
}
