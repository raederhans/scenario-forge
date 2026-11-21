import { getCityCanonicalId } from "./renderer/city_reveal_policy.js";

export function getCityOverrideId(feature) {
  return getCityCanonicalId(feature) || String(feature?.properties?.__city_stable_key || feature?.properties?.stable_key || "").trim();
}

export function setCityNameOverride(state, cityId, field, value) {
  const current = state.cityNameOverrides?.[cityId];
  const next = field === "hidden" ? value === true : value.trim();
  if ((current?.[field] || (field === "hidden" ? false : "")) === next) return false;
  const entry = { ...current };
  if (next) entry[field] = next;
  else delete entry[field];
  const overrides = { ...state.cityNameOverrides, [cityId]: entry };
  if (!Object.keys(entry).length) delete overrides[cityId];
  state.cityNameOverrides = overrides;
  return true;
}
