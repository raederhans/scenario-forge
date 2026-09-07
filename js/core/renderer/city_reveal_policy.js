// City reveal rules: tiering, phase budgets, country priority, and marker sizing.
// Pure policy only; collection caches and viewport/runtime access stay in the renderer.

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const CITY_COUNTRY_TIER_RANK = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};

export const CITY_COUNTRY_CLASS_RANK = Object.freeze({
  global_core: 6,
  regional_core: 5,
  local_actor: 4,
  fragmented_actor: 3,
  micro: 2,
  micro_subject: 1,
});

const CITY_COUNTRY_CLASS_WEIGHT = Object.freeze({
  global_core: 1.36,
  regional_core: 1.2,
  local_actor: 1.02,
  fragmented_actor: 1.12,
  micro: 0.86,
  micro_subject: 0.74,
});

const CITY_SCENARIO_EXCLUDED_TAGS = new Set(["AFA", "RFA"]);

const CITY_WARLORD_SCENARIO_TAGS = new Set([
  // Russia warlord/fragmentation bloc
  "ALT", "BKR", "BRY", "CHT", "GOR", "IRK", "KOM", "KRS", "NOV", "OMS", "OUR", "PRM", "RSF",
  "RUR", "SAM", "SBA", "SVR", "TAT", "TOM", "TYM", "URA", "VOL", "VYT", "WRS", "YAK", "ZLT",
  // China warlord/clique bloc
  "GXC", "GUI", "PRC", "QMA", "RGC", "SIC", "SIK", "XIK", "XSM",
]);

export const CITY_PRIMARY_POWER_TAGS = new Set(["USA", "GER", "JAP"]);

export const CITY_SECONDARY_POWER_TAGS = new Set(["ITA", "ENG", "FRA", "CAN", "BRA", "BRG", "RKM", "RKO", "RKU"]);

export const CITY_MARKER_SIZE_LIMITS_PX = {
  minor: 10,
  regional: 14,
  major: 18,
  capital: 22,
};

const CITY_MARKER_BASE_SIZES_PX = {
  minor: 5.8,
  regional: 7.7,
  major: 10.4,
};

const CITY_LABEL_DENSITY_BUDGETS = {
  sparse: { P4: 16, P5: 32 },
  balanced: { P4: 24, P5: 48 },
  dense: { P4: 32, P5: 64 },
};

const CITY_REVEAL_PHASES = [
  { id: "P0", minScale: 0, maxScale: 1.15, markerBudget: 18, labelBudget: 0 },
  { id: "P1", minScale: 1.15, maxScale: 1.45, markerBudget: 28, labelBudget: 0 },
  { id: "P2", minScale: 1.45, maxScale: 1.9, markerBudget: 42, labelBudget: 0 },
  { id: "P3", minScale: 1.9, maxScale: 2.45, markerBudget: 72, labelBudget: 8 },
  { id: "P4", minScale: 2.45, maxScale: 3.05, markerBudget: 110, labelBudget: 24 },
  { id: "P5", minScale: 3.05, maxScale: Infinity, markerBudget: 170, labelBudget: 48 },
];

const CITY_MARKER_QUOTAS_BY_PHASE = Object.freeze({
  P0: Object.freeze({ A: 1, B: 0, C: 0, D: 0, E: 0 }),
  P1: Object.freeze({ A: 1, B: 1, C: 1, D: 1, E: 1 }),
  P2: Object.freeze({ A: 3, B: 1, C: 1, D: 1, E: 1 }),
  P3: Object.freeze({ A: 4, B: 2, C: 1, D: 1, E: 1 }),
  P4: Object.freeze({ A: 6, B: 4, C: 2, D: 1, E: 1 }),
  P5: Object.freeze({ A: 8, B: 6, C: 4, D: 2, E: 1 }),
});

const CITY_PRIORITY_COUNTRY_RESERVE_SHARE_BY_PHASE = Object.freeze({
  P0: 0.5,
  P1: 0.5,
  P2: 0.3,
  P3: 0.3,
  P4: 0,
  P5: 0,
});

