export function getCountryNameOverride(state, code, language = state.currentLanguage) {
  return state.countryNameOverrides?.[code]?.[language === "zh" ? "zh" : "en"] || "";
}

export function setCountryNameOverride(state, code, language, value) {
  const key = language === "zh" ? "zh" : "en";
  const name = value.trim();
  if (getCountryNameOverride(state, code, key) === name) return false;
  const overrides = { ...state.countryNameOverrides };
  const names = { ...overrides[code] };
  if (name) names[key] = name;
  else delete names[key];
  if (Object.keys(names).length) overrides[code] = names;
  else delete overrides[code];
  state.countryNameOverrides = overrides;
  return true;
}
