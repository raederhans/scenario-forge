const SCENARIO_BUNDLE_LEVELS = new Set(["bootstrap", "full"]);
const SCENARIO_LOAD_TIMEOUT_MS = 12_000;

function cacheBust(url) {
  if (!url) return url;
  if (!shouldBypassScenarioCache()) {
    return url;
  }
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}_t=${Date.now()}`;
}

function getSearchParams() {
  try {
    return new URLSearchParams(globalThis.location?.search || "");
  } catch (_error) {
    return null;
  }
}

function shouldBypassScenarioCache() {
  const params = getSearchParams();
  if (!params) return false;
  const raw = String(params.get("dev_nocache") || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function normalizeScenarioBundleLevel(value, fallback = "full") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return SCENARIO_BUNDLE_LEVELS.has(normalized) ? normalized : "full";
}

function getScenarioBundleHydrationRank(bundleLevel) {
  return normalizeScenarioBundleLevel(bundleLevel) === "full" ? 2 : 1;
}

function scenarioBundleSatisfiesLevel(bundle, requestedLevel) {
  return getScenarioBundleHydrationRank(bundle?.bundleLevel) >= getScenarioBundleHydrationRank(requestedLevel);
}

function normalizeScenarioCoreTag(rawValue) {
  return String(rawValue || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeScenarioCoreValue(rawValue) {
  if (Array.isArray(rawValue)) {
    const seen = new Set();
    const tags = [];
    rawValue.forEach((entry) => {
      const tag = normalizeScenarioCoreTag(entry);
      if (!tag || seen.has(tag)) return;
      seen.add(tag);
      tags.push(tag);
    });
    return tags;
  }
  const text = String(rawValue || "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text.replace(/'/g, "\""));
      if (Array.isArray(parsed)) {
        return normalizeScenarioCoreValue(parsed);
      }
    } catch (_error) {
      const inner = text.slice(1, -1).trim();
      if (inner) {
        return normalizeScenarioCoreValue(
          inner
            .split(",")
            .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean)
        );
      }
    }
  }
  const normalized = normalizeScenarioCoreTag(text);
  return normalized ? [normalized] : [];
}

function normalizeScenarioCoreMap(rawMap, { normalizeFeatureText = (value) => String(value || "").trim() } = {}) {
  const cores = {};
  Object.entries(rawMap && typeof rawMap === "object" ? rawMap : {}).forEach(([rawFeatureId, rawValue]) => {
    const featureId = normalizeFeatureText(rawFeatureId);
    const coreTags = normalizeScenarioCoreValue(rawValue);
    if (!featureId || !coreTags.length) return;
    cores[featureId] = coreTags;
  });
  return cores;
}

function withScenarioLoadTimeout(promise, ms, { scenarioId = "", resourceLabel = "resource" } = {}) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`[scenario] Timed out loading "${resourceLabel}" for "${scenarioId}" after ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function loadScenarioJsonWithTimeout(
  loadMeasuredJsonResourceFn,
  d3Client,
  url,
  { scenarioId = "", resourceLabel = "resource" } = {}
) {
  return withScenarioLoadTimeout(
    loadMeasuredJsonResourceFn(cacheBust(url), {
      d3Client,
      label: `scenario:${resourceLabel}`,
    }).then((result) => result.payload),
    SCENARIO_LOAD_TIMEOUT_MS,
    { scenarioId, resourceLabel }
  );
}

function loadScenarioJsonResourceWithTimeout(
  loadMeasuredJsonResourceFn,
  d3Client,
  url,
  { scenarioId = "", resourceLabel = "resource" } = {}
) {
  return withScenarioLoadTimeout(
    loadMeasuredJsonResourceFn(cacheBust(url), {
      d3Client,
      label: `scenario:${resourceLabel}`,
    }),
    SCENARIO_LOAD_TIMEOUT_MS,
    { scenarioId, resourceLabel }
  );
}

