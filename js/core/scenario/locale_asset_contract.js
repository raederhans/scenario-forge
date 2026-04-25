// Shared filenames and manifest field names for scenario locale startup assets.
// Runtime modules import this contract instead of repeating literal asset names.

export const SCENARIO_LOCALE_LANGUAGES = Object.freeze(["en", "zh"]);

export const SCENARIO_STARTUP_LOCALES_FILENAME = "locales.startup.json";
export const SCENARIO_STARTUP_GEO_ALIASES_FILENAME = "geo_aliases.startup.json";

export const SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD = "geo_locale_patch_url";
export const SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS = Object.freeze({
  en: "geo_locale_patch_url_en",
  zh: "geo_locale_patch_url_zh",
});

export const SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS = Object.freeze({
  en: "startup_bundle_url_en",
  zh: "startup_bundle_url_zh",
});

export function normalizeScenarioLocaleLanguage(value) {
  return String(value || "").trim().toLowerCase() === "zh" ? "zh" : "en";
}

export function getScenarioStartupBundleFilename(language) {
  return `startup.bundle.${normalizeScenarioLocaleLanguage(language)}.json`;
}
