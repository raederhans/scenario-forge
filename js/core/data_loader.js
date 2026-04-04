// Data loading helpers (Phase 13 scaffold)

import {
  createSerializableStartupBaseTopologyPayload,
  createSerializableStartupLocalizationPayload,
  createStartupBaseTopologyCacheKey,
  createStartupLocalizationCacheKey,
  isStartupCacheEnabled,
  loadBuildManifest,
  readStartupCacheEntry,
  writeStartupCacheEntry,
} from "./startup_cache.js";
import {
  loadBaseStartupViaWorker,
  shouldUseStartupWorker,
} from "./startup_worker_client.js";
import { state } from "./state.js";

const TOPOLOGY_VARIANT_URLS = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
  na_v1: "data/europe_topology.na_v1.json",
  na_v2: "data/europe_topology.na_v2.json",
};

const DETAIL_SOURCES = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
  na_v1: "data/europe_topology.na_v1.json",
  na_v2: "data/europe_topology.na_v2.json",
};
const DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const WORLD_CITIES_URLS = ["data/world_cities.geojson", "data/world_cities.json"];
const CITY_ALIASES_URLS = ["data/city_aliases.json"];
const RU_CITY_OVERRIDES_URL = "data/ru_city_overrides.geojson";
const SPECIAL_ZONES_URL = "data/special_zones.geojson";
const RUNTIME_POLITICAL_URL = "data/europe_topology.runtime_political_v1.json";
const GLOBAL_RIVERS_CONTEXT_PACK_URL = "data/global_rivers.geojson";
const CONTEXT_LAYER_PACKS = {
  airports: { url: "data/transport_layers/japan_airport/airports.geojson", format: "geojson" },
  ports: { url: "data/transport_layers/japan_port/ports.geojson", format: "geojson" },
  physical: { url: "data/europe_physical.geojson", format: "geojson" },
  urban: { url: "data/europe_urban.geojson", format: "geojson" },
  physical_semantics: {
    url: "data/global_physical_semantics.topo.json",
    format: "topology",
    objectName: "physical_semantics",
  },
  physical_contours_major: {
    url: "data/global_contours.major.topo.json",
    format: "topology",
    objectName: "contours",
  },
  physical_contours_minor: {
    url: "data/global_contours.minor.topo.json",
    format: "topology",
    objectName: "contours",
  },
};
const PALETTE_REGISTRY_URL = "data/palettes/index.json";
const RELEASABLE_CATALOG_URL = "data/releasables/hoi4_vanilla.internal.phase1.catalog.json";
const RENDER_PROFILES = new Set(["auto", "balanced", "full"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCityText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function parseCityAliases(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseCityAliases(entry));
  }
  if (typeof value === "string") {
    return value
      .split(/[|;/]/)
      .map((entry) => normalizeCityText(entry))
      .filter(Boolean);
  }
  return [];
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return fallback;
}

function parseFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCityLocaleEntry(source = {}, fallbackName = "") {
  const displayName = source?.display_name && typeof source.display_name === "object"
    ? source.display_name
    : (source?.displayName && typeof source.displayName === "object" ? source.displayName : {});
  const en = normalizeCityText(
    displayName.en || displayName.EN || source.name_en || source.label_en || source.en || source.name || source.label || fallbackName
  );
  const zh = normalizeCityText(
    displayName.zh || displayName.ZH || source.name_zh || source.label_zh || source.zh || source.name_cn || source.label_cn || ""
  );
  if (!en && !zh) return null;
  return {
    en: en || zh || fallbackName,
    zh: zh || en || fallbackName,
  };
}

function normalizeCityFeature(feature, index, { sourceLabel = "world_cities" } = {}) {
  if (!feature || typeof feature !== "object" || !feature.geometry) return null;
  const props = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const id = normalizeCityText(
    props.id || props.city_id || props.cityId || props.stable_id || feature.id || `${sourceLabel}_${index + 1}`
  );
  if (!id) return null;

  const stableKey = normalizeCityText(props.stable_key || props.locale_key || props.localeKey || `city::${id}`);
  const localeEntry = getCityLocaleEntry(props, id);
  const population = parseFiniteNumber(
    props.population || props.pop || props.population_est || props.populationEstimate,
    null
  );
  const capitalKind = normalizeCityText(
    props.capital_kind || props.capitalKind || props.capital_type || props.capitalType || props.capital_status || props.capitalStatus
  ).toLowerCase();
  const baseTierRaw = normalizeCityText(props.base_tier || props.baseTier).toLowerCase();
  const validBaseTier = ["minor", "regional", "major"].includes(baseTierRaw) ? baseTierRaw : "";
  const aliases = Array.from(new Set([
    id,
    stableKey,
    normalizeCityText(props.name),
    normalizeCityText(props.label),
    normalizeCityText(props.name_en),
    normalizeCityText(props.label_en),
    normalizeCityText(props.name_zh),
    normalizeCityText(props.label_zh),
    ...parseCityAliases(props.aliases),
    ...parseCityAliases(props.alias),
    ...parseCityAliases(props.alt_names),
    ...parseCityAliases(props.altNames),
    ...parseCityAliases(props.alias_names),
    ...parseCityAliases(props.aliasNames),
  ].filter(Boolean)));

  const isCountryCapital = parseBoolean(props.is_country_capital, false)
    || capitalKind === "country_capital"
    || capitalKind === "admin-0 capital";
  const isAdminCapital = parseBoolean(props.is_admin_capital, false)
    || capitalKind === "admin_capital"
    || capitalKind === "admin-1 capital"
    || capitalKind === "admin-0 region capital";
  const isCapital = parseBoolean(props.is_capital, false)
    || parseBoolean(props.capital, false)
    || isCountryCapital
    || isAdminCapital
    || ["capital", "primary", "national", "state", "regional"].includes(capitalKind);
  const isHidden = parseBoolean(props.hidden, false)
    || parseBoolean(props.remove, false)
    || parseBoolean(props.deleted, false);
  const baseTier = validBaseTier || (
    isCountryCapital || (population !== null && population >= 1_500_000)
      ? "major"
      : (isAdminCapital || (population !== null && population >= 350_000) ? "regional" : "minor")
  );
  const minZoom = parseFiniteNumber(
    props.min_zoom || props.minZoom,
    baseTier === "major" ? 0.8 : (baseTier === "regional" ? 1.6 : 2.9)
  );
  const hostFeatureId = normalizeCityText(
    props.host_feature_id || props.hostFeatureId || props.political_feature_id || props.politicalFeatureId
  );
  const urbanMatchId = normalizeCityText(
    props.urban_match_id || props.urbanMatchId || props.urban_area_id || props.urbanAreaId
  );
  const countryCode = normalizeCityText(
    props.cntr_code || props.country_code || props.countryCode || props.iso_a2 || props.ISO_A2
  ).toUpperCase();

  return {
    ...feature,
    id,
    properties: {
      ...props,
      id,
      stable_key: stableKey,
      __city_source: sourceLabel,
      __city_id: id,
      __city_stable_key: stableKey,
      __city_locale: localeEntry,
      __city_aliases: aliases,
      __city_is_capital: isCapital,
      __city_capital_kind: capitalKind,
      __city_capital_type: capitalKind,
      __city_is_country_capital: isCountryCapital,
      __city_is_admin_capital: isAdminCapital,
      __city_hidden: isHidden,
      __city_population: population,
      __city_country_code: countryCode,
      __city_base_tier: baseTier,
      __city_min_zoom: minZoom,
      __city_host_feature_id: hostFeatureId,
      __city_urban_match_id: urbanMatchId,
      __city_dataset_source: normalizeCityText(props.source || props.dataset_source || props.datasetSource || sourceLabel),
      __city_replace_ids: Array.from(new Set([
        ...parseCityAliases(props.replace_ids),
        ...parseCityAliases(props.replaceIds),
        ...parseCityAliases(props.remove_ids),
        ...parseCityAliases(props.removeIds),
      ].filter(Boolean))),
    },
  };
}

