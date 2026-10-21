import { state as runtimeState } from "./state.js";
import {
  buildCityLocalizationPatch,
  normalizeCityText,
} from "./data_loader.js";
import { applyScenarioChunkCityExternalEffectState } from "./state/actions/scenario_presentation_actions.js";
import { copyLocalizationEntries, prepareLocalizationCandidate, isCityRevisionFromLocalizationPublication } from "./state/content_state.js";
const state = runtimeState;

function getScenarioOverrideLocaleEntry(overrideEntry) {
  const displayName = overrideEntry?.display_name && typeof overrideEntry.display_name === "object"
    ? overrideEntry.display_name
    : {};
  const en = normalizeCityText(displayName.en || overrideEntry?.name_en || overrideEntry?.name || "");
  const zh = normalizeCityText(displayName.zh || overrideEntry?.name_zh || "");
  if (!en && !zh) return null;
  const localeEntry = {};
  if (en) {
    localeEntry.en = en;
  }
  if (zh) {
    localeEntry.zh = zh;
  }
  return Object.keys(localeEntry).length ? localeEntry : null;
}

function* buildScenarioOverrideSourceCityIndex(overrideEntries, target) {
  const matches = new Map();
  for (const entry of overrideEntries) {
    const cityId = normalizeCityText(entry?.city_id);
    const stableKey = normalizeCityText(entry?.stable_key);
    if (cityId) matches.set(cityId, null);
    if (stableKey) matches.set(stableKey, null);
  }
  let remaining = matches.size;
  const features = Array.isArray(target.worldCitiesData?.features) ? target.worldCitiesData.features : [];
  for (let index = 0; index < features.length && remaining > 0; index += 1) {
    yield;
    const feature = features[index];
    const props = feature?.properties || {};
    const cityId = normalizeCityText(props.__city_id || props.id || feature?.id);
    const stableKey = normalizeCityText(props.__city_stable_key || props.stable_key);
    if (matches.has(cityId) && !matches.get(cityId)) {
      matches.set(cityId, { feature, index });
      remaining -= 1;
    }
    if (matches.has(stableKey) && !matches.get(stableKey)) {
      matches.set(stableKey, { feature, index });
      remaining -= 1;
    }
  }
  return matches;
}

function getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex) {
  const byId = sourceCityIndex.get(normalizeCityText(overrideEntry?.city_id));
  const byAlias = sourceCityIndex.get(normalizeCityText(overrideEntry?.stable_key));
  // Either key can match first in source order, including an alias before an ID.
  if (byId && (!byAlias || byId.index <= byAlias.index)) return byId.feature;
  return byAlias?.feature || null;
}

function getFeaturePointCoordinates(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates[0]?.length >= 2) {
    return geometry.coordinates[0];
  }
  return null;
}

function getAngularDistanceDegrees(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  const avgLatRad = (((Number(left[1]) || 0) + ((Number(right[1]) || 0))) * 0.5) * (Math.PI / 180);
  const dx = ((Number(left[0]) || 0) - (Number(right[0]) || 0)) * Math.cos(avgLatRad);
  const dy = (Number(left[1]) || 0) - (Number(right[1]) || 0);
  return Math.hypot(dx, dy);
}

function* resolveScenarioGeoFeatureIdForCityFeature(cityFeature, target, centroidCache) {
  const props = cityFeature?.properties || {};
  // This supplemental polygon layer contains Russian cities only. A global
  // capital must never acquire a Russian host through a spatial fallback.
  const countryCode = normalizeCityText(props.__city_country_code || props.country_code).toUpperCase();
  if (countryCode !== "RU") return "";
  const point = getFeaturePointCoordinates(cityFeature);
  const overrideFeatures = Array.isArray(target.ruCityOverrides?.features) ? target.ruCityOverrides.features : [];
  if (!point || !overrideFeatures.length) return "";

  const geoContains = globalThis.d3?.geoContains;
  const geoCentroid = globalThis.d3?.geoCentroid;
  let nearestId = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const feature of overrideFeatures) {
    yield;
    const featureId = normalizeCityText(feature?.properties?.id || feature?.id);
    if (!featureId || !feature?.geometry) continue;
    try {
      if (typeof geoCentroid !== "function") continue;
      let centroid = centroidCache.get(feature);
      if (!centroidCache.has(feature)) {
        centroid = geoCentroid(feature);
        centroidCache.set(feature, centroid);
      }
      const distance = getAngularDistanceDegrees(point, centroid);
      // Reversed spherical rings can contain almost the entire world. Require
      // the same local proximity used by the fallback before trusting contains.
      if (distance <= 1.5 && typeof geoContains === "function" && geoContains(feature, point)) {
        return featureId;
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = featureId;
      }
    } catch (_error) {
      // Ignore centroid failures for malformed features.
    }
  }

  return nearestDistance <= 1.5 ? nearestId : "";
}

