import {
  getCountryCode as getSharedFeatureCountryCode,
  getStableKey as getSharedFeatureStableKey,
} from "../feature_identity.js";

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
  const reject = (reason) => {
    throw new Error(`[city-contract] ${sourceLabel} feature ${index + 1}: ${reason}`);
  };
  if (!feature || typeof feature !== "object" || feature.type !== "Feature") {
    reject("expected Feature");
  }
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates)
    || ![2, 3].includes(coordinates.length)) {
    reject("expected Point coordinates");
  }
  if (!coordinates.every((value) => typeof value === "number" && Number.isFinite(value))) {
    reject("coordinates must be finite numbers");
  }
  if (Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) {
    reject("coordinates outside WGS84 bounds");
  }
  const props = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const rawId = props.id || props.city_id || props.cityId || props.stable_id || feature.id;
  if (rawId != null && typeof rawId !== "string"
    && !(typeof rawId === "number" && Number.isFinite(rawId))) reject("invalid city id");
  const id = normalizeCityText(rawId);
  if (!id) reject("missing explicit city id");

  const rawStableKey = props.stable_key || props.stableKey || props.locale_key || props.localeKey || `id::${id}`;
  if (typeof rawStableKey !== "string" || !rawStableKey.trim()) reject("invalid stable_key");
  const stableKey = normalizeCityText(rawStableKey);
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
  const countryCode = getSharedFeatureCountryCode(feature);

  return {
    ...feature,
    id,
    properties: {
      ...props,
      id,
      stable_key: stableKey,
      host_feature_id: hostFeatureId,
      urban_match_id: urbanMatchId,
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

function finishCityPreparation(iterator) {
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}

function* normalizeCityFeatureCollectionSteps(payload, { sourceLabel = "world_cities" } = {}) {
  if (!Array.isArray(payload?.features)) {
    return null;
  }
  const ids = new Set();
  const stableKeys = new Set();
  const features = new Array(payload.features.length);
  for (let index = 0; index < payload.features.length; index++) {
    if ((index + 1) % 128 === 0) yield;
    if (!(index in payload.features)) continue;
    const feature = payload.features[index];
    const normalized = normalizeCityFeature(feature, index, { sourceLabel });
    for (const [field, seen] of [["id", ids], ["stable_key", stableKeys]]) {
      const value = normalized.properties[field];
      if (seen.has(value)) {
        throw new Error(`[city-contract] ${sourceLabel} feature ${index + 1}: duplicate ${field}: ${value}`);
      }
      seen.add(value);
    }
    features[index] = normalized;
  }
  return {
    ...payload,
    type: "FeatureCollection",
    features,
  };
}

function normalizeCityFeatureCollection(payload, options) {
  return finishCityPreparation(normalizeCityFeatureCollectionSteps(payload, options));
}

function normalizeScenarioCityOverrideEntry(rawEntry, rawCityId = "") {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  const cityId = normalizeCityText(rawEntry.city_id || rawEntry.cityId || rawCityId);
  if (!cityId) return null;
  const stableKey = normalizeCityText(rawEntry.stable_key || rawEntry.stableKey || `id::${cityId}`);
  // A host/position/tier override is not a rename. An identity fallback here
  // becomes an explicit display_name and masks the base city's translations.
  const localeEntry = getCityLocaleEntry(rawEntry);
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

  const additionalFeatures = Object.values(cities)
    .filter((entry) => entry.add_city === true)
    .map((entry) => ({
      type: "Feature",
      properties: { ...entry, id: entry.city_id },
      geometry: { type: "Point", coordinates: [entry.lon, entry.lat] },
    }));
  const rawFeatures = [
    ...(Array.isArray(payload.feature_collection?.features) ? payload.feature_collection.features : []),
    ...additionalFeatures,
  ];
  const featureCollection = rawFeatures.length
    ? normalizeCityFeatureCollection({ type: "FeatureCollection", features: rawFeatures }, { sourceLabel: `${sourceLabel}:feature_collection` })
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
  // runtime 侧统一按 featureId -> { en, zh } 读取 locale patch。
  // 这里把磁盘上的宽松字段形态收口成稳定结构，避免 editor/save 链再各自兼容一次。
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

function* applyAliasObjectToPatch(rawAliasMap, aliasToStableKey) {
  if (!rawAliasMap || typeof rawAliasMap !== "object") return;
  let processed = 0;
  for (const rawAlias in rawAliasMap) {
    if (!Object.hasOwn(rawAliasMap, rawAlias)) continue;
    const rawStableKey = rawAliasMap[rawAlias];
    const alias = normalizeCityText(rawAlias);
    const stableKey = normalizeCityText(rawStableKey);
    if (alias && stableKey) aliasToStableKey[alias] = stableKey;
    if (++processed % 128 === 0) yield;
  }
}

function* applyGeoLocaleObjectToPatch(rawGeoMap, geo) {
  if (!rawGeoMap || typeof rawGeoMap !== "object") return;
  let processed = 0;
  for (const rawStableKey in rawGeoMap) {
    if (!Object.hasOwn(rawGeoMap, rawStableKey)) continue;
    if (++processed % 128 === 0) yield;
    const rawEntry = rawGeoMap[rawStableKey];
    const stableKey = normalizeCityText(rawStableKey);
    const localeEntry = getCityLocaleEntry(rawEntry, stableKey);
    if (!stableKey || !localeEntry) continue;
    // 多路 locale 来源会在这里汇流，所以保留“后写覆盖前写”的浅合并语义，
    // 让更具体的 patch/alias 扩展可以覆盖基础条目，而不必复制整份对象。
    geo[stableKey] = {
      ...(geo[stableKey] || {}),
      ...localeEntry,
    };
  }
}

function* applyCityAliasEntriesToPatch(entries, geo, aliasToStableKey) {
  entries = asArray(entries);
  for (let index = 0; index < entries.length; index++) {
    if ((index + 1) % 128 === 0) yield;
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const stableKey = normalizeCityText(
      entry.stable_key || entry.locale_key || entry.localeKey || entry.id || entry.city_id || `city_alias_${index + 1}`
    );
    if (!stableKey) continue;
    // Alias-only and metadata-only entries must not publish IDs as translations.
    const localeEntry = getCityLocaleEntry(entry);
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
  }
}

export function* buildCityLocalizationPatchSteps({ cityCollection = null, cityAliases = null } = {}) {
  const geo = {};
  const aliasToStableKey = {};

  let processed = 0;
  for (const feature of asArray(cityCollection?.features)) {
    if (++processed % 128 === 0) yield;
    const props = feature?.properties || {};
    const stableKey = normalizeCityText(getSharedFeatureStableKey(feature));
    if (!stableKey) continue;
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
  }

  yield* applyAliasObjectToPatch(cityAliases?.alias_to_stable_key, aliasToStableKey);
  yield* applyGeoLocaleObjectToPatch(cityAliases?.geo, geo);
  yield* applyGeoLocaleObjectToPatch(cityAliases?.locales?.geo, geo);
  yield* applyCityAliasEntriesToPatch(cityAliases?.entries, geo, aliasToStableKey);
  yield* applyCityAliasEntriesToPatch(cityAliases?.cities, geo, aliasToStableKey);
  yield* applyCityAliasEntriesToPatch(cityAliases?.aliases, geo, aliasToStableKey);

  return {
    geo,
    aliasToStableKey,
  };
}

function buildCityLocalizationPatch(options) {
  return finishCityPreparation(buildCityLocalizationPatchSteps(options));
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

export {
  buildCityLocalizationPatch,
  finishCityPreparation,
  getCityLocaleEntry,
  mergeCityLocalizationData,
  normalizeCityText,
  normalizeCityFeatureCollection,
  normalizeCityFeatureCollectionSteps,
  normalizeScenarioCityOverridesPayload,
  normalizeScenarioGeoLocalePatchPayload,
};
