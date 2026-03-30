import { state } from "./state.js";
import {
  buildCityLocalizationPatch,
  normalizeCityText,
} from "./data_loader.js";

function getScenarioOverrideLocaleEntry(overrideEntry) {
  const displayName = overrideEntry?.display_name && typeof overrideEntry.display_name === "object"
    ? overrideEntry.display_name
    : {};
  const en = normalizeCityText(displayName.en || overrideEntry?.name_en || overrideEntry?.name || "");
  const zh = normalizeCityText(displayName.zh || overrideEntry?.name_zh || "");
  if (!en && !zh) return null;
  return {
    en: en || zh,
    zh: zh || en,
  };
}

function getScenarioOverrideSourceCityFeature(overrideEntry) {
  const features = Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : [];
  if (!features.length) return null;
  const candidates = new Set([
    normalizeCityText(overrideEntry?.city_id),
    normalizeCityText(overrideEntry?.stable_key),
  ].filter(Boolean));
  if (!candidates.size) return null;
  return features.find((feature) => {
    const props = feature?.properties || {};
    return candidates.has(normalizeCityText(props.__city_id || props.id || feature?.id))
      || candidates.has(normalizeCityText(props.__city_stable_key || props.stable_key));
  }) || null;
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

function resolveScenarioGeoFeatureIdForCityFeature(cityFeature) {
  const point = getFeaturePointCoordinates(cityFeature);
  const overrideFeatures = Array.isArray(state.ruCityOverrides?.features) ? state.ruCityOverrides.features : [];
  if (!point || !overrideFeatures.length) return "";

  const geoContains = globalThis.d3?.geoContains;
  const geoCentroid = globalThis.d3?.geoCentroid;
  let nearestId = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const feature of overrideFeatures) {
    const featureId = normalizeCityText(feature?.properties?.id || feature?.id);
    if (!featureId || !feature?.geometry) continue;
    try {
      if (typeof geoContains === "function" && geoContains(feature, point)) {
        return featureId;
      }
    } catch (_error) {
      // Ignore invalid geometries and fall back to centroid proximity.
    }
    try {
      if (typeof geoCentroid !== "function") continue;
      const centroid = geoCentroid(feature);
      const distance = getAngularDistanceDegrees(point, centroid);
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

function buildScenarioCityNameSyncPatch({ baseGeoLocales = {}, scenarioGeoPatch = {} } = {}) {
  const geo = {};
  const conflicts = [];
  let preservedExplicitPatchCount = 0;
  const overrideEntries = Object.values(state.scenarioCityOverridesData?.cities || {});

  overrideEntries.forEach((overrideEntry) => {
    const localeEntry = getScenarioOverrideLocaleEntry(overrideEntry);
    if (!localeEntry?.en && !localeEntry?.zh) return;
    const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry);
    if (!sourceFeature) return;

    const sourceProps = sourceFeature?.properties || {};
    const targetIds = new Set([
      normalizeCityText(sourceProps.__city_host_feature_id || sourceProps.host_feature_id),
      resolveScenarioGeoFeatureIdForCityFeature(sourceFeature),
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
      if (existingEn === localeEntry.en && existingZh === localeEntry.zh) {
        return;
      }
      geo[targetId] = { ...localeEntry };
      conflicts.push({
        targetId,
        previous: existingEntry,
        next: localeEntry,
      });
    });
  });

  return { geo, conflicts, preservedExplicitPatchCount };
}

function applyScenarioGeoLocalization() {
  const baseGeoLocales = state.baseGeoLocales && typeof state.baseGeoLocales === "object"
    ? state.baseGeoLocales
    : {};
  const baseAliasMap = state.baseGeoAliasToStableKey && typeof state.baseGeoAliasToStableKey === "object"
    ? state.baseGeoAliasToStableKey
    : {};
  const scenarioGeoPatch = state.scenarioGeoLocalePatchData?.geo
    && typeof state.scenarioGeoLocalePatchData.geo === "object"
    ? state.scenarioGeoLocalePatchData.geo
    : {};
  const overrideEntries = Object.values(state.scenarioCityOverridesData?.cities || {});
  const patch = buildCityLocalizationPatch({
    cityCollection: state.scenarioCityOverridesData?.featureCollection || null,
    cityAliases: { cities: overrideEntries },
  });
  const synchronizedNamePatch = buildScenarioCityNameSyncPatch({
    baseGeoLocales,
    scenarioGeoPatch,
  });
  if (!state.locales || typeof state.locales !== "object") {
    state.locales = { ui: {}, geo: {} };
  }
  state.locales.geo = {
    ...baseGeoLocales,
    ...patch.geo,
    ...synchronizedNamePatch.geo,
    ...scenarioGeoPatch,
  };
  state.geoAliasToStableKey = {
    ...baseAliasMap,
    ...patch.aliasToStableKey,
  };
  if (synchronizedNamePatch.conflicts.length > 0) {
    const preservedSuffix = synchronizedNamePatch.preservedExplicitPatchCount > 0
      ? ` Preserved ${synchronizedNamePatch.preservedExplicitPatchCount} explicit scenario patch override${synchronizedNamePatch.preservedExplicitPatchCount === 1 ? "" : "s"}.`
      : "";
    console.info(
      `[scenario] Synchronized ${synchronizedNamePatch.conflicts.length} geo locale entr${synchronizedNamePatch.conflicts.length === 1 ? "y" : "ies"} from scenario city overrides.${preservedSuffix}`
    );
  }
}

export function syncScenarioLocalizationState({
  cityOverridesPayload = state.scenarioCityOverridesData,
  geoLocalePatchPayload = state.scenarioGeoLocalePatchData,
} = {}) {
  state.scenarioCityOverridesData = cityOverridesPayload || null;
  state.scenarioGeoLocalePatchData = geoLocalePatchPayload || null;
  state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
  applyScenarioGeoLocalization();
}