function* prepareScenarioCityNameSyncPatch({ baseGeoLocales = {}, scenarioGeoPatch = {} } = {}, target = runtimeState) {
  const geo = {};
  const conflicts = [];
  let preservedExplicitPatchCount = 0;
  const overrideEntries = Object.values(target.scenarioCityOverridesData?.cities || {});
  let sourceCityIndex;
  const centroidCache = new Map();

  for (const overrideEntry of overrideEntries) {
    yield;
    const localeEntry = getScenarioOverrideLocaleEntry(overrideEntry);
    if (!localeEntry?.en && !localeEntry?.zh) continue;
    sourceCityIndex ||= yield* buildScenarioOverrideSourceCityIndex(overrideEntries, target);
    const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex);
    if (!sourceFeature) continue;

    const sourceProps = sourceFeature?.properties || {};
    const targetIds = new Set([
      normalizeCityText(sourceProps.__city_host_feature_id || sourceProps.host_feature_id),
      yield* resolveScenarioGeoFeatureIdForCityFeature(sourceFeature, target, centroidCache),
    ].filter(Boolean));

    targetIds.forEach((targetId) => {
      const explicitPatchEntry = scenarioGeoPatch[targetId] || null;
      if (explicitPatchEntry) {
        const explicitEn = normalizeCityText(explicitPatchEntry?.en || "");
        const explicitZh = normalizeCityText(explicitPatchEntry?.zh || "");
        if (explicitEn !== localeEntry.en || explicitZh !== localeEntry.zh) {
          preservedExplicitPatchCount += 1;
        }
        return;
      }

      const existingEntry = baseGeoLocales[targetId] || null;
      const existingEn = normalizeCityText(existingEntry?.en || "");
      const existingZh = normalizeCityText(existingEntry?.zh || "");
      const nextEntry = {
        ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
        ...(localeEntry.en ? { en: localeEntry.en } : {}),
        ...(localeEntry.zh ? { zh: localeEntry.zh } : {}),
      };
      const nextEn = normalizeCityText(nextEntry.en || "");
      const nextZh = normalizeCityText(nextEntry.zh || "");
      if (existingEn === nextEn && existingZh === nextZh) {
        return;
      }
      geo[targetId] = nextEntry;
      conflicts.push({
        targetId,
        previous: existingEntry,
        next: nextEntry,
      });
    });
  }

  return { geo, conflicts, preservedExplicitPatchCount };
}

function finishLocalizationIterator(iterator) {
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}

function buildScenarioCityNameSyncPatch(options) {
  return finishLocalizationIterator(prepareScenarioCityNameSyncPatch(options));
}

