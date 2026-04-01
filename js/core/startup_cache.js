const STARTUP_CACHE_DB_NAME = "mapcreator-startup-cache";
const STARTUP_CACHE_DB_VERSION = 1;
const STARTUP_CACHE_STORE_NAME = "entries";
const STARTUP_CACHE_KIND_INDEX = "by_kind";
const STARTUP_CACHE_UPDATED_AT_INDEX = "by_updated_at";
const DEFAULT_BUILD_MANIFEST_URL = "data/manifest.json";
const BUILD_MANIFEST_PROXY_OUTPUT_BY_URL = {
  "data/locales.startup.json": "locales.json",
  "data/geo_aliases.startup.json": "geo_aliases.json",
};

export const BOOT_CACHE_SCHEMA_VERSION = 2;
export const BASE_DATA_CACHE_REVISION = 1;
export const STARTUP_CACHE_KINDS = Object.freeze({
  BASE_TOPOLOGY: "startup-base-topology",
  LOCALIZATION: "startup-localization",
  SCENARIO_BOOTSTRAP: "startup-scenario-bootstrap",
  SCENARIO_BOOTSTRAP_CORE: "startup-scenario-bootstrap-core",
  SCENARIO_BOOTSTRAP_LOCALE: "startup-scenario-bootstrap-locale",
});

let openDbPromise = null;
let buildManifestPromise = null;

function getNowIso() {
  return new Date().toISOString();
}

function getSearchParams(search = null) {
  try {
    const source = typeof search === "string" ? search : (globalThis.location?.search || "");
    return new URLSearchParams(source);
  } catch (_error) {
    return new URLSearchParams();
  }
}

function parseToggleParam(value, fallback = null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeCacheKeyPart(value, fallback = "") {
  const text = normalizeText(value);
  return text || fallback;
}

function normalizeCacheKind(kind) {
  const normalized = normalizeText(kind);
  if (Object.values(STARTUP_CACHE_KINDS).includes(normalized)) {
    return normalized;
  }
  throw new Error(`[startup_cache] Unknown cache kind: ${kind}`);
}

function normalizeOutputLookupKey(url) {
  const raw = normalizeText(url).split(/[?#]/, 1)[0];
  if (!raw) return "";
  const proxy = BUILD_MANIFEST_PROXY_OUTPUT_BY_URL[raw];
  if (proxy) return proxy;
  const lastSlash = raw.lastIndexOf("/");
  return lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
}

function shallowCloneObject(value) {
  return value && typeof value === "object" ? { ...value } : {};
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createRequestPromise(requestFactory) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = requestFactory();
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function createTransactionDonePromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function openStartupCacheDb() {
  if (openDbPromise) return openDbPromise;
  openDbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = globalThis.indexedDB.open(STARTUP_CACHE_DB_NAME, STARTUP_CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STARTUP_CACHE_STORE_NAME)
        ? request.transaction.objectStore(STARTUP_CACHE_STORE_NAME)
        : db.createObjectStore(STARTUP_CACHE_STORE_NAME, { keyPath: "cacheKey" });
      if (!store.indexNames.contains(STARTUP_CACHE_KIND_INDEX)) {
        store.createIndex(STARTUP_CACHE_KIND_INDEX, "kind", { unique: false });
      }
      if (!store.indexNames.contains(STARTUP_CACHE_UPDATED_AT_INDEX)) {
        store.createIndex(STARTUP_CACHE_UPDATED_AT_INDEX, "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB startup cache."));
    request.onblocked = () => reject(new Error("IndexedDB startup cache is blocked by another connection."));
  }).catch((error) => {
    openDbPromise = null;
    throw error;
  });
  return openDbPromise;
}

export function shouldBypassStartupCache(search = null) {
  const params = getSearchParams(search);
  if (parseToggleParam(params.get("dev_nocache"), false) === true) {
    return true;
  }
  if (parseToggleParam(params.get("startup_cache"), true) === false) {
    return true;
  }
  return false;
}

export function isStartupCacheEnabled(search = null) {
  return !shouldBypassStartupCache(search);
}

export async function loadBuildManifest({
  manifestUrl = DEFAULT_BUILD_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  forceReload = false,
} = {}) {
  if (!forceReload && buildManifestPromise) {
    return buildManifestPromise;
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("[startup_cache] fetch is not available for build manifest loading.");
  }
  buildManifestPromise = fetchImpl(manifestUrl, {
    cache: "default",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`[startup_cache] Failed to load build manifest at ${manifestUrl} (${response.status} ${response.statusText}).`);
      }
      return response.json();
    })
    .catch((error) => {
      buildManifestPromise = null;
      throw error;
    });
  return buildManifestPromise;
}

