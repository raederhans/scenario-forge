import { state as runtimeState } from "./state.js";
const state = runtimeState;

function getScenarioCountryOwnName(countryRecord = {}) {
  if (runtimeState.currentLanguage === "zh") {
    return String(countryRecord?.display_name_zh || countryRecord?.displayNameZh || "").trim();
  }
  return String(
    countryRecord?.display_name_en || countryRecord?.displayNameEn
    || countryRecord?.display_name || countryRecord?.displayName || ""
  ).trim();
}

function getScenarioCountryDisplayName(countryRecord = {}, fallback = "") {
  const legacyName = String(countryRecord?.display_name || countryRecord?.displayName || "").trim();
  const nameEn = String(countryRecord?.display_name_en || countryRecord?.displayNameEn || legacyName || "").trim();
  const nameZh = String(countryRecord?.display_name_zh || countryRecord?.displayNameZh || "").trim();
  const normalizedFallback = String(fallback || "").trim();
  if (runtimeState.currentLanguage === "zh") {
    return nameZh || nameEn || legacyName || normalizedFallback;
  }
  return nameEn || legacyName || nameZh || normalizedFallback;
}

// The scenario's own name in the current language is final. Only a fallback
// name goes through the geo dictionary: looking up an already localized name
// can hit an alias of a different place (伯利兹 is also an alias of Belize City).
function getLocalizedScenarioCountryName(countryRecord = {}, fallback = "", translateGeo = null) {
  const ownName = getScenarioCountryOwnName(countryRecord);
  if (ownName) return ownName;
  const name = getScenarioCountryDisplayName(countryRecord, fallback);
  return (name && typeof translateGeo === "function" ? translateGeo(name) : "") || name;
}

export { getLocalizedScenarioCountryName, getScenarioCountryDisplayName, getScenarioCountryOwnName };
