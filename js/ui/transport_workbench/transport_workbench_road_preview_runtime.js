import { normalizeTransportWorkbenchNumber as normalizeNumber } from "./transport_workbench_line_runtime_shared.js";

// Pure decision logic for the Japan road workbench preview. No DOM, no carrier
// singleton access — every input (feature, config, scale) is passed in, so this
// layer is unit-testable in isolation. DOM rendering lives in
// transport_workbench_road_preview_dom.js; lifecycle orchestration stays in
// transport_workbench_road_preview.js.

export const DATA_ROW_LIMIT = 240;

export const ROAD_STYLE_PRESETS = {
  corridor: {
    motorway: { stroke: "#cf5d35", width: 2.8 },
    trunk: { stroke: "#dd854d", width: 2.0 },
    primary: { stroke: "#be9762", width: 1.35 },
  },
  review: {
    motorway: { stroke: "#bf4f32", width: 3.0 },
    trunk: { stroke: "#cf7746", width: 2.15 },
    primary: { stroke: "#ab8348", width: 1.45 },
  },
  quiet: {
    motorway: { stroke: "#ae6a56", width: 2.5 },
    trunk: { stroke: "#bc8b68", width: 1.8 },
    primary: { stroke: "#9a8367", width: 1.25 },
  },
};
const PRIMARY_REVEAL_SCALE = {
  strict: 1.65,
  balanced: 1.38,
  loose: 1.18,
};
const PRIMARY_LABEL_REVEAL_SCALE = {
  strict: 1.34,
  balanced: 1.16,
  loose: 1.04,
};
const TRUNK_REVEAL_SCALE = {
  strict: 1.08,
  balanced: 1.0,
  loose: 1.0,
};
const TRUNK_LABEL_REVEAL_SCALE = {
  strict: 1.0,
  balanced: 0.96,
  loose: 0.92,
};
const METRO_GUARD_BONUS = {
  light: 0,
  balanced: 4,
  strict: 8,
};
const CONFLICT_STROKE = "#a22f2a";
export const ROAD_RENDER_PRIORITY = {
  primary: 1,
  trunk: 2,
  motorway: 3,
};

export function normalizeRoadSourceFlags(flags) {
  if (Array.isArray(flags)) return flags.filter(Boolean).map((value) => String(value));
  if (typeof flags === "string" && flags.trim()) {
    return flags.split("|").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

export function getRoadVisibilityReason(feature, config, scale) {
  if (!config.roadClass?.includes(feature.roadClass)) return "class_filtered";
  if (config.excludeLinks && feature.isLink) return "link_filtered";
  if (feature.projectedLength < normalizeNumber(config.minProjectedSegmentPx, 6)) return "short_projected_segment";
  if (
    feature.roadClass === "primary"
    && config.suppressShortPrimarySegments
    && feature.lengthMeters < 6_500
  ) {
    return "short_primary";
  }
  if (
    feature.denseMetro
    && feature.roadClass === "primary"
    && feature.projectedLength < normalizeNumber(config.minProjectedSegmentPx, 6) + (METRO_GUARD_BONUS[config.denseMetroGuard] || 0)
  ) {
    return "dense_metro_guard";
  }
  if (feature.roadClass === "trunk" && scale < (TRUNK_REVEAL_SCALE[config.zoomGate] || 1)) {
    return "zoom_gate";
  }
  if (feature.roadClass === "primary" && scale < (PRIMARY_REVEAL_SCALE[config.zoomGate] || 1.38)) {
    return "zoom_gate";
  }
  return null;
}

export function getRoadStyle(feature, config, selectedRoadId) {
  const preset = ROAD_STYLE_PRESETS[config.strokePreset] || ROAD_STYLE_PRESETS.corridor;
  const base = preset[feature.roadClass] || preset.primary;
  const configuredWidth = feature.roadClass === "motorway"
    ? normalizeNumber(config.motorwayWidth, base.width)
    : feature.roadClass === "trunk"
      ? normalizeNumber(config.trunkWidth, base.width)
      : normalizeNumber(config.primaryWidth, base.width);
  const isSelected = selectedRoadId && selectedRoadId === feature.id;
  const hasConflict = config.showSourceConflicts && feature.sourceFlags.includes("name_conflict");
  return {
    stroke: hasConflict ? CONFLICT_STROKE : base.stroke,
    width: isSelected ? configuredWidth + 1.1 : configuredWidth,
    opacity: isSelected && config.selectedEmphasis === "mute_others"
      ? 1
      : normalizeNumber(config.baseOpacity, 88) / 100,
  };
}

export function getLabelClassGate(feature, config, scale) {
  if (!config.showRefs) return false;
  if (!config.refClasses?.includes(feature.roadClass)) return false;
  if (feature.roadClass === "primary" && !config.allowPrimaryRefsAtHighZoom) return false;
  if (!feature.ref || feature.projectedRoadLength < Math.max(28, String(feature.ref || "").length * 7)) return false;
  if (feature.roadClass === "primary" && scale < (PRIMARY_LABEL_REVEAL_SCALE[config.zoomGate] || 1.16)) return false;
  if (feature.roadClass === "trunk" && scale < (TRUNK_LABEL_REVEAL_SCALE[config.zoomGate] || 0.96)) return false;
  return true;
}