function normalizeCityFeatureCollection(payload, { sourceLabel = "world_cities" } = {}) {
  if (!Array.isArray(payload?.features)) {
    return null;
  }
  const features = payload.features
    .map((feature, index) => normalizeCityFeature(feature, index, { sourceLabel }))
    .filter(Boolean);
  return {
    type: "FeatureCollection",
    features,
  };
}

function normalizeScenarioCityOverrideEntry(rawEntry, rawCityId = "") {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  const cityId = normalizeCityText(rawEntry.city_id || rawEntry.cityId || rawCityId);
  if (!cityId) return null;
  const stableKey = normalizeCityText(rawEntry.stable_key || rawEntry.stableKey || `id::${cityId}`);
  const localeEntry = getCityLocaleEntry(rawEntry, cityId);
  const tierRaw = normalizeCityText(
    rawEntry.tier || rawEntry.base_tier || rawEntry.baseTier || rawEntry.level
  ).toLowerCase();
  const tier = ["minor", "regional", "major"].includes(tierRaw) ? tierRaw : "";
  const aliases = Array.from(new Set([
    cityId,
    stableKey,
    ...(localeEntry ? [localeEntry.en, localeEntry.zh] : []),
    ...parseCityAliases(rawEntry.aliases),
    ...parseCityAliases(rawEntry.alias),
    ...parseCityAliases(rawEntry.alt_names),
    ...parseCityAliases(rawEntry.altNames),
  ].filter(Boolean)));
  return {
    ...rawEntry,
    city_id: cityId,
    stable_key: stableKey,
    name_en: localeEntry?.en || normalizeCityText(rawEntry.name_en || rawEntry.name),
    name_zh: localeEntry?.zh || normalizeCityText(rawEntry.name_zh || ""),
    display_name: localeEntry ? { ...localeEntry } : null,
    aliases,
    tier,
    hidden: parseBoolean(rawEntry.hidden, false),
    replace_ids: Array.from(new Set([
      ...parseCityAliases(rawEntry.replace_ids),
      ...parseCityAliases(rawEntry.replaceIds),
      ...parseCityAliases(rawEntry.remove_ids),
      ...parseCityAliases(rawEntry.removeIds),
    ].filter(Boolean))),
  };
}

function normalizeScenarioCityOverridesPayload(payload, { sourceLabel = "scenario_city_overrides" } = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (Array.isArray(payload.features)) {
    return {
      type: "city_overrides",
      version: 1,
      scenario_id: "",
      generated_at: "",
      cities: {},
      capitals_by_tag: {},
      capital_city_hints: {},
      audit: null,
      featureCollection: normalizeCityFeatureCollection(payload, { sourceLabel }),
    };
  }

  const rawCityMap = payload.cities && typeof payload.cities === "object" ? payload.cities : {};
  const cities = {};
  Object.entries(rawCityMap).forEach(([rawCityId, rawEntry]) => {
    const normalizedEntry = normalizeScenarioCityOverrideEntry(rawEntry, rawCityId);
    if (!normalizedEntry) return;
    cities[normalizedEntry.city_id] = normalizedEntry;
  });

  const capitalsByTag = {};
  Object.entries(payload.capitals_by_tag || payload.capitalsByTag || {}).forEach(([rawTag, rawCityId]) => {
    const tag = normalizeCityText(rawTag).toUpperCase();
    const cityId = normalizeCityText(rawCityId);
    if (!tag || !cityId) return;
    capitalsByTag[tag] = cityId;
  });

  const capitalCityHints = {};
  const rawHintMap = payload.capital_city_hints || payload.capitalCityHints || payload.capital_hints || {};
  Object.entries(rawHintMap && typeof rawHintMap === "object" ? rawHintMap : {}).forEach(([rawTag, rawHint]) => {
    const tag = normalizeCityText(rawTag).toUpperCase();
    if (!tag || !rawHint || typeof rawHint !== "object") return;
    capitalCityHints[tag] = {
      ...rawHint,
      tag,
      city_id: normalizeCityText(rawHint.city_id || rawHint.cityId),
      capital_state_id: rawHint.capital_state_id ?? rawHint.capitalStateId ?? null,
      resolution_method: normalizeCityText(rawHint.resolution_method || rawHint.resolutionMethod),
      confidence: normalizeCityText(rawHint.confidence),
      host_feature_id: normalizeCityText(rawHint.host_feature_id || rawHint.hostFeatureId),
      lookup_iso2: normalizeCityText(rawHint.lookup_iso2 || rawHint.lookupIso2).toUpperCase(),
      base_iso2: normalizeCityText(rawHint.base_iso2 || rawHint.baseIso2).toUpperCase(),
    };
  });

  const featureCollection = Array.isArray(payload.feature_collection?.features)
    ? normalizeCityFeatureCollection(payload.feature_collection, { sourceLabel: `${sourceLabel}:feature_collection` })
    : null;

  return {
    type: "city_overrides",
    version: Number(payload.version || 1) || 1,
    scenario_id: normalizeCityText(payload.scenario_id || payload.scenarioId),
    generated_at: normalizeCityText(payload.generated_at || payload.generatedAt),
    cities,
    capitals_by_tag: capitalsByTag,
    capital_city_hints: capitalCityHints,
    audit: payload.audit && typeof payload.audit === "object" ? payload.audit : null,
    featureCollection,
  };
}

