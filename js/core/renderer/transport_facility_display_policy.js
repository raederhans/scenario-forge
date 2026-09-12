// Preserve exact scene values so cached label batches reject any identity change.
export function getTransportFacilityLabelBatchIdentity(state) {
  return {
    scenarioId: state.activeScenarioId,
    sceneGeneration: state.sceneGeneration,
    scenarioDataGeneration: state.scenarioDataGeneration,
  };
}

export function getTransportFacilityDensityStrategy(k) {
  const scale = Math.max(0.0001, Number(k || 1));
  if (scale >= 5) {
    return { level: "local", gridSizePx: 16, maxVisible: 5000 };
  }
  if (scale >= 2.4) {
    return { level: "regional", gridSizePx: 32, maxVisible: 1200 };
  }
  return { level: "world", gridSizePx: 56, maxVisible: 600 };
}

export function getTransportFacilityEntryStableSortKey(feature, properties = {}, coordinates = []) {
  const coordinateKey = Array.isArray(coordinates) && coordinates.length >= 2
    ? `${coordinates[0] ?? ""}:${coordinates[1] ?? ""}`
    : "";
  return String(
    properties.stable_key
    || properties.id
    || properties.facility_id
    || properties.name
    || coordinateKey
    || feature?.id
    || ""
  ).trim();
}

export function applyTransportFacilityDensity(entries, densityStrategy) {
  const sortedEntries = [...entries].sort((left, right) => {
    if (right.importanceRank !== left.importanceRank) return right.importanceRank - left.importanceRank;
    return String(left.stableSortKey || "").localeCompare(String(right.stableSortKey || ""));
  });
  const gridSizePx = Math.max(1, Number(densityStrategy?.gridSizePx || 1));
  const maxVisible = Math.max(1, Number(densityStrategy?.maxVisible || sortedEntries.length));
  const usedBuckets = new Set();
  const filteredEntries = [];
  for (const entry of sortedEntries) {
    const bucket = `${Math.floor(Number(entry.screenX || 0) / gridSizePx)}:${Math.floor(Number(entry.screenY || 0) / gridSizePx)}`;
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);
    filteredEntries.push(entry);
    if (filteredEntries.length >= maxVisible) break;
  }
  return filteredEntries;
}

export function getTransportFacilityLabelCandidates(entries, {
  k,
  configuredLabelSize,
  nationalLabelScale,
  regionalLabelScale,
} = {}) {
  const zoomScale = Number(k || 1);
  const labelSize = Number(configuredLabelSize || 9);
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      if (!entry?.label) return false;
      const baseScale = entry.importanceRank >= 3 ? nationalLabelScale : regionalLabelScale;
      const labelLengthPenalty = Math.max(0, String(entry.label || "").length - 14) * 0.055;
      const sizePenalty = Math.max(0, labelSize - 9) * 0.16;
      return zoomScale >= baseScale + labelLengthPenalty + sizePenalty;
    })
    .sort((left, right) => {
      if (right.importanceRank !== left.importanceRank) return right.importanceRank - left.importanceRank;
      const labelDelta = String(left.label || "").length - String(right.label || "").length;
      if (labelDelta !== 0) return labelDelta;
      return String(left.stableSortKey || "").localeCompare(String(right.stableSortKey || ""));
    });
}

export function doTransportFacilityLabelBoxesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

