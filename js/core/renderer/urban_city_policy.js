/**
 * Owns urban/city policy decisions:
 * - scenario-aware city collection merge
 * - city reveal planning
 * - city-to-urban runtime matching
 *
 * map_renderer.js keeps the facade exports, render transaction orchestration,
 * projection/context helpers, and render-only shared helpers.
 */
import { isScenarioStrategicValuesUsable } from "../scenario/strategic_values.js";
import { getCityDetailProgress, getCitySettlementRank, getCitySettlementRankWeight } from "./city_reveal_policy.js";

// Yield after every merge write, including tail copies: a large sorted run
// must remain interruptible even when the comparator always prefers one side.
function* stableSortCityEntries(entries, compare) {
  let source = entries;
  let target = new Array(entries.length);
  for (let width = 1; width < entries.length; width *= 2) {
    for (let start = 0; start < entries.length; start += width * 2) {
      const middle = Math.min(start + width, entries.length);
      const end = Math.min(start + width * 2, entries.length);
      let left = start, right = middle;
      for (let index = start; index < end; index += 1) {
        // Native stable sort treats NaN comparisons as equality as well.
        const takeLeft = left < middle && (right >= end || !(compare(source[left], source[right]) > 0));
        target[index] = takeLeft ? source[left++] : source[right++];
        yield;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

async function yieldCityPlanningTask() {
  if (typeof globalThis.scheduler?.yield === "function") await globalThis.scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
}

export function getUrbanCityRenderPassSignatureParts(state, passName) {
  const cities = `cities:${Number(state?.cityLayerRevision || 0)}`;
  const strategic = `strategic:${Number(state?.scenarioStrategicValuesRevision || 0)}`;
  const sharedTail = [
    `sovereignty:${Number(state?.sovereigntyRevision || 0)}`,
    `colors:${Number(state?.colorRevision || 0)}`,
  ];
  if (passName === "contextMarkers") {
    return [cities, `${strategic}:${String(state?.strategicChoroplethMetric || "")}`, ...sharedTail];
  }
  if (passName === "labels") {
    return [state?.deferContextBasePass ? "labels:deferred" : "labels:ready", cities, strategic, ...sharedTail];
  }
  throw new RangeError(`Unsupported urban city render pass: ${String(passName || "")}`);
}

export function createUrbanCityPolicyOwner({
  state,
  caches = {},
  helpers = {},
} = {}) {
  const {
    cityLayerCache = null,
    urbanFeatureIndexCache = null,
  } = caches;

  const {
    compareCityRevealEntries,
    defaultCityCountryClassRank,
    defaultCityCountryTierRank,
    getCityAnchor,
    getCityCanonicalId,
    getCityCapitalScore,
    getCityCountryGroupKey,
    getCityCountryProfileIndex,
    getCityEffectiveMinZoom,
    getCityFeatureAliases,
    getCityFeatureKey,
    getCityInterpolatedMarkerBudget,
    getCityInterpolatedMarkerQuota,
    getCityInterpolatedRevealBucket,
    getCityLabelBudget,
    getCityLabelMinZoom,
    getCityMarkerDensityMultiplier,
    getCityMarkerSizePx,
    getCityPriorityCountryReserveBudget,
    getCityPriorityCountryReserveRank,
    getCityRevealPhase,
    getCityScreenPoint,
    getCitySortWeight,
    getCityTier,
    getCityTierWeight,
    getCityViewportCenterDistanceNorm,
    getDefaultCityMinZoomForTier,
    getUrbanFeatureStableId,
    isCityAnchorInViewport,
    getCityPaintOverscanPx = () => 48,
    isCityLabelEligibleForPhase,
    isCityScenarioTagExcludedFromReveal,
  } = helpers;

  function getUrbanFeatureIndex() {
    const urbanCollection = state?.urbanData;
    if (urbanFeatureIndexCache?.sourceRef === urbanCollection) {
      return urbanFeatureIndexCache.byId;
    }
    const byId = new Map();
    if (Array.isArray(urbanCollection?.features)) {
      urbanCollection.features.forEach((feature) => {
        const urbanId = getUrbanFeatureStableId(feature);
        if (urbanId) {
          byId.set(urbanId, feature);
        }
      });
    }
    if (urbanFeatureIndexCache && typeof urbanFeatureIndexCache === "object") {
      urbanFeatureIndexCache.sourceRef = urbanCollection;
      urbanFeatureIndexCache.byId = byId;
    }
    return byId;
  }

  function getCityUrbanRuntimeInfo(feature, urbanIndex = getUrbanFeatureIndex()) {
    const props = feature?.properties || {};
    const urbanMatchId = String(
      props.__city_urban_match_id
      || props.urban_match_id
      || props.urban_area_id
      || props.urbanMatchId
      || props.urbanAreaId
      || ""
    ).trim();
    const urbanMatchMethod = String(
      props.urban_match_method
      || props.urbanMatchMethod
      || ""
    ).trim().toLowerCase();
    const urbanFeature = urbanMatchId ? (urbanIndex.get(urbanMatchId) || null) : null;
    return {
      urbanMatchId,
      urbanFeature,
      hasUrbanMatch: !!urbanFeature,
      urbanMatchMethod,
    };
  }

  function cloneCityFeature(feature, propertyPatch = {}) {
    const props = feature?.properties || {};
    return {
      ...feature,
      properties: {
        ...props,
        ...propertyPatch,
      },
    };
  }

  function resolveCityFeatureKey(reference, featuresByKey, aliasToKey) {
    const value = String(reference || "").trim();
    if (!value) return "";
    if (featuresByKey.has(value)) return value;
    return String(aliasToKey.get(value) || "").trim();
  }

  function getScenarioCountryCodesForTag(tag, countries = state?.scenarioCountriesByTag) {
    const record = countries?.[tag];
    if (!record || typeof record !== "object") return new Set();
    return new Set(
      [record.lookup_iso2, record.base_iso2]
        .map((value) => String(value || "").trim().toUpperCase())
        .filter((value) => /^[A-Z]{2}$/.test(value))
    );
  }

  function getCityScenarioTag(feature, sovereignty = state?.sovereigntyByFeatureId) {
    const props = feature?.properties || {};
    const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
    if (!hostFeatureId) return "";
    return String(
      sovereignty?.[hostFeatureId]
      || ""
    ).trim().toUpperCase();
  }

  function doesScenarioCountryHideCityPoints(tag) {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    if (!normalizedTag) return false;
    return !!state?.scenarioCountriesByTag?.[normalizedTag]?.hide_city_points;
  }

  function getCapitalCandidateSortTuple(feature, preferredCountryCodes = new Set()) {
    const props = feature?.properties || {};
    const countryCode = String(props.__city_country_code || props.country_code || "").trim().toUpperCase();
    const countryPenalty = preferredCountryCodes.size > 0 && !preferredCountryCodes.has(countryCode) ? 1 : 0;
    return [
      countryPenalty,
      -getCityCapitalScore(feature),
      -getCityTierWeight(feature),
      -Math.max(0, Number(props.__city_population || 0)),
      getCityFeatureKey(feature),
    ];
  }

  function compareCapitalCandidateEntries(left, right, preferredCountryCodes = new Set()) {
    const leftTuple = getCapitalCandidateSortTuple(left?.feature, preferredCountryCodes);
    const rightTuple = getCapitalCandidateSortTuple(right?.feature, preferredCountryCodes);
    for (let index = 0; index < leftTuple.length; index += 1) {
      if (leftTuple[index] < rightTuple[index]) return -1;
      if (leftTuple[index] > rightTuple[index]) return 1;
    }
    return 0;
  }

  function applyScenarioCityOverride(feature, overrideEntry) {
    if (!feature || !overrideEntry || typeof overrideEntry !== "object") {
      return feature;
    }
    const props = feature.properties || {};
    const overrideTier = String(overrideEntry.tier || "").trim().toLowerCase();
    const overrideRank = String(overrideEntry.settlement_rank || overrideEntry.settlementRank || "").trim().toLowerCase();
    const nextTier = ["major", "regional", "minor"].includes(overrideTier)
      ? overrideTier
      : getCityTier(feature);
    const displayName = overrideEntry.display_name && typeof overrideEntry.display_name === "object"
      ? overrideEntry.display_name
      : {};
    const hasDisplayNameOverride = Object.keys(displayName).length > 0;
    const nextAliases = Array.from(new Set([
      ...(Array.isArray(props.__city_aliases) ? props.__city_aliases : []),
      ...(Array.isArray(overrideEntry.aliases) ? overrideEntry.aliases : []),
      displayName.en,
      displayName.zh,
      overrideEntry.city_id,
      overrideEntry.stable_key,
    ].filter(Boolean).map((value) => String(value).trim())));
    const overrideMinZoom = Number(overrideEntry.min_zoom ?? overrideEntry.minZoom);
    const nextFeature = cloneCityFeature(feature, {
      __city_aliases: nextAliases,
      ...(overrideEntry.host_feature_id ? {
        host_feature_id: String(overrideEntry.host_feature_id),
        __city_host_feature_id: String(overrideEntry.host_feature_id),
        __city_has_host_override: true,
      } : {}),
      __city_has_display_name_override: hasDisplayNameOverride,
      __city_display_name_override: hasDisplayNameOverride ? { ...displayName } : null,
      __city_hidden: overrideEntry.hidden === undefined ? !!props.__city_hidden : !!overrideEntry.hidden,
      __city_base_tier: nextTier,
      ...(getCitySettlementRankWeight(overrideRank) >= 0 ? { __city_settlement_rank: overrideRank } : {}),
      __city_min_zoom: Number.isFinite(overrideMinZoom) ? overrideMinZoom : (
        getCitySettlementRankWeight(overrideRank) >= getCitySettlementRankWeight("large")
          ? Math.min(getDefaultCityMinZoomForTier(nextTier), 2.45)
          : getDefaultCityMinZoomForTier(nextTier)
      ),
      name_en: String(displayName.en || overrideEntry.name_en || props.name_en || props.name || "").trim(),
      label_en: String(displayName.en || overrideEntry.name_en || props.label_en || props.name_en || props.name || "").trim(),
      name_zh: String(displayName.zh || overrideEntry.name_zh || props.name_zh || "").trim(),
      label_zh: String(displayName.zh || overrideEntry.name_zh || props.label_zh || props.name_zh || "").trim(),
    });
    if (Number.isFinite(overrideEntry.lon) && Number.isFinite(overrideEntry.lat)
      && Math.abs(overrideEntry.lon) <= 180 && Math.abs(overrideEntry.lat) <= 90) {
      nextFeature.geometry = { type: "Point", coordinates: [overrideEntry.lon, overrideEntry.lat] };
      nextFeature.properties.lon = overrideEntry.lon;
      nextFeature.properties.lat = overrideEntry.lat;
    }
    return nextFeature;
  }

  function normalizeStrategicCityReference(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getStrategicVictoryPointForCity(feature, source = state?.scenarioStrategicValuesData) {
    const strategicValues = isScenarioStrategicValuesUsable(source)
      ? source
      : null;
    const byFeature = strategicValues?.victoryPointsByFeature
      && typeof strategicValues.victoryPointsByFeature === "object"
      ? strategicValues.victoryPointsByFeature
      : {};
    const props = feature?.properties || {};
    const hostFeatureIds = Array.from(new Set([
      props.__city_host_feature_id,
      props.host_feature_id,
      props.hostFeatureId,
    ].map((value) => String(value || "").trim()).filter(Boolean)));
    const candidates = hostFeatureIds.flatMap((featureId) => (
      Array.isArray(byFeature[featureId]) ? byFeature[featureId] : []
    ));
    if (!candidates.length) {
      return null;
    }
    const cityRefs = new Set([
      getCityCanonicalId(feature),
      getCityFeatureKey(feature),
      props.city_id,
      props.cityId,
      props.stable_key,
      props.stableKey,
      props.__city_stable_key,
    ].map(normalizeStrategicCityReference).filter(Boolean));
    const exactMatch = candidates.find((entry) => (
      cityRefs.has(normalizeStrategicCityReference(entry.city_id || entry.cityId))
      || cityRefs.has(normalizeStrategicCityReference(entry.stable_key || entry.stableKey))
    ));
    // A host polygon can contain several cities. Never borrow another city's VP.
    return exactMatch || null;
  }

  function applyStrategicVictoryPointRank(feature, source = state?.scenarioStrategicValuesData) {
    const entry = getStrategicVictoryPointForCity(feature, source);
    const value = Math.max(0, Number(entry?.value || 0));
    if (!entry || value <= 0) {
      return feature;
    }
    return cloneCityFeature(feature, {
      __city_scenario_victory_points: value,
      __city_scenario_vp_name: String(entry.name || "").trim(),
      __city_scenario_vp_province_id: entry.province_id ?? entry.provinceId ?? "",
      __city_scenario_vp_match_method: String(entry.match_method || entry.matchMethod || "").trim(),
    });
  }

  function* iterateCityRevealPlan(cityCollection, scale, transform, config, includeDeferredLabels = false) {
    const phase = getCityRevealPhase(scale);
    const countryProfiles = getCityCountryProfileIndex(cityCollection);
    const urbanIndex = getUrbanFeatureIndex();
    const markerEntries = [];
    const countsByCountry = new Map();
    const markerDensity = getCityMarkerDensityMultiplier(config);
    const densityPreset = ["compact", "balanced", "detailed"].includes(config.densityPreset)
      ? config.densityPreset : "balanced";
    const localSeparationPx = { compact: 64, balanced: 48, detailed: 36 }[densityPreset];
    const viewportWidth = Number(config.viewportWidth || state?.width || 0);
    const viewportHeight = Number(config.viewportHeight || state?.height || 0);
    const viewportBudget = viewportWidth > 0 && viewportHeight > 0
      ? Math.max(1, Math.ceil((viewportWidth * viewportHeight) / (localSeparationPx ** 2) * 1.5))
      : Infinity;
    const markerBudget = Math.min(getCityInterpolatedMarkerBudget(scale, markerDensity),
      getCityDetailProgress(scale) > 0 ? viewportBudget : Infinity);
    const priorityReserveBudget = getCityPriorityCountryReserveBudget(scale, markerBudget);
    const labelBudget = getCityLabelBudget(phase, config, scale);
    const labelEntries = [];
    const minimumRankWeight = Math.max(0, getCitySettlementRankWeight(config.minSettlementRank || "town"));

    const paintOverscanPx = getCityPaintOverscanPx();
    const createCandidateEntry = (feature) => {
        const anchor = getCityAnchor(feature);
        if (!anchor || !isCityAnchorInViewport(anchor, { padding: paintOverscanPx, transform })) {
          return null;
        }
        const profile = countryProfiles.get(getCityCountryGroupKey(feature)) || {
          scenarioTag: getCityScenarioTag(feature),
          countryTier: "D",
          countryTierRank: defaultCityCountryTierRank,
          featureCount: 0,
          maxPopulation: 0,
          controllerFeatureCount: 0,
          countryClass: "micro",
          countryClassRank: defaultCityCountryClassRank,
          classWeightBias: 0,
          minQuotaFloorBoost: 0,
          isDefaultCountry: false,
          isFeaturedCountry: false,
          isPrimaryPower: false,
          isSecondaryPower: false,
          isPriorityCountry: false,
        };
        const scenarioTag = String(profile.scenarioTag || getCityScenarioTag(feature) || "").trim().toUpperCase();
        if (isCityScenarioTagExcludedFromReveal(scenarioTag)) {
          return null;
        }
        const isCapital = !!feature?.properties?.__city_is_capital;
        const settlementRank = getCitySettlementRank(feature, state?.activeScenarioId);
        if (!isCapital && getCitySettlementRankWeight(settlementRank) < minimumRankWeight) return null;
        const minZoom = getCityEffectiveMinZoom(feature);
        if (!isCapital && scale < minZoom) {
          return null;
        }
        const cityTier = getCityTier(feature);
        const urbanInfo = getCityUrbanRuntimeInfo(feature, urbanIndex);
        const entry = {
          feature,
          anchor,
          screenPoint: getCityScreenPoint(anchor, transform),
          cityId: getCityCanonicalId(feature) || getCityFeatureKey(feature),
          isCapital,
          minZoom,
          cityTier,
          settlementRank,
          cityTierWeight: getCityTierWeight(feature),
          countryKey: profile.groupKey || getCityCountryGroupKey(feature),
          scenarioTag,
          countryTier: profile.countryTier || "D",
          countryTierRank: profile.countryTierRank || defaultCityCountryTierRank,
          countryFeatureCount: Math.max(0, Number(profile.featureCount || 0)),
          countryControllerFeatureCount: Math.max(0, Number(profile.controllerFeatureCount || profile.featureCount || 0)),
          countryMaxPopulation: Math.max(0, Number(profile.maxPopulation || 0)),
          countryClass: String(profile.countryClass || "micro").trim().toLowerCase(),
          countryClassRank: Number(profile.countryClassRank || defaultCityCountryClassRank),
          countryClassWeightBias: Number(profile.classWeightBias || 0),
          countryMinQuotaFloorBoost: Number(profile.minQuotaFloorBoost || 0),
          isDefaultCountry: !!profile.isDefaultCountry,
          isFeaturedCountry: !!profile.isFeaturedCountry,
          isPrimaryPower: !!profile.isPrimaryPower,
          isSecondaryPower: !!profile.isSecondaryPower,
          isPriorityCountry: !!profile.isPriorityCountry,
          population: Math.max(0, Number(feature?.properties?.__city_population || 0)),
          sortWeight: getCitySortWeight(feature),
          urbanMatchId: urbanInfo.urbanMatchId,
          urbanFeature: urbanInfo.urbanFeature,
          hasUrbanMatch: urbanInfo.hasUrbanMatch,
          urbanMatchMethod: urbanInfo.urbanMatchMethod,
          centerDistanceNorm: 1,
          acceptedLabelPlacement: "",
        };
        entry.centerDistanceNorm = getCityViewportCenterDistanceNorm(entry);
        entry.revealBucket = getCityInterpolatedRevealBucket(entry, scale);
        if (!Number.isFinite(entry.revealBucket)) {
          return null;
        }
        return entry;
      };
    const unsortedCandidates = [];
    const features = cityCollection.features;
    for (let index = 0, length = features.length; index < length; index += 1) {
      if (index in features) {
        const entry = createCandidateEntry(features[index]);
        if (entry) unsortedCandidates.push(entry);
      }
      yield;
    }
    const candidateEntries = yield* stableSortCityEntries(unsortedCandidates,
      (left, right) => compareCityRevealEntries(left, right, phase.id));

    const priorityCapitalEntriesByCountry = new Map();
    for (const entry of candidateEntries) {
      yield;
      if (!entry.isCapital || !entry.isPriorityCountry) {
        continue;
      }
      const existing = priorityCapitalEntriesByCountry.get(entry.countryKey);
      if (!existing || compareCityRevealEntries(entry, existing, phase.id) < 0) {
        priorityCapitalEntriesByCountry.set(entry.countryKey, entry);
      }
    }
    const acceptedCityIds = new Set();
    const detailProgress = getCityDetailProgress(scale);
    const markerGrid = new Map();
    const gridKey = (x, y) => `${x}:${y}`;
    const acceptMarker = (entry) => {
      entry.markerSizePx = getCityMarkerSizePx(entry, config);
      const screenX = Number(entry.screenPoint?.[0]);
      const screenY = Number(entry.screenPoint?.[1]);
      if (detailProgress > 0 && Number.isFinite(screenX) && Number.isFinite(screenY)) {
        const cellX = Math.floor(screenX / localSeparationPx);
        const cellY = Math.floor(screenY / localSeparationPx);
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (const other of markerGrid.get(gridKey(cellX + dx, cellY + dy)) || []) {
              const boundsDistance = (entry.markerSizePx + other.markerSizePx) / 2 + 8;
              const minimumDistance = boundsDistance
                + (Math.max(localSeparationPx, boundsDistance) - boundsDistance) * detailProgress;
              if (Math.hypot(screenX - other.screenPoint[0], screenY - other.screenPoint[1]) < minimumDistance) return false;
            }
          }
        }
        const key = gridKey(cellX, cellY);
        if (!markerGrid.has(key)) markerGrid.set(key, []);
        markerGrid.get(key).push(entry);
      }
      markerEntries.push(entry);
      countsByCountry.set(entry.countryKey, (countsByCountry.get(entry.countryKey) || 0) + 1);
      acceptedCityIds.add(entry.cityId);
      return true;
    };
    const priorityCapitalEntries = yield* stableSortCityEntries(Array.from(priorityCapitalEntriesByCountry.values()),
      (left, right) => {
        const leftRank = getCityPriorityCountryReserveRank(left);
        const rightRank = getCityPriorityCountryReserveRank(right);
        if (leftRank !== rightRank) return rightRank - leftRank;
        if (left.population !== right.population) return right.population - left.population;
        return String(left.cityId || "").localeCompare(String(right.cityId || ""));
      });
    for (const entry of priorityCapitalEntries) {
      yield;
      if (markerEntries.length >= markerBudget || markerEntries.length >= priorityReserveBudget) {
        break;
      }
      const currentCount = countsByCountry.get(entry.countryKey) || 0;
      if (currentCount >= 1) continue;
      acceptMarker(entry);
    }

    for (const entry of candidateEntries) {
      yield;
      if (markerEntries.length >= markerBudget) break;
      if (acceptedCityIds.has(entry.cityId)) continue;
      const currentCount = countsByCountry.get(entry.countryKey) || 0;
      const quota = getCityInterpolatedMarkerQuota(entry, scale, markerDensity);
      if (currentCount >= quota) continue;
      acceptMarker(entry);
    }

    if (config.showLabels && (includeDeferredLabels || !state?.deferExactAfterSettle) && labelBudget > 0 && scale >= Number(config.labelMinZoom || 0)) {
      const eligibleLabels = [];
      for (const entry of markerEntries) {
        if (isCityLabelEligibleForPhase(entry, phase.id)) eligibleLabels.push(entry);
        yield;
      }
      const sortedLabels = yield* stableSortCityEntries(eligibleLabels,
        (left, right) => compareCityRevealEntries(left, right, phase.id));
      for (const entry of sortedLabels) {
        yield;
        if (scale < getCityLabelMinZoom(entry, config)) {
          continue;
        }
        labelEntries.push(entry);
      }
    }

    return {
      phase,
      markerBudget,
      priorityReserveBudget,
      labelBudget,
      markerEntries,
      labelEntries,
      candidateEntries,
    };
  }

  function buildCityRevealPlan(cityCollection, scale, transform, config = {}) {
    const iterator = iterateCityRevealPlan(cityCollection, scale, transform, config);
    let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }

  async function prepareCityRevealPlan(cityCollection, scale, transform, config = {}, {
    signal, isCurrent = () => true, yieldControl = yieldCityPlanningTask,
    nowMs = () => globalThis.performance?.now?.() ?? Date.now(), sliceBudgetMs = 4, workBatch = 512,
  } = {}) {
    const current = () => !signal?.aborted && isCurrent();
    if (!current()) return null;
    // Do not start a cold collection scan in the caller's render task.
    await yieldControl();
    if (!current()) return null;
    const iterator = iterateCityRevealPlan(cityCollection, scale, transform, config, true);
    const batchLimit = Math.max(1, Number(workBatch) || 512);
    const timeLimit = Math.max(0.1, Number(sliceBudgetMs) || 4);
    let started = nowMs(), work = 0;
    while (true) {
      const step = iterator.next();
      if (step.done) return current() ? step.value : null;
      work += 1;
      if (work >= batchLimit || (work % 32 === 0 && nowMs() - started >= timeLimit)) {
        await yieldControl();
        if (!current()) return null;
        work = 0;
        started = nowMs();
      }
    }
  }

  function getEffectiveCityCollectionSource() {
    return {
      baseRef: state?.worldCitiesData || null,
      scenarioRef: state?.scenarioCityOverridesData || null,
      strategicValuesRef: state?.scenarioStrategicValuesData || null,
      scenarioCountriesRef: state?.scenarioCountriesByTag || null,
      sovereigntyRef: state?.sovereigntyByFeatureId || null,
      scenarioId: String(state?.activeScenarioId || ""),
      cityLayerRevision: Number(state?.cityLayerRevision || 0),
      strategicValuesRevision: Number(state?.scenarioStrategicValuesRevision || 0),
      sovereigntyRevision: Number(state?.sovereigntyRevision || 0),
    };
  }

  function sameEffectiveCitySource(left, right) {
    return !!left && !!right && Object.keys(right).every((key) => Object.is(left[key], right[key]));
  }

  function isEffectiveCityCollectionSourceCurrent(source) {
    return sameEffectiveCitySource(source, getEffectiveCityCollectionSource());
  }

  function getCachedEffectiveCityCollection() {
    return cityLayerCache?.merged || null;
  }

  function installEffectiveCityCollection(prepared) {
    if (!prepared || !isEffectiveCityCollectionSourceCurrent(prepared.source)) return false;
    if (cityLayerCache && typeof cityLayerCache === "object") {
      Object.assign(cityLayerCache, prepared.source, { merged: prepared.collection });
    }
    return true;
  }

  function* iterateEffectiveCityCollection(source) {
    const { baseRef, scenarioRef, strategicValuesRef, scenarioCountriesRef, sovereigntyRef, scenarioId } = source;
    const featuresByKey = new Map();
    const aliasToKey = new Map();
    const rememberFeatureAliases = function* (feature, key) {
      for (const alias of getCityFeatureAliases(feature, key)) {
        aliasToKey.set(alias, key);
        yield;
      }
    };
    const setFeature = function* (feature, key) {
      featuresByKey.set(key, feature);
      yield* rememberFeatureAliases(feature, key);
    };
    const deleteByAlias = (rawAlias) => {
      const alias = String(rawAlias || "").trim();
      if (!alias) return;
      const resolvedKey = aliasToKey.get(alias) || alias;
      featuresByKey.delete(resolvedKey);
    };

    let index = 0;
    for (const feature of (Array.isArray(baseRef?.features) ? baseRef.features : [])) {
      yield;
      index += 1;
      const key = getCityFeatureKey(feature, `world_city_${index}`);
      if (!key || feature?.properties?.__city_hidden) continue;
      yield* setFeature(feature, key);
    }

    const legacyScenarioCollection = scenarioRef?.featureCollection || (
      Array.isArray(scenarioRef?.features) ? scenarioRef : null
    );
    index = 0;
    for (const feature of (Array.isArray(legacyScenarioCollection?.features) ? legacyScenarioCollection.features : [])) {
      yield;
      index += 1;
      const props = feature?.properties || {};
      const key = getCityFeatureKey(feature, `scenario_city_${index}`);
      const replaceIds = Array.isArray(props.__city_replace_ids) ? props.__city_replace_ids : [];
      for (const value of replaceIds) { deleteByAlias(value); yield; }
      if (!key) continue;
      deleteByAlias(key);
      if (props.__city_hidden) continue;
      yield* setFeature(feature, key);
    }

    for (const entryKey in (scenarioRef?.cities || {})) {
      if (!Object.hasOwn(scenarioRef.cities, entryKey)) continue;
      yield;
      const overrideEntry = scenarioRef.cities[entryKey];
      const replaceIds = Array.isArray(overrideEntry?.replace_ids) ? overrideEntry.replace_ids : [];
      for (const value of replaceIds) { deleteByAlias(value); yield; }
      const key = resolveCityFeatureKey(
        overrideEntry?.city_id || overrideEntry?.stable_key || "",
        featuresByKey,
        aliasToKey
      );
      if (!key || !featuresByKey.has(key)) continue;
      const nextFeature = applyScenarioCityOverride(featuresByKey.get(key), overrideEntry);
      if (nextFeature?.properties?.__city_hidden) {
        featuresByKey.delete(key);
        continue;
      }
      yield* setFeature(nextFeature, key);
    }

    const activeCapitalCityIds = new Set();
    if (scenarioId && scenarioCountriesRef && typeof scenarioCountriesRef === "object") {
      const candidatesByTag = new Map();
      for (const [key, feature] of featuresByKey) {
        yield;
        const tag = getCityScenarioTag(feature, sovereigntyRef);
        if (!tag) continue;
        const current = candidatesByTag.get(tag) || [];
        current.push({ key, feature });
        candidatesByTag.set(tag, current);
      }

      for (const rawTag in scenarioCountriesRef) {
        if (!Object.hasOwn(scenarioCountriesRef, rawTag)) continue;
        yield;
        const tag = String(rawTag || "").trim().toUpperCase();
        if (!tag) continue;
        const country = scenarioCountriesRef[rawTag];
        const capitalHint = scenarioRef?.capital_city_hints?.[tag];
        if ((scenarioId !== "blank_base" && country?.feature_count === 0)
          || capitalHint?.resolution_method === "no_capital") continue;
        const explicitKey = resolveCityFeatureKey(scenarioRef?.capitals_by_tag?.[tag], featuresByKey, aliasToKey);
        const hintedKey = explicitKey
          ? ""
          : resolveCityFeatureKey(scenarioRef?.capital_city_hints?.[tag]?.city_id, featuresByKey, aliasToKey);
        let resolvedKey = explicitKey || hintedKey;
        if (!resolvedKey) {
          const candidateEntries = candidatesByTag.get(tag) || [];
          if (candidateEntries.length) {
            const preferredCountryCodes = getScenarioCountryCodesForTag(tag, scenarioCountriesRef);
            const sortedCandidates = yield* stableSortCityEntries(candidateEntries,
              (left, right) => compareCapitalCandidateEntries(left, right, preferredCountryCodes));
            resolvedKey = sortedCandidates[0]?.key || "";
          }
        }
        if (!resolvedKey || !featuresByKey.has(resolvedKey)) continue;
        const resolvedCityId = getCityCanonicalId(featuresByKey.get(resolvedKey)) || resolvedKey;
        if (resolvedCityId) {
          activeCapitalCityIds.add(resolvedCityId);
        }
      }
    }

    const finalFeatures = [];
    for (const [key, feature] of featuresByKey) {
      yield;
      const cityId = getCityCanonicalId(feature) || key;
      const nextIsCapital = scenarioId ? activeCapitalCityIds.has(cityId) : !!feature?.properties?.__city_is_capital;
      // Country-capital priority must follow the scenario, including newly
      // promoted regional cities and former modern capitals being demoted.
      const nextIsCountryCapital = scenarioId ? nextIsCapital : !!feature?.properties?.__city_is_country_capital;
      const nextFeature = feature?.properties?.__city_is_capital === nextIsCapital
          && feature?.properties?.__city_is_country_capital === nextIsCountryCapital
        ? feature
        : cloneCityFeature(feature, {
          __city_is_capital: nextIsCapital,
          __city_is_country_capital: nextIsCountryCapital,
        });
      const strategicFeature = applyStrategicVictoryPointRank(nextFeature, strategicValuesRef);
      if (!strategicFeature?.properties?.__city_hidden && !scenarioCountriesRef?.[getCityScenarioTag(strategicFeature, sovereigntyRef)]?.hide_city_points) {
        finalFeatures.push(strategicFeature);
      }
    }

    const merged = finalFeatures.length
      ? {
        type: "FeatureCollection",
        features: finalFeatures,
      }
      : null;

    return merged;
  }

  function getEffectiveCityCollection() {
    const source = getEffectiveCityCollectionSource();
    if (sameEffectiveCitySource(cityLayerCache, source)) return cityLayerCache.merged;
    const iterator = iterateEffectiveCityCollection(source);
    let step;
    do { step = iterator.next(); } while (!step.done);
    installEffectiveCityCollection({ source, collection: step.value });
    return step.value;
  }

  async function prepareEffectiveCityCollection(source = getEffectiveCityCollectionSource(), {
    signal, isCurrent = () => true, yieldControl = yieldCityPlanningTask,
    nowMs = () => globalThis.performance?.now?.() ?? Date.now(), sliceBudgetMs = 4, workBatch = 512,
  } = {}) {
    const current = () => !signal?.aborted && isCurrent() && isEffectiveCityCollectionSourceCurrent(source);
    if (!current()) return null;
    if (sameEffectiveCitySource(cityLayerCache, source)) return { source, collection: cityLayerCache.merged };
    // Even the first merge scan starts in a subsequent host task.
    await yieldControl();
    if (!current()) return null;
    const iterator = iterateEffectiveCityCollection(source);
    const batchLimit = Math.max(1, Number(workBatch) || 512);
    const timeLimit = Math.max(0.1, Number(sliceBudgetMs) || 4);
    let started = nowMs(), work = 0;
    while (true) {
      const step = iterator.next();
      if (step.done) return current() ? { source, collection: step.value } : null;
      work += 1;
      if (work >= batchLimit || (work % 32 === 0 && nowMs() - started >= timeLimit)) {
        await yieldControl();
        if (!current()) return null;
        work = 0;
        started = nowMs();
      }
    }
  }

  return {
    buildCityRevealPlan,
    prepareCityRevealPlan,
    doesScenarioCountryHideCityPoints,
    getCityScenarioTag,
    getCityUrbanRuntimeInfo,
    getEffectiveCityCollection,
    getEffectiveCityCollectionSource,
    isEffectiveCityCollectionSourceCurrent,
    getCachedEffectiveCityCollection,
    prepareEffectiveCityCollection,
    installEffectiveCityCollection,
    getUrbanFeatureIndex,
  };
}