function normalizeScenarioGeoLocalePatchEntry(source = {}) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const displayName = source?.display_name && typeof source.display_name === "object"
    ? source.display_name
    : (source?.displayName && typeof source.displayName === "object" ? source.displayName : {});
  const en = normalizeCityText(
    displayName.en || displayName.EN || source.name_en || source.label_en || source.en || ""
  );
  const zh = normalizeCityText(
    displayName.zh || displayName.ZH || source.name_zh || source.label_zh || source.zh || source.name_cn || source.label_cn || ""
  );
  if (!en && !zh) return null;
  const localeEntry = {};
  if (en) localeEntry.en = en;
  if (zh) localeEntry.zh = zh;
  return Object.keys(localeEntry).length ? localeEntry : null;
}

function normalizeScenarioGeoLocalePatchPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const geo = {};
  Object.entries(payload.geo && typeof payload.geo === "object" ? payload.geo : {}).forEach(([rawFeatureId, rawEntry]) => {
    const featureId = normalizeCityText(rawFeatureId);
    const localeEntry = normalizeScenarioGeoLocalePatchEntry(rawEntry);
    if (!featureId || !localeEntry) return;
    geo[featureId] = localeEntry;
  });
  return {
    type: "scenario_geo_locale_patch",
    version: Number(payload.version || 1) || 1,
    scenario_id: normalizeCityText(payload.scenario_id || payload.scenarioId),
    generated_at: normalizeCityText(payload.generated_at || payload.generatedAt),
    geo,
    audit: payload.audit && typeof payload.audit === "object" ? payload.audit : null,
  };
}

function applyAliasObjectToPatch(rawAliasMap, aliasToStableKey) {
  if (!rawAliasMap || typeof rawAliasMap !== "object") return;
  Object.entries(rawAliasMap).forEach(([rawAlias, rawStableKey]) => {
    const alias = normalizeCityText(rawAlias);
    const stableKey = normalizeCityText(rawStableKey);
    if (!alias || !stableKey) return;
    aliasToStableKey[alias] = stableKey;
  });
}

function applyGeoLocaleObjectToPatch(rawGeoMap, geo) {
  if (!rawGeoMap || typeof rawGeoMap !== "object") return;
  Object.entries(rawGeoMap).forEach(([rawStableKey, rawEntry]) => {
    const stableKey = normalizeCityText(rawStableKey);
    const localeEntry = getCityLocaleEntry(rawEntry, stableKey);
    if (!stableKey || !localeEntry) return;
    geo[stableKey] = {
      ...(geo[stableKey] || {}),
      ...localeEntry,
    };
  });
}

function applyCityAliasEntriesToPatch(entries, geo, aliasToStableKey) {
  asArray(entries).forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const stableKey = normalizeCityText(
      entry.stable_key || entry.locale_key || entry.localeKey || entry.id || entry.city_id || `city_alias_${index + 1}`
    );
    if (!stableKey) return;
    const localeEntry = getCityLocaleEntry(entry, stableKey);
    if (localeEntry) {
      geo[stableKey] = {
        ...(geo[stableKey] || {}),
        ...localeEntry,
      };
    }
    const aliases = Array.from(new Set([
      stableKey,
      normalizeCityText(entry.city_id || entry.cityId),
      ...parseCityAliases(entry.aliases),
      ...parseCityAliases(entry.alias),
      ...parseCityAliases(entry.names),
      ...parseCityAliases(entry.alt_names),
      ...parseCityAliases(entry.altNames),
      normalizeCityText(entry.name),
      normalizeCityText(entry.label),
      normalizeCityText(entry.name_en),
      normalizeCityText(entry.name_zh),
    ].filter(Boolean)));
    aliases.forEach((alias) => {
      aliasToStableKey[alias] = stableKey;
    });
  });
}

function buildCityLocalizationPatch({ cityCollection = null, cityAliases = null } = {}) {
  const geo = {};
  const aliasToStableKey = {};

  asArray(cityCollection?.features).forEach((feature) => {
    const props = feature?.properties || {};
    const stableKey = normalizeCityText(props.__city_stable_key || props.stable_key || props.id || feature?.id);
    if (!stableKey) return;
    const localeEntry = getCityLocaleEntry(props.__city_locale || props, stableKey);
    if (localeEntry) {
      geo[stableKey] = {
        ...(geo[stableKey] || {}),
        ...localeEntry,
      };
    }
    asArray(props.__city_aliases).forEach((alias) => {
      const normalizedAlias = normalizeCityText(alias);
      if (!normalizedAlias) return;
      aliasToStableKey[normalizedAlias] = stableKey;
    });
  });

  applyAliasObjectToPatch(cityAliases?.alias_to_stable_key, aliasToStableKey);
  applyGeoLocaleObjectToPatch(cityAliases?.geo, geo);
  applyGeoLocaleObjectToPatch(cityAliases?.locales?.geo, geo);
  applyCityAliasEntriesToPatch(cityAliases?.entries, geo, aliasToStableKey);
  applyCityAliasEntriesToPatch(cityAliases?.cities, geo, aliasToStableKey);
  applyCityAliasEntriesToPatch(cityAliases?.aliases, geo, aliasToStableKey);

  return {
    geo,
    aliasToStableKey,
  };
}

function mergeCityLocalizationData({
  locales = { ui: {}, geo: {} },
  geoAliases = { alias_to_stable_key: {} },
  cityCollection = null,
  cityAliases = null,
} = {}) {
  const patch = buildCityLocalizationPatch({ cityCollection, cityAliases });
  return {
    locales: {
      ...(locales || { ui: {}, geo: {} }),
      geo: {
        ...(locales?.geo || {}),
        ...patch.geo,
      },
    },
    geoAliases: {
      ...(geoAliases || { alias_to_stable_key: {} }),
      alias_to_stable_key: {
        ...(geoAliases?.alias_to_stable_key || {}),
        ...patch.aliasToStableKey,
      },
    },
    cityLocalizationPatch: patch,
  };
}

async function loadOptionalJsonCandidate(d3Client, candidateUrls, { label = "resource", normalizer = (payload) => payload } = {}) {
  const urls = Array.isArray(candidateUrls) ? candidateUrls : [candidateUrls];
  let sawFailure = false;
  for (const url of urls.filter(Boolean)) {
    try {
      const payload = await d3Client.json(url);
      const normalized = normalizer(payload, url);
      if (normalized !== null && normalized !== undefined) {
        return normalized;
      }
      console.warn(`[data_loader] Optional ${label} payload invalid at ${url}.`);
      sawFailure = true;
    } catch (error) {
      sawFailure = true;
      console.warn(`[data_loader] Optional ${label} missing or invalid at ${url}.`, error);
    }
  }
  if (!sawFailure) {
    console.warn(`[data_loader] Optional ${label} is unavailable; no candidate URL resolved.`);
  }
  return null;
}

