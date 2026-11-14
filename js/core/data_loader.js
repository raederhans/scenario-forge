import {
  finishCityPreparation,
  mergeCityLocalizationData,
  normalizeCityFeatureCollection,
  normalizeCityFeatureCollectionSteps,
} from "./data_loader/city_normalization.js";
import { loadOptionalContextLayerPacks } from "./data_loader/context_pack_loader.js";
import {
  createDefaultStartupBootCacheState,
  loadLocalizationData,
  loadMeasuredJsonResource,
  loadStartupBootArtifacts,
  normalizeLocaleLevel,
  resolveLocalizationUrls,
} from "./data_loader/startup_artifact_loader.js";

import { resolveDataUrl } from "./data_base_url.js";
// Data loading helpers (Phase 13 scaffold)

import {
  loadDetailTopologyViaWorker,
  shouldUseStartupWorker,
} from "./startup_worker_client.js";
import {
  resolveDataAssetUrl,
} from "./runtime_asset_registry.js";
export {
  resolveDataAssetUrl,
  resolveScenarioRegistryUrl,
  resolveTransportManifestUrl,
} from "./runtime_asset_registry.js";

// 这些 detail topology fallback 仍是 data_loader 的本地实现细节。
// runtime_asset_registry 只登记真正走 Pages dist 发布契约的共享 runtime 资源，
// 避免 registry 暗示 highres / legacy_bak / na_v1 这些未发布文件在部署版可用。
const TOPOLOGY_VARIANT_URLS = Object.freeze({
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
  na_v1: "data/europe_topology.na_v1.json",
  na_v2: "data/europe_topology.na_v2.json",
});
const DETAIL_SOURCES = { ...TOPOLOGY_VARIANT_URLS };
// detail source 的 fallback 顺序属于 runtime 发布契约的一部分：
// 首选当前主源，缺失时再按历史兼容顺序降到旧文件，保证首屏 coarse 已出图时，
// detail enhancement 仍尽量接到“最像当前发布物”的那份数据。
const DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const WORLD_CITIES_URLS = [resolveDataAssetUrl("world_cities"), "data/world_cities.json"];
const CITY_ALIASES_URLS = [resolveDataAssetUrl("city_aliases")];
const RU_CITY_OVERRIDES_URL = resolveDataAssetUrl("ru_city_overrides");
const SPECIAL_ZONES_URL = resolveDataAssetUrl("special_zones");
const RUNTIME_POLITICAL_URL = resolveDataAssetUrl("runtime_political_topology");
const PALETTE_REGISTRY_URL = resolveDataAssetUrl("palette_registry");
const RELEASABLE_CATALOG_URL = resolveDataAssetUrl("releasable_catalog");
const RENDER_PROFILES = new Set(["auto", "balanced", "full"]);

async function loadOptionalJsonCandidate(d3Client, candidateUrls, { label = "resource", normalizer = (payload) => payload } = {}) {
  const urls = Array.isArray(candidateUrls) ? candidateUrls : [candidateUrls];
  let sawFailure = false;
  for (const url of urls.filter(Boolean)) {
    try {
      const payload = await d3Client.json(resolveDataUrl(url));
      const normalized = await normalizer(payload, url);
      if (normalized !== null && normalized !== undefined) {
        return normalized;
      }
      console.warn(`[data_loader] Optional ${label} payload invalid at ${url}.`);
      sawFailure = true;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      sawFailure = true;
      console.warn(`[data_loader] Optional ${label} missing or invalid at ${url}.`, error);
    }
  }
  if (!sawFailure) {
    console.warn(`[data_loader] Optional ${label} is unavailable; no candidate URL resolved.`);
  }
  return null;
}

function getSearchParams() {
  const search = globalThis?.location?.search || "";
  if (!search || !globalThis.URLSearchParams) {
    return null;
  }
  return new globalThis.URLSearchParams(search);
}

