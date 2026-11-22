import { normalizeCountryCodeAlias as canonicalCountryCode } from "./country_code_aliases.js";
import { callRuntimeHook } from "./state/index.js";
import { createCityTerritoryQuery, getCityTerritoryHostId, resolveCityHostId } from "./renderer/capital_visibility.js";
import { createCityLabelTextModel } from "./renderer/city_label_text_model.js";
import {
  getCityCanonicalId, getCityCapitalScore, getCityTier, getCityTierWeight, getDefaultCityMinZoomForTier,
} from "./renderer/city_reveal_policy.js";
import { createUrbanCityPolicyOwner } from "./renderer/urban_city_policy.js";

const PROJECT_CITY_PREFIX = "project_city_";

export function normalizeCapitalOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, entry] of Object.entries(raw)) {
    const tag = canonicalCountryCode(key);
    const cityId = entry?.cityId;
    if (tag && (cityId === null || (typeof cityId === "string" && cityId.trim()))) {
      result[tag] = { cityId: cityId?.trim() ?? null };
    }
  }
  return result;
}

function normalizeProjectCity(city, landIndex) {
  if (typeof city?.id !== "string" || !/^project_city_[1-9]\d*$/.test(city.id)
    || !Number.isSafeInteger(Number(city.id.slice(PROJECT_CITY_PREFIX.length)))
    || !Number.isFinite(city.lon) || Math.abs(city.lon) > 180
    || !Number.isFinite(city.lat) || Math.abs(city.lat) > 90) return null;
  const en = typeof city.name?.en === "string" ? city.name.en.trim() : "";
  const zh = typeof city.name?.zh === "string" ? city.name.zh.trim() : "";
  if (!en && !zh) return null;
  const hostId = typeof city.hostFeatureId === "string" ? city.hostFeatureId.trim() : "";
  return {
    id: city.id, name: { en: en || zh, zh: zh || en }, lon: city.lon, lat: city.lat,
    hostFeatureId: landIndex ? resolveCityHostId(landIndex, hostId, [city.lon, city.lat]) : hostId,
    tier: ["major", "regional", "minor"].includes(city.tier) ? city.tier : "minor",
  };
}

export function normalizeProjectCities(raw, landIndex) {
  const cities = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const city = normalizeProjectCity(entry, landIndex);
    if (city) cities.set(city.id, city);
  }
  return [...cities.values()];
}

export function baseCityNameOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides || {}).filter(([id]) => !id.startsWith(PROJECT_CITY_PREFIX)));
}

export function addProjectCity(state, entry) {
  const cities = state.projectCities || [];
  const reserved = new Set(Object.keys(state.cityNameOverrides || {}));
  for (const entry of [...(state.historyPast || []), ...(state.historyFuture || [])]) {
    for (const snapshot of [entry.before, entry.after]) {
      for (const city of snapshot?.projectCities || []) reserved.add(city.id);
      for (const id of Object.keys(snapshot?.cityNameOverrides || {})) reserved.add(id);
    }
  }
  let next = cities.reduce((max, city) => Math.max(max, Number(city.id.slice(PROJECT_CITY_PREFIX.length))), 0) + 1;
  while (Number.isSafeInteger(next) && reserved.has(`${PROJECT_CITY_PREFIX}${next}`)) next++;
  const city = normalizeProjectCity({ ...entry, id: `${PROJECT_CITY_PREFIX}${next}` }, state.landIndex);
  if (!city) return null;
  if (!city.hostFeatureId) return false;
  state.projectCities = [...cities, city];
  return city.id;
}

export function removeProjectCity(state, id) {
  if (!state.projectCities?.some(city => city.id === id)) return false;
  state.projectCities = state.projectCities.filter(city => city.id !== id);
  for (const [tag, entry] of Object.entries(state.capitalOverrides || {})) {
    if (entry.cityId === id) clearCapitalOverride(state, tag);
  }
  if (state.cityNameOverrides?.[id]) {
    const { [id]: removed, ...remaining } = state.cityNameOverrides;
    state.cityNameOverrides = remaining;
  }
  return true;
}