export function findTransportFacilityLabelPlacement(entry, {
  fontSizePx,
  iconSizePx,
  zoomScale,
  measureText,
  zoomTransform = { x: 0, y: 0 },
} = {}) {
  const label = String(entry?.label || "").trim();
  if (!label) return null;
  const screenFontSize = Math.max(8, Number(fontSizePx || 10));
  const screenTextWidth = Math.max(1, Number(measureText?.(label)) || (label.length * screenFontSize * 0.58));
  const screenTextHeight = screenFontSize + 3;
  const gap = Math.max(5, (Number(iconSizePx || 10) / 2) + 4);
  const screenX = Number(entry.screenX || 0);
  const screenY = Number(entry.screenY || 0);
  const safeZoomScale = Math.max(0.0001, Number(zoomScale || 1));
  const offsetX = Number(zoomTransform?.x || 0);
  const offsetY = Number(zoomTransform?.y || 0);
  const placements = [
    {
      textX: screenX + gap,
      textY: screenY,
      box: { x: screenX + gap - 2, y: screenY - (screenTextHeight / 2), width: screenTextWidth + 4, height: screenTextHeight },
    },
    {
      textX: screenX - gap - screenTextWidth,
      textY: screenY,
      box: { x: screenX - gap - screenTextWidth - 2, y: screenY - (screenTextHeight / 2), width: screenTextWidth + 4, height: screenTextHeight },
    },
    {
      textX: screenX - (screenTextWidth / 2),
      textY: screenY - gap - (screenTextHeight / 2),
      box: { x: screenX - (screenTextWidth / 2) - 2, y: screenY - gap - screenTextHeight, width: screenTextWidth + 4, height: screenTextHeight },
    },
    {
      textX: screenX - (screenTextWidth / 2),
      textY: screenY + gap + (screenTextHeight / 2),
      box: { x: screenX - (screenTextWidth / 2) - 2, y: screenY + gap, width: screenTextWidth + 4, height: screenTextHeight },
    },
  ];
  return placements.map((placement) => ({
    ...placement,
    worldX: (placement.textX - offsetX) / safeZoomScale,
    worldY: (placement.textY - offsetY) / safeZoomScale,
  }));
}

export function compactTransportFacilityName(name, familyId, { aggressive = false } = {}) {
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  const originalLabel = String(name || "").trim();
  let label = originalLabel;
  if (!label) return "";
  if (normalizedFamilyId === "airport") {
    label = label
      .replace(/\bInternational Airport\b/gi, "Intl")
      .replace(/\bInternational\b/gi, "Intl")
      .replace(/\bAirport\b/gi, "")
      .replace(/\bAerodrome\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  } else if (normalizedFamilyId === "port") {
    label = label
      .replace(/^Port of\s+/i, "")
      .replace(/\bPort\b/gi, "")
      .replace(/\bHarbor\b/gi, "Hbr")
      .replace(/\bHarbour\b/gi, "Hbr")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!label) label = originalLabel;
  const limit = aggressive ? 18 : 28;
  return label.length > limit ? `${label.slice(0, Math.max(8, limit - 1)).trim()}...` : label;
}

export function shouldUseShortFacilityLabel(label, { scale = 1, labelSize = 9, importanceRank = 1 } = {}) {
  const length = String(label || "").trim().length;
  const zoom = Number(scale || 1);
  const size = Number(labelSize || 9);
  if (zoom < 4.2) return true;
  if (importanceRank < 3 && zoom < 6.2) return true;
  return length > Math.max(18, 36 - Math.max(0, size - 9) * 3) && zoom < 7.2;
}

export function getTransportOverviewAirportLabelText(properties = {}, mode = "adaptive", options = {}) {
  const name = String(properties.name || "").trim();
  const code = String(properties.iata || properties.icao || "").trim();
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "code") return code || name;
  if (normalized === "name") return name || code;
  if (normalized === "adaptive") {
    if (shouldUseShortFacilityLabel(name, options)) return code || compactTransportFacilityName(name, "airport", { aggressive: true });
    const compactName = compactTransportFacilityName(name, "airport");
    return code && compactName ? `${code} · ${compactName}` : (code || compactName);
  }
  return code && name ? `${code} · ${name}` : (code || name);
}

export function getTransportOverviewPortLabelText(properties = {}, mode = "adaptive", options = {}) {
  const name = String(properties.name || "").trim();
  const designation = String(properties.legal_designation_label || properties.legal_designation || "").trim();
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "cargo_focus") return designation || name;
  if (normalized === "name") return name || designation;
  if (normalized === "adaptive") {
    const compactName = compactTransportFacilityName(name, "port", {
      aggressive: shouldUseShortFacilityLabel(name, options),
    });
    if (shouldUseShortFacilityLabel(name, options)) return compactName || designation;
    return designation && compactName ? `${compactName} · ${designation}` : (compactName || designation);
  }
  return designation && name ? `${name} · ${designation}` : (name || designation);
}