export function getCityCanonicalId(feature) {
  const props = feature?.properties || {};
  return String(props.__city_id || props.id || feature?.id || "").trim();
}

export function getCityTier(feature) {
  const props = feature?.properties || {};
  const tier = String(props.__city_base_tier || props.base_tier || props.baseTier || "").trim().toLowerCase();
  if (tier === "major" || tier === "regional" || tier === "minor") {
    return tier;
  }
  return "minor";
}

export function getCityTierWeight(feature) {
  switch (getCityTier(feature)) {
    case "major":
      return 3;
    case "regional":
      return 2;
    default:
      return 1;
  }
}

export function getDefaultCityMinZoomForTier(tier) {
  switch (String(tier || "").trim().toLowerCase()) {
    case "major":
      return 0.8;
    case "regional":
      return 1.6;
    default:
      return 2.9;
  }
}

export function getCityEffectiveMinZoom(feature) {
  const props = feature?.properties || {};
  const explicit = Number(props.__city_min_zoom ?? props.min_zoom ?? props.minZoom);
  if (Number.isFinite(explicit)) return explicit;
  return getDefaultCityMinZoomForTier(getCityTier(feature));
}

export function getUrbanFeatureStableId(feature) {
  const directId = String(feature?.id ?? "").trim();
  if (directId) return directId;
  const props = feature?.properties || {};
  const lowercasePropId = String(props.id ?? "").trim();
  if (lowercasePropId) return lowercasePropId;
  return String(props.ID ?? "").trim();
}

export function getCityCapitalScore(feature) {
  const props = feature?.properties || {};
  if (props.__city_is_country_capital) return 3;
  if (props.__city_is_admin_capital) return 2;
  if (props.__city_is_capital) return 1;
  return 0;
}

export function getCitySortWeight(feature) {
  const props = feature?.properties || {};
  const population = Math.max(0, Number(props.__city_population || 0));
  const victoryPointValue = Math.max(0, Number(props.__city_scenario_victory_points || 0));
  return (
    (props.__city_is_capital ? 2_000_000_000 : 0)
    + (getCityTierWeight(feature) * 250_000_000)
    + (victoryPointValue * 25_000_000)
    + population
  );
}

export function getCityCountryTierFromScenarioRecord(profile, record, { defaultCountry = "", featuredTags = new Set() } = {}) {
  if (!record || typeof record !== "object") return "";
  const tag = String(profile?.scenarioTag || "").trim().toUpperCase();
  const entryKind = String(record.entry_kind || record.entryKind || "").trim().toLowerCase();
  const controllerFeatureCount = Math.max(
    0,
    Number(record.controller_feature_count ?? record.controllerFeatureCount ?? 0) || 0
  );
  const isFeatured = !!record.featured || featuredTags.has(tag);
  if (entryKind === "controller_only" || controllerFeatureCount <= 0) {
    return "E";
  }
  if (
    tag === defaultCountry
    || (isFeatured && controllerFeatureCount >= 40)
    || (!isFeatured && controllerFeatureCount >= 150)
  ) {
    return "A";
  }
  if ((isFeatured && controllerFeatureCount < 40) || (!isFeatured && controllerFeatureCount >= 40)) {
    return "B";
  }
  if (controllerFeatureCount >= 12) return "C";
  if (controllerFeatureCount >= 1) return "D";
  return "E";
}