async function loadRiversFallbackCollection(d3Client) {
  try {
    const payload = await d3Client.json(GLOBAL_RIVERS_CONTEXT_PACK_URL);
    if (!Array.isArray(payload?.features)) {
      console.warn(
        `[data_loader] Rivers fallback pack invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`
      );
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  } catch (err) {
    console.warn(
      `[data_loader] Rivers fallback pack missing or invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`,
      err
    );
    return null;
  }
}

function normalizeRequestedContextLayerNames(includeContextLayers) {
  if (includeContextLayers === true) {
    return ["rivers", ...Object.keys(CONTEXT_LAYER_PACKS)];
  }
  if (includeContextLayers === false || includeContextLayers == null) {
    return [];
  }
  const requestedNames = Array.isArray(includeContextLayers)
    ? includeContextLayers
    : [includeContextLayers];
  return Array.from(
    new Set(
      requestedNames
        .map((name) => String(name || "").trim().toLowerCase())
        .filter((name) => name === "rivers" || Object.prototype.hasOwnProperty.call(CONTEXT_LAYER_PACKS, name))
    )
  );
}

async function loadContextLayerPackInternal(layerName, d3Client) {
  if (layerName === "rivers") {
    return loadRiversFallbackCollection(d3Client);
  }
  const descriptor = CONTEXT_LAYER_PACKS[layerName];
  if (!descriptor) {
    return null;
  }
  const { url, format = "geojson", objectName = "" } = descriptor;
  try {
    const payload = await d3Client.json(url);
    if (format === "topology") {
      const object = payload?.objects?.[objectName];
      const collection = object && globalThis.topojson
        ? globalThis.topojson.feature(payload, object)
        : null;
      if (!Array.isArray(collection?.features)) {
        console.warn(`[data_loader] Context topology pack invalid at ${url}. Ignoring ${layerName}.`);
        return null;
      }
      return collection;
    }
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] Context layer pack invalid at ${url}. Ignoring ${layerName}.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  } catch (err) {
    console.warn(`[data_loader] Context layer pack missing or invalid for ${layerName}. Ignoring.`, err);
    return null;
  }
}

async function loadOptionalContextLayerPacks(d3Client, includeContextLayers = true) {
  const requestedNames = normalizeRequestedContextLayerNames(includeContextLayers);
  if (!requestedNames.length) {
    return {};
  }
  const entries = await Promise.all(
    requestedNames.map(async (layerName) => [layerName, await loadContextLayerPackInternal(layerName, d3Client)])
  );
  return Object.fromEntries(entries.filter(([, collection]) => Array.isArray(collection?.features)));
}

function getSearchParams() {
  const search = globalThis?.location?.search || "";
  if (!search || !globalThis.URLSearchParams) {
    return null;
  }
  return new globalThis.URLSearchParams(search);
}

function resolveTopologyVariant() {
  const params = getSearchParams();
  if (!params) return null;

  const raw = params.get("topology_variant");
  if (!raw) return null;

  const key = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TOPOLOGY_VARIANT_URLS, key)) {
    console.warn(
      `[data_loader] Ignoring unknown topology_variant="${raw}". Allowed values: highres, legacy_bak, na_v1, na_v2.`
    );
    return null;
  }

  return {
    key,
    url: TOPOLOGY_VARIANT_URLS[key],
  };
}

function resolveRenderProfile() {
  const params = getSearchParams();
  const raw = params?.get("render_profile");
  const value = String(raw || "auto").trim().toLowerCase();
  if (!RENDER_PROFILES.has(value)) {
    if (raw) {
      console.warn(
        `[data_loader] Ignoring unknown render_profile="${raw}". Allowed values: auto, balanced, full.`
      );
    }
    return "auto";
  }
  return value;
}

function resolveDetailLayerEnabled() {
  const params = getSearchParams();
  if (!params) return true;
  const raw = params.get("detail_layer");
  if (!raw) return true;
  const value = String(raw).trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(value);
}

