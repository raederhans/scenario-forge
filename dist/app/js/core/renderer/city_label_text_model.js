const CITY_LABEL_MAX_WIDTH_PX = {
  sparse: { capital: 212, major: 186, regional: 164, minor: 150 },
  balanced: { capital: 188, major: 166, regional: 148, minor: 134 },
  dense: { capital: 166, major: 148, regional: 132, minor: 120 },
};

const CITY_ADMIN_LABEL_PATTERNS = [
  /\bcounty\b/giu,
  /\bdistrict\b/giu,
  /\boblast\b/giu,
  /\bokrug\b/giu,
  /\braion\b/giu,
  /\bmunicipality\b/giu,
  /\bgovernorate\b/giu,
  /городской округ/giu,
  /район/giu,
  /область/giu,
];

const CITY_ADMIN_LABEL_REJECT_PATTERNS = [
  /\bcounty\b/iu,
  /\bdistrict\b/iu,
  /\boblast\b/iu,
  /\bokrug\b/iu,
  /\braion\b/iu,
  /городской округ/iu,
  /район/iu,
  /область/iu,
];

// Label lookup stays live across language and locale changes.
export function createCityLabelTextModel(runtimeState, { getStrictGeoLabel, getPreferredGeoLabel }) {
  function getCityFeatureKey(feature, fallbackKey = "") {
    const props = feature?.properties || {};
    return String(
      props.__city_stable_key
      || props.stable_key
      || props.__city_id
      || props.id
      || feature?.id
      || fallbackKey
      || ""
    ).trim();
  }

  function getCityFeatureAliases(feature, key = "") {
    const props = feature?.properties || {};
    const aliases = new Set([
      key,
      props.__city_stable_key,
      props.stable_key,
      props.__city_id,
      props.id,
      props.name,
      props.label,
      props.name_en,
      props.label_en,
      props.name_zh,
      props.label_zh,
    ].filter(Boolean).map((value) => String(value).trim()));
    const extraAliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
    extraAliases.forEach((value) => {
      const alias = String(value || "").trim();
      if (alias) aliases.add(alias);
    });
    return Array.from(aliases);
  }

  function normalizeCityLabelComparisonValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getCityRawLanguageLabel(feature, language = runtimeState.currentLanguage) {
    const props = feature?.properties || {};
    if (String(language || "en").trim().toLowerCase() === "zh") {
      return String(props.label_zh || props.name_zh || props.label_cn || props.name_cn || "").trim();
    }
    return String(props.label_en || props.name_en || props.label || props.name || "").trim();
  }

  function getCityOverrideDisplayLabel(feature) {
    const props = feature?.properties || {};
    if (!props.__city_has_display_name_override) {
      return "";
    }
    const displayName = props.__city_display_name_override && typeof props.__city_display_name_override === "object"
      ? props.__city_display_name_override
      : {};
    return String(
      runtimeState.currentLanguage === "zh"
        ? (displayName.zh || "")
        : (displayName.en || "")
    ).trim();
  }

  function getCityBaseLocalizedLabel(feature, { strict = false } = {}) {
    const props = feature?.properties || {};
    const baseCandidates = [
      props.__city_stable_key,
      props.stable_key,
      props.__city_id,
      props.id,
      props.name,
      props.label,
      props.name_en,
      props.label_en,
      props.name_zh,
      props.label_zh,
    ];
    const aliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
    return strict
      ? getStrictGeoLabel([...baseCandidates, ...aliases], "")
      : getPreferredGeoLabel([...baseCandidates, ...aliases], "");
  }

  function isAdministrativeCityLabelCandidate(label = "") {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return false;
    return CITY_ADMIN_LABEL_REJECT_PATTERNS.some((pattern) => pattern.test(normalizedLabel));
  }

  function getCityHostFeatureDisplayLabel(feature) {
    const props = feature?.properties || {};
    const hostFeatureId = String(props.__city_host_feature_id || "").trim();
    if (!hostFeatureId) return "";
    const hostLabel = getStrictGeoLabel(hostFeatureId, "");
    if (!hostLabel || isAdministrativeCityLabelCandidate(hostLabel)) {
      return "";
    }
    return hostLabel;
  }

  function getCityRawFallbackLabel(feature) {
    const props = feature?.properties || {};
    const currentLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage);
    if (currentLanguageLabel) {
      return currentLanguageLabel;
    }
    const alternateLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage === "zh" ? "en" : "zh");
    if (alternateLanguageLabel) {
      return alternateLanguageLabel;
    }
    const localeEntry = props.__city_locale && typeof props.__city_locale === "object" ? props.__city_locale : {};
    return String(
      runtimeState.currentLanguage === "zh"
        ? (localeEntry.zh || localeEntry.en || props.label_zh || props.name_zh || props.label || props.name || props.__city_id || feature?.id || "")
        : (localeEntry.en || localeEntry.zh || props.label_en || props.name_en || props.label || props.name || props.__city_id || feature?.id || "")
    ).trim();
  }

  function getCityDisplayLabel(feature) {
    const props = feature?.properties || {};
    const overrideLabel = getCityOverrideDisplayLabel(feature);
    if (overrideLabel) {
      return overrideLabel;
    }
    const baseStrict = getCityBaseLocalizedLabel(feature, { strict: true });
    const baseFallback = getCityBaseLocalizedLabel(feature);
    const rawCurrentLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage);
    const rawFallback = getCityRawFallbackLabel(feature);
    const hostFeatureLabel = getCityHostFeatureDisplayLabel(feature);
    const prefersLocalizedFallback = !!props.__city_has_display_name_override;
    const hostComparison = normalizeCityLabelComparisonValue(hostFeatureLabel);
    const baseComparison = normalizeCityLabelComparisonValue(
      baseStrict || (prefersLocalizedFallback ? baseFallback : rawCurrentLanguageLabel) || (prefersLocalizedFallback ? rawCurrentLanguageLabel : baseFallback) || rawFallback
    );
    if (hostComparison && hostComparison !== baseComparison) {
      return hostFeatureLabel;
    }
    if (baseStrict) {
      return baseStrict;
    }
    if (prefersLocalizedFallback) {
      if (baseFallback) {
        return baseFallback;
      }
      if (rawCurrentLanguageLabel) {
        return rawCurrentLanguageLabel;
      }
    } else {
      if (rawCurrentLanguageLabel) {
        return rawCurrentLanguageLabel;
      }
      if (baseFallback) {
        return baseFallback;
      }
    }
    return rawFallback;
  }

  function cleanCityMapLabelText(label = "") {
    const rawLabel = String(label || "").trim();
    if (!rawLabel) return "";
    let cleaned = rawLabel
      .replace(/\s*\(([^)]*)\)\s*/g, " ")
      .replace(/\s*,\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    CITY_ADMIN_LABEL_PATTERNS.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, " ").replace(/\s+/g, " ").trim();
    });
    cleaned = cleaned.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
    return cleaned.length >= 3 ? cleaned : rawLabel;
  }

  function isCjkText(value = "") {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(String(value || ""));
  }

  function abbreviateCityMapLabel(label = "") {
    const rawLabel = String(label || "").trim();
    if (!rawLabel || isCjkText(rawLabel) || !/[\s-]/u.test(rawLabel)) {
      return rawLabel;
    }
    const segments = rawLabel.split(/([\s-]+)/u);
    let wordIndex = 0;
    return segments.map((segment) => {
      if (!segment || /^[\s-]+$/u.test(segment)) {
        return segment;
      }
      wordIndex += 1;
      if (wordIndex === 1) {
        return segment;
      }
      const firstGlyph = Array.from(segment)[0] || "";
      return firstGlyph ? `${firstGlyph}.` : segment;
    }).join("").replace(/\s+/g, " ").trim();
  }

  function truncateCityLabelToWidth(text = "", maxWidthPx = 0, measureWidth = () => 0) {
    const rawText = String(text || "").trim();
    if (!rawText) return "";
    if (measureWidth(rawText) <= maxWidthPx) {
      return rawText;
    }
    const glyphs = Array.from(rawText);
    if (glyphs.length <= 4) {
      return rawText;
    }
    let truncated = rawText;
    while (glyphs.length > 4) {
      glyphs.pop();
      truncated = `${glyphs.join("")}\u2026`;
      if (measureWidth(truncated) <= maxWidthPx) {
        return truncated;
      }
    }
    return truncated;
  }

  function getCityMapLabelMaxWidth(entry, config = {}) {
    const densityKey = String(config.labelDensity || "balanced").trim().toLowerCase();
    const widthTable = CITY_LABEL_MAX_WIDTH_PX[densityKey] || CITY_LABEL_MAX_WIDTH_PX.balanced;
    const widthKey = entry?.isCapital ? "capital" : (String(entry?.cityTier || "minor").trim().toLowerCase());
    return Number(widthTable[widthKey] || widthTable.minor || 132);
  }

  function formatCityMapLabel(fullLabel, { entry = null, context: labelContext = null, config = {}, scale = 1 } = {}) {
    const rawLabel = String(fullLabel || "").trim();
    if (!rawLabel || !labelContext?.measureText) {
      return rawLabel;
    }
    const maxWidthPx = getCityMapLabelMaxWidth(entry, config);
    const measureWidth = (candidate) => Number(labelContext.measureText(String(candidate || "")).width || 0) * scale;
    const cleanedLabel = cleanCityMapLabelText(rawLabel);
    if (cleanedLabel && measureWidth(cleanedLabel) <= maxWidthPx) {
      return cleanedLabel;
    }
    const abbreviatedLabel = abbreviateCityMapLabel(cleanedLabel || rawLabel);
    if (abbreviatedLabel && measureWidth(abbreviatedLabel) <= maxWidthPx) {
      return abbreviatedLabel;
    }
    return truncateCityLabelToWidth(abbreviatedLabel || cleanedLabel || rawLabel, maxWidthPx, measureWidth);
  }

  return Object.freeze({ getCityFeatureKey, getCityFeatureAliases, getCityDisplayLabel, formatCityMapLabel });
}