export function getBuildManifestOutput(buildManifest, url, { fallbackOutputKey = "" } = {}) {
  const outputs = buildManifest?.outputs && typeof buildManifest.outputs === "object"
    ? buildManifest.outputs
    : null;
  if (!outputs) return null;
  const outputKey = normalizeOutputLookupKey(url) || normalizeCacheKeyPart(fallbackOutputKey);
  if (outputKey && outputs[outputKey]) {
    return outputs[outputKey];
  }
  const normalizedUrl = normalizeText(url);
  if (!normalizedUrl) return null;
  return Object.entries(outputs).find(([key]) => normalizedUrl.endsWith(key))?.[1] || null;
}

export function getBuildManifestOutputSha(buildManifest, url, { fallbackOutputKey = "" } = {}) {
  return normalizeText(getBuildManifestOutput(buildManifest, url, { fallbackOutputKey })?.sha256);
}

export function createStartupBaseTopologyCacheKey({
  topologyUrl = "",
  topologyVariant = "",
  buildManifest = null,
  schemaVersion = BOOT_CACHE_SCHEMA_VERSION,
  baseDataRevision = BASE_DATA_CACHE_REVISION,
} = {}) {
  const version = normalizeCacheKeyPart(buildManifest?.version, "1");
  const generatedAt = normalizeCacheKeyPart(buildManifest?.generated_at, "unknown");
  const sha = normalizeCacheKeyPart(getBuildManifestOutputSha(buildManifest, topologyUrl), "missing-sha");
  return [
    STARTUP_CACHE_KINDS.BASE_TOPOLOGY,
    `schema=${schemaVersion}`,
    `base=${baseDataRevision}`,
    `topology=${normalizeCacheKeyPart(topologyUrl, "unknown")}`,
    `variant=${normalizeCacheKeyPart(topologyVariant, "default")}`,
    `manifest=${version}`,
    `generated=${generatedAt}`,
    `sha=${sha}`,
  ].join("|");
}

export function createStartupLocalizationCacheKey({
  localeLevel = "startup",
  currentLanguage = "en",
  localesUrl = "",
  geoAliasesUrl = "",
  buildManifest = null,
  schemaVersion = BOOT_CACHE_SCHEMA_VERSION,
  baseDataRevision = BASE_DATA_CACHE_REVISION,
} = {}) {
  const localeSha = normalizeCacheKeyPart(
    getBuildManifestOutputSha(buildManifest, localesUrl, { fallbackOutputKey: "locales.json" }),
    "missing-locales-sha"
  );
  const aliasSha = normalizeCacheKeyPart(
    getBuildManifestOutputSha(buildManifest, geoAliasesUrl, { fallbackOutputKey: "geo_aliases.json" }),
    "missing-alias-sha"
  );
  return [
    STARTUP_CACHE_KINDS.LOCALIZATION,
    `schema=${schemaVersion}`,
    `base=${baseDataRevision}`,
    `localeLevel=${normalizeCacheKeyPart(localeLevel, "startup")}`,
    `lang=${normalizeCacheKeyPart(currentLanguage, "en")}`,
    `locales=${normalizeCacheKeyPart(localesUrl, "unknown")}`,
    `geoAliases=${normalizeCacheKeyPart(geoAliasesUrl, "unknown")}`,
    `localeSha=${localeSha}`,
    `aliasSha=${aliasSha}`,
  ].join("|");
}