function resolveDetailSource() {
  const params = getSearchParams();
  if (!params) {
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  const raw = params.get("detail_source");
  if (!raw) {
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  const key = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key)) {
    console.warn(
      `[data_loader] Ignoring unknown detail_source="${raw}". Allowed values: highres, legacy_bak, na_v1, na_v2.`
    );
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  return { key, url: DETAIL_SOURCES[key] };
}

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function normalizeLocaleLevel(value, fallback = "full") {
  return String(value || fallback).trim().toLowerCase() === "startup" ? "startup" : "full";
}

function isScenarioScopedLocalizationUrl(url) {
  return /(^|\/)data\/scenarios\/[^/]+\/(?:locales|geo_aliases)\.startup\.json$/i.test(String(url || "").trim());
}

function resolveLocalizationUrls({
  localeLevel = "full",
  localesUrl = null,
  geoAliasesUrl = null,
} = {}) {
  const normalizedLevel = normalizeLocaleLevel(localeLevel);
  return {
    localeLevel: normalizedLevel,
    localesUrl: String(
      localesUrl || "data/locales.json"
    ).trim(),
    geoAliasesUrl: String(
      geoAliasesUrl || "data/geo_aliases.json"
    ).trim(),
  };
}

function getPoliticalGeometryCount(topology) {
  return (
    topology?.objects?.political?.geometries &&
    Array.isArray(topology.objects.political.geometries)
      ? topology.objects.political.geometries.length
      : 0
  );
}

function shouldDeferDetailLoad(renderProfile) {
  if (renderProfile === "full") return false;
  if (renderProfile === "balanced") return true;

  const nav = globalThis?.navigator || {};
  const deviceMemory = Number(nav.deviceMemory || 0);
  const hardwareConcurrency = Number(nav.hardwareConcurrency || 0);
  const dpr = Math.max(Number(globalThis?.devicePixelRatio || 1), 1);

  if (deviceMemory && deviceMemory <= 8) return true;
  if (hardwareConcurrency && hardwareConcurrency <= 8) return true;
  if (dpr > 1.5) return true;
  return false;
}

async function loadTopologyUrlWithMetrics(d3Client, url, label) {
  const { payload: topology, metrics } = await loadMeasuredJsonResource(url, {
    d3Client,
    label: `${label}_topology`,
  });
  const count = getPoliticalGeometryCount(topology);
  console.info(`[data_loader] Loaded ${label} topology ${url} (${count} features).`);
  return {
    topology,
    metrics: {
      ...(metrics || {}),
      featureCount: count,
    },
  };
}

async function loadTopologyUrl(d3Client, url, label) {
  const result = await loadTopologyUrlWithMetrics(d3Client, url, label);
  return result.topology;
}

export async function loadMeasuredJsonResource(
  url,
  {
    d3Client = globalThis.d3,
    label = "resource",
  } = {}
) {
  if (!url) {
    throw new Error(`[data_loader] Missing URL for ${label}.`);
  }
  const startedAt = nowMs();
  if (typeof globalThis.fetch === "function") {
    const response = await globalThis.fetch(url, {
      cache: "default",
      credentials: "same-origin",
    });
    const textLoadedAt = nowMs();
    if (!response.ok) {
      throw new Error(`[data_loader] Failed to fetch ${label} at ${url} (${response.status} ${response.statusText}).`);
    }
    const rawText = await response.text();
    const fetchCompletedAt = nowMs();
    const parseStartedAt = fetchCompletedAt;
    try {
      const payload = rawText ? JSON.parse(rawText) : null;
      const parsedAt = nowMs();
      return {
        payload,
        metrics: {
          url,
          label,
          fetchMs: fetchCompletedAt - startedAt,
          jsonParseMs: parsedAt - parseStartedAt,
          totalMs: parsedAt - startedAt,
          transferMs: textLoadedAt - startedAt,
        },
      };
    } catch (error) {
      throw new Error(`[data_loader] Invalid JSON for ${label} at ${url}: ${error?.message || error}`);
    }
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error(`[data_loader] No JSON loader available for ${label}.`);
  }
  const payload = await d3Client.json(url);
  const finishedAt = nowMs();
  return {
    payload,
    metrics: {
      url,
      label,
      fetchMs: finishedAt - startedAt,
      jsonParseMs: 0,
      totalMs: finishedAt - startedAt,
      transferMs: finishedAt - startedAt,
    },
  };
}

async function loadExplicitVariant({
  topologyUrl,
  d3Client,
  variant,
} = {}) {
  const tried = new Set();
  const candidates = [];
  const enqueue = (url) => {
    if (!url || tried.has(url)) return;
    tried.add(url);
    candidates.push(url);
  };

  enqueue(variant?.url);
  enqueue(topologyUrl);

  const attempted = [];
  for (const url of candidates) {
    attempted.push(url);
    try {
      return await loadTopologyUrlWithMetrics(d3Client, url, "single");
    } catch (error) {
      console.warn(`[data_loader] Failed loading topology ${url}:`, error);
    }
  }

  throw new Error(`Unable to load topology dataset. Tried: ${attempted.join(", ") || topologyUrl}`);
}

async function loadDetailTopologyWithFallback({
  d3Client,
  detailSource,
  candidateKeys = null,
} = {}) {
  const orderedKeys = Array.from(new Set([
    ...(Array.isArray(candidateKeys) ? candidateKeys : []),
    detailSource?.key,
    ...DETAIL_SOURCE_FALLBACK_ORDER,
  ].filter((key) => key && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key))));

  const deduped = orderedKeys.map((key) => ({
    key,
    url: DETAIL_SOURCES[key],
  }));

  let firstError = null;
  for (const candidate of deduped) {
    try {
      const { topology, metrics } = await loadTopologyUrlWithMetrics(
        d3Client,
        candidate.url,
        `detail(${candidate.key})`
      );
      return { topology, sourceKey: candidate.key, metrics };
    } catch (error) {
      firstError = firstError || error;
      console.warn(
        `[data_loader] Detail topology (${candidate.key}) unavailable at ${candidate.url}.`,
        error
      );
    }
  }

  if (firstError) {
    console.warn("[data_loader] Detail topology could not be loaded from any candidate.");
  }
  return { topology: null, sourceKey: null };
}

async function loadTopologyBundle({
  topologyUrl,
  d3Client,
  renderProfile,
  prefetchedPrimaryTopology = null,
  prefetchedPrimaryMetrics = null,
} = {}) {
  const variant = resolveTopologyVariant();
  if (variant?.url) {
    console.info(
      `[data_loader] topology_variant=${variant.key} explicitly requested. Running single-topology mode.`
    );
    const single = await loadExplicitVariant({ topologyUrl, d3Client, variant });
    return {
      topology: single.topology,
      topologyPrimary: single.topology,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: variant.key,
      detailDeferred: false,
      detailSourceRequested: null,
      resourceMetrics: {
        topologyPrimary: single.metrics || null,
        topologyDetail: null,
      },
    };
  }

  const detailLayerEnabled = resolveDetailLayerEnabled();
  const detailSource = resolveDetailSource();
  const topologyPrimaryResult = prefetchedPrimaryTopology
    ? {
      topology: prefetchedPrimaryTopology,
      metrics: prefetchedPrimaryMetrics || null,
    }
    : await loadTopologyUrlWithMetrics(d3Client, topologyUrl, "primary");
  const topologyPrimary = topologyPrimaryResult.topology;

  if (!detailLayerEnabled) {
    console.info("[data_loader] detail_layer=off detected. Running coarse-only primary topology.");
    return {
      topology: topologyPrimary,
      topologyPrimary,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: null,
      detailDeferred: false,
      detailSourceRequested: detailSource.key,
      resourceMetrics: {
        topologyPrimary: topologyPrimaryResult.metrics || null,
        topologyDetail: null,
      },
    };
  }

  if (shouldDeferDetailLoad(renderProfile)) {
    console.info(
      `[data_loader] render_profile=${renderProfile} deferred detail loading. Starting in coarse-only primary mode.`
    );
    return {
      topology: topologyPrimary,
      topologyPrimary,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: null,
      detailDeferred: true,
      detailSourceRequested: detailSource.key,
      resourceMetrics: {
        topologyPrimary: topologyPrimaryResult.metrics || null,
        topologyDetail: null,
      },
    };
  }

  const { topology: topologyDetail, sourceKey: detailSourceUsed, metrics: topologyDetailMetrics } =
    await loadDetailTopologyWithFallback({
      d3Client,
      detailSource,
    });
  if (detailSourceUsed && detailSourceUsed !== detailSource.key) {
    console.info(
      `[data_loader] Detail topology fallback activated: requested=${detailSource.key}, using=${detailSourceUsed}.`
    );
  }

  const bundleMode = topologyDetail ? "composite" : "single";
  console.info(
    `[data_loader] Topology bundle mode: ${bundleMode}. primary=${getPoliticalGeometryCount(topologyPrimary)}, detail=${getPoliticalGeometryCount(topologyDetail)}`
  );
  return {
    topology: topologyPrimary,
    topologyPrimary,
    topologyDetail,
    topologyBundleMode: bundleMode,
    topologyVariant: null,
    detailDeferred: false,
    detailSourceRequested: detailSource.key,
    resourceMetrics: {
      topologyPrimary: topologyPrimaryResult.metrics || null,
      topologyDetail: topologyDetailMetrics || null,
    },
  };
}

function createDefaultStartupBootCacheState(enabled = false) {
  return {
    enabled: !!enabled,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  };
}

