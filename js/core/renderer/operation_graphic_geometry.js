export const DEFAULT_OPERATION_GRAPHIC_KIND = "attack";

export const DEFAULT_OPERATIONAL_LINE_KIND = "frontline";

export const OPERATION_GRAPHIC_STYLE_PRESETS = ["attack", "retreat", "supply", "naval", "encirclement", "theater"];

export const OPERATIONAL_LINE_STYLE_PRESETS = ["frontline", "offensive_line", "spearhead_line", "defensive_line"];

export function getLineMidpointFromCoordinates(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const totalSegments = [];
  let totalLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (!Array.isArray(previous) || !Array.isArray(current)) continue;
    const dx = Number(current[0]) - Number(previous[0]);
    const dy = Number(current[1]) - Number(previous[1]);
    const segmentLength = Math.hypot(dx, dy);
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) continue;
    totalSegments.push({ previous, current, segmentLength });
    totalLength += segmentLength;
  }
  if (!totalLength || !totalSegments.length) return null;
  let distance = totalLength / 2;
  for (const segment of totalSegments) {
    if (distance <= segment.segmentLength) {
      const ratio = distance / segment.segmentLength;
      return [
        Number(segment.previous[0]) + (Number(segment.current[0]) - Number(segment.previous[0])) * ratio,
        Number(segment.previous[1]) + (Number(segment.current[1]) - Number(segment.previous[1])) * ratio,
      ];
    }
    distance -= segment.segmentLength;
  }
  const last = totalSegments[totalSegments.length - 1];
  return [Number(last.current[0]), Number(last.current[1])];
}

export function getMultiLineLabelAnchor(geometry, placementMode = "midpoint") {
  const lines = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  let bestLine = null;
  let bestLength = -1;
  lines.forEach((line) => {
    if (!Array.isArray(line) || line.length < 2) return;
    let length = 0;
    for (let index = 1; index < line.length; index += 1) {
      const previous = line[index - 1];
      const current = line[index];
      length += Math.hypot(
        Number(current?.[0] || 0) - Number(previous?.[0] || 0),
        Number(current?.[1] || 0) - Number(previous?.[1] || 0)
      );
    }
    if (length > bestLength) {
      bestLength = length;
      bestLine = line;
    }
  });
  if (!bestLine) return null;
  if (placementMode === "centroid") {
    const sums = bestLine.reduce((acc, coord) => {
      acc[0] += Number(coord?.[0] || 0);
      acc[1] += Number(coord?.[1] || 0);
      acc[2] += 1;
      return acc;
    }, [0, 0, 0]);
    return sums[2] > 0 ? [sums[0] / sums[2], sums[1] / sums[2]] : null;
  }
  return getLineMidpointFromCoordinates(bestLine);
}

