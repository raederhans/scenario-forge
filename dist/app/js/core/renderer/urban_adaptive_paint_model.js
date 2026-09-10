import {
  getCanvasColorRelativeLuminance,
  getSafeCanvasColor,
  mixCanvasColors,
} from "./canvas_color_helpers.js";

export function getUrbanFeatureOwnerId(feature) {
  const props = feature?.properties || {};
  return String(
    props.country_owner_id ||
    props.countryOwnerId ||
    ""
  ).trim();
}

// Read state collections and colors at call time to reflect scenario and palette changes.
export function createUrbanAdaptivePaintModel(runtimeState, { getResolvedFeatureColor, clamp }) {
  function getUrbanHostFillColor(feature) {
    const ownerFeatureId = getUrbanFeatureOwnerId(feature);
    if (!ownerFeatureId) return null;
    const hostFeature = runtimeState.landIndex?.get(ownerFeatureId);
    if (!hostFeature) return null;
    return (
      getSafeCanvasColor(runtimeState.colors?.[ownerFeatureId], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(hostFeature, ownerFeatureId), null)
    );
  }

  function computeUrbanAdaptivePaintFromHostColor(backgroundColor, config = {}) {
    if (!backgroundColor) return null;
    const luminance = getCanvasColorRelativeLuminance(backgroundColor);
    if (!Number.isFinite(luminance)) return null;

    const strength = clamp(Number(config.adaptiveStrength) || 0, 0, 1);
    const toneBias = clamp(Number(config.toneBias) || 0, -0.3, 0.3);
    const lightenBias = Math.max(toneBias, 0);
    const deepenBias = Math.max(-toneBias, 0);
    const isDark = luminance <= 0.30;
    const isLight = luminance >= 0.62;

    const tintEnabled = !!config.adaptiveTintEnabled;
    const tintColor = getSafeCanvasColor(config.adaptiveTintColor, null);
    const tintStrength = clamp(Number(config.adaptiveTintStrength) || 0, 0, 0.5);
    const applyTintOverlay = (baseColor, channelStrength = 1) => {
      if (!tintEnabled || !tintColor || tintStrength <= 0) return baseColor;
      return mixCanvasColors(baseColor, tintColor, clamp(tintStrength * channelStrength, 0, 0.5));
    };

    if (isDark) {
      const fillColor = mixCanvasColors(
        backgroundColor,
        "#f4efe3",
        clamp(0.48 + (strength * 0.18) + (lightenBias * 0.56) - (deepenBias * 0.24), 0.18, 0.96)
      );
      const strokeColor = mixCanvasColors(
        backgroundColor,
        "#fff9ef",
        clamp(0.66 + (strength * 0.14) + (lightenBias * 0.44) - (deepenBias * 0.18), 0.24, 0.98)
      );
      return {
        fillColor: applyTintOverlay(fillColor, 1),
        strokeColor: applyTintOverlay(strokeColor, 0.72),
      };
    }
    if (isLight) {
      const fillColor = mixCanvasColors(
        backgroundColor,
        "#20252b",
        clamp(0.42 + (strength * 0.16) + (deepenBias * 0.34) - (lightenBias * 0.28), 0.16, 0.94)
      );
      const strokeColor = mixCanvasColors(
        backgroundColor,
        "#0f1419",
        clamp(0.62 + (strength * 0.12) + (deepenBias * 0.26) - (lightenBias * 0.18), 0.22, 0.96)
      );
      return {
        fillColor: applyTintOverlay(fillColor, 1),
        strokeColor: applyTintOverlay(strokeColor, 0.72),
      };
    }
    const targetFill = luminance < 0.48 ? "#ede7da" : "#272d34";
    const targetStroke = luminance < 0.48 ? "#fff7ec" : "#10151a";
    const fillColor = mixCanvasColors(
      backgroundColor,
      targetFill,
      clamp(0.46 + (strength * 0.16) + (luminance < 0.48 ? (lightenBias * 0.42) - (deepenBias * 0.18) : (deepenBias * 0.26) - (lightenBias * 0.22)), 0.18, 0.95)
    );
    const strokeColor = mixCanvasColors(
      backgroundColor,
      targetStroke,
      clamp(0.66 + (strength * 0.12) + (luminance < 0.48 ? (lightenBias * 0.3) - (deepenBias * 0.14) : (deepenBias * 0.22) - (lightenBias * 0.16)), 0.24, 0.97)
    );
    return {
      fillColor: applyTintOverlay(fillColor, 1),
      strokeColor: applyTintOverlay(strokeColor, 0.72),
    };
  }

  function getUrbanAdaptivePaint(feature, config = {}) {
    const backgroundColor = getUrbanHostFillColor(feature);
    return computeUrbanAdaptivePaintFromHostColor(backgroundColor, config);
  }

  // A draw is synchronous. Share owner colors only within it so subsequent
  // palette edits, scenario changes and replacement land maps remain live.
  function createDrawPaintResolver(config = {}) {
    const byOwner = new Map();
    return (feature) => {
      const ownerId = getUrbanFeatureOwnerId(feature);
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, getUrbanAdaptivePaint(feature, config));
      return byOwner.get(ownerId);
    };
  }

  function getEffectiveUrbanMode(config = {}, capability = runtimeState.urbanLayerCapability) {
    return config?.mode === "adaptive" && capability?.adaptiveAvailable ? "adaptive" : "manual";
  }

  return Object.freeze({
    computeUrbanAdaptivePaintFromHostColor,
    getUrbanAdaptivePaint,
    createDrawPaintResolver,
    getEffectiveUrbanMode,
  });
}
