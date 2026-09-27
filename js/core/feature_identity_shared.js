// 这份 helper 必须同时兼容：
// 1. 主线程 ESM import
// 2. startup_boot.worker.js 里的 importScripts
// 所以这里保持纯脚本语法，并把 API 挂到 globalThis。

var SCENARIO_FORGE_FEATURE_IDENTITY_SHARED = (() => {
  const FEATURE_ID_KEYS = Object.freeze(["id", "NUTS_ID"]);
  const COUNTRY_CODE_KEYS = Object.freeze([
    "cntr_code",
    "CNTR_CODE",
    "CNTR",
    "iso_a2",
    "ISO_A2",
    "iso_a2_eh",
    "ISO_A2_EH",
    "adm0_a2",
    "ADM0_A2",
    "country_code",
    "countryCode",
    "__city_country_code",
  ]);
  const STABLE_KEY_KEYS = Object.freeze([
    "__city_stable_key",
    "stable_key",
    "stableKey",
    "locale_key",
    "localeKey",
    "__city_id",
    "id",
    "NUTS_ID",
    "__city_host_feature_id",
  ]);
  const RESERVED_COUNTRY_CODES = new Set(["ZZ", "XX"]);

  function getFeatureProperties(featureLike) {
    return featureLike && typeof featureLike === "object" ? (featureLike.properties || {}) : {};
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function pickFirstText(source, keys) {
    for (const key of keys) {
      const text = normalizeText(source?.[key]);
      if (text) return text;
    }
    return "";
  }

  function normalizeFeatureIdentityOptions(options = {}) {
    return options && typeof options === "object" ? options : {};
  }

  function defaultCountryCodeNormalizer(rawCode) {
    return normalizeText(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function isCountryCodeLike(value) {
    return /^[A-Z0-9]{2,3}$/.test(value) && /[A-Z]/.test(value);
  }

  function isDerivedCountryCodeLike(value) {
    return /^[A-Z]{2,3}$/.test(value);
  }

  function extractCountryCodeFromId(value) {
    const text = normalizeText(value).toUpperCase();
    if (!text) return "";
    const prefix = text.split(/[-_]/)[0];
    if (isDerivedCountryCodeLike(prefix)) return prefix;
    const match = prefix.match(/^[A-Z]{2,3}/)?.[0] || "";
    return isDerivedCountryCodeLike(match) ? match : "";
  }

  function normalizeFeatureCountryCode(rawCode, options = {}) {
    const {
      allowReserved = false,
      normalizeAlias = defaultCountryCodeNormalizer,
    } = normalizeFeatureIdentityOptions(options);
    const code = normalizeAlias(rawCode);
    if (!isCountryCodeLike(code)) return "";
    if (!allowReserved && RESERVED_COUNTRY_CODES.has(code)) return "";
    return code;
  }

  function getFeatureId(featureOrId, options = {}) {
    const { fallback = "" } = normalizeFeatureIdentityOptions(options);
    if (typeof featureOrId === "string" || typeof featureOrId === "number") {
      return normalizeText(featureOrId) || normalizeText(fallback);
    }
    const props = getFeatureProperties(featureOrId);
    return (
      pickFirstText(props, FEATURE_ID_KEYS) ||
      normalizeText(featureOrId?.id) ||
      normalizeText(fallback)
    );
  }

  function getCountryCode(featureLike, options = {}) {
    const {
      allowReserved = false,
      fallbackCountryCode = "",
      fallbackId = "",
      normalizeAlias = defaultCountryCodeNormalizer,
      useIdFallback = true,
    } = normalizeFeatureIdentityOptions(options);
    const props = getFeatureProperties(featureLike);
    const direct = normalizeFeatureCountryCode(pickFirstText(props, COUNTRY_CODE_KEYS), {
      allowReserved,
      normalizeAlias,
    });
    if (direct) return direct;
    const fallbackCode = normalizeFeatureCountryCode(fallbackCountryCode, {
      allowReserved,
      normalizeAlias,
    });
    if (fallbackCode) return fallbackCode;
    if (!useIdFallback) return "";
    return normalizeFeatureCountryCode(
      extractCountryCodeFromId(pickFirstText(props, FEATURE_ID_KEYS)) ||
        extractCountryCodeFromId(featureLike?.id) ||
        extractCountryCodeFromId(fallbackId),
      { allowReserved, normalizeAlias }
    );
  }

  function getStableKey(featureLike, options = {}) {
    const { fallback = "", useIdFallback = true } = normalizeFeatureIdentityOptions(options);
    const props = getFeatureProperties(featureLike);
    const direct = pickFirstText(props, STABLE_KEY_KEYS);
    if (direct) return direct;
    if (useIdFallback) {
      const id = normalizeText(featureLike?.id);
      if (id) return id;
    }
    return normalizeText(fallback);
  }

  return Object.freeze({
    COUNTRY_CODE_KEYS,
    FEATURE_ID_KEYS,
    RESERVED_COUNTRY_CODES,
    STABLE_KEY_KEYS,
    defaultCountryCodeNormalizer,
    extractCountryCodeFromId,
    getCountryCode,
    getFeatureId,
    getStableKey,
    isDerivedCountryCodeLike,
    isCountryCodeLike,
    normalizeFeatureCountryCode,
    normalizeFeatureIdentityOptions,
    normalizeText,
    pickFirstText,
  });
})();

globalThis.__scenarioForgeFeatureIdentityShared = SCENARIO_FORGE_FEATURE_IDENTITY_SHARED;
