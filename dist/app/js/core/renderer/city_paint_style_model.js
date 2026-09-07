import {
  getCanvasColorRelativeLuminance,
  getSafeCanvasColor,
  mixCanvasColors,
} from "./canvas_color_helpers.js";

const CITY_MARKER_THEME_GRAPHITE = "classic_graphite";
const CITY_LABEL_DARK_BACKGROUND_LUMINANCE = 0.34;
const CITY_MARKER_THEME_TOKENS = {
  classic_graphite: {
    fillTop: "rgba(82, 91, 103, 0.99)",
    fillMid: "rgba(48, 56, 68, 0.99)",
    fillBottom: "rgba(24, 30, 39, 0.99)",
    rimDark: "rgba(5, 9, 15, 0.58)",
    stroke: "rgba(245, 188, 86, 0.72)",
    highlight: "rgba(246, 249, 252, 0.2)",
    specular: "rgba(242, 246, 252, 0.14)",
    baseShadow: "rgba(4, 8, 13, 0.32)",
    capitalAccent: "rgba(240, 184, 79, 0.98)",
    capitalHighlight: "rgba(255, 237, 186, 0.5)",
    label: "rgba(37, 40, 45, 0.96)",
    capitalLabel: "rgba(95, 68, 30, 0.98)",
    halo: "rgba(255, 242, 197, 0.12)",
    shadow: "rgba(7, 11, 17, 0.22)",
  },
  atlas_ink: {
    fillTop: "rgba(96, 230, 244, 0.99)",
    fillMid: "rgba(0, 142, 168, 0.99)",
    fillBottom: "rgba(0, 74, 92, 0.99)",
    rimDark: "rgba(0, 37, 50, 0.6)",
    stroke: "rgba(221, 251, 255, 0.72)",
    highlight: "rgba(241, 255, 255, 0.34)",
    specular: "rgba(229, 254, 255, 0.24)",
    baseShadow: "rgba(0, 31, 43, 0.3)",
    capitalAccent: "rgba(255, 209, 102, 0.98)",
    capitalHighlight: "rgba(255, 244, 196, 0.52)",
    label: "rgba(0, 69, 82, 0.96)",
    capitalLabel: "rgba(101, 72, 22, 0.98)",
    halo: "rgba(211, 250, 255, 0.15)",
    shadow: "rgba(0, 35, 50, 0.22)",
  },
  parchment_sepia: {
    fillTop: "rgba(211, 104, 82, 0.99)",
    fillMid: "rgba(155, 63, 47, 0.99)",
    fillBottom: "rgba(92, 37, 31, 0.99)",
    rimDark: "rgba(52, 20, 18, 0.56)",
    stroke: "rgba(255, 210, 168, 0.64)",
    highlight: "rgba(255, 230, 210, 0.28)",
    specular: "rgba(255, 221, 194, 0.2)",
    baseShadow: "rgba(48, 19, 17, 0.28)",
    capitalAccent: "rgba(230, 132, 58, 0.98)",
    capitalHighlight: "rgba(255, 211, 160, 0.5)",
    label: "rgba(90, 37, 31, 0.96)",
    capitalLabel: "rgba(118, 60, 22, 0.98)",
    halo: "rgba(255, 225, 198, 0.11)",
    shadow: "rgba(56, 22, 18, 0.2)",
  },
  slate_blue: {
    fillTop: "rgba(160, 130, 240, 0.99)",
    fillMid: "rgba(91, 66, 166, 0.99)",
    fillBottom: "rgba(49, 35, 105, 0.99)",
    rimDark: "rgba(25, 17, 69, 0.6)",
    stroke: "rgba(226, 210, 255, 0.72)",
    highlight: "rgba(249, 245, 255, 0.32)",
    specular: "rgba(236, 228, 255, 0.22)",
    baseShadow: "rgba(24, 18, 58, 0.3)",
    capitalAccent: "rgba(215, 183, 255, 0.98)",
    capitalHighlight: "rgba(246, 232, 255, 0.5)",
    label: "rgba(53, 40, 102, 0.96)",
    capitalLabel: "rgba(78, 53, 126, 0.98)",
    halo: "rgba(237, 229, 255, 0.14)",
    shadow: "rgba(28, 20, 66, 0.22)",
  },
  ivory_outline: {
    fillTop: "rgba(255, 252, 237, 0.99)",
    fillMid: "rgba(243, 234, 210, 0.99)",
    fillBottom: "rgba(199, 184, 146, 0.99)",
    rimDark: "rgba(18, 24, 34, 0.7)",
    stroke: "rgba(30, 41, 59, 0.78)",
    highlight: "rgba(255, 255, 255, 0.4)",
    specular: "rgba(255, 255, 255, 0.28)",
    baseShadow: "rgba(6, 10, 18, 0.3)",
    capitalAccent: "rgba(255, 159, 67, 0.98)",
    capitalHighlight: "rgba(255, 220, 177, 0.56)",
    label: "rgba(51, 45, 36, 0.98)",
    capitalLabel: "rgba(112, 63, 16, 0.98)",
    halo: "rgba(255, 249, 228, 0.18)",
    shadow: "rgba(8, 12, 20, 0.24)",
  },
};