export async function loadStartupBootArtifacts({
  topologyUrl = "data/europe_topology.json",
  localesUrl = null,
  geoAliasesUrl = null,
  localeLevel = "startup",
  d3Client = globalThis.d3,
  useWorker = true,
  useStartupCache = true,
} = {}) {
  const resolvedLocalization = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  const startupBootCacheState = createDefaultStartupBootCacheState(
    useStartupCache && isStartupCacheEnabled()
  );
  const workerEnabled = useWorker && shouldUseStartupWorker();
  const localizationUsesScenarioScopedStartupFiles =
    isScenarioScopedLocalizationUrl(resolvedLocalization.localesUrl)
    || isScenarioScopedLocalizationUrl(resolvedLocalization.geoAliasesUrl);
  let buildManifest = null;

  if (startupBootCacheState.enabled) {
    try {
      buildManifest = await loadBuildManifest();
    } catch (error) {
      console.warn("[data_loader] Startup build manifest unavailable, bypassing persistent startup cache.", error);
      startupBootCacheState.enabled = false;
    }
  }
  if (startupBootCacheState.enabled && localizationUsesScenarioScopedStartupFiles) {
    startupBootCacheState.localization = "scenario-scoped";
  }

  const topologyCacheKey = startupBootCacheState.enabled
    ? createStartupBaseTopologyCacheKey({
      topologyUrl,
      buildManifest,
    })
    : "";
  const localizationCacheKey = startupBootCacheState.enabled && !localizationUsesScenarioScopedStartupFiles
    ? createStartupLocalizationCacheKey({
      localeLevel: resolvedLocalization.localeLevel,
      currentLanguage: state.currentLanguage || "en",
      localesUrl: resolvedLocalization.localesUrl,
      geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
      buildManifest,
    })
    : "";

  let topologyPrimary = null;
  let locales = null;
  let geoAliases = null;
  let decodedCollections = null;
  const resourceMetrics = {
    topologyPrimary: null,
    locales: null,
    geoAliases: null,
  };

  if (topologyCacheKey) {
    try {
      const cacheEntry = await readStartupCacheEntry(topologyCacheKey);
      if (cacheEntry?.payload?.topologyPrimary) {
        topologyPrimary = cacheEntry.payload.topologyPrimary;
        startupBootCacheState.baseTopology = "hit";
      } else {
        startupBootCacheState.baseTopology = "miss";
      }
    } catch (error) {
      console.warn("[data_loader] Startup base-topology cache read failed.", error);
      startupBootCacheState.baseTopology = "error";
    }
  }

  if (localizationCacheKey) {
    try {
      const cacheEntry = await readStartupCacheEntry(localizationCacheKey);
      if (cacheEntry?.payload?.locales && cacheEntry?.payload?.geoAliases) {
        locales = cacheEntry.payload.locales;
        geoAliases = cacheEntry.payload.geoAliases;
        startupBootCacheState.localization = "hit";
      } else {
        startupBootCacheState.localization = "miss";
      }
    } catch (error) {
      console.warn("[data_loader] Startup localization cache read failed.", error);
      startupBootCacheState.localization = "error";
    }
  }

  if (!topologyPrimary && workerEnabled) {
    try {
      const workerResult = await loadBaseStartupViaWorker({
        topologyUrl,
        localesUrl: resolvedLocalization.localesUrl,
        geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
        needTopologyPrimary: !topologyPrimary,
        needLocales: !locales,
        needGeoAliases: !geoAliases,
      });
      topologyPrimary = workerResult.topologyPrimary || null;
      locales = locales || workerResult.locales || null;
      geoAliases = geoAliases || workerResult.geoAliases || null;
      decodedCollections = workerResult.decodedCollections || null;
      resourceMetrics.topologyPrimary = resourceMetrics.topologyPrimary || workerResult.metrics?.topologyPrimary || null;
      resourceMetrics.locales = resourceMetrics.locales || workerResult.metrics?.locales || null;
      resourceMetrics.geoAliases = resourceMetrics.geoAliases || workerResult.metrics?.geoAliases || null;
    } catch (error) {
      console.warn("[data_loader] Startup worker failed for base artifacts, falling back to main thread.", error);
    }
  }

  if (!topologyPrimary) {
    const topologyResult = await loadMeasuredJsonResource(topologyUrl, {
      d3Client,
      label: "primary_topology",
    });
    topologyPrimary = topologyResult.payload || null;
    resourceMetrics.topologyPrimary = topologyResult.metrics || null;
  }

  if (!locales || !geoAliases) {
    const localizationBundle = await loadLocalizationData({
      d3Client,
      localeLevel: resolvedLocalization.localeLevel,
      localesUrl: resolvedLocalization.localesUrl,
      geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
    });
    locales = locales || localizationBundle.locales;
    geoAliases = geoAliases || localizationBundle.geoAliases;
    resourceMetrics.locales = resourceMetrics.locales || localizationBundle.resourceMetrics?.locales || null;
    resourceMetrics.geoAliases = resourceMetrics.geoAliases || localizationBundle.resourceMetrics?.geoAliases || null;
  }

  if (topologyCacheKey && topologyPrimary && startupBootCacheState.baseTopology !== "hit") {
    startupBootCacheState.baseTopology = "write-pending";
    void writeStartupCacheEntry({
      kind: "startup-base-topology",
      cacheKey: topologyCacheKey,
      payload: createSerializableStartupBaseTopologyPayload({ topologyPrimary }),
      keyParts: {
        topologyUrl,
      },
    }).then(() => {
      startupBootCacheState.baseTopology = "written";
    }).catch((error) => {
      console.warn("[data_loader] Startup base-topology cache write failed.", error);
      startupBootCacheState.baseTopology = "write-error";
    });
  }

  if (localizationCacheKey && locales && geoAliases && startupBootCacheState.localization !== "hit") {
    startupBootCacheState.localization = "write-pending";
    void writeStartupCacheEntry({
      kind: "startup-localization",
      cacheKey: localizationCacheKey,
      payload: createSerializableStartupLocalizationPayload({ locales, geoAliases }),
      keyParts: {
        localeLevel: resolvedLocalization.localeLevel,
        language: state.currentLanguage || "en",
      },
    }).then(() => {
      startupBootCacheState.localization = "written";
    }).catch((error) => {
      console.warn("[data_loader] Startup localization cache write failed.", error);
      startupBootCacheState.localization = "write-error";
    });
  }

  return {
    topologyPrimary,
    locales: locales || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    decodedCollections,
    hasScenarioRuntimeBootstrap: false,
    localeLevel: resolvedLocalization.localeLevel,
    resourceMetrics,
    startupBootCacheState,
    startupWorkerUsed: workerEnabled,
  };
}

