// Data loading helpers (Phase 13 scaffold)

const TOPOLOGY_VARIANT_URLS = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
  na_v1: "data/europe_topology.na_v1.json",
  na_v2: "data/europe_topology.na_v2.json",
};

const DETAIL_SOURCES = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
  na_v1: "data/europe_topology.na_v1.json",
  na_v2: "data/europe_topology.na_v2.json",
};
const DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const RU_CITY_OVERRIDES_URL = "data/ru_city_overrides.geojson";
const SPECIAL_ZONES_URL = "data/special_zones.geojson";
const RUNTIME_POLITICAL_URL = "data/europe_topology.runtime_political_v1.json";
const GLOBAL_RIVERS_CONTEXT_PACK_URL = "data/global_rivers.geojson";
const CONTEXT_LAYER_PACKS = {
  physical: { url: "data/europe_physical.geojson", format: "geojson" },
  urban: { url: "data/europe_urban.geojson", format: "geojson" },
  physical_semantics: {
    url: "data/global_physical_semantics.topo.json",
    format: "topology",
    objectName: "physical_semantics",
  },
  physical_contours_major: {
    url: "data/global_contours.major.topo.json",
    format: "topology",
    objectName: "contours",
  },
  physical_contours_minor: {
    url: "data/global_contours.minor.topo.json",
    format: "topology",
    objectName: "contours",
  },
};
const PALETTE_REGISTRY_URL = "data/palettes/index.json";
const RELEASABLE_CATALOG_URL = "data/releasables/hoi4_vanilla.internal.phase1.catalog.json";
const RENDER_PROFILES = new Set(["auto", "balanced", "full"]);

async function loadRiversFallbackCollection(d3Client) {
  try {
    const payload = await d3Client.json(GLOBAL_RIVERS_CONTEXT_PACK_URL);
    if (!Array.isArray(payload?.features)) {
      console.warn(
        `[data_loader] Rivers fallback pack invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`
      );
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  } catch (err) {
    console.warn(
      `[data_loader] Rivers fallback pack missing or invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`,
      err
    );
    return null;
  }
}

async function loadOptionalContextLayerPacks(d3Client) {
  const riversCollection = await loadRiversFallbackCollection(d3Client);
  const entries = await Promise.all(
    Object.entries(CONTEXT_LAYER_PACKS).map(async ([layerName, descriptor]) => {
      const { url, format = "geojson", objectName = "" } = descriptor || {};
      try {
        const payload = await d3Client.json(url);
        if (format === "topology") {
          const object = payload?.objects?.[objectName];
          const collection = object && globalThis.topojson
            ? globalThis.topojson.feature(payload, object)
            : null;
          if (!Array.isArray(collection?.features)) {
            console.warn(`[data_loader] Context topology pack invalid at ${url}. Ignoring ${layerName}.`);
            return [layerName, null];
          }
          return [layerName, collection];
        }
        if (!Array.isArray(payload?.features)) {
          console.warn(`[data_loader] Context layer pack invalid at ${url}. Ignoring ${layerName}.`);
          return [layerName, null];
        }
        return [
          layerName,
          {
            type: "FeatureCollection",
            features: payload.features,
          },
        ];
      } catch (err) {
        console.warn(`[data_loader] Context layer pack missing or invalid at ${url}. Ignoring ${layerName}.`, err);
        return [layerName, null];
      }
    })
  );

  const contextCollections = Object.fromEntries(
    entries.filter(([, collection]) => Array.isArray(collection?.features))
  );
  if (Array.isArray(riversCollection?.features)) {
    contextCollections.rivers = riversCollection;
  }
  return contextCollections;
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

async function loadTopologyUrl(d3Client, url, label) {
  const topology = await d3Client.json(url);
  const count = getPoliticalGeometryCount(topology);
  console.info(`[data_loader] Loaded ${label} topology ${url} (${count} features).`);
  return topology;
}

async function loadExplicitVariant({
  topologyUrl,
  d3Client,
  variant,
} = {}) {
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
      return await loadTopologyUrl(d3Client, url, "single");
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
      const topology = await loadTopologyUrl(
        d3Client,
        candidate.url,
        `detail(${candidate.key})`
      );
      return { topology, sourceKey: candidate.key };
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
} = {}) {
  const variant = resolveTopologyVariant();
  if (variant?.url) {
    console.info(
      `[data_loader] topology_variant=${variant.key} explicitly requested. Running single-topology mode.`
    );
    const single = await loadExplicitVariant({ topologyUrl, d3Client, variant });
    return {
      topology: single,
      topologyPrimary: single,
      topologyDetail: null,
      topologyBundleMode: "single",
      topologyVariant: variant.key,
      detailDeferred: false,
      detailSourceRequested: null,
    };
  }

  const detailLayerEnabled = resolveDetailLayerEnabled();
  const detailSource = resolveDetailSource();
  const topologyPrimary = await loadTopologyUrl(d3Client, topologyUrl, "primary");

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
    };
  }

  if (shouldDeferDetailLoad(renderProfile)) {
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
    };
  }

  const { topology: topologyDetail, sourceKey: detailSourceUsed } =
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
  };
}