export function createStartupScenarioBootstrapCacheKey({
  scenarioRegistry = null,
  scenarioId = "",
  bundleLevel = "bootstrap",
  manifest = null,
  currentLanguage = "en",
  runtimeBootstrapTopologyUrl = "",
  geoLocalePatchUrl = "",
  schemaVersion = BOOT_CACHE_SCHEMA_VERSION,
} = {}) {
  return [
    STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP,
    `schema=${schemaVersion}`,
    `registry=${normalizeCacheKeyPart(scenarioRegistry?.version, "1")}`,
    `scenario=${normalizeCacheKeyPart(scenarioId, "unknown")}`,
    `bundle=${normalizeCacheKeyPart(bundleLevel, "bootstrap")}`,
    `manifest=${normalizeCacheKeyPart(manifest?.version, "1")}`,
    `baseline=${normalizeCacheKeyPart(manifest?.baseline_hash, "no-baseline")}`,
    `generated=${normalizeCacheKeyPart(manifest?.generated_at, "unknown")}`,
    `lang=${normalizeCacheKeyPart(currentLanguage, "en")}`,
    `runtime=${normalizeCacheKeyPart(runtimeBootstrapTopologyUrl, "unknown")}`,
    `patch=${normalizeCacheKeyPart(geoLocalePatchUrl, "none")}`,
  ].join("|");
}

export function createStartupScenarioBootstrapCoreCacheKey({
  scenarioRegistry = null,
  scenarioId = "",
  bundleLevel = "bootstrap",
  manifest = null,
  runtimeBootstrapTopologyUrl = "",
  schemaVersion = BOOT_CACHE_SCHEMA_VERSION,
} = {}) {
  return [
    STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_CORE,
    `schema=${schemaVersion}`,
    `registry=${normalizeCacheKeyPart(scenarioRegistry?.version, "1")}`,
    `scenario=${normalizeCacheKeyPart(scenarioId, "unknown")}`,
    `bundle=${normalizeCacheKeyPart(bundleLevel, "bootstrap")}`,
    `manifest=${normalizeCacheKeyPart(manifest?.version, "1")}`,
    `baseline=${normalizeCacheKeyPart(manifest?.baseline_hash, "no-baseline")}`,
    `generated=${normalizeCacheKeyPart(manifest?.generated_at, "unknown")}`,
    `runtime=${normalizeCacheKeyPart(runtimeBootstrapTopologyUrl, "unknown")}`,
  ].join("|");
}

export function createStartupScenarioBootstrapLocaleCacheKey({
  scenarioRegistry = null,
  scenarioId = "",
  bundleLevel = "bootstrap",
  manifest = null,
  currentLanguage = "en",
  geoLocalePatchUrl = "",
  schemaVersion = BOOT_CACHE_SCHEMA_VERSION,
} = {}) {
  return [
    STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_LOCALE,
    `schema=${schemaVersion}`,
    `registry=${normalizeCacheKeyPart(scenarioRegistry?.version, "1")}`,
    `scenario=${normalizeCacheKeyPart(scenarioId, "unknown")}`,
    `bundle=${normalizeCacheKeyPart(bundleLevel, "bootstrap")}`,
    `manifest=${normalizeCacheKeyPart(manifest?.version, "1")}`,
    `baseline=${normalizeCacheKeyPart(manifest?.baseline_hash, "no-baseline")}`,
    `generated=${normalizeCacheKeyPart(manifest?.generated_at, "unknown")}`,
    `lang=${normalizeCacheKeyPart(currentLanguage, "en")}`,
    `patch=${normalizeCacheKeyPart(geoLocalePatchUrl, "none")}`,
  ].join("|");
}