export async function loadDeferredDetailBundle({
  d3Client = globalThis.d3,
  detailSourceKey = null,
  detailSourceKeys = null,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadDeferredDetailBundle().");
  }

  const fallbackDetailSource = resolveDetailSource();
  const resolvedKey =
    detailSourceKey && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, detailSourceKey)
      ? detailSourceKey
      : fallbackDetailSource.key;
  const detailSource = {
    key: resolvedKey,
    url: DETAIL_SOURCES[resolvedKey],
  };
  const orderedDetailSourceKeys = Array.from(new Set([
    ...(Array.isArray(detailSourceKeys) ? detailSourceKeys : []),
    resolvedKey,
    ...DETAIL_SOURCE_FALLBACK_ORDER,
  ].filter((key) => key && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key))));

  const [{ topology: topologyDetail, sourceKey: detailSourceUsed }, runtimePoliticalTopology] =
    await Promise.all([
      loadDetailTopologyWithFallback({
        d3Client,
        detailSource,
        candidateKeys: orderedDetailSourceKeys,
      }),
      d3Client.json(runtimePoliticalUrl).catch((err) => {
        console.warn("Runtime political topology missing or invalid during deferred load.", err);
        return null;
      }),
    ]);

  return {
    topologyDetail,
    runtimePoliticalTopology,
    topologyBundleMode: topologyDetail ? "composite" : "single",
    detailSourceUsed: detailSourceUsed || resolvedKey,
  };
}

export async function loadMapData({
  topologyUrl = "data/europe_topology.json",
  localesUrl = null,
  geoAliasesUrl = null,
  worldCitiesUrls = WORLD_CITIES_URLS,
  cityAliasesUrls = CITY_ALIASES_URLS,
  hierarchyUrl = "data/hierarchy.json",
  ruCityOverridesUrl = RU_CITY_OVERRIDES_URL,
  specialZonesUrl = SPECIAL_ZONES_URL,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
  paletteRegistryUrl = PALETTE_REGISTRY_URL,
  releasableCatalogUrl = RELEASABLE_CATALOG_URL,
  d3Client = globalThis.d3,
  includeCityData = true,
  includeContextLayers = true,
  localeLevel = "full",
  useStartupWorker = false,
  useStartupCache = false,
  startupBootArtifactsOverride = null,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadMapData().");
  }

  const renderProfile = resolveRenderProfile();
  const localizationUrls = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  const shouldUseStartupBootPath =
    normalizeLocaleLevel(localeLevel) === "startup" && (useStartupWorker || useStartupCache);
  const startupBootArtifactsPromise = startupBootArtifactsOverride
    ? Promise.resolve(startupBootArtifactsOverride)
    : (
      shouldUseStartupBootPath
        ? loadStartupBootArtifacts({
          topologyUrl,
          localesUrl,
          geoAliasesUrl,
          localeLevel,
          d3Client,
          useWorker: useStartupWorker,
          useStartupCache,
        })
        : Promise.resolve(null)
    );
  const hierarchyPromise = d3Client.json(hierarchyUrl).catch((err) => {
    console.warn("Hierarchy file missing or invalid, using defaults.", err);
    return null;
  });
  const paletteRegistryPromise = d3Client.json(paletteRegistryUrl).catch((err) => {
    console.warn("Palette registry missing or invalid, continuing with legacy palette fallback.", err);
    return null;
  });
  const paletteAssetsPromise = paletteRegistryPromise.then((paletteRegistry) => {
    if (!Array.isArray(paletteRegistry?.palettes) || paletteRegistry.palettes.length === 0) {
      return {
        activePaletteMeta: null,
        activePalettePack: null,
        activePaletteMap: null,
      };
    }
    const defaultPaletteId = String(
      paletteRegistry.default_palette_id || paletteRegistry.palettes[0]?.palette_id || ""
    ).trim();
    const activePaletteMeta =
      paletteRegistry.palettes.find((entry) => String(entry?.palette_id || "").trim() === defaultPaletteId)
      || paletteRegistry.palettes[0]
      || null;
    const paletteUrl = String(activePaletteMeta?.palette_url || "").trim();
    const mapUrl = String(activePaletteMeta?.map_url || "").trim();
    return Promise.all([
      paletteUrl
        ? d3Client.json(paletteUrl).catch((err) => {
          console.warn(`Palette pack missing or invalid at ${paletteUrl}, continuing without asset palette.`, err);
          return null;
        })
        : Promise.resolve(null),
      mapUrl
        ? d3Client.json(mapUrl).catch((err) => {
          console.warn(`Palette map missing or invalid at ${mapUrl}, continuing without asset palette mapping.`, err);
          return null;
        })
        : Promise.resolve(null),
    ]).then(([activePalettePack, activePaletteMap]) => ({
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
    }));
  });
  const releasableCatalogPromise = d3Client.json(releasableCatalogUrl).catch((err) => {
    console.warn("Releasable catalog missing or invalid, continuing without releasable overlays.", err);
    return null;
  });
  const contextLayerPackPromise = loadOptionalContextLayerPacks(d3Client, includeContextLayers);
  const ruCityOverridesPromise = d3Client.json(ruCityOverridesUrl).then((payload) => {
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] RU city overrides payload invalid at ${ruCityOverridesUrl}. Ignoring.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  }).catch((err) => {
    console.warn("RU city overrides file missing or invalid, continuing without overrides.", err);
    return null;
  });
  const specialZonesPromise = d3Client.json(specialZonesUrl).then((payload) => {
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] Special zones payload invalid at ${specialZonesUrl}. Ignoring.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  }).catch((err) => {
    console.warn("Special zones file missing or invalid, falling back to topology layer.", err);
    return null;
  });

  const cityDataPromises = includeCityData
    ? [
      loadOptionalJsonCandidate(d3Client, worldCitiesUrls, {
        label: "world_cities",
        normalizer: (payload) => normalizeCityFeatureCollection(payload, { sourceLabel: "world_cities" }),
      }),
      loadOptionalJsonCandidate(d3Client, cityAliasesUrls, {
        label: "city_aliases",
        normalizer: (payload) => (payload && typeof payload === "object" ? payload : null),
      }),
    ]
    : [Promise.resolve(null), Promise.resolve(null)];

  const localizationPromise = startupBootArtifactsPromise.then((startupBootArtifacts) => (
    startupBootArtifacts
      ? {
        localeLevel: startupBootArtifacts.localeLevel || localizationUrls.localeLevel,
        locales: startupBootArtifacts.locales,
        geoAliases: startupBootArtifacts.geoAliases,
        resourceMetrics: {
          locales: startupBootArtifacts.resourceMetrics?.locales || null,
          geoAliases: startupBootArtifacts.resourceMetrics?.geoAliases || null,
        },
      }
      : loadLocalizationData({
        d3Client,
        localeLevel: localizationUrls.localeLevel,
        localesUrl: localizationUrls.localesUrl,
        geoAliasesUrl: localizationUrls.geoAliasesUrl,
      })
  ));
  const topologyBundlePromise = startupBootArtifactsPromise.then((startupBootArtifacts) => (
    loadTopologyBundle({
      topologyUrl,
      d3Client,
      renderProfile,
      prefetchedPrimaryTopology: startupBootArtifacts?.topologyPrimary || null,
      prefetchedPrimaryMetrics: startupBootArtifacts?.resourceMetrics?.topologyPrimary || null,
    })
  ));
  const runtimePoliticalPromise = Promise.all([startupBootArtifactsPromise, topologyBundlePromise]).then(
    ([startupBootArtifacts, topologyBundle]) => {
      if (startupBootArtifacts?.hasScenarioRuntimeBootstrap || topologyBundle.detailDeferred) {
        return null;
      }
      return d3Client.json(runtimePoliticalUrl).catch((err) => {
        console.warn("Runtime political topology missing or invalid, continuing without dynamic sovereignty.", err);
        return null;
      });
    }
  );
  const [
    startupBootArtifacts,
    topologyBundle,
    localizationBundle,
    worldCities,
    cityAliases,
    hierarchy,
    ruCityOverrides,
    specialZones,
    runtimePoliticalTopology,
    paletteRegistry,
    paletteAssets,
    releasableCatalog,
    contextLayerExternal,
  ] = await Promise.all([
    startupBootArtifactsPromise,
    topologyBundlePromise,
    localizationPromise,
    ...cityDataPromises,
    hierarchyPromise,
    ruCityOverridesPromise,
    specialZonesPromise,
    runtimePoliticalPromise,
    paletteRegistryPromise,
    paletteAssetsPromise,
    releasableCatalogPromise,
    contextLayerPackPromise,
  ]);
  const localeData = localizationBundle.locales;
  const geoAliases = localizationBundle.geoAliases;
  const cityLocalizationMerged = mergeCityLocalizationData({
    locales: localeData || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    cityCollection: worldCities,
    cityAliases,
  });

  const activePaletteMeta = paletteAssets?.activePaletteMeta || null;
  const activePalettePack = paletteAssets?.activePalettePack || null;
  const activePaletteMap = paletteAssets?.activePaletteMap || null;

  return {
    ...topologyBundle,
    renderProfile,
    locales: cityLocalizationMerged.locales,
    geoAliases: cityLocalizationMerged.geoAliases,
    worldCities,
    cityAliases,
    hierarchy,
    ruCityOverrides,
    specialZones,
    runtimePoliticalTopology,
    paletteRegistry,
    releasableCatalog,
    contextLayerExternal,
    activePaletteMeta,
    activePalettePack,
    activePaletteMap,
    localeLevel: startupBootArtifacts?.localeLevel || localizationBundle.localeLevel || localizationUrls.localeLevel,
    startupBootCacheState: startupBootArtifacts?.startupBootCacheState || createDefaultStartupBootCacheState(false),
    startupWorkerUsed: !!startupBootArtifacts?.startupWorkerUsed,
    startupDecodedCollections: startupBootArtifacts?.decodedCollections || null,
    resourceMetrics: {
      ...(topologyBundle.resourceMetrics || {}),
      locales: localizationBundle.resourceMetrics?.locales || null,
      geoAliases: localizationBundle.resourceMetrics?.geoAliases || null,
    },
  };
}