function resolveTopologyVariant() {
  const params = getSearchParams();
  if (!params) return null;

  // topology_variant 只用于显式调试或对比不同底图输入；
  // 正常启动路径继续走 manifest / startup bundle 选出来的默认资源。
  const raw = params.get("topology_variant");
  if (!raw) return null;

  const key = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TOPOLOGY_VARIANT_URLS, key)) {
    console.warn(
      `[data_loader] Ignoring unknown topology_variant="${raw}". Allowed values: highres, legacy_bak, na_v1, na_v2.`
    );
    return null;
  }

  return {
    key,
    url: TOPOLOGY_VARIANT_URLS[key],
  };
}

function resolveRenderProfile() {
  const params = getSearchParams();
  const raw = params?.get("render_profile");
  const value = String(raw || "auto").trim().toLowerCase();
  if (!RENDER_PROFILES.has(value)) {
    if (raw) {
      console.warn(
        `[data_loader] Ignoring unknown render_profile="${raw}". Allowed values: auto, balanced, full.`
      );
    }
    return "auto";
  }
  return value;
}

function resolveDetailLayerEnabled() {
  const params = getSearchParams();
  if (!params) return true;
  const raw = params.get("detail_layer");
  if (!raw) return true;
  const value = String(raw).trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(value);
}

function resolveDetailSource() {
  const params = getSearchParams();
  if (!params) {
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  const raw = params.get("detail_source");
  if (!raw) {
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  const key = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key)) {
    console.warn(
      `[data_loader] Ignoring unknown detail_source="${raw}". Allowed values: highres, legacy_bak, na_v1, na_v2.`
    );
    return { key: "na_v2", url: DETAIL_SOURCES.na_v2 };
  }

  return { key, url: DETAIL_SOURCES[key] };
}

function getPoliticalGeometryCount(topology) {
  return (
    topology?.objects?.political?.geometries &&
    Array.isArray(topology.objects.political.geometries)
      ? topology.objects.political.geometries.length
      : 0
  );
}

function shouldDeferDetailLoad(renderProfile) {
  if (renderProfile === "full") return false;
  if (renderProfile === "balanced") return true;

  const nav = globalThis?.navigator || {};
  const deviceMemory = Number(nav.deviceMemory || 0);
  const hardwareConcurrency = Number(nav.hardwareConcurrency || 0);
  const dpr = Math.max(Number(globalThis?.devicePixelRatio || 1), 1);

  if (deviceMemory && deviceMemory <= 8) return true;
  if (hardwareConcurrency && hardwareConcurrency <= 8) return true;
  if (dpr > 1.5) return true;
  return false;
}

async function loadTopologyUrlWithMetrics(d3Client, url, label) {
  const { payload: topology, metrics } = await loadMeasuredJsonResource(url, {
    d3Client,
    label: `${label}_topology`,
  });
  const count = getPoliticalGeometryCount(topology);
  console.info(`[data_loader] Loaded ${label} topology ${url} (${count} features).`);
  return {
    topology,
    metrics: {
      ...(metrics || {}),
      featureCount: count,
    },
  };
}

// The detail topology arrives after the map is interactive; parsing its ~90 MB
// on the main thread blocked input for several hundred milliseconds. A worker
// parses it and transfers the arcs as buffers. Any worker failure falls back to
// the main-thread load, so the worker only changes where the work happens.
async function loadDetailTopologyUrl(d3Client, url, label) {
  if (shouldUseStartupWorker()) {
    try {
      const { topology, metrics } = await loadDetailTopologyViaWorker({ topologyUrl: url });
      console.info(`[data_loader] Loaded ${label} topology ${url} in a worker (${getPoliticalGeometryCount(topology)} features).`);
      return { topology, metrics: { ...(metrics || {}), worker: true } };
    } catch (error) {
      console.warn(`[data_loader] Worker load of ${label} topology failed; loading on the main thread.`, error);
    }
  }
  return loadTopologyUrlWithMetrics(d3Client, url, label);
}

/**
 * Load and parse a JSON resource with execution metrics.
 *
 * Metrics semantics:
 * - encodedBytes: Byte length of HTTP response body received by JS (before client-side gzip decompression).
 *   When transport-level Content-Encoding: gzip was applied, this reflects delivered response body bytes,
 *   which may differ from network wire transfer bytes.
 * - decodedBytes: Byte length of decoded UTF-8 string payload (accurate for multi-byte non-ASCII).
 * - decompressMs: Elapsed milliseconds spent on client-side gzip decompression (0 if plain or transport-decoded).
 * - jsonParseMs: Elapsed milliseconds spent on JSON.parse.
 */