export function createSerializableStartupBaseTopologyPayload({ topologyPrimary = null } = {}) {
  if (!topologyPrimary || typeof topologyPrimary !== "object") {
    throw new Error("[startup_cache] topologyPrimary is required for startup-base-topology cache payload.");
  }
  return {
    topologyPrimary,
  };
}

export function createSerializableStartupLocalizationPayload({ locales = null, geoAliases = null } = {}) {
  return {
    locales: clonePlainObject(locales || { ui: {}, geo: {} }) || { ui: {}, geo: {} },
    geoAliases: clonePlainObject(geoAliases || { alias_to_stable_key: {} }) || { alias_to_stable_key: {} },
  };
}

export function createSerializableStartupScenarioBootstrapPayload({
  manifest = null,
  bundleLevel = "bootstrap",
  countriesPayload = null,
  ownersPayload = null,
  controllersPayload = null,
  coresPayload = null,
  geoLocalePatchPayload = null,
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  return {
    manifest: clonePlainObject(manifest),
    bundleLevel: normalizeCacheKeyPart(bundleLevel, "bootstrap"),
    countriesPayload: clonePlainObject(countriesPayload),
    ownersPayload: clonePlainObject(ownersPayload),
    controllersPayload: clonePlainObject(controllersPayload),
    coresPayload: clonePlainObject(coresPayload),
    geoLocalePatchPayload: clonePlainObject(geoLocalePatchPayload),
    runtimeTopologyPayload: clonePlainObject(runtimeTopologyPayload),
    runtimePoliticalMeta: clonePlainObject(runtimePoliticalMeta),
  };
}

export function createSerializableStartupScenarioBootstrapCorePayload({
  manifest = null,
  bundleLevel = "bootstrap",
  countriesPayload = null,
  ownersPayload = null,
  controllersPayload = null,
  coresPayload = null,
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  return {
    manifest: clonePlainObject(manifest),
    bundleLevel: normalizeCacheKeyPart(bundleLevel, "bootstrap"),
    countriesPayload: clonePlainObject(countriesPayload),
    ownersPayload: clonePlainObject(ownersPayload),
    controllersPayload: clonePlainObject(controllersPayload),
    coresPayload: clonePlainObject(coresPayload),
    runtimeTopologyPayload: clonePlainObject(runtimeTopologyPayload),
    runtimePoliticalMeta: clonePlainObject(runtimePoliticalMeta),
  };
}

export function createSerializableStartupScenarioBootstrapLocalePayload({
  manifest = null,
  bundleLevel = "bootstrap",
  language = "en",
  geoLocalePatchPayload = null,
} = {}) {
  return {
    manifest: clonePlainObject(manifest),
    bundleLevel: normalizeCacheKeyPart(bundleLevel, "bootstrap"),
    language: normalizeCacheKeyPart(language, "en"),
    geoLocalePatchPayload: clonePlainObject(geoLocalePatchPayload),
  };
}

export async function readStartupCacheEntry(cacheKey, { search = null } = {}) {
  if (!isStartupCacheEnabled(search) || !normalizeText(cacheKey)) {
    return null;
  }
  const db = await openStartupCacheDb();
  const transaction = db.transaction(STARTUP_CACHE_STORE_NAME, "readonly");
  const store = transaction.objectStore(STARTUP_CACHE_STORE_NAME);
  const entry = await createRequestPromise(() => store.get(cacheKey));
  return entry || null;
}

export async function writeStartupCacheEntry({
  kind,
  cacheKey,
  payload,
  keyParts = {},
  metadata = {},
  maxEntriesPerKind = 4,
  search = null,
} = {}) {
  if (!isStartupCacheEnabled(search) || !normalizeText(cacheKey)) {
    return null;
  }
  const normalizedKind = normalizeCacheKind(kind);
  const db = await openStartupCacheDb();
  const transaction = db.transaction(STARTUP_CACHE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(STARTUP_CACHE_STORE_NAME);
  const nowIso = getNowIso();
  const record = {
    cacheKey,
    kind: normalizedKind,
    payload,
    keyParts: shallowCloneObject(keyParts),
    metadata: shallowCloneObject(metadata),
    updatedAt: nowIso,
    createdAt: normalizeCacheKeyPart(metadata.createdAt, nowIso),
  };
  store.put(record);
  await createTransactionDonePromise(transaction);
  await garbageCollectStartupCache({ maxEntriesPerKind, keepKinds: [normalizedKind], search });
  return record;
}

export async function deleteStartupCacheEntry(cacheKey, { search = null } = {}) {
  if (!isStartupCacheEnabled(search) || !normalizeText(cacheKey)) {
    return false;
  }
  const db = await openStartupCacheDb();
  const transaction = db.transaction(STARTUP_CACHE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(STARTUP_CACHE_STORE_NAME);
  store.delete(cacheKey);
  await createTransactionDonePromise(transaction);
  return true;
}

export async function clearStartupCache({ force = false, search = null } = {}) {
  if (!force && shouldBypassStartupCache(search)) {
    return false;
  }
  const db = await openStartupCacheDb();
  const transaction = db.transaction(STARTUP_CACHE_STORE_NAME, "readwrite");
  transaction.objectStore(STARTUP_CACHE_STORE_NAME).clear();
  await createTransactionDonePromise(transaction);
  return true;
}

export async function garbageCollectStartupCache({
  maxEntriesPerKind = 4,
  keepKinds = null,
  search = null,
} = {}) {
  if (!isStartupCacheEnabled(search)) {
    return { deletedKeys: [] };
  }
  const kinds = Array.isArray(keepKinds) && keepKinds.length
    ? Array.from(new Set(keepKinds.map((kind) => normalizeCacheKind(kind))))
    : Object.values(STARTUP_CACHE_KINDS);
  const db = await openStartupCacheDb();
  const deletedKeys = [];
  for (const kind of kinds) {
    const readTx = db.transaction(STARTUP_CACHE_STORE_NAME, "readonly");
    const index = readTx.objectStore(STARTUP_CACHE_STORE_NAME).index(STARTUP_CACHE_KIND_INDEX);
    const entries = await createRequestPromise(() => index.getAll(kind));
    const sorted = Array.isArray(entries)
      ? entries
        .slice()
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      : [];
    const overflow = sorted.slice(Math.max(0, Number(maxEntriesPerKind) || 0));
    if (!overflow.length) {
      continue;
    }
    const writeTx = db.transaction(STARTUP_CACHE_STORE_NAME, "readwrite");
    const store = writeTx.objectStore(STARTUP_CACHE_STORE_NAME);
    overflow.forEach((entry) => {
      if (!entry?.cacheKey) return;
      deletedKeys.push(entry.cacheKey);
      store.delete(entry.cacheKey);
    });
    await createTransactionDonePromise(writeTx);
  }
  return { deletedKeys };
}

export async function getStartupCacheDiagnostics({ search = null } = {}) {
  if (!isStartupCacheEnabled(search)) {
    return {
      enabled: false,
      bypassed: true,
      entryCount: 0,
      kinds: {},
    };
  }
  const db = await openStartupCacheDb();
  const transaction = db.transaction(STARTUP_CACHE_STORE_NAME, "readonly");
  const entries = await createRequestPromise(() => transaction.objectStore(STARTUP_CACHE_STORE_NAME).getAll());
  const kinds = {};
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const kind = normalizeText(entry?.kind) || "unknown";
    kinds[kind] = (Number(kinds[kind]) || 0) + 1;
  });
  return {
    enabled: true,
    bypassed: false,
    entryCount: Array.isArray(entries) ? entries.length : 0,
    kinds,
  };
}