export async function loadLocalizationData({
  d3Client = globalThis.d3,
  localeLevel = "full",
  localesUrl = null,
  geoAliasesUrl = null,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadLocalizationData().");
  }
  const resolved = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  const [localeResult, geoAliasResult] = await Promise.all([
    loadMeasuredJsonResource(resolved.localesUrl, {
      d3Client,
      label: `locales:${resolved.localeLevel}`,
    }).catch((err) => {
      console.warn("Locales file missing or invalid, using defaults.", err);
      return {
        payload: { ui: {}, geo: {} },
        metrics: {
          url: resolved.localesUrl,
          label: `locales:${resolved.localeLevel}`,
          fetchMs: 0,
          jsonParseMs: 0,
          totalMs: 0,
          transferMs: 0,
          failed: true,
        },
      };
    }),
    loadMeasuredJsonResource(resolved.geoAliasesUrl, {
      d3Client,
      label: `geo_aliases:${resolved.localeLevel}`,
    }).catch((err) => {
      console.warn("Geo alias file missing or invalid, using defaults.", err);
      return {
        payload: { alias_to_stable_key: {} },
        metrics: {
          url: resolved.geoAliasesUrl,
          label: `geo_aliases:${resolved.localeLevel}`,
          fetchMs: 0,
          jsonParseMs: 0,
          totalMs: 0,
          transferMs: 0,
          failed: true,
        },
      };
    }),
  ]);
  return {
    localeLevel: resolved.localeLevel,
    locales: localeResult.payload || { ui: {}, geo: {} },
    geoAliases: geoAliasResult.payload || { alias_to_stable_key: {} },
    resourceMetrics: {
      locales: localeResult.metrics || null,
      geoAliases: geoAliasResult.metrics || null,
    },
  };
}

export async function loadCitySupportData({
  d3Client = globalThis.d3,
  worldCitiesUrls = WORLD_CITIES_URLS,
  cityAliasesUrls = CITY_ALIASES_URLS,
  locales = { ui: {}, geo: {} },
  geoAliases = { alias_to_stable_key: {} },
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadCitySupportData().");
  }

  const [worldCities, cityAliases] = await Promise.all([
    loadOptionalJsonCandidate(d3Client, worldCitiesUrls, {
      label: "world_cities",
      normalizer: (payload) => normalizeCityFeatureCollection(payload, { sourceLabel: "world_cities" }),
    }),
    loadOptionalJsonCandidate(d3Client, cityAliasesUrls, {
      label: "city_aliases",
      normalizer: (payload) => (payload && typeof payload === "object" ? payload : null),
    }),
  ]);

  const merged = mergeCityLocalizationData({
    locales,
    geoAliases,
    cityCollection: worldCities,
    cityAliases,
  });

  return {
    worldCities,
    cityAliases,
    locales: merged.locales,
    geoAliases: merged.geoAliases,
    cityLocalizationPatch: merged.cityLocalizationPatch,
  };
}

export {
  buildCityLocalizationPatch,
  getCityLocaleEntry,
  loadContextLayerPackInternal as loadContextLayerPack,
  normalizeRequestedContextLayerNames,
  mergeCityLocalizationData,
  normalizeCityText,
  normalizeCityFeatureCollection,
  normalizeScenarioCityOverridesPayload,
  normalizeScenarioGeoLocalePatchPayload,
};

