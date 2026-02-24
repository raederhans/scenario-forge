// Data loading helpers (Phase 13 scaffold)

const TOPOLOGY_VARIANT_URLS = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
};

const DETAIL_SOURCES = {
  highres: "data/europe_topology.highres.json",
  legacy_bak: "data/europe_topology.json.bak",
};

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
      `[data_loader] Ignoring unknown topology_variant="${raw}". Allowed values: highres, legacy_bak.`
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
    return { key: "legacy_bak", url: DETAIL_SOURCES.legacy_bak };
  }

  const raw = params.get("detail_source");
  if (!raw) {
    return { key: "legacy_bak", url: DETAIL_SOURCES.legacy_bak };
  }

  const key = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(DETAIL_SOURCES, key)) {
    console.warn(
      `[data_loader] Ignoring unknown detail_source="${raw}". Allowed values: highres, legacy_bak.`
    );
    return { key: "legacy_bak", url: DETAIL_SOURCES.legacy_bak };
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

  let topologyDetail = null;
  try {
    topologyDetail = await loadTopologyUrl(d3Client, detailSource.url, `detail(${detailSource.key})`);
  } catch (error) {
    console.warn(
      `[data_loader] Detail topology (${detailSource.key}) unavailable at ${detailSource.url}; continuing with primary only.`,
      error
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
  d3Client = globalThis.d3,
} = {}) {
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available. Ensure D3 is loaded before calling loadMapData().");
  }

  const [topologyBundle, localeData, geoAliases, hierarchy] = await Promise.all([
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
  ]);

  return {
    ...topologyBundle,
    locales: localeData || { ui: {}, geo: {} },
    geoAliases: geoAliases || { alias_to_stable_key: {} },
    hierarchy,
  };
}