const queryOwners = new WeakMap();
function getCities(state, options) {
  if (options.cityCollection) return options.cityCollection.features;
  // 优先复用渲染器已合并好的城市集合；只有未注册（如单元测试）时才自建一份。
  const shared = callRuntimeHook(state, "getEffectiveCityCollectionFn");
  if (Array.isArray(shared?.features)) return shared.features;
  if (!queryOwners.has(state)) {
    const { getCityFeatureKey, getCityFeatureAliases } = createCityLabelTextModel(state, {});
    queryOwners.set(state, createUrbanCityPolicyOwner({ state, caches: { cityLayerCache: {} }, helpers: {
      getCityFeatureKey, getCityFeatureAliases, getCityCanonicalId, getCityCapitalScore,
      getCityTier, getCityTierWeight, getDefaultCityMinZoomForTier,
    } }));
  }
  return queryOwners.get(state).getEffectiveCityCollection()?.features || [];
}

function territoryQuery(state, options) {
  return createCityTerritoryQuery({
    state,
    resolveBorderIdentity: (id, feature) => callRuntimeHook(state, "resolveBorderIdentityFn", id, feature),
    getSuppressedCodes: () => callRuntimeHook(state, "getSuppressedCountryCodesFn"),
    ...options,
  });
}

export function findCapitalCityFeature(state, cityId, options = {}) {
  return getCities(state, options).find(feature => getCityCanonicalId(feature) === cityId);
}

export function isCityInCountryTerritory(state, rawTag, cityId, options = {}) {
  const tag = canonicalCountryCode(rawTag);
  if (!state.scenarioCountriesByTag?.[tag]) return false;
  const city = findCapitalCityFeature(state, cityId, options);
  return !!city && territoryQuery(state, options)(city, tag);
}

export function listCountryCities(state, rawTag, options = {}) {
  const tag = canonicalCountryCode(rawTag);
  if (!state.scenarioCountriesByTag?.[tag]) return [];
  const inCountry = territoryQuery(state, options);
  const entries = [];
  for (const city of getCities(state, options)) {
    const host = getCityTerritoryHostId(state, city);
    const id = getCityCanonicalId(city);
    if (!host && state.capitalOverrides?.[tag]?.cityId !== id) continue;
    const inTerritory = inCountry(city, tag, host);
    if (inTerritory || canonicalCountryCode(state.sovereigntyByFeatureId?.[host]) === tag
      || (!host && state.capitalOverrides?.[tag]?.cityId === id)) {
      entries.push({ id, feature: city, inTerritory });
    }
  }
  return entries;
}

export function pickLargestCity(state, tag, options = {}) {
  const candidates = listCountryCities(state, tag, options).filter(entry => entry.inTerritory);
  candidates.sort((a, b) => (b.feature.properties.__city_population || 0) - (a.feature.properties.__city_population || 0)
    || getCityTierWeight(b.feature) - getCityTierWeight(a.feature) || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}

export function setCapitalOverride(state, rawTag, cityId, options = {}) {
  const tag = canonicalCountryCode(rawTag);
  if (!state.scenarioCountriesByTag?.[tag] || state.capitalOverrides?.[tag]?.cityId === cityId) return false;
  if (cityId !== null && !isCityInCountryTerritory(state, tag, cityId, options)) return false;
  state.capitalOverrides = { ...state.capitalOverrides, [tag]: { cityId } };
  if (cityId && state.cityNameOverrides?.[cityId]?.hidden) {
    const overrides = { ...state.cityNameOverrides };
    const { hidden, ...entry } = overrides[cityId];
    if (Object.keys(entry).length) overrides[cityId] = entry;
    else delete overrides[cityId];
    state.cityNameOverrides = overrides;
  }
  return true;
}

export function clearCapitalOverride(state, rawTag) {
  const tag = canonicalCountryCode(rawTag);
  if (!Object.hasOwn(state.capitalOverrides || {}, tag)) return false;
  const { [tag]: removed, ...remaining } = state.capitalOverrides;
  state.capitalOverrides = remaining;
  return true;
}