async function loadExplicitVariant({
  topologyUrl,
  d3Client,
  variant,
} = {}) {
  // 显式 variant 属于“用户已经指定要哪一套 topology”，
  // 这里直接走单份加载，不再混入 coarse/detail 的组合逻辑。
  const tried = new Set();
  const candidates = [];
  const enqueue = (url) => {
    if (!url || tried.has(url)) return;
    tried.add(url);
    candidates.push(url);
  };

  enqueue(variant?.url);
  enqueue(topologyUrl);

  const attempted = [];
  for (const url of candidates) {
    attempted.push(url);
    try {
      return await loadTopologyUrlWithMetrics(d3Client, url, "single");
    } catch (error) {
      console.warn(`[data_loader] Failed loading topology ${url}:`, error);
    }
  }

  throw new Error(`Unable to load topology dataset. Tried: ${attempted.join(", ") || topologyUrl}`);
}

async function loadDetailTopologyWithFallback({
  d3Client,
  detailSource,
  candidateKeys = null,
} = {}) {
  // detail 数据常因为构建差异、缓存或场景包不完整而缺一份；
  // 这里顺序探测候选源，尽量把“请求哪份、最后实际用了哪份”保留下来。
  const orderedKeys = Array.from(new Set([
    ...(Array.isArray(candidateKeys) ? candidateKeys : []),
    detailSource?.key,
    ...DETAIL_SOURCE_FALLBACK_ORDER,
  ].filter((key) => key && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key))));

  const deduped = orderedKeys.map((key) => ({
    key,
    url: DETAIL_SOURCES[key],
  }));

  let firstError = null;
  for (const candidate of deduped) {
    try {
      const { topology, metrics } = await loadDetailTopologyUrl(
        d3Client,
        candidate.url,
        `detail(${candidate.key})`
      );
      if (
        topology?.type !== "Topology" ||
        topology.objects?.political?.type !== "GeometryCollection" ||
        !Array.isArray(topology.objects.political.geometries) ||
        topology.objects.political.geometries.length === 0
      ) {
        throw new Error("Detail topology has no political geometries.");
      }
      return { topology, sourceKey: candidate.key, metrics };
    } catch (error) {
      firstError = firstError || error;
      console.warn(
        `[data_loader] Detail topology (${candidate.key}) unavailable at ${candidate.url}.`,
        error
      );
    }
  }

  if (firstError) {
    console.warn("[data_loader] Detail topology could not be loaded from any candidate.");
  }
  return { topology: null, sourceKey: null };
}