export function getCityCountryVisibilityClass(profile, record, { defaultCountry = "", featuredTags = new Set() } = {}) {
  const tag = String(profile?.scenarioTag || "").trim().toUpperCase();
  const controllerFeatureCount = Math.max(
    0,
    Number(record?.controller_feature_count ?? record?.controllerFeatureCount ?? 0) || 0
  );
  const profileFeatureCount = Math.max(0, Number(profile?.featureCount || 0));
  const isFeatured = !!record?.featured || featuredTags.has(tag) || tag === defaultCountry;
  const isScenarioOnly = !!record?.scenario_only;
  const parentOwnerTag = String(record?.parent_owner_tag || record?.parentOwnerTag || "").trim().toUpperCase();
  const entryKind = String(record?.entry_kind || record?.entryKind || "").trim().toLowerCase();
  const isSubject = !!parentOwnerTag || entryKind === "scenario_subject";
  if (isSubject) return "micro_subject";
  if (CITY_WARLORD_SCENARIO_TAGS.has(tag)) {
    return "fragmented_actor";
  }
  if (isFeatured || controllerFeatureCount >= 120 || profileFeatureCount >= 200) return "global_core";
  if (controllerFeatureCount >= 40 || profileFeatureCount >= 80) return "regional_core";
  if (controllerFeatureCount >= 8 || profileFeatureCount >= 16) return "local_actor";
  if (isScenarioOnly && controllerFeatureCount >= 1 && !parentOwnerTag && profileFeatureCount <= 18) {
    return "fragmented_actor";
  }
  return "micro";
}

export function isCityScenarioTagExcludedFromReveal(tag = "") {
  const normalized = String(tag || "").trim().toUpperCase();
  return normalized ? CITY_SCENARIO_EXCLUDED_TAGS.has(normalized) : false;
}

function getCityFixedPowerCalibration(tag = "") {
  const normalized = String(tag || "").trim().toUpperCase();
  if (CITY_PRIMARY_POWER_TAGS.has(normalized)) {
    return {
      className: "global_core",
      classWeightBias: 0.42,
      minQuotaFloorBoost: 2,
    };
  }
  if (CITY_SECONDARY_POWER_TAGS.has(normalized)) {
    return {
      className: "regional_core",
      classWeightBias: 0.22,
      minQuotaFloorBoost: 1,
    };
  }
  return null;
}

function normalizeCityCountryVisibilityClass(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CITY_COUNTRY_CLASS_WEIGHT, normalized)
    ? normalized
    : "";
}

export function getCityCountryRevealOverride(record = null) {
  const tag = String(record?.tag || "").trim().toUpperCase();
  const fixedPower = getCityFixedPowerCalibration(tag);
  if (!record || typeof record !== "object") {
    return fixedPower || {
      className: "",
      classWeightBias: 0,
      minQuotaFloorBoost: 0,
    };
  }
  const className = normalizeCityCountryVisibilityClass(
    record.city_reveal_class
    || record.cityRevealClass
    || record.city_visibility_class
    || record.cityVisibilityClass
  ) || String(fixedPower?.className || "");
  const classWeightBias = clamp(
    Number(record.city_reveal_weight_bias ?? record.cityRevealWeightBias ?? fixedPower?.classWeightBias ?? 0) || 0,
    -0.35,
    0.75
  );
  const minQuotaFloorBoost = clamp(
    Math.round(Number(record.city_reveal_min_floor_boost ?? record.cityRevealMinFloorBoost ?? fixedPower?.minQuotaFloorBoost ?? 0) || 0),
    0,
    3
  );
  return {
    className,
    classWeightBias,
    minQuotaFloorBoost,
  };
}

export function getFallbackCityCountryTier(profile) {
  const maxPopulation = Math.max(0, Number(profile?.maxPopulation || 0));
  if ((profile?.hasCountryCapital && maxPopulation >= 2_500_000) || maxPopulation >= 5_000_000) {
    return "A";
  }
  if (profile?.hasCountryCapital || maxPopulation >= 1_500_000) {
    return "B";
  }
  if (maxPopulation >= 350_000) {
    return "C";
  }
  if ((profile?.featureCount || 0) > 0) {
    return "D";
  }
  return "E";
}