function validateScenarioRequiredResourcePayload(
  payload,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`[scenario] Required resource "${resourceLabel}" for "${scenarioId}" returned an invalid payload.`);
  }
  if (requiredField && (!payload[requiredField] || typeof payload[requiredField] !== "object")) {
    throw new Error(
      `[scenario] Required resource "${resourceLabel}" for "${scenarioId}" is missing "${requiredField}".`
    );
  }
  return payload;
}

async function loadRequiredScenarioResource(
  loadMeasuredJsonResourceFn,
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!url) {
    throw new Error(`[scenario] Required resource "${resourceLabel}" is missing for "${scenarioId}".`);
  }
  const payload = await loadScenarioJsonWithTimeout(loadMeasuredJsonResourceFn, d3Client, url, {
    scenarioId,
    resourceLabel,
  });
  return validateScenarioRequiredResourcePayload(payload, {
    scenarioId,
    resourceLabel,
    requiredField,
  });
}

async function loadOptionalScenarioResource(
  loadMeasuredJsonResourceFn,
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
  } = {}
) {
  if (!url) {
    return {
      ok: false,
      value: null,
      reason: "missing_url",
      errorMessage: "",
    };
  }
  try {
    const result = await loadScenarioJsonResourceWithTimeout(loadMeasuredJsonResourceFn, d3Client, url, {
      scenarioId,
      resourceLabel,
    });
    return {
      ok: true,
      value: result.payload ?? null,
      metrics: result.metrics || null,
      reason: "loaded",
      errorMessage: "",
    };
  } catch (error) {
    const errorMessage = String(error?.message || `Failed to load optional resource "${resourceLabel}".`);
    console.warn(`[scenario] Failed to load optional resource "${resourceLabel}" for "${scenarioId}".`, error);
    return {
      ok: false,
      value: null,
      metrics: null,
      reason: errorMessage.includes("Timed out") ? "timeout" : "load_error",
      errorMessage,
    };
  }
}

async function loadMeasuredRequiredScenarioResource(
  loadMeasuredJsonResourceFn,
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!url) {
    throw new Error(`[scenario] Required resource "${resourceLabel}" is missing for "${scenarioId}".`);
  }
  const result = await loadScenarioJsonResourceWithTimeout(loadMeasuredJsonResourceFn, d3Client, url, {
    scenarioId,
    resourceLabel,
  });
  return {
    payload: validateScenarioRequiredResourcePayload(result.payload, {
      scenarioId,
      resourceLabel,
      requiredField,
    }),
    metrics: result.metrics || null,
  };
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
}

function normalizeScenarioLanguage(value) {
  return String(value || "").trim().toLowerCase() === "zh" ? "zh" : "en";
}

function getScenarioGeoLocalePatchDescriptor(manifest, language) {
  const normalizedLanguage = normalizeScenarioLanguage(language);
  const localeSpecificUrl = String(
    normalizedLanguage === "zh"
      ? manifest?.geo_locale_patch_url_zh || ""
      : manifest?.geo_locale_patch_url_en || ""
  ).trim();
  if (localeSpecificUrl) {
    return {
      url: localeSpecificUrl,
      language: normalizedLanguage,
      localeSpecific: true,
    };
  }
  return {
    url: String(manifest?.geo_locale_patch_url || "").trim(),
    language: normalizedLanguage,
    localeSpecific: false,
  };
}

export {
  cacheBust,
  getSearchParams,
  shouldBypassScenarioCache,
  normalizeScenarioBundleLevel,
  getScenarioBundleHydrationRank,
  scenarioBundleSatisfiesLevel,
  normalizeScenarioCoreTag,
  normalizeScenarioCoreValue,
  normalizeScenarioCoreMap,
  withScenarioLoadTimeout,
  loadScenarioJsonWithTimeout,
  loadScenarioJsonResourceWithTimeout,
  validateScenarioRequiredResourcePayload,
  loadRequiredScenarioResource,
  loadOptionalScenarioResource,
  loadMeasuredRequiredScenarioResource,
  normalizeScenarioId,
  normalizeScenarioLanguage,
  getScenarioGeoLocalePatchDescriptor,
};
