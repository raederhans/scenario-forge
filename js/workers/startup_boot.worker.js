/* global importScripts, self */

importScripts("/vendor/topojson-client.min.js");

const MESSAGE_TYPES = Object.freeze({
  LOAD_BASE_STARTUP: "LOAD_BASE_STARTUP",
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
  BASE_STARTUP_READY: "BASE_STARTUP_READY",
  SCENARIO_RUNTIME_BOOTSTRAP_READY: "SCENARIO_RUNTIME_BOOTSTRAP_READY",
  ERROR: "ERROR",
});

const COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function normalizeCountryCodeAlias(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function extractCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

function getFeatureId(feature) {
  const raw =
    feature?.properties?.id ??
    feature?.properties?.NUTS_ID ??
    feature?.id;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

function getFeatureCountryCodeNormalized(feature) {
  const props = feature?.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  const normalizedDirect = normalizeCountryCodeAlias(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }
  return normalizeCountryCodeAlias(
    extractCountryCodeFromId(props.id) ||
    extractCountryCodeFromId(props.NUTS_ID) ||
    extractCountryCodeFromId(feature?.id)
  );
}

function asFeatureLike(entity) {
  if (!entity || typeof entity !== "object") return null;
  return {
    id: entity.id,
    properties: entity.properties || {},
  };
}

function getEntityFeatureId(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureId(featureLike) : null;
}

function getEntityCountryCode(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureCountryCodeNormalized(featureLike) : "";
}

async function fetchJsonResource(url, label) {
  if (!url) {
    throw new Error(`[startup_worker] Missing URL for ${label}.`);
  }
  const resolvedUrl = new URL(String(url), `${self.location.origin}/`).toString();
  const startedAt = nowMs();
  const response = await fetch(resolvedUrl, {
    cache: "default",
    credentials: "same-origin",
  });
  const headersReceivedAt = nowMs();
  if (!response.ok) {
    throw new Error(`[startup_worker] Failed to fetch ${label} at ${url} (${response.status} ${response.statusText}).`);
  }
  const rawText = await response.text();
  const fetchCompletedAt = nowMs();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    throw new Error(`[startup_worker] Invalid JSON for ${label} at ${resolvedUrl}: ${error?.message || error}`);
  }
  const parsedAt = nowMs();
  return {
    payload,
    metrics: {
      url: resolvedUrl,
      label,
      transferMs: headersReceivedAt - startedAt,
      fetchMs: fetchCompletedAt - startedAt,
      jsonParseMs: parsedAt - fetchCompletedAt,
      totalMs: parsedAt - startedAt,
      bytes: rawText.length,
    },
  };
}

function getPoliticalGeometryCount(topology) {
  return Array.isArray(topology?.objects?.political?.geometries)
    ? topology.objects.political.geometries.length
    : 0;
}

function buildRuntimePoliticalMeta(runtimePoliticalTopology) {
  const geometries = Array.isArray(runtimePoliticalTopology?.objects?.political?.geometries)
    ? runtimePoliticalTopology.objects.political.geometries
    : [];
  const neighbors = Array.isArray(runtimePoliticalTopology?.objects?.political?.computed_neighbors)
    ? runtimePoliticalTopology.objects.political.computed_neighbors
    : [];

  const featureIds = [];
  const featureIndexById = {};
  const canonicalCountryByFeatureId = {};

  geometries.forEach((geometry, index) => {
    const id = getEntityFeatureId(geometry);
    if (!id) return;
    featureIds.push(id);
    featureIndexById[id] = index;
    canonicalCountryByFeatureId[id] = getEntityCountryCode(geometry);
  });

  return {
    featureIds,
    featureIndexById,
    canonicalCountryByFeatureId,
    neighborGraph:
      Array.isArray(neighbors) && neighbors.length === geometries.length
        ? neighbors
        : new Array(geometries.length).fill(null).map(() => []),
  };
}

function postWorkerMessage(type, payload) {
  self.postMessage({
    type,
    ...payload,
  });
}

async function handleLoadBaseStartup(message) {
  const taskId = String(message?.taskId || "").trim();
  const topologyUrl = String(message?.topologyUrl || "").trim();
  const localesUrl = String(message?.localesUrl || "").trim();
  const geoAliasesUrl = String(message?.geoAliasesUrl || "").trim();
  const startedAt = nowMs();

  const [topologyResult, localesResult, geoAliasesResult] = await Promise.all([
    fetchJsonResource(topologyUrl, "topologyPrimary"),
    fetchJsonResource(localesUrl, "locales"),
    fetchJsonResource(geoAliasesUrl, "geoAliases"),
  ]);

  postWorkerMessage(MESSAGE_TYPES.BASE_STARTUP_READY, {
    taskId,
    topologyPrimary: topologyResult.payload,
    locales: localesResult.payload || { ui: {}, geo: {} },
    geoAliases: geoAliasesResult.payload || { alias_to_stable_key: {} },
    metrics: {
      totalMs: nowMs() - startedAt,
      topologyPrimary: {
        ...(topologyResult.metrics || {}),
        featureCount: getPoliticalGeometryCount(topologyResult.payload),
      },
      locales: localesResult.metrics || null,
      geoAliases: geoAliasesResult.metrics || null,
    },
  });
}

async function handleLoadScenarioRuntimeBootstrap(message) {
  const taskId = String(message?.taskId || "").trim();
  const runtimeTopologyUrl = String(message?.runtimeTopologyUrl || "").trim();
  const startedAt = nowMs();
  const runtimeTopologyResult = await fetchJsonResource(runtimeTopologyUrl, "runtimePoliticalTopology");
  const metaStartedAt = nowMs();
  const runtimePoliticalMeta = buildRuntimePoliticalMeta(runtimeTopologyResult.payload);
  const metaCompletedAt = nowMs();

  postWorkerMessage(MESSAGE_TYPES.SCENARIO_RUNTIME_BOOTSTRAP_READY, {
    taskId,
    runtimePoliticalTopology: runtimeTopologyResult.payload,
    runtimePoliticalMeta,
    metrics: {
      totalMs: nowMs() - startedAt,
      runtimePoliticalTopology: {
        ...(runtimeTopologyResult.metrics || {}),
        featureCount: getPoliticalGeometryCount(runtimeTopologyResult.payload),
      },
      runtimePoliticalMeta: {
        featureCount: Array.isArray(runtimePoliticalMeta.featureIds)
          ? runtimePoliticalMeta.featureIds.length
          : 0,
        buildMs: metaCompletedAt - metaStartedAt,
      },
    },
  });
}

async function dispatchMessage(message) {
  switch (message?.type) {
    case MESSAGE_TYPES.LOAD_BASE_STARTUP:
      await handleLoadBaseStartup(message);
      return;
    case MESSAGE_TYPES.LOAD_SCENARIO_RUNTIME_BOOTSTRAP:
      await handleLoadScenarioRuntimeBootstrap(message);
      return;
    default:
      throw new Error(`[startup_worker] Unsupported message type: ${String(message?.type || "") || "<empty>"}`);
  }
}

self.onmessage = (event) => {
  const message = event?.data || {};
  void dispatchMessage(message).catch((error) => {
    postWorkerMessage(MESSAGE_TYPES.ERROR, {
      taskId: String(message?.taskId || "").trim(),
      stage: String(message?.type || "").trim() || "unknown",
      message: error?.message || String(error || "Unknown startup worker error."),
    });
  });
};