async function loadTopologyBundle({
  topologyUrl,
  d3Client,
  renderProfile,
  prefetchedPrimaryTopology = null,
  prefetchedPrimaryMetrics = null,
  deferDetail = false,
} = {}) {
  const variant = resolveTopologyVariant();
  if (variant?.url) {
    console.info(
      `[data_loader] topology_variant=${variant.key} explicitly requested. Running single-topology mode.`
    );
    const single = await loadExplicitVariant({ topologyUrl, d3Client, variant });
    return {
      topology: single.topology,
      topologyPrimary: single.topology,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: variant.key,
      detailDeferred: false,
      detailSourceRequested: null,
      resourceMetrics: {
        topologyPrimary: single.metrics || null,
        topologyDetail: null,
      },
    };
  }

  const detailLayerEnabled = resolveDetailLayerEnabled();
  const detailSource = resolveDetailSource();
  // 这个 loader 始终把 primary coarse topology 当作主返回值。
  // detail topology 只是附加增强层；外部调用方拿到的 `topology` 语义一直是“首屏可依赖基底”。
  const topologyPrimaryResult = prefetchedPrimaryTopology
    ? {
      topology: prefetchedPrimaryTopology,
      metrics: prefetchedPrimaryMetrics || null,
    }
    : await loadTopologyUrlWithMetrics(d3Client, topologyUrl, "primary");
  const topologyPrimary = topologyPrimaryResult.topology;

  // primary coarse topology 是启动必需的基底；
  // detail 只是后续增强层，所以任何“关掉 detail / 延迟 detail”的路径都不能阻塞 primary 出图。
  if (!detailLayerEnabled) {
    console.info("[data_loader] detail_layer=off detected. Running coarse-only primary topology.");
    return {
      topology: topologyPrimary,
      topologyPrimary,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: null,
      detailDeferred: false,
      detailSourceRequested: detailSource.key,
      resourceMetrics: {
        topologyPrimary: topologyPrimaryResult.metrics || null,
        topologyDetail: null,
      },
    };
  }

  if (deferDetail || shouldDeferDetailLoad(renderProfile)) {
    console.info(
      `[data_loader] render_profile=${renderProfile} deferred detail loading. Starting in coarse-only primary mode.`
    );
    return {
      topology: topologyPrimary,
      topologyPrimary,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: null,
      detailDeferred: true,
      detailSourceRequested: detailSource.key,
      resourceMetrics: {
        topologyPrimary: topologyPrimaryResult.metrics || null,
        topologyDetail: null,
      },
    };
  }

  const { topology: topologyDetail, sourceKey: detailSourceUsed, metrics: topologyDetailMetrics } =
    await loadDetailTopologyWithFallback({
      d3Client,
      detailSource,
    });
  if (detailSourceUsed && detailSourceUsed !== detailSource.key) {
    console.info(
      `[data_loader] Detail topology fallback activated: requested=${detailSource.key}, using=${detailSourceUsed}.`
    );
  }

  const bundleMode = topologyDetail ? "composite" : "single";
  console.info(
    `[data_loader] Topology bundle mode: ${bundleMode}. primary=${getPoliticalGeometryCount(topologyPrimary)}, detail=${getPoliticalGeometryCount(topologyDetail)}`
  );
  return {
    topology: topologyPrimary,
    topologyPrimary,
    topologyDetail,
    topologyBundleMode: bundleMode,
    topologyVariant: null,
    detailDeferred: false,
    detailSourceRequested: detailSource.key,
    resourceMetrics: {
      topologyPrimary: topologyPrimaryResult.metrics || null,
      topologyDetail: topologyDetailMetrics || null,
    },
  };
}

export async function loadDeferredDetailBundle({
  d3Client = globalThis.d3,
  detailSourceKey = null,
  detailSourceKeys = null,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
  includeRuntimePolitical = true,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadDeferredDetailBundle().");
  }

  const fallbackDetailSource = resolveDetailSource();
  const resolvedKey =
    detailSourceKey && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, detailSourceKey)
      ? detailSourceKey
      : fallbackDetailSource.key;
  const detailSource = {
    key: resolvedKey,
    url: DETAIL_SOURCES[resolvedKey],
  };
  const orderedDetailSourceKeys = Array.from(new Set([
    ...(Array.isArray(detailSourceKeys) ? detailSourceKeys : []),
    resolvedKey,
    ...DETAIL_SOURCE_FALLBACK_ORDER,
  ].filter((key) => key && Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key))));

  // deferred bundle 是启动后补细节的第二阶段：
  // 补 detail topology；只有调用方需要时才并行补 global runtime overlay。
  // 两者都允许单独失败，省略 runtime 的结果只满足本次显式需求。
  const [{ topology: topologyDetail, sourceKey: detailSourceUsed }, runtimePoliticalTopology] =
    await Promise.all([
      loadDetailTopologyWithFallback({
        d3Client,
        detailSource,
        candidateKeys: orderedDetailSourceKeys,
      }),
      includeRuntimePolitical
        ? d3Client.json(resolveDataUrl(runtimePoliticalUrl)).catch((err) => {
          console.warn("Runtime political topology missing or invalid during deferred load.", err);
          return null;
        })
        : Promise.resolve(null),
    ]);

  return {
    topologyDetail,
    runtimePoliticalTopology,
    runtimePoliticalRequested: includeRuntimePolitical,
    topologyBundleMode: topologyDetail ? "composite" : "single",
    detailSourceUsed: detailSourceUsed || resolvedKey,
  };
}