export function getCityRevealPhase(scale) {
  const normalizedScale = Math.max(0.0001, Number(scale || 1));
  return CITY_REVEAL_PHASES.find((phase) => normalizedScale >= phase.minScale && normalizedScale < phase.maxScale)
    || CITY_REVEAL_PHASES[CITY_REVEAL_PHASES.length - 1];
}

function getCityRevealPhaseIndex(scale) {
  const phase = getCityRevealPhase(scale);
  const index = CITY_REVEAL_PHASES.findIndex((entry) => entry.id === phase.id);
  return Math.max(0, index);
}

export function getCityRevealPhaseInterpolation(scale) {
  const phaseIndex = getCityRevealPhaseIndex(scale);
  const currentPhase = CITY_REVEAL_PHASES[phaseIndex] || CITY_REVEAL_PHASES[0];
  const nextPhase = CITY_REVEAL_PHASES[Math.min(CITY_REVEAL_PHASES.length - 1, phaseIndex + 1)] || currentPhase;
  if (!nextPhase || nextPhase.id === currentPhase.id || !Number.isFinite(nextPhase.minScale)) {
    return { phaseIndex, currentPhase, nextPhase: currentPhase, t: 0 };
  }
  const minScale = Number(currentPhase.minScale || 0);
  const maxScale = Number(nextPhase.minScale || currentPhase.maxScale || minScale);
  const span = Math.max(0.0001, maxScale - minScale);
  const t = clamp((Number(scale || 1) - minScale) / span, 0, 1);
  return { phaseIndex, currentPhase, nextPhase, t };
}

export function getCityRevealBucket(entry, phaseId) {
  const countryTier = String(entry?.countryTier || "D").trim().toUpperCase();
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  const isCapital = !!entry?.isCapital;
  switch (String(phaseId || "P0")) {
    case "P0":
      return countryTier === "A" && isCapital ? 0 : Number.POSITIVE_INFINITY;
    case "P1":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      return Number.POSITIVE_INFINITY;
    case "P2":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      return Number.POSITIVE_INFINITY;
    case "P3":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      if (countryTier === "B" && cityTier === "major") return 4;
      return Number.POSITIVE_INFINITY;
    case "P4":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      if (countryTier === "B" && cityTier === "major") return 4;
      if ((countryTier === "A" || countryTier === "B" || countryTier === "C") && (cityTier === "regional" || cityTier === "major")) {
        return 5;
      }
      return Number.POSITIVE_INFINITY;
    case "P5":
    default:
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (cityTier === "major") return 3;
      if (cityTier === "regional") return 4;
      if (countryTier !== "E" && cityTier === "minor") return 5;
      return Number.POSITIVE_INFINITY;
  }
}

function getCityMarkerQuotaForTier(phaseId, countryTier) {
  const quotaTable = CITY_MARKER_QUOTAS_BY_PHASE[String(phaseId || "P0")] || CITY_MARKER_QUOTAS_BY_PHASE.P0;
  return quotaTable[String(countryTier || "D").trim().toUpperCase()] ?? 0;
}

export function getCityMarkerDensityMultiplier(config = {}) {
  return clamp(Number(config.markerDensity) || 1, 0.5, 2);
}

function scaleCityMarkerQuota(baseQuota, markerDensity) {
  const normalizedQuota = Math.max(0, Number(baseQuota) || 0);
  const normalizedDensity = clamp(Number(markerDensity) || 1, 0.5, 2);
  if (normalizedQuota <= 0) return 0;
  const scaledQuota = normalizedQuota * normalizedDensity;
  if (normalizedDensity < 1) {
    const flooredQuota = Math.floor(scaledQuota);
    if (normalizedQuota >= 1 && scaledQuota > 0) {
      return Math.max(1, flooredQuota);
    }
    return flooredQuota;
  }
  return Math.ceil(scaledQuota);
}