function* buildScenarioGeoLocalization(target, { baseGeoLocales = target.baseGeoLocales, baseAliasMap = target.baseGeoAliasToStableKey } = {}) {
  baseGeoLocales = baseGeoLocales && typeof baseGeoLocales === "object" ? baseGeoLocales : {};
  baseAliasMap = baseAliasMap && typeof baseAliasMap === "object" ? baseAliasMap : {};
  const scenarioGeoPatch = target.scenarioGeoLocalePatchData?.geo
    && typeof target.scenarioGeoLocalePatchData.geo === "object"
    ? target.scenarioGeoLocalePatchData.geo : {};
  const overrideEntries = Object.values(target.scenarioCityOverridesData?.cities || {});
  const patch = buildCityLocalizationPatch({
    cityCollection: target.scenarioCityOverridesData?.featureCollection || null,
    cityAliases: { cities: overrideEntries },
  });
  const synchronizedNamePatch = yield* prepareScenarioCityNameSyncPatch({ baseGeoLocales, scenarioGeoPatch }, target);
  const geo = {};
  const aliasToStableKey = {};
  for (const source of [baseGeoLocales, patch.geo, synchronizedNamePatch.geo, scenarioGeoPatch]) {
    yield* copyLocalizationEntries(geo, source);
  }
  yield* copyLocalizationEntries(aliasToStableKey, baseAliasMap);
  yield* copyLocalizationEntries(aliasToStableKey, patch.aliasToStableKey);
  return { geo, aliasToStableKey, synchronizedNamePatch };
}

// The caller retains the live localization while this private snapshot is built.
// It must validate its scenario identity immediately before publishing.
export function prepareScenarioLocalizationState(target, base, options) {
  return prepareLocalizationCandidate(buildScenarioGeoLocalization(target, base), options);
}

function applyScenarioGeoLocalization(candidate) {
  if (!runtimeState.locales || typeof runtimeState.locales !== "object") {
    runtimeState.locales = { ui: {}, geo: {} };
  }
  runtimeState.locales.geo = candidate.geo;
  runtimeState.geoAliasToStableKey = candidate.aliasToStableKey;
  const { synchronizedNamePatch } = candidate;
  if (synchronizedNamePatch.conflicts.length > 0) {
    const preservedSuffix = synchronizedNamePatch.preservedExplicitPatchCount > 0
      ? ` Preserved ${synchronizedNamePatch.preservedExplicitPatchCount} explicit scenario patch override${synchronizedNamePatch.preservedExplicitPatchCount === 1 ? "" : "s"}.`
      : "";
    console.info(
      `[scenario] Synchronized ${synchronizedNamePatch.conflicts.length} geo locale entr${synchronizedNamePatch.conflicts.length === 1 ? "y" : "ies"} from scenario city overrides.${preservedSuffix}`
    );
  }
}

function getLocalizationInputIdentity(target) {
  return [
    target.activeScenarioId,
    target.baseGeoLocales, target.baseGeoAliasToStableKey,
    target.worldCitiesData, target.ruCityOverrides,
    target.scenarioCityOverridesData, target.scenarioCityOverridesData?.cities,
    target.scenarioCityOverridesData?.featureCollection,
    target.scenarioGeoLocalePatchData, target.scenarioGeoLocalePatchData?.geo,
    globalThis.d3?.geoContains, globalThis.d3?.geoCentroid,
  ];
}

let confirmedLocalization = null;

function getConfirmedLocalization(inputs) {
  const confirmed = confirmedLocalization;
  return confirmed
    && inputs.every((input, index) => input === confirmed.inputs[index])
    && runtimeState.locales === confirmed.locales
    && runtimeState.locales?.geo === confirmed.candidate.geo
    && runtimeState.geoAliasToStableKey === confirmed.candidate.aliasToStableKey
    && runtimeState.cityLayerRevision === confirmed.cityLayerRevision
    ? confirmed.candidate : null;
}

function commitScenarioLocalization(cityOverridesPayload, geoLocalePatchPayload, candidate) {
  applyScenarioChunkCityExternalEffectState(runtimeState, cityOverridesPayload);
  runtimeState.scenarioGeoLocalePatchData = geoLocalePatchPayload || null;
  applyScenarioGeoLocalization(candidate);
  confirmedLocalization = {
    inputs: getLocalizationInputIdentity(runtimeState), candidate,
    locales: runtimeState.locales, cityLayerRevision: runtimeState.cityLayerRevision,
  };
}