export async function loadMapData({
  topologyUrl = "data/europe_topology.json",
  localesUrl = null,
  geoAliasesUrl = null,
  currentLanguage = "en",
  worldCitiesUrls = WORLD_CITIES_URLS,
  cityAliasesUrls = CITY_ALIASES_URLS,
  hierarchyUrl = "data/hierarchy.json",
  ruCityOverridesUrl = RU_CITY_OVERRIDES_URL,
  specialZonesUrl = SPECIAL_ZONES_URL,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
  paletteRegistryUrl = PALETTE_REGISTRY_URL,
  releasableCatalogUrl = RELEASABLE_CATALOG_URL,
  d3Client = globalThis.d3,
  includeCityData = true,
  includeContextLayers = true,
  localeLevel = "full",
  useStartupWorker = false,
  useStartupCache = false,
  startupBootArtifactsOverride = null,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadMapData().");
  }

  const renderProfile = resolveRenderProfile();
  const localizationUrls = resolveLocalizationUrls({
    localeLevel,
    localesUrl,
    geoAliasesUrl,
  });
  // 这里是完整数据装配入口：
  // 把 startup boot、topology、localization、城市、context layers、palette 等来源并发拉齐，
  // 最后再统一拼成运行时需要的 map data 包。
  const shouldUseStartupBootPath =
    normalizeLocaleLevel(localeLevel) === "startup" && (useStartupWorker || useStartupCache);
  const startupBootArtifactsPromise = startupBootArtifactsOverride
    ? Promise.resolve(startupBootArtifactsOverride)
    : (
      shouldUseStartupBootPath
        ? loadStartupBootArtifacts({
          topologyUrl,
          localesUrl,
          geoAliasesUrl,
          localeLevel,
          currentLanguage,
          d3Client,
          useWorker: useStartupWorker,
          useStartupCache,
        })
        : Promise.resolve(null)
    );
  const hierarchyPromise = d3Client.json(resolveDataUrl(hierarchyUrl)).catch((err) => {
    console.warn("Hierarchy file missing or invalid, using defaults.", err);
    return null;
  });
  const paletteRegistryPromise = d3Client.json(resolveDataUrl(paletteRegistryUrl)).catch((err) => {
    console.warn("Palette registry missing or invalid, continuing with legacy palette fallback.", err);
    return null;
  });
  const paletteAssetsPromise = paletteRegistryPromise.then((paletteRegistry) => {
    if (!Array.isArray(paletteRegistry?.palettes) || paletteRegistry.palettes.length === 0) {
      return {
        activePaletteMeta: null,
        activePalettePack: null,
        activePaletteMap: null,
      };
    }
    const defaultPaletteId = String(
      paletteRegistry.default_palette_id || paletteRegistry.palettes[0]?.palette_id || ""
    ).trim();
    const activePaletteMeta =
      paletteRegistry.palettes.find((entry) => String(entry?.palette_id || "").trim() === defaultPaletteId)
      || paletteRegistry.palettes[0]
      || null;
    const paletteUrl = String(activePaletteMeta?.palette_url || "").trim();
    const mapUrl = String(activePaletteMeta?.map_url || "").trim();
    return Promise.all([
      paletteUrl
        ? d3Client.json(resolveDataUrl(paletteUrl)).catch((err) => {
          console.warn(`Palette pack missing or invalid at ${paletteUrl}, continuing without asset palette.`, err);
          return null;
        })
        : Promise.resolve(null),
      mapUrl
        ? d3Client.json(resolveDataUrl(mapUrl)).catch((err) => {
          console.warn(`Palette map missing or invalid at ${mapUrl}, continuing without asset palette mapping.`, err);
          return null;
        })
        : Promise.resolve(null),
    ]).then(([activePalettePack, activePaletteMap]) => ({
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
    }));
  });
  const releasableCatalogPromise = d3Client.json(resolveDataUrl(releasableCatalogUrl)).catch((err) => {
    console.warn("Releasable catalog missing or invalid, continuing without releasable overlays.", err);
    return null;
  });
  const contextLayerPackPromise = loadOptionalContextLayerPacks(d3Client, includeContextLayers);
  const ruCityOverridesPromise = d3Client.json(resolveDataUrl(ruCityOverridesUrl)).then((payload) => {
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] RU city overrides payload invalid at ${ruCityOverridesUrl}. Ignoring.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  }).catch((err) => {
    console.warn("RU city overrides file missing or invalid, continuing without overrides.", err);
    return null;
  });
  const specialZonesPromise = d3Client.json(resolveDataUrl(specialZonesUrl)).then((payload) => {
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] Special zones payload invalid at ${specialZonesUrl}. Ignoring.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  }).catch((err) => {
    console.warn("Special zones file missing or invalid, falling back to topology layer.", err);
    return null;
  });

  const cityDataPromises = includeCityData
    ? [
      loadOptionalJsonCandidate(d3Client, worldCitiesUrls, {
        label: "world_cities",
        normalizer: (payload) => normalizeCityFeatureCollection(payload, { sourceLabel: "world_cities" }),
      }),
      loadOptionalJsonCandidate(d3Client, cityAliasesUrls, {
        label: "city_aliases",
        normalizer: (payload) => (payload && typeof payload === "object" ? payload : null),
      }),
    ]
    : [Promise.resolve(null), Promise.resolve(null)];

  // 完整加载链把 startup boot 产物当成 warm cache：
  // 能复用的就直接复用，缺的部分再走完整 loader，避免首屏和全量链各自重复解析同一批资源。
  const localizationPromise = startupBootArtifactsPromise.then((startupBootArtifacts) => (
    startupBootArtifacts && startupBootArtifacts.locales && startupBootArtifacts.geoAliases
      ? {
        localeLevel: startupBootArtifacts.localeLevel || localizationUrls.localeLevel,
        locales: startupBootArtifacts.locales,
        geoAliases: startupBootArtifacts.geoAliases,
        resourceMetrics: {
          locales: startupBootArtifacts.resourceMetrics?.locales || null,
          geoAliases: startupBootArtifacts.resourceMetrics?.geoAliases || null,
        },
      }
      : loadLocalizationData({
        d3Client,
        localeLevel: localizationUrls.localeLevel,
        localesUrl: localizationUrls.localesUrl,
        geoAliasesUrl: localizationUrls.geoAliasesUrl,
      })
  ));
  const topologyBundlePromise = startupBootArtifactsPromise.then((startupBootArtifacts) => (
    loadTopologyBundle({
      topologyUrl,
      d3Client,
      renderProfile,
      prefetchedPrimaryTopology: startupBootArtifacts?.topologyPrimary || null,
      prefetchedPrimaryMetrics: startupBootArtifacts?.resourceMetrics?.topologyPrimary || null,
      // A scenario bootstrap brings its own political runtime, so the detail
      // topology must not hold startup back; the deferred promotion decides later.
      deferDetail: !!startupBootArtifacts?.hasScenarioRuntimeBootstrap,
    })
  ));
  const runtimePoliticalPromise = Promise.all([startupBootArtifactsPromise, topologyBundlePromise]).then(
    ([startupBootArtifacts, topologyBundle]) => {
      // 启动已经带了 scenario bootstrap，或者当前明确走 deferred detail，
      // 就不要在首轮完整加载里再抢跑 runtime political。
      if (startupBootArtifacts?.hasScenarioRuntimeBootstrap || topologyBundle.detailDeferred) {
        return null;
      }
      return d3Client.json(resolveDataUrl(runtimePoliticalUrl)).catch((err) => {
        console.warn("Runtime political topology missing or invalid, continuing without dynamic sovereignty.", err);
        return null;
      });
    }
  );
  const [
    startupBootArtifacts,
    topologyBundle,
    localizationBundle,
    worldCities,
    cityAliases,
    hierarchy,
    ruCityOverrides,
    specialZones,
    runtimePoliticalTopology,
    paletteRegistry,
    paletteAssets,
    releasableCatalog,
    contextLayerExternal,
  ] = await Promise.all([
    startupBootArtifactsPromise,
    topologyBundlePromise,
    localizationPromise,
    ...cityDataPromises,
    hierarchyPromise,
    ruCityOverridesPromise,
    specialZonesPromise,
    runtimePoliticalPromise,
    paletteRegistryPromise,
    paletteAssetsPromise,
    releasableCatalogPromise,
    contextLayerPackPromise,
  ]);
  const localeData = localizationBundle.locales;
  const geoAliases = localizationBundle.geoAliases;
  const cityLocalizationMerged = mergeCityLocalizationData({
    locales: localeData || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    cityCollection: worldCities,
    cityAliases,
  });

  const activePaletteMeta = paletteAssets?.activePaletteMeta || null;
  const activePalettePack = paletteAssets?.activePalettePack || null;
  const activePaletteMap = paletteAssets?.activePaletteMap || null;

  return {
    ...topologyBundle,
    renderProfile,
    locales: cityLocalizationMerged.locales,
    geoAliases: cityLocalizationMerged.geoAliases,
    worldCities,
    cityAliases,
    hierarchy,
    ruCityOverrides,
    specialZones,
    runtimePoliticalTopology,
    paletteRegistry,
    releasableCatalog,
    contextLayerExternal,
    activePaletteMeta,
    activePalettePack,
    activePaletteMap,
    localeLevel: startupBootArtifacts?.localeLevel || localizationBundle.localeLevel || localizationUrls.localeLevel,
    startupBootCacheState: startupBootArtifacts?.startupBootCacheState || createDefaultStartupBootCacheState(false),
    startupWorkerUsed: !!startupBootArtifacts?.startupWorkerUsed,
    startupDecodedCollections: startupBootArtifacts?.decodedCollections || null,
    resourceMetrics: {
      ...(topologyBundle.resourceMetrics || {}),
      locales: localizationBundle.resourceMetrics?.locales || null,
      geoAliases: localizationBundle.resourceMetrics?.geoAliases || null,
    },
  };
}

