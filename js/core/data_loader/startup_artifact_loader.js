import { resolveDataUrl } from "../data_base_url.js";
import { resolveDataAssetUrl } from "../runtime_asset_registry.js";
import {
  createSerializableStartupBaseTopologyPayload,
  createSerializableStartupLocalizationPayload,
  createStartupBaseTopologyCacheKey,
  createStartupLocalizationCacheKey,
  isStartupCacheEnabled,
  loadBuildManifest,
  readStartupCacheEntry,
  writeStartupCacheEntry,
} from "../startup_cache.js";
import { loadBaseStartupViaWorker, shouldUseStartupWorker } from "../startup_worker_client.js";
import "../json_resource_decoder_shared.js";

const JSON_RESOURCE_DECODER = globalThis.__scenarioForgeJsonResourceDecoderShared;

if (!JSON_RESOURCE_DECODER) {
  throw new Error("[data_loader] Shared JSON resource decoder failed to initialize.");
}

const LOCALES_URL = resolveDataAssetUrl("locales");
const GEO_ALIASES_URL = resolveDataAssetUrl("geo_aliases");

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function normalizeLocaleLevel(value, fallback = "full") {
  return String(value || fallback).trim().toLowerCase() === "startup" ? "startup" : "full";
}

function isScenarioScopedLocalizationUrl(url) {
  return /(^|\/)data\/scenarios\/[^/]+\/(?:locales|geo_aliases)\.startup\.json$/i.test(String(url || "").trim());
}

function resolveLocalizationUrls({
  localeLevel = "full",
  localesUrl = null,
  geoAliasesUrl = null,
} = {}) {
  const normalizedLevel = normalizeLocaleLevel(localeLevel);
  return {
    localeLevel: normalizedLevel,
    localesUrl: String(
      localesUrl || LOCALES_URL
    ).trim(),
    geoAliasesUrl: String(
      geoAliasesUrl || GEO_ALIASES_URL
    ).trim(),
  };
}

