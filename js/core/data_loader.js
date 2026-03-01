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
const RU_CITY_OVERRIDES_URL = "data/ru_city_overrides.geojson";
const SPECIAL_ZONES_URL = "data/special_zones.geojson";

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
} = {}) {
  const candidates = [];
  if (detailSource?.key && detailSource?.url) {
    candidates.push({ key: detailSource.key, url: detailSource.url });
  }

  if (detailSource?.key !== "na_v2") {
    candidates.push({ key: "na_v2", url: DETAIL_SOURCES.na_v2 });
  }

  if (detailSource?.key !== "na_v1") {
    candidates.push({ key: "na_v1", url: DETAIL_SOURCES.na_v1 });
  }

  if (detailSource?.key !== "legacy_bak") {
    candidates.push({ key: "legacy_bak", url: DETAIL_SOURCES.legacy_bak });
  }

  const deduped = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    if (!candidate?.url || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    deduped.push(candidate);
  });

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
  };
}

export async function loadMapData({
  topologyUrl = "data/europe_topology.json",
  localesUrl = "data/locales.json",
  geoAliasesUrl = "data/geo_aliases.json",
  hierarchyUrl = "data/hierarchy.json",
  ruCityOverridesUrl = RU_CITY_OVERRIDES_URL,
  specialZonesUrl = SPECIAL_ZONES_URL,
  d3Client = globalThis.d3,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadMapData().");
  }

  const [topologyBundle, localeData, geoAliases, hierarchy, ruCityOverrides, specialZones] = await Promise.all([
    loadTopologyBundle({ topologyUrl, d3Client }),
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
  ]);

  return {
    ...topologyBundle,
    locales: localeData || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    hierarchy,
    ruCityOverrides,
    specialZones,
  };
}