// Marker and label contrast derive from the same live host/palette state.
export function createCityPaintStyleModel({
  runtimeState, getResolvedFeatureColor, computeUrbanAdaptivePaintFromHostColor,
}) {
  function getCityMarkerThemeTokens(config = {}) {
    const themeKey = String(config.theme || CITY_MARKER_THEME_GRAPHITE).trim().toLowerCase();
    const baseTokens = CITY_MARKER_THEME_TOKENS[themeKey] || CITY_MARKER_THEME_TOKENS.classic_graphite;
    const pointColor = getSafeCanvasColor(config.color, baseTokens.fillMid);
    const capitalColor = getSafeCanvasColor(config.capitalColor, baseTokens.capitalAccent);
    return {
      ...baseTokens,
      fillTop: mixCanvasColors(baseTokens.fillTop, pointColor, 0.34) || pointColor,
      fillMid: mixCanvasColors(baseTokens.fillMid, pointColor, 0.84) || pointColor,
      fillBottom: mixCanvasColors(baseTokens.fillBottom, pointColor, 0.9) || pointColor,
      stroke: mixCanvasColors(baseTokens.stroke, pointColor, 0.2) || baseTokens.stroke,
      capitalAccent: mixCanvasColors(baseTokens.capitalAccent, capitalColor, 0.92) || capitalColor,
      capitalHighlight: mixCanvasColors(baseTokens.capitalHighlight, capitalColor, 0.32) || baseTokens.capitalHighlight,
      capitalLabel: mixCanvasColors(baseTokens.capitalLabel, capitalColor, 0.18) || baseTokens.capitalLabel,
    };
  }

  function getCityLabelBackgroundColor(entry) {
    const props = entry?.feature?.properties || entry?.properties || {};
    const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
    const hostFeature = hostFeatureId ? runtimeState.landIndex?.get(hostFeatureId) : null;
    if (hostFeature && hostFeatureId) {
      return (
        getSafeCanvasColor(runtimeState.colors?.[hostFeatureId], null) ||
        getSafeCanvasColor(getResolvedFeatureColor(hostFeature, hostFeatureId), null)
      );
    }

    const countryCode = String(
      props.__city_scenario_tag ||
      props.__city_country_code ||
      props.country_code ||
      props.cntr_code ||
      ""
    ).trim().toUpperCase();
    if (!countryCode) return null;
    return (
      getSafeCanvasColor(runtimeState.sovereignBaseColors?.[countryCode], null) ||
      getSafeCanvasColor(runtimeState.countryBaseColors?.[countryCode], null)
    );
  }

  function getCityBackgroundPaintInfo(entry) {
    const backgroundColor = getCityLabelBackgroundColor(entry) || "";
    const luminance = getCanvasColorRelativeLuminance(backgroundColor);
    const usesLightContrast = Number.isFinite(luminance) && luminance < CITY_LABEL_DARK_BACKGROUND_LUMINANCE;
    return {
      backgroundColor,
      luminance,
      usesLightContrast,
    };
  }

  function getCityLabelRenderStyle(entry, config = {}) {
    const tokens = getCityMarkerThemeTokens(config);
    const backgroundInfo = getCityBackgroundPaintInfo(entry);
    const { backgroundColor, luminance } = backgroundInfo;
    const usesLightLabel = backgroundInfo.usesLightContrast;

    if (!usesLightLabel) {
      return {
        fillStyle: entry?.isCapital ? tokens.capitalLabel : tokens.label,
        strokeStyle: "rgba(255, 252, 245, 0.22)",
        shadowColor: tokens.shadow,
        strokeWidthFactor: 0.1,
        shadowBlurFactor: 0.12,
        shadowOffsetYFactor: 0.04,
        usesLightLabel: false,
        backgroundColor: backgroundColor || "",
        luminance,
      };
    }

    return {
      fillStyle: entry?.isCapital ? "rgba(248, 245, 238, 0.98)" : "rgba(243, 240, 233, 0.96)",
      strokeStyle: "rgba(12, 16, 24, 0.46)",
      shadowColor: "rgba(6, 9, 14, 0.34)",
      strokeWidthFactor: 0.18,
      shadowBlurFactor: 0.18,
      shadowOffsetYFactor: 0.05,
      usesLightLabel: true,
      backgroundColor: backgroundColor || "",
      luminance,
    };
  }

  function getCityMarkerRenderStyle(entry, config = {}) {
    const baseTokens = getCityMarkerThemeTokens(config);
    const backgroundInfo = getCityBackgroundPaintInfo(entry);
    const { backgroundColor, luminance, usesLightContrast } = backgroundInfo;
    if (!usesLightContrast || !backgroundColor) {
      return {
        tokens: baseTokens,
        backgroundColor,
        luminance,
        usesLightContrast: false,
        adapted: false,
      };
    }

    const adaptiveBase = computeUrbanAdaptivePaintFromHostColor(backgroundColor, {
      adaptiveStrength: 1,
      toneBias: 0.08,
    });
    const adaptiveStroke = adaptiveBase?.strokeColor || mixCanvasColors(backgroundColor, "#fff8ef", 0.78) || baseTokens.stroke;
    return {
      tokens: {
        ...baseTokens,
        rimDark: mixCanvasColors(baseTokens.rimDark, adaptiveStroke, 0.44) || baseTokens.rimDark,
        stroke: mixCanvasColors(baseTokens.stroke, adaptiveStroke, 0.54) || baseTokens.stroke,
        highlight: mixCanvasColors(baseTokens.highlight, "#ffffff", 0.14) || baseTokens.highlight,
        specular: mixCanvasColors(baseTokens.specular, "#ffffff", 0.1) || baseTokens.specular,
        halo: mixCanvasColors(baseTokens.halo, adaptiveStroke, 0.16) || baseTokens.halo,
      },
      backgroundColor,
      luminance,
      usesLightContrast: true,
      adapted: true,
    };
  }

  return { getCityLabelRenderStyle, getCityMarkerRenderStyle };
}
