import { state as runtimeState } from "./state.js";
const state = runtimeState;

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

export { getScenarioCountryDisplayName };

