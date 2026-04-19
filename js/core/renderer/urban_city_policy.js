/**
 * Owns urban/city policy decisions:
 * - scenario-aware city collection merge
 * - city reveal planning
 * - city-to-urban runtime matching
 *
 * map_renderer.js keeps the facade exports, render transaction orchestration,
 * projection/context helpers, and render-only shared helpers.
 */
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

  function getScenarioCountryCodesForTag(tag) {
    const record = state?.scenarioCountriesByTag?.[tag];
    if (!record || typeof record !== "object") return new Set();
    return new Set(
      [record.lookup_iso2, record.base_iso2]
        .map((value) => String(value || "").trim().toUpperCase())
        .filter((value) => /^[A-Z]{2}$/.test(value))
    );
  }

  function getCityScenarioTag(feature) {
    const props = feature?.properties || {};
    const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
    if (!hostFeatureId) return "";
    return String(
      state?.scenarioControllersByFeatureId?.[hostFeatureId]
      || state?.sovereigntyByFeatureId?.[hostFeatureId]
      || ""
    ).trim().toUpperCase();
  }

  function doesScenarioCountryHideCityPoints(tag) {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    if (!normalizedTag) return false;
    return !!state?.scenarioCountriesByTag?.[normalizedTag]?.hide_city_points;
  }

  function shouldHideCityPointForScenarioCountry(feature) {
    return doesScenarioCountryHideCityPoints(getCityScenarioTag(feature));
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
    return cloneCityFeature(feature, {
      __city_aliases: nextAliases,
      __city_has_display_name_override: hasDisplayNameOverride,
      __city_display_name_override: hasDisplayNameOverride ? { ...displayName } : null,
      __city_hidden: overrideEntry.hidden === undefined ? !!props.__city_hidden : !!overrideEntry.hidden,
      __city_base_tier: nextTier,
      __city_min_zoom: Number.isFinite(overrideMinZoom) ? overrideMinZoom : getDefaultCityMinZoomForTier(nextTier),
      name_en: String(displayName.en || overrideEntry.name_en || props.name_en || props.name || "").trim(),
      label_en: String(displayName.en || overrideEntry.name_en || props.label_en || props.name_en || props.name || "").trim(),
      name_zh: String(displayName.zh || overrideEntry.name_zh || props.name_zh || "").trim(),
      label_zh: String(displayName.zh || overrideEntry.name_zh || props.label_zh || props.name_zh || "").trim(),
    });
  }

  function buildCityRevealPlan(cityCollection, scale, transform, config = {}) {
    const phase = getCityRevealPhase(scale);
    const countryProfiles = getCityCountryProfileIndex(cityCollection);
    const urbanIndex = getUrbanFeatureIndex();
    const markerEntries = [];
    const countsByCountry = new Map();
    const markerDensity = getCityMarkerDensityMultiplier(config);
    const markerBudget = getCityInterpolatedMarkerBudget(scale, markerDensity);
    const priorityReserveBudget = getCityPriorityCountryReserveBudget(scale, markerBudget);
    const labelBudget = getCityLabelBudget(phase, config);
    const labelEntries = [];

    const candidateEntries = cityCollection.features
      .map((feature) => {
        const anchor = getCityAnchor(feature);
        if (!anchor || !isCityAnchorInViewport(anchor, { padding: 48, transform })) {
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
      })
      .filter(Boolean)
      .sort((left, right) => compareCityRevealEntries(left, right, phase.id));

    const priorityCapitalEntriesByCountry = new Map();
    candidateEntries.forEach((entry) => {
      if (!entry.isCapital || !entry.isPriorityCountry) {
        return;
      }
      const existing = priorityCapitalEntriesByCountry.get(entry.countryKey);
      if (!existing || compareCityRevealEntries(entry, existing, phase.id) < 0) {
        priorityCapitalEntriesByCountry.set(entry.countryKey, entry);
      }
    });
    const acceptedCityIds = new Set();
    Array.from(priorityCapitalEntriesByCountry.values())
      .sort((left, right) => {
        const leftRank = getCityPriorityCountryReserveRank(left);
        const rightRank = getCityPriorityCountryReserveRank(right);
        if (leftRank !== rightRank) return rightRank - leftRank;
        if (left.population !== right.population) return right.population - left.population;
        return String(left.cityId || "").localeCompare(String(right.cityId || ""));
      })
      .some((entry) => {
        if (markerEntries.length >= markerBudget || markerEntries.length >= priorityReserveBudget) {
          return true;
        }
        const currentCount = countsByCountry.get(entry.countryKey) || 0;
        if (currentCount >= 1) return false;
        entry.markerSizePx = getCityMarkerSizePx(entry, config);
        markerEntries.push(entry);
        countsByCountry.set(entry.countryKey, currentCount + 1);
        acceptedCityIds.add(entry.cityId);
        return false;
      });

    for (const entry of candidateEntries) {
      if (markerEntries.length >= markerBudget) break;
      if (acceptedCityIds.has(entry.cityId)) continue;
      const currentCount = countsByCountry.get(entry.countryKey) || 0;
      const quota = getCityInterpolatedMarkerQuota(entry, scale, markerDensity);
      if (currentCount >= quota) continue;
      entry.markerSizePx = getCityMarkerSizePx(entry, config);
      markerEntries.push(entry);
      countsByCountry.set(entry.countryKey, currentCount + 1);
      acceptedCityIds.add(entry.cityId);
    }

    if (config.showLabels && !state?.deferExactAfterSettle && labelBudget > 0 && scale >= Number(config.labelMinZoom || 0)) {
      markerEntries
        .filter((entry) => isCityLabelEligibleForPhase(entry, phase.id))
        .sort((left, right) => compareCityRevealEntries(left, right, phase.id))
        .some((entry) => {
          if (scale < getCityLabelMinZoom(entry, config)) {
            return false;
          }
          labelEntries.push(entry);
          return labelEntries.length >= labelBudget;
        });
    }

    return {
      phase,
      markerBudget,
      priorityReserveBudget,
      markerEntries,
      labelEntries,
      candidateEntries,
    };
  }

  function getEffectiveCityCollection() {
    const baseRef = state?.worldCitiesData || null;
    const scenarioRef = state?.scenarioCityOverridesData || null;
    const scenarioCountriesRef = state?.scenarioCountriesByTag || null;
    const scenarioId = String(state?.activeScenarioId || "");
    const cityLayerRevision = Number(state?.cityLayerRevision || 0);
    const scenarioControllerRevision = Number(state?.scenarioControllerRevision || 0);
    const sovereigntyRevision = Number(state?.sovereigntyRevision || 0);
    if (
      cityLayerCache?.baseRef === baseRef
      && cityLayerCache?.scenarioRef === scenarioRef
      && cityLayerCache?.scenarioCountriesRef === scenarioCountriesRef
      && cityLayerCache?.scenarioId === scenarioId
      && cityLayerCache?.cityLayerRevision === cityLayerRevision
      && cityLayerCache?.scenarioControllerRevision === scenarioControllerRevision
      && cityLayerCache?.sovereigntyRevision === sovereigntyRevision
    ) {
      return cityLayerCache.merged;
    }

    const featuresByKey = new Map();
    const aliasToKey = new Map();
    const rememberFeatureAliases = (feature, key) => {
      getCityFeatureAliases(feature, key).forEach((alias) => {
        aliasToKey.set(alias, key);
      });
    };
    const setFeature = (feature, key) => {
      featuresByKey.set(key, feature);
      rememberFeatureAliases(feature, key);
    };
    const deleteByAlias = (rawAlias) => {
      const alias = String(rawAlias || "").trim();
      if (!alias) return;
      const resolvedKey = aliasToKey.get(alias) || alias;
      featuresByKey.delete(resolvedKey);
    };

    (Array.isArray(baseRef?.features) ? baseRef.features : []).forEach((feature, index) => {
      const key = getCityFeatureKey(feature, `world_city_${index + 1}`);
      if (!key || feature?.properties?.__city_hidden) return;
      setFeature(feature, key);
    });

    const legacyScenarioCollection = scenarioRef?.featureCollection || (
      Array.isArray(scenarioRef?.features) ? scenarioRef : null
    );
    (Array.isArray(legacyScenarioCollection?.features) ? legacyScenarioCollection.features : []).forEach((feature, index) => {
      const props = feature?.properties || {};
      const key = getCityFeatureKey(feature, `scenario_city_${index + 1}`);
      const replaceIds = Array.isArray(props.__city_replace_ids) ? props.__city_replace_ids : [];
      replaceIds.forEach((value) => deleteByAlias(value));
      if (!key) return;
      deleteByAlias(key);
      if (props.__city_hidden) return;
      setFeature(feature, key);
    });

    Object.values(scenarioRef?.cities || {}).forEach((overrideEntry) => {
      const replaceIds = Array.isArray(overrideEntry?.replace_ids) ? overrideEntry.replace_ids : [];
      replaceIds.forEach((value) => deleteByAlias(value));
      const key = resolveCityFeatureKey(
        overrideEntry?.city_id || overrideEntry?.stable_key || "",
        featuresByKey,
        aliasToKey
      );
      if (!key || !featuresByKey.has(key)) return;
      const nextFeature = applyScenarioCityOverride(featuresByKey.get(key), overrideEntry);
      if (nextFeature?.properties?.__city_hidden) {
        featuresByKey.delete(key);
        return;
      }
      setFeature(nextFeature, key);
    });

    const activeCapitalCityIds = new Set();
    if (scenarioId && state?.scenarioCountriesByTag && typeof state.scenarioCountriesByTag === "object") {
      const candidatesByTag = new Map();
      Array.from(featuresByKey.entries()).forEach(([key, feature]) => {
        const tag = getCityScenarioTag(feature);
        if (!tag) return;
        const current = candidatesByTag.get(tag) || [];
        current.push({ key, feature });
        candidatesByTag.set(tag, current);
      });

      Object.keys(state.scenarioCountriesByTag).forEach((rawTag) => {
        const tag = String(rawTag || "").trim().toUpperCase();
        if (!tag) return;
        const explicitKey = resolveCityFeatureKey(state.scenarioCityOverridesData?.capitals_by_tag?.[tag], featuresByKey, aliasToKey);
        const hintedKey = explicitKey
          ? ""
          : resolveCityFeatureKey(state.scenarioCityOverridesData?.capital_city_hints?.[tag]?.city_id, featuresByKey, aliasToKey);
        let resolvedKey = explicitKey || hintedKey;
        if (!resolvedKey) {
          const candidateEntries = (candidatesByTag.get(tag) || []).slice();
          if (candidateEntries.length) {
            const preferredCountryCodes = getScenarioCountryCodesForTag(tag);
            candidateEntries.sort((left, right) => compareCapitalCandidateEntries(left, right, preferredCountryCodes));
            resolvedKey = candidateEntries[0]?.key || "";
          }
        }
        if (!resolvedKey || !featuresByKey.has(resolvedKey)) return;
        const resolvedCityId = getCityCanonicalId(featuresByKey.get(resolvedKey)) || resolvedKey;
        if (resolvedCityId) {
          activeCapitalCityIds.add(resolvedCityId);
        }
      });
    }

    const finalFeatures = [];
    Array.from(featuresByKey.entries()).forEach(([key, feature]) => {
      const cityId = getCityCanonicalId(feature) || key;
      const nextIsCapital = scenarioId ? activeCapitalCityIds.has(cityId) : !!feature?.properties?.__city_is_capital;
      const nextFeature = feature?.properties?.__city_is_capital === nextIsCapital
        ? feature
        : cloneCityFeature(feature, { __city_is_capital: nextIsCapital });
      if (!nextFeature?.properties?.__city_hidden && !shouldHideCityPointForScenarioCountry(nextFeature)) {
        finalFeatures.push(nextFeature);
      }
    });

    const merged = finalFeatures.length
      ? {
        type: "FeatureCollection",
        features: finalFeatures,
      }
      : null;

    if (cityLayerCache && typeof cityLayerCache === "object") {
      cityLayerCache.baseRef = baseRef;
      cityLayerCache.scenarioRef = scenarioRef;
      cityLayerCache.scenarioCountriesRef = scenarioCountriesRef;
      cityLayerCache.scenarioId = scenarioId;
      cityLayerCache.cityLayerRevision = cityLayerRevision;
      cityLayerCache.scenarioControllerRevision = scenarioControllerRevision;
      cityLayerCache.sovereigntyRevision = sovereigntyRevision;
      cityLayerCache.merged = merged;
    }

    return merged;
  }

  return {
    buildCityRevealPlan,
    doesScenarioCountryHideCityPoints,
    getCityScenarioTag,
    getCityUrbanRuntimeInfo,
    getEffectiveCityCollection,
    getUrbanFeatureIndex,
  };
}