export function getCityInterpolatedMarkerQuota(entry, scale, markerDensity = 1, viewportStats = null) {
  const { currentPhase, nextPhase, t } = getCityRevealPhaseInterpolation(scale);
  const countryTier = String(entry?.countryTier || "D").trim().toUpperCase();
  const fromQuota = Number(getCityMarkerQuotaForTier(currentPhase.id, countryTier) || 0);
  const toQuota = Number(getCityMarkerQuotaForTier(nextPhase.id, countryTier) || fromQuota);
  const interpolated = fromQuota + ((toQuota - fromQuota) * t);
  return scaleCityMarkerQuota(interpolated, markerDensity);
}

export function getCityInterpolatedMarkerBudget(scale, markerDensity = 1) {
  const { currentPhase, nextPhase, t } = getCityRevealPhaseInterpolation(scale);
  const fromBudget = Math.max(0, Number(currentPhase?.markerBudget || 0));
  const toBudget = Math.max(0, Number(nextPhase?.markerBudget || fromBudget));
  const interpolated = fromBudget + ((toBudget - fromBudget) * t);
  return Math.max(0, Math.round(interpolated * clamp(Number(markerDensity) || 1, 0.5, 2)));
}

function getCityRevealCompetitionBand(phaseId = "") {
  if (phaseId === "P0" || phaseId === "P1") return "low";
  if (phaseId === "P2" || phaseId === "P3") return "mid";
  return "high";
}

function getCityCountryClassScore(entry) {
  const className = String(entry?.countryClass || "micro").trim().toLowerCase();
  const rank = Number(entry?.countryClassRank || CITY_COUNTRY_CLASS_RANK[className] || 0);
  const bias = clamp(Number(entry?.countryClassWeightBias || 0) || 0, -0.35, 0.75);
  return rank + bias;
}

export function getCityPriorityCountryReserveBudget(scale, markerBudget) {
  const normalizedBudget = Math.max(0, Number(markerBudget) || 0);
  if (normalizedBudget <= 0) return 0;
  const { currentPhase, nextPhase, t } = getCityRevealPhaseInterpolation(scale);
  const fromShare = Number(CITY_PRIORITY_COUNTRY_RESERVE_SHARE_BY_PHASE[currentPhase.id] || 0);
  const toShare = Number(CITY_PRIORITY_COUNTRY_RESERVE_SHARE_BY_PHASE[nextPhase.id] || fromShare);
  const share = clamp(fromShare + ((toShare - fromShare) * t), 0, 0.5);
  return Math.min(normalizedBudget, Math.max(0, Math.round(normalizedBudget * share)));
}

export function getCityPriorityCountryReserveRank(entry) {
  let score = 0;
  if (entry?.isDefaultCountry) score += 600;
  if (entry?.isPrimaryPower) score += 520;
  if (entry?.isFeaturedCountry) score += 360;
  if (entry?.isSecondaryPower) score += 260;
  score += Number(entry?.countryTierRank || 0) * 24;
  score += getCityCountryClassScore(entry) * 8;
  if (entry?.feature?.properties?.__city_is_country_capital) score += 18;
  return score;
}

