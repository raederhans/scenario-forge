import { claimScreenLabelPlacement } from "./screen_label_placement.js";

const CITY_LABEL_PLACEMENT_ORDER = [
  "right",
  "left",
  "upper-right",
  "lower-right",
  "upper-left",
  "lower-left",
];

function buildCityLabelPlacementCandidates(entry, {
  textWidthPx,
  fontPx,
  scale,
  offsetPx,
  verticalOffsetPx,
}) {
  if (!entry?.screenPoint || !entry?.anchor) return [];
  const widthPx = Math.max(1, Number(textWidthPx || 0));
  const heightPx = fontPx + 4;
  const halfHeightPx = heightPx * 0.5;
  const placements = {
    right: {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    left: {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    "upper-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
    "upper-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
  };
  return CITY_LABEL_PLACEMENT_ORDER
    .map((placementId) => {
      const candidate = placements[placementId];
      if (!candidate) return null;
      return {
        id: placementId,
        textAlign: candidate.textAlign,
        drawX: entry.anchor[0] + (candidate.dxPx / scale),
        drawY: entry.anchor[1] + (candidate.dyPx / scale),
        box: {
          x: candidate.boxX,
          y: candidate.boxY,
          w: widthPx + 6,
          h: heightPx,
        },
      };
    })
    .filter(Boolean);
}

const DEFAULT_SERIF_STACK = '"Libre Baskerville", "Palatino Linotype", Georgia, serif';

export function createCityLabelOwner({ constants = {}, getters = {}, helpers = {} } = {}) {
  const serifStack = constants.textureLabelSerifStack || DEFAULT_SERIF_STACK;
  const getContext = typeof getters.getContext === "function" ? getters.getContext : () => null;
  const getViewportSize = typeof getters.getViewportSize === "function"
    ? getters.getViewportSize
    : () => ({ width: 0, height: 0 });

  function drawCityLabelsFromEntries(labelEntries, {
    config, scale, occupiedBoxes = [], labelBudget, layoutOnly = false, reusePlacement = false,
  } = {}) {
    const preferredPlacements = new Map();
    if (Array.isArray(labelEntries)) {
      for (const entry of labelEntries) {
        if (reusePlacement) preferredPlacements.set(entry, entry.acceptedLabelPlacement);
        delete entry.acceptedLabelPlacement;
        delete entry.labelContrastMode;
      }
    }
    const context = getContext();
    if (!Array.isArray(labelEntries) || !labelEntries.length || !context) return 0;
    let labelCount = 0;
    const baseFontPx = Number(config?.labelSize) || 11;
    const maxLabels = Number.isFinite(labelBudget) ? Math.max(0, Math.floor(labelBudget)) : Infinity;
    context.save();
    context.globalAlpha = 1;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    for (const entry of labelEntries) {
      if (labelCount >= maxLabels) break;
      const visualEntry = helpers.getCityVisualCapitalState(entry, config)
        ? entry
        : { ...entry, isCapital: false, markerSizePx: null };
      const tierOffset = visualEntry.isCapital ? 1 : visualEntry.cityTier === "major" ? 0 : -1;
      const fontPx = helpers.clamp(baseFontPx + tierOffset, 7, 23);
      context.font = `${visualEntry.isCapital ? 600 : 400} ${fontPx / scale}px ${serifStack}`;
      const fullText = helpers.getCityDisplayLabel(visualEntry.feature);
      const text = helpers.formatCityMapLabel(fullText, {
        entry: visualEntry,
        context,
        config,
        scale,
      });
      const labelMinZoom = helpers.getCityLabelMinZoom(visualEntry, config);
      if (!text || !entry.screenPoint || scale < labelMinZoom) continue;
      const markerSizePx = Number(visualEntry.markerSizePx || helpers.getCityMarkerSizePx(visualEntry, config));
      // Even the smallest sprite is 18px wide; keep its own label clear of it.
      const offsetPx = Math.max(12, markerSizePx + 4);
      const verticalOffsetPx = Math.max(fontPx + 2, markerSizePx + 6);
      const metrics = context.measureText(text);
      const candidates = buildCityLabelPlacementCandidates(visualEntry, {
        textWidthPx: metrics.width * scale,
        fontPx,
        scale,
        offsetPx,
        verticalOffsetPx,
      });
      const preferredIndex = candidates.findIndex((candidate) => candidate.id === preferredPlacements.get(entry));
      if (preferredIndex > 0) candidates.unshift(candidates.splice(preferredIndex, 1)[0]);
      const viewportSize = getViewportSize();
      const acceptedPlacement = claimScreenLabelPlacement(candidates, occupiedBoxes, (box) => (
        !(box.x > viewportSize.width + 24
        || box.y > viewportSize.height + 24
        || (box.x + box.w) < -24
        || (box.y + box.h) < -24)
      ));
      if (!acceptedPlacement) {
        continue;
      }
      entry.acceptedLabelPlacement = acceptedPlacement.id;
      labelCount += 1;
      if (layoutOnly) continue;
      const labelStyle = helpers.getCityLabelRenderStyle(visualEntry, config);
      context.textAlign = acceptedPlacement.textAlign;
      context.shadowColor = labelStyle.shadowColor;
      context.shadowBlur = Math.max(1.1, fontPx * labelStyle.shadowBlurFactor) / scale;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = Math.max(0.5, fontPx * labelStyle.shadowOffsetYFactor) / scale;
      context.lineWidth = Math.max(0.9, fontPx * labelStyle.strokeWidthFactor) / scale;
      context.strokeStyle = labelStyle.strokeStyle;
      context.strokeText(text, acceptedPlacement.drawX, acceptedPlacement.drawY);
      context.fillStyle = labelStyle.fillStyle;
      context.fillText(text, acceptedPlacement.drawX, acceptedPlacement.drawY);
      entry.labelContrastMode = labelStyle.usesLightLabel ? "light" : "default";
    }
    context.restore();
    return labelCount;
  }

  return {
    drawCityLabelsFromEntries,
  };
}