export function getOperationGraphicPreset(kind) {
  const presets = {
    attack: {
      stroke: "#7f1d1d",
      width: 2.2,
      opacity: 0.9,
      dasharray: null,
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    retreat: {
      stroke: "#9a3412",
      width: 1.8,
      opacity: 0.82,
      dasharray: "7 5",
      markerEnd: "url(#strategic-arrow-retreat)",
      curved: true,
      closed: false,
    },
    supply: {
      stroke: "#475569",
      width: 1.4,
      opacity: 0.8,
      dasharray: "4 4",
      markerEnd: "url(#strategic-arrow-supply)",
      curved: true,
      closed: false,
    },
    naval: {
      stroke: "#1e3a8a",
      width: 1.8,
      opacity: 0.82,
      dasharray: "8 5",
      markerEnd: "url(#strategic-arrow-naval)",
      curved: true,
      closed: false,
    },
    encirclement: {
      stroke: "#4c1d95",
      width: 1.7,
      opacity: 0.76,
      dasharray: "6 4",
      markerEnd: null,
      curved: true,
      closed: true,
    },
    theater: {
      stroke: "#7c2d12",
      width: 1.9,
      opacity: 0.74,
      dasharray: "10 5",
      markerEnd: null,
      curved: true,
      closed: true,
    },
  };
  return presets[kind] || presets.attack;
}

export function getOperationalLinePreset(kind) {
  const presets = {
    frontline: {
      stroke: "#6b7280",
      width: 2.1,
      opacity: 0.82,
      dasharray: "10 5",
      markerEnd: null,
      curved: true,
      closed: false,
    },
    offensive_line: {
      stroke: "#7f1d1d",
      width: 2.5,
      opacity: 0.94,
      dasharray: null,
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    spearhead_line: {
      stroke: "#991b1b",
      width: 2.9,
      opacity: 0.98,
      dasharray: "14 5 2 5",
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    defensive_line: {
      stroke: "#92400e",
      width: 1.9,
      opacity: 0.82,
      dasharray: "5 4",
      markerEnd: null,
      curved: true,
      closed: false,
    },
  };
  return presets[kind] || presets.frontline;
}

export function getOperationGraphicMinPoints(kind = DEFAULT_OPERATION_GRAPHIC_KIND) {
  return kind === "encirclement" || kind === "theater" ? 3 : 2;
}

export function getOperationalLineMinPoints() {
  return 2;
}

export function normalizeOperationGraphicStylePreset(value, fallback = DEFAULT_OPERATION_GRAPHIC_KIND) {
  const normalized = String(value || "").trim().toLowerCase();
  if (OPERATION_GRAPHIC_STYLE_PRESETS.includes(normalized)) {
    return normalized;
  }
  return OPERATION_GRAPHIC_STYLE_PRESETS.includes(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : DEFAULT_OPERATION_GRAPHIC_KIND;
}

export function normalizeOperationalLineStylePreset(value, fallback = DEFAULT_OPERATIONAL_LINE_KIND) {
  const normalized = String(value || "").trim().toLowerCase();
  if (OPERATIONAL_LINE_STYLE_PRESETS.includes(normalized)) {
    return normalized;
  }
  return OPERATIONAL_LINE_STYLE_PRESETS.includes(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : DEFAULT_OPERATIONAL_LINE_KIND;
}

export function normalizeOperationGraphicStroke(value) {
  const candidate = String(value || "").trim();
  return /^#(?:[0-9a-f]{6})$/i.test(candidate) ? candidate.toLowerCase() : "";
}

export function normalizeOperationGraphicWidth(value) {
  return Math.max(0, Math.min(16, Number(value) || 0));
}

export function normalizeOperationGraphicOpacity(value) {
  return Math.max(0, Math.min(1, Number(value) || 1));
}

export function getOperationGraphicEditorMidpoints(points = [], { closed = false } = {}) {
  const segments = [];
  const maxIndex = closed ? points.length : points.length - 1;
  for (let index = 0; index < maxIndex; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!Array.isArray(start) || !Array.isArray(end)) continue;
    const midpoint = [
      (Number(start[0]) + Number(end[0])) / 2,
      (Number(start[1]) + Number(end[1])) / 2,
    ];
    segments.push({
      id: `opg-midpoint-${index}`,
      insertIndex: index + 1,
      coord: midpoint,
    });
  }
  return segments;
}

export function getOperationGraphicLabelAnchor(projectedPoints = [], { closed = false } = {}) {
  if (!Array.isArray(projectedPoints) || projectedPoints.length === 0) {
    return null;
  }
  if (closed) {
    const [sumX, sumY] = projectedPoints.reduce(
      (acc, point) => [acc[0] + Number(point?.[0] || 0), acc[1] + Number(point?.[1] || 0)],
      [0, 0]
    );
    return [sumX / projectedPoints.length, sumY / projectedPoints.length];
  }
  if (projectedPoints.length === 1) {
    return projectedPoints[0];
  }
  const midIndex = Math.floor((projectedPoints.length - 1) / 2);
  const start = projectedPoints[midIndex];
  const end = projectedPoints[Math.min(projectedPoints.length - 1, midIndex + 1)];
  const anchorX = (Number(start?.[0] || 0) + Number(end?.[0] || 0)) / 2;
  const anchorY = (Number(start?.[1] || 0) + Number(end?.[1] || 0)) / 2;
  const dx = Number(end?.[0] || 0) - Number(start?.[0] || 0);
  const dy = Number(end?.[1] || 0) - Number(start?.[1] || 0);
  const length = Math.max(1, Math.hypot(dx, dy));
  return [anchorX - (dy / length) * 9, anchorY + (dx / length) * 9];
}