export async function loadMeasuredJsonResource(
  url,
  {
    d3Client = globalThis.d3,
    label = "resource",
    cache = "default",
    credentials = "same-origin",
    signal = null,
  } = {}
) {
  const createDataLoaderError = (
    code,
    message,
    extra = {},
  ) => {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  };
  if (!url) {
    throw createDataLoaderError("missing-url", `[data_loader] Missing URL for ${label}.`, {
      label,
      url: "",
    });
  }
  const startedAt = nowMs();
  signal?.throwIfAborted();
  // 这里统一收口 fetch + JSON parse + timing metrics。
  // 上层 loader 只关心 payload 和指标，不再各自拼接重复的网络错误语义。
  if (typeof globalThis.fetch === "function") {
    const response = await globalThis.fetch(resolveDataUrl(url), {
      cache,
      credentials,
      ...(signal ? { signal } : {}),
    });
    const textLoadedAt = nowMs();
    if (!response.ok) {
      throw createDataLoaderError(
        "http-error",
        `[data_loader] Failed to fetch ${label} at ${url} (${response.status} ${response.statusText}).`,
        {
          label,
          url,
          httpStatus: response.status,
          httpStatusText: response.statusText,
        },
      );
    }
    signal?.throwIfAborted();
    let decoded;
    try {
      decoded = await JSON_RESOURCE_DECODER.decodeResponsePayload(response, {
        url,
        label,
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (signal?.aborted) {
        const abortErr = new Error("Aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      if (error?.code === "unsupported-decompressor") {
        throw createDataLoaderError(
          "unsupported-decompressor",
          `[data_loader] Unsupported decompressor for ${label} at ${url}: ${error.message}`,
          {
            label,
            url,
            cause: error,
          },
        );
      }
      if (error?.code === "decompress-failed" || error?.name === "DecompressError") {
        throw createDataLoaderError(
          "decompress-failed",
          `[data_loader] Failed to decompress ${label} at ${url}: ${error.message}`,
          {
            label,
            url,
            cause: error,
          },
        );
      }
      throw createDataLoaderError(
        "invalid-json",
        `[data_loader] Invalid JSON for ${label} at ${url}: ${error?.message || error}`,
        {
          label,
          url,
          cause: error,
        },
      );
    }
    signal?.throwIfAborted();
    const parsedAt = nowMs();
    return {
      payload: decoded.payload,
      metrics: {
        url,
        label,
        cache,
        transferMs: textLoadedAt - startedAt,
        fetchMs: decoded.bodyReadAt - startedAt,
        decompressMs: decoded.decompressMs,
        jsonParseMs: decoded.jsonParseMs,
        totalMs: parsedAt - startedAt,
        bytes: decoded.decodedBytes,
        encodedBytes: decoded.encodedBytes,
        decodedBytes: decoded.decodedBytes,
        compressedBytes: decoded.compressedBytes,
        compressed: decoded.compressed,
      },
    };
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw createDataLoaderError("missing-loader", `[data_loader] No JSON loader available for ${label}.`, {
      label,
      url,
    });
  }
  // This legacy loader has no cancellation contract. Reject stale results after
  // it settles; only the native fetch branch can interrupt the network request.
  const payload = await d3Client.json(resolveDataUrl(url));
  signal?.throwIfAborted();
  const finishedAt = nowMs();
  return {
    payload,
    metrics: {
      url,
      label,
      cache,
      fetchMs: finishedAt - startedAt,
      decompressMs: 0,
      jsonParseMs: 0,
      totalMs: finishedAt - startedAt,
      transferMs: finishedAt - startedAt,
      bytes: 0,
      encodedBytes: 0,
      decodedBytes: 0,
      compressedBytes: 0,
      compressed: false,
    },
  };
}

function createDefaultStartupBootCacheState(enabled = false) {
  return {
    enabled: !!enabled,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  };
}

export async function loadStartupBootArtifacts({
  topologyUrl = "data/europe_topology.json",
  localesUrl = null,
  geoAliasesUrl = null,
  localeLevel = "startup",
  currentLanguage = "en",
  d3Client = globalThis.d3,
  useWorker = true,
  useStartupCache = true,
} = {}) {
  const resolvedLocalization = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  // startup boot 只准备“首屏马上要用”的基础资产：
  // primary topology + startup 级本地化。
  // 真正的 detail/runtime 数据仍然交给后续完整加载链处理。
  const startupBootCacheState = createDefaultStartupBootCacheState(
    useStartupCache && isStartupCacheEnabled()
  );
  const workerEnabled = useWorker && shouldUseStartupWorker();
  const localizationUsesScenarioScopedStartupFiles =
    isScenarioScopedLocalizationUrl(resolvedLocalization.localesUrl)
    || isScenarioScopedLocalizationUrl(resolvedLocalization.geoAliasesUrl);
  let buildManifest = null;

  if (startupBootCacheState.enabled) {
    try {
      buildManifest = await loadBuildManifest();
    } catch (error) {
      console.warn("[data_loader] Startup build manifest unavailable, bypassing persistent startup cache.", error);
      startupBootCacheState.enabled = false;
    }
  }
  if (startupBootCacheState.enabled && localizationUsesScenarioScopedStartupFiles) {
    startupBootCacheState.localization = "scenario-scoped";
  }

  const topologyCacheKey = startupBootCacheState.enabled
    ? createStartupBaseTopologyCacheKey({
      topologyUrl,
      buildManifest,
    })
    : "";
  const localizationCacheKey = startupBootCacheState.enabled && !localizationUsesScenarioScopedStartupFiles
    ? createStartupLocalizationCacheKey({
      localeLevel: resolvedLocalization.localeLevel,
      currentLanguage: String(currentLanguage || "en").trim() || "en",
      localesUrl: resolvedLocalization.localesUrl,
      geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
      buildManifest,
    })
    : "";

  let topologyPrimary = null;
  let locales = null;
  let geoAliases = null;
  let decodedCollections = null;
  let startupWorkerUsed = false;
  const resourceMetrics = {
    topologyPrimary: null,
    locales: null,
    geoAliases: null,
  };

  if (topologyCacheKey) {
    try {
      const cacheEntry = await readStartupCacheEntry(topologyCacheKey);
      if (cacheEntry?.payload?.topologyPrimary) {
        topologyPrimary = cacheEntry.payload.topologyPrimary;
        startupBootCacheState.baseTopology = "hit";
      } else {
        startupBootCacheState.baseTopology = "miss";
      }
    } catch (error) {
      console.warn("[data_loader] Startup base-topology cache read failed.", error);
      startupBootCacheState.baseTopology = "error";
    }
  }

  if (localizationCacheKey) {
    try {
      const cacheEntry = await readStartupCacheEntry(localizationCacheKey);
      if (cacheEntry?.payload?.locales && cacheEntry?.payload?.geoAliases) {
        locales = cacheEntry.payload.locales;
        geoAliases = cacheEntry.payload.geoAliases;
        startupBootCacheState.localization = "hit";
      } else {
        startupBootCacheState.localization = "miss";
      }
    } catch (error) {
      console.warn("[data_loader] Startup localization cache read failed.", error);
      startupBootCacheState.localization = "error";
    }
  }

  if ((!topologyPrimary || !locales || !geoAliases || !decodedCollections) && workerEnabled) {
    try {
      // 缓存命中的拓扑同样交给 worker 解码；仅对缺失资源发起网络请求。
      startupWorkerUsed = true;
      const workerResult = await loadBaseStartupViaWorker({
        topologyUrl,
        localesUrl: resolvedLocalization.localesUrl,
        geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
        needTopologyPrimary: !topologyPrimary,
        needLocales: !locales,
        needGeoAliases: !geoAliases,
        cachedTopologyPrimary: topologyPrimary,
      });
      topologyPrimary = workerResult.topologyPrimary || topologyPrimary || null;
      locales = locales || workerResult.locales || null;
      geoAliases = geoAliases || workerResult.geoAliases || null;
      decodedCollections = workerResult.decodedCollections || null;
      resourceMetrics.topologyPrimary = resourceMetrics.topologyPrimary || workerResult.metrics?.topologyPrimary || null;
      resourceMetrics.locales = resourceMetrics.locales || workerResult.metrics?.locales || null;
      resourceMetrics.geoAliases = resourceMetrics.geoAliases || workerResult.metrics?.geoAliases || null;
    } catch (error) {
      console.warn("[data_loader] Startup worker failed for base artifacts, falling back to main thread.", error);
    }
  }

  if (!topologyPrimary) {
    const topologyResult = await loadMeasuredJsonResource(topologyUrl, {
      d3Client,
      label: "primary_topology",
    });
    topologyPrimary = topologyResult.payload || null;
    resourceMetrics.topologyPrimary = topologyResult.metrics || null;
  }

  if (!locales || !geoAliases) {
    const localizationBundle = await loadLocalizationData({
      d3Client,
      localeLevel: resolvedLocalization.localeLevel,
      localesUrl: resolvedLocalization.localesUrl,
      geoAliasesUrl: resolvedLocalization.geoAliasesUrl,
    });
    locales = locales || localizationBundle.locales;
    geoAliases = geoAliases || localizationBundle.geoAliases;
    resourceMetrics.locales = resourceMetrics.locales || localizationBundle.resourceMetrics?.locales || null;
    resourceMetrics.geoAliases = resourceMetrics.geoAliases || localizationBundle.resourceMetrics?.geoAliases || null;
  }

  if (topologyCacheKey && topologyPrimary && startupBootCacheState.baseTopology !== "hit") {
    startupBootCacheState.baseTopology = "write-pending";
    // cache 写回放到后台做，不让首屏加载再多等一次 IO。
    void writeStartupCacheEntry({
      kind: "startup-base-topology",
      cacheKey: topologyCacheKey,
      payload: createSerializableStartupBaseTopologyPayload({ topologyPrimary }),
      keyParts: {
        topologyUrl,
      },
    }).then(() => {
      startupBootCacheState.baseTopology = "written";
    }).catch((error) => {
      console.warn("[data_loader] Startup base-topology cache write failed.", error);
      startupBootCacheState.baseTopology = "write-error";
    });
  }

  if (localizationCacheKey && locales && geoAliases && startupBootCacheState.localization !== "hit") {
    startupBootCacheState.localization = "write-pending";
    void writeStartupCacheEntry({
      kind: "startup-localization",
      cacheKey: localizationCacheKey,
      payload: createSerializableStartupLocalizationPayload({ locales, geoAliases }),
      keyParts: {
        localeLevel: resolvedLocalization.localeLevel,
        language: String(currentLanguage || "en").trim() || "en",
      },
    }).then(() => {
      startupBootCacheState.localization = "written";
    }).catch((error) => {
      console.warn("[data_loader] Startup localization cache write failed.", error);
      startupBootCacheState.localization = "write-error";
    });
  }

  return {
    topologyPrimary,
    locales: locales || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    decodedCollections,
    hasScenarioRuntimeBootstrap: false,
    localeLevel: resolvedLocalization.localeLevel,
    resourceMetrics,
    startupBootCacheState,
    startupWorkerUsed,
  };
}

export async function loadLocalizationData({
  d3Client = globalThis.d3,
  localeLevel = "full",
  localesUrl = null,
  geoAliasesUrl = null,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadLocalizationData().");
  }
  const resolved = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  const [localeResult, geoAliasResult] = await Promise.all([
    loadMeasuredJsonResource(resolved.localesUrl, {
      d3Client,
      label: `locales:${resolved.localeLevel}`,
    }).catch((err) => {
      console.warn("Locales file missing or invalid, using defaults.", err);
      return {
        payload: { ui: {}, geo: {} },
        metrics: {
          url: resolved.localesUrl,
          label: `locales:${resolved.localeLevel}`,
          fetchMs: 0,
          jsonParseMs: 0,
          totalMs: 0,
          transferMs: 0,
          failed: true,
        },
      };
    }),
    loadMeasuredJsonResource(resolved.geoAliasesUrl, {
      d3Client,
      label: `geo_aliases:${resolved.localeLevel}`,
    }).catch((err) => {
      console.warn("Geo alias file missing or invalid, using defaults.", err);
      return {
        payload: { alias_to_stable_key: {} },
        metrics: {
          url: resolved.geoAliasesUrl,
          label: `geo_aliases:${resolved.localeLevel}`,
          fetchMs: 0,
          jsonParseMs: 0,
          totalMs: 0,
          transferMs: 0,
          failed: true,
        },
      };
    }),
  ]);
  return {
    localeLevel: resolved.localeLevel,
    locales: localeResult.payload || { ui: {}, geo: {} },
    geoAliases: geoAliasResult.payload || { alias_to_stable_key: {} },
    resourceMetrics: {
      locales: localeResult.metrics || null,
      geoAliases: geoAliasResult.metrics || null,
    },
  };
}

export {
  createDefaultStartupBootCacheState,
  normalizeLocaleLevel,
  resolveLocalizationUrls,
};