export function compareCityRevealEntries(left, right, phaseId = "P0") {
  const leftBucket = Number(left?.revealBucket ?? Number.POSITIVE_INFINITY);
  const rightBucket = Number(right?.revealBucket ?? Number.POSITIVE_INFINITY);
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;
  const competitionBand = getCityRevealCompetitionBand(phaseId);
  const leftCountryRank = Number(left?.countryTierRank || 0);
  const rightCountryRank = Number(right?.countryTierRank || 0);
  const leftTierWeight = Number(left?.cityTierWeight || 0);
  const rightTierWeight = Number(right?.cityTierWeight || 0);
  const leftPopulation = Math.max(0, Number(left?.population || 0));
  const rightPopulation = Math.max(0, Number(right?.population || 0));
  const leftCenterDistance = Number(left?.centerDistanceNorm ?? 1);
  const rightCenterDistance = Number(right?.centerDistanceNorm ?? 1);
  const leftCountryClassScore = getCityCountryClassScore(left);
  const rightCountryClassScore = getCityCountryClassScore(right);

  if (competitionBand === "low") {
    if (!!left?.isPriorityCountry !== !!right?.isPriorityCountry) return left?.isPriorityCountry ? -1 : 1;
    if (leftCountryRank !== rightCountryRank) return rightCountryRank - leftCountryRank;
    if (leftCountryClassScore !== rightCountryClassScore) return rightCountryClassScore - leftCountryClassScore;
  } else {
    if (!!left?.isCapital !== !!right?.isCapital) return left?.isCapital ? -1 : 1;
    if (leftTierWeight !== rightTierWeight) return rightTierWeight - leftTierWeight;
    if (leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;
    if (leftCenterDistance !== rightCenterDistance) return leftCenterDistance - rightCenterDistance;
    if (competitionBand === "mid") {
      if (leftCountryRank !== rightCountryRank) return rightCountryRank - leftCountryRank;
      if (leftCountryClassScore !== rightCountryClassScore) return rightCountryClassScore - leftCountryClassScore;
      if (!!left?.isPriorityCountry !== !!right?.isPriorityCountry) return left?.isPriorityCountry ? -1 : 1;
    } else {
      if (leftCountryClassScore !== rightCountryClassScore) return rightCountryClassScore - leftCountryClassScore;
      if (leftCountryRank !== rightCountryRank) return rightCountryRank - leftCountryRank;
      if (!!left?.isPriorityCountry !== !!right?.isPriorityCountry) return left?.isPriorityCountry ? -1 : 1;
    }
  }
  if (!!left?.isCapital !== !!right?.isCapital) return left?.isCapital ? -1 : 1;
  if (leftTierWeight !== rightTierWeight) return rightTierWeight - leftTierWeight;
  if (leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;
  if (leftCenterDistance !== rightCenterDistance) return leftCenterDistance - rightCenterDistance;
  return String(left?.cityId || "").localeCompare(String(right?.cityId || ""));
}

export function getCityLabelBudget(phase, config = {}) {
  const densityKey = String(config.labelDensity || "balanced").trim().toLowerCase();
  const budgetTable = CITY_LABEL_DENSITY_BUDGETS[densityKey] || CITY_LABEL_DENSITY_BUDGETS.balanced;
  const phaseId = String(phase?.id || "");
  if (Object.prototype.hasOwnProperty.call(budgetTable, phaseId)) {
    return Math.max(0, Number(budgetTable[phaseId] || 0));
  }
  return Math.max(0, Number(phase?.labelBudget || 0));
}

export function isCityLabelEligibleForPhase(entry, phaseId) {
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  if (String(phaseId || "P0") === "P3") {
    return !!entry?.isCapital;
  }
  if (String(phaseId || "P0") === "P4") {
    return !!entry?.isCapital || cityTier === "major";
  }
  if (String(phaseId || "P0") === "P5") {
    return true;
  }
  return false;
}

export function getCityLabelMinZoom(entry, config = {}) {
  const configuredMinZoom = Number(config?.labelMinZoom || 1.9);
  if (entry?.isCapital) {
    return configuredMinZoom;
  }
  return Math.max(configuredMinZoom, Number(entry?.minZoom || 0));
}

export function getCityMarkerSizePx(entry, config = {}) {
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  const markerScale = clamp(Number(config.markerScale) || 1, 0.75, 2.5);
  const baseSize = CITY_MARKER_BASE_SIZES_PX[cityTier] || CITY_MARKER_BASE_SIZES_PX.minor;
  const hardLimit = CITY_MARKER_SIZE_LIMITS_PX[cityTier] || CITY_MARKER_SIZE_LIMITS_PX.minor;
  const capitalLimit = entry?.isCapital ? CITY_MARKER_SIZE_LIMITS_PX.capital : hardLimit;
  const boostedSize = entry?.isCapital ? baseSize * 1.08 : baseSize;
  return Math.min(capitalLimit, boostedSize * markerScale);
}