export async function loadCitySupportData({
  d3Client = globalThis.d3,
  worldCitiesUrls = WORLD_CITIES_URLS,
  cityAliasesUrls = CITY_ALIASES_URLS,
  locales = { ui: {}, geo: {} },
  geoAliases = { alias_to_stable_key: {} },
  includeLocalization = true,
  cityCollection = null,
  deferLocalization = false,
  prepareCandidate = finishCityPreparation,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadCitySupportData().");
  }

  const [worldCities, cityAliases] = await Promise.all([
    cityCollection || loadOptionalJsonCandidate(d3Client, worldCitiesUrls, {
      label: "world_cities",
      normalizer: (payload) => prepareCandidate(normalizeCityFeatureCollectionSteps(payload, { sourceLabel: "world_cities" })),
    }),
    includeLocalization ? loadOptionalJsonCandidate(d3Client, cityAliasesUrls, {
      label: "city_aliases",
      normalizer: (payload) => (payload && typeof payload === "object" ? payload : null),
    }) : null,
  ]);

  if (!includeLocalization) return { worldCities, localizationReady: false };
  // The pipeline rebases localization against its current snapshot after fetch,
  // rather than publishing a merge against dictionaries captured before IO.
  if (deferLocalization) return { worldCities, cityAliases, localizationReady: true, localizationDeferred: true };
  const merged = mergeCityLocalizationData({
    locales,
    geoAliases,
    cityCollection: worldCities,
    cityAliases,
  });

  return {
    worldCities,
    cityAliases,
    locales: merged.locales,
    geoAliases: merged.geoAliases,
    cityLocalizationPatch: merged.cityLocalizationPatch,
    localizationReady: true,
  };
}

export {
  buildCityLocalizationPatch,
  buildCityLocalizationPatchSteps,
  getCityLocaleEntry,
  mergeCityLocalizationData,
  normalizeCityText,
  normalizeCityFeatureCollection,
  normalizeScenarioCityOverridesPayload,
  normalizeScenarioGeoLocalePatchPayload,
} from "./data_loader/city_normalization.js";
export {
  loadContextLayerPack,
  normalizeRequestedContextLayerNames,
} from "./data_loader/context_pack_loader.js";
export {
  loadLocalizationData,
  loadMeasuredJsonResource,
  loadStartupBootArtifacts,
} from "./data_loader/startup_artifact_loader.js";