export async function loadDeferredDetailBundle({
  d3Client = globalThis.d3,
  detailSourceKey = null,
  detailSourceKeys = null,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
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

  const [{ topology: topologyDetail, sourceKey: detailSourceUsed }, runtimePoliticalTopology] =
    await Promise.all([
      loadDetailTopologyWithFallback({
        d3Client,
        detailSource,
        candidateKeys: orderedDetailSourceKeys,
      }),
      d3Client.json(runtimePoliticalUrl).catch((err) => {
        console.warn("Runtime political topology missing or invalid during deferred load.", err);
        return null;
      }),
    ]);

  return {
    topologyDetail,
    runtimePoliticalTopology,
    topologyBundleMode: topologyDetail ? "composite" : "single",
    detailSourceUsed: detailSourceUsed || resolvedKey,
  };
}

export async function loadMapData({
  topologyUrl = "data/europe_topology.json",
  localesUrl = "data/locales.json",
  geoAliasesUrl = "data/geo_aliases.json",
  hierarchyUrl = "data/hierarchy.json",
  ruCityOverridesUrl = RU_CITY_OVERRIDES_URL,
  specialZonesUrl = SPECIAL_ZONES_URL,
  runtimePoliticalUrl = RUNTIME_POLITICAL_URL,
  paletteRegistryUrl = PALETTE_REGISTRY_URL,
  releasableCatalogUrl = RELEASABLE_CATALOG_URL,
  d3Client = globalThis.d3,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadMapData().");
  }

  const renderProfile = resolveRenderProfile();
  const topologyBundle = await loadTopologyBundle({ topologyUrl, d3Client, renderProfile });
  const runtimePoliticalPromise = topologyBundle.detailDeferred
    ? Promise.resolve(null)
    : d3Client.json(runtimePoliticalUrl).catch((err) => {
      console.warn("Runtime political topology missing or invalid, continuing without dynamic sovereignty.", err);
      return null;
    });

  const paletteRegistryPromise = d3Client.json(paletteRegistryUrl).catch((err) => {
    console.warn("Palette registry missing or invalid, continuing with legacy palette fallback.", err);
    return null;
  });
  const releasableCatalogPromise = d3Client.json(releasableCatalogUrl).catch((err) => {
    console.warn("Releasable catalog missing or invalid, continuing without releasable overlays.", err);
    return null;
  });
  const contextLayerPackPromise = loadOptionalContextLayerPacks(d3Client);

  const [
    localeData,
    geoAliases,
    hierarchy,
    ruCityOverrides,
    specialZones,
    runtimePoliticalTopology,
    paletteRegistry,
    releasableCatalog,
    contextLayerExternal,
  ] = await Promise.all([
    d3Client.json(localesUrl).catch((err) => {
      console.warn("Locales file missing or invalid, using defaults.", err);
      return { ui: {}, geo: {} };
    }),
    d3Client.json(geoAliasesUrl).catch((err) => {
      console.warn("Geo alias file missing or invalid, using defaults.", err);
      return { alias_to_stable_key: {} };
    }),
    d3Client.json(hierarchyUrl).catch((err) => {
      console.warn("Hierarchy file missing or invalid, using defaults.", err);
      return null;
    }),
    d3Client.json(ruCityOverridesUrl).then((payload) => {
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
      }),
    d3Client.json(specialZonesUrl).then((payload) => {
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
    }),
    runtimePoliticalPromise,
    paletteRegistryPromise,
    releasableCatalogPromise,
    contextLayerPackPromise,
  ]);

  let activePaletteMeta = null;
  let activePalettePack = null;
  let activePaletteMap = null;
  if (Array.isArray(paletteRegistry?.palettes) && paletteRegistry.palettes.length > 0) {
    const defaultPaletteId = String(
      paletteRegistry.default_palette_id || paletteRegistry.palettes[0]?.palette_id || ""
    ).trim();
    activePaletteMeta =
      paletteRegistry.palettes.find((entry) => String(entry?.palette_id || "").trim() === defaultPaletteId)
      || paletteRegistry.palettes[0]
      || null;
    const paletteUrl = String(activePaletteMeta?.palette_url || "").trim();
    const mapUrl = String(activePaletteMeta?.map_url || "").trim();
    [activePalettePack, activePaletteMap] = await Promise.all([
      paletteUrl
        ? d3Client.json(paletteUrl).catch((err) => {
          console.warn(`Palette pack missing or invalid at ${paletteUrl}, continuing without asset palette.`, err);
          return null;
        })
        : Promise.resolve(null),
      mapUrl
        ? d3Client.json(mapUrl).catch((err) => {
          console.warn(`Palette map missing or invalid at ${mapUrl}, continuing without asset palette mapping.`, err);
          return null;
        })
        : Promise.resolve(null),
    ]);
  }

  return {
    ...topologyBundle,
    renderProfile,
    locales: localeData || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
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
  };
}