function createLocalizationTarget(cityOverridesPayload, geoLocalePatchPayload) {
  return {
    activeScenarioId: runtimeState.activeScenarioId,
    baseGeoLocales: runtimeState.baseGeoLocales,
    baseGeoAliasToStableKey: runtimeState.baseGeoAliasToStableKey,
    worldCitiesData: runtimeState.worldCitiesData,
    ruCityOverrides: runtimeState.ruCityOverrides,
    scenarioCityOverridesData: (cityOverridesPayload === undefined
      ? runtimeState.scenarioCityOverridesData : cityOverridesPayload) || null,
    scenarioGeoLocalePatchData: geoLocalePatchPayload || null,
  };
}

export function syncScenarioLocalizationState({
  cityOverridesPayload,
  geoLocalePatchPayload = runtimeState.scenarioGeoLocalePatchData,
} = {}) {
  const target = createLocalizationTarget(cityOverridesPayload, geoLocalePatchPayload);
  const candidate = getConfirmedLocalization(getLocalizationInputIdentity(target))
    || finishLocalizationIterator(buildScenarioGeoLocalization(target));
  commitScenarioLocalization(cityOverridesPayload, geoLocalePatchPayload, candidate);
}

// Only async resource owners use this entry point. Preparation never publishes
// partial city effects or dictionaries, and synchronous consumers stay synchronous.
export async function syncScenarioLocalizationStateAsync({
  cityOverridesPayload,
  geoLocalePatchPayload = runtimeState.scenarioGeoLocalePatchData,
} = {}, options = {}) {
  const originalCityPayload = runtimeState.scenarioCityOverridesData;
  let expectedCityRevision = runtimeState.cityLayerRevision;
  const originalScenarioId = runtimeState.activeScenarioId;
  const incomingCities = cityOverridesPayload?.cities;
  const incomingFeatures = cityOverridesPayload?.featureCollection;
  const ownerIsCurrent = () => {
    if (!(options.isCurrent?.() ?? true)
      || runtimeState.activeScenarioId !== originalScenarioId
      || runtimeState.scenarioCityOverridesData !== originalCityPayload
      || cityOverridesPayload?.cities !== incomingCities
      || cityOverridesPayload?.featureCollection !== incomingFeatures) return false;
    if (runtimeState.cityLayerRevision !== expectedCityRevision) {
      if (!isCityRevisionFromLocalizationPublication(runtimeState, expectedCityRevision)) return false;
      expectedCityRevision = runtimeState.cityLayerRevision;
    }
    return true;
  };
  // Parallel base/full-localization hydration can replace the merge inputs.
  // Rebuild against those inputs, but never overwrite a newer city edit.
  while (ownerIsCurrent()) {
    const target = createLocalizationTarget(cityOverridesPayload, geoLocalePatchPayload);
    const inputs = getLocalizationInputIdentity(target);
    const before = {
      ...createLocalizationTarget(),
      scenarioCityOverridesData: runtimeState.scenarioCityOverridesData,
      scenarioGeoLocalePatchData: runtimeState.scenarioGeoLocalePatchData,
      locales: runtimeState.locales,
      geoAliasToStableKey: runtimeState.geoAliasToStableKey,
      cityLayerRevision: runtimeState.cityLayerRevision,
    };
    const previousGeo = runtimeState.locales?.geo;
    const isCurrent = () => ownerIsCurrent()
      && Object.keys(before).every((key) => runtimeState[key] === before[key])
      && runtimeState.locales?.geo === previousGeo
      && getLocalizationInputIdentity(target).every((input, index) => input === inputs[index]);
    const candidate = getConfirmedLocalization(inputs)
      || await prepareScenarioLocalizationState(target, undefined, { ...options, isCurrent });
    if (!candidate || !isCurrent()) {
      // The optional city load follows the latest locale patch while retaining
      // an explicitly supplied patch if the caller owns that replacement.
      if (geoLocalePatchPayload === before.scenarioGeoLocalePatchData) {
        geoLocalePatchPayload = runtimeState.scenarioGeoLocalePatchData;
      }
      continue;
    }
    commitScenarioLocalization(cityOverridesPayload, geoLocalePatchPayload, candidate);
    return true;
  }
  return false;
}

