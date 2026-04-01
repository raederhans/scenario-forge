/* global importScripts, self */

importScripts(new URL("../../vendor/topojson-client.min.js", self.location.href).href);

const MESSAGE_TYPES = Object.freeze({
  LOAD_BASE_STARTUP: "LOAD_BASE_STARTUP",
  LOAD_STARTUP_BUNDLE: "LOAD_STARTUP_BUNDLE",
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
  DECODE_RUNTIME_CHUNK: "DECODE_RUNTIME_CHUNK",
  BASE_STARTUP_READY: "BASE_STARTUP_READY",
  STARTUP_BUNDLE_READY: "STARTUP_BUNDLE_READY",
  SCENARIO_RUNTIME_BOOTSTRAP_READY: "SCENARIO_RUNTIME_BOOTSTRAP_READY",
  RUNTIME_CHUNK_READY: "RUNTIME_CHUNK_READY",
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

async function decompressGzipBytes(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is not available.");
  }
  const blob = new Blob([bytes], { type: "application/gzip" });
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function buildGzipCandidateUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized || normalized.endsWith(".gz") || !normalized.endsWith(".json")) {
    return "";
  }
  return `${normalized}.gz`;
}

async function fetchJsonResourceWithOptionalGzip(url, label) {
  const gzipUrl = buildGzipCandidateUrl(url);
  if (gzipUrl) {
    try {
      const resolvedUrl = new URL(gzipUrl, `${self.location.origin}/`).toString();
      const startedAt = nowMs();
      const response = await fetch(resolvedUrl, {
        cache: "default",
        credentials: "same-origin",
      });
      const headersReceivedAt = nowMs();
      if (response.ok) {
        const compressedBytes = await response.arrayBuffer();
        const fetchCompletedAt = nowMs();
        const rawText = await decompressGzipBytes(compressedBytes);
        const decompressedAt = nowMs();
        const payload = rawText ? JSON.parse(rawText) : null;
        const parsedAt = nowMs();
        return {
          payload,
          metrics: {
            url: resolvedUrl,
            label,
            transferMs: headersReceivedAt - startedAt,
            fetchMs: fetchCompletedAt - startedAt,
            decompressMs: decompressedAt - fetchCompletedAt,
            jsonParseMs: parsedAt - decompressedAt,
            totalMs: parsedAt - startedAt,
            bytes: rawText.length,
            compressedBytes: compressedBytes.byteLength,
            compressed: true,
          },
        };
      }
    } catch (_error) {
      // Fall back to plain JSON below.
    }
  }
  const plainResult = await fetchJsonResource(url, label);
  return {
    ...plainResult,
    metrics: {
      ...(plainResult.metrics || {}),
      compressed: false,
      compressedBytes: 0,
      decompressMs: 0,
    },
  };
}

function getPoliticalGeometryCount(topology) {
  return Array.isArray(topology?.objects?.political?.geometries)
    ? topology.objects.political.geometries.length
    : 0;
}

function decodeTopologyObject(topology, objectName) {
  const object = topology?.objects?.[objectName];
  if (!object || typeof self.topojson?.feature !== "function") {
    return null;
  }
  try {
    const collection = self.topojson.feature(topology, object);
    if (!collection || typeof collection !== "object") {
      return null;
    }
    return collection;
  } catch (_error) {
    return null;
  }
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

function countObjectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
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
    decodedCollections: {
      landData: decodeTopologyObject(topologyResult.payload, "political"),
      specialZonesData: decodeTopologyObject(topologyResult.payload, "special_zones"),
      riversData: decodeTopologyObject(topologyResult.payload, "rivers"),
      waterRegionsData: decodeTopologyObject(topologyResult.payload, "water_regions"),
      oceanData: decodeTopologyObject(topologyResult.payload, "ocean"),
      landBgData: decodeTopologyObject(topologyResult.payload, "land"),
      urbanData: decodeTopologyObject(topologyResult.payload, "urban"),
      physicalData: decodeTopologyObject(topologyResult.payload, "physical"),
    },
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

async function handleLoadStartupBundle(message) {
  const taskId = String(message?.taskId || "").trim();
  const startupBundleUrl = String(message?.startupBundleUrl || "").trim();
  const expectedScenarioId = String(message?.scenarioId || "").trim();
  const language = String(message?.language || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
  const startedAt = nowMs();
  const startupBundleResult = await fetchJsonResourceWithOptionalGzip(startupBundleUrl, "startupBundle");
  const payload = startupBundleResult.payload && typeof startupBundleResult.payload === "object"
    ? startupBundleResult.payload
    : null;
  if (!payload) {
    throw new Error(`[startup_worker] Startup bundle payload missing or invalid at ${startupBundleUrl}.`);
  }
  const scenarioId = String(payload.scenario_id || payload.manifest_subset?.scenario_id || "").trim();
  if (!scenarioId) {
    throw new Error("[startup_worker] Startup bundle is missing scenario_id.");
  }
  if (expectedScenarioId && expectedScenarioId !== scenarioId) {
    throw new Error(
      `[startup_worker] Startup bundle scenario mismatch. Expected "${expectedScenarioId}" but received "${scenarioId}".`
    );
  }
  const topologyPrimary = payload.base?.topology_primary || null;
  const runtimeTopology = payload.scenario?.runtime_topology_bootstrap || null;
  if (!topologyPrimary?.objects?.political) {
    throw new Error("[startup_worker] Startup bundle is missing base topology.");
  }
  if (!runtimeTopology?.objects?.political) {
    throw new Error("[startup_worker] Startup bundle is missing runtime bootstrap topology.");
  }
  const baseDecodeStartedAt = nowMs();
  const baseDecodedCollections = {
    landData: decodeTopologyObject(topologyPrimary, "political"),
    specialZonesData: decodeTopologyObject(topologyPrimary, "special_zones"),
    riversData: decodeTopologyObject(topologyPrimary, "rivers"),
    waterRegionsData: decodeTopologyObject(topologyPrimary, "water_regions"),
    oceanData: decodeTopologyObject(topologyPrimary, "ocean"),
    landBgData: decodeTopologyObject(topologyPrimary, "land"),
    urbanData: decodeTopologyObject(topologyPrimary, "urban"),
    physicalData: decodeTopologyObject(topologyPrimary, "physical"),
  };
  const baseDecodeCompletedAt = nowMs();
  const runtimeDecodeStartedAt = nowMs();
  const runtimeDecodedCollections = {
    politicalData: decodeTopologyObject(runtimeTopology, "political"),
    scenarioLandMaskData:
      decodeTopologyObject(runtimeTopology, "land_mask")
      || decodeTopologyObject(runtimeTopology, "land"),
    scenarioContextLandMaskData: decodeTopologyObject(runtimeTopology, "context_land_mask"),
    scenarioWaterRegionsData: decodeTopologyObject(runtimeTopology, "scenario_water"),
    scenarioSpecialRegionsData: decodeTopologyObject(runtimeTopology, "scenario_special_land"),
  };
  const runtimeDecodeCompletedAt = nowMs();
  const runtimePoliticalMeta = buildRuntimePoliticalMeta(runtimeTopology);
  const metaCompletedAt = nowMs();
  postWorkerMessage(MESSAGE_TYPES.STARTUP_BUNDLE_READY, {
    taskId,
    payload,
    baseDecodedCollections,
    runtimeDecodedCollections,
    runtimePoliticalMeta,
    metrics: {
      totalMs: nowMs() - startedAt,
      startupBundle: {
        ...(startupBundleResult.metrics || {}),
        scenarioId,
        language,
      },
      topologyPrimary: {
        featureCount: getPoliticalGeometryCount(topologyPrimary),
        decodeMs: baseDecodeCompletedAt - baseDecodeStartedAt,
      },
      runtimeTopology: {
        featureCount: getPoliticalGeometryCount(runtimeTopology),
        decodeMs: runtimeDecodeCompletedAt - runtimeDecodeStartedAt,
      },
      runtimePoliticalMeta: {
        featureCount: Array.isArray(runtimePoliticalMeta.featureIds)
          ? runtimePoliticalMeta.featureIds.length
          : 0,
        buildMs: metaCompletedAt - runtimeDecodeCompletedAt,
      },
      geoLocalePatch: {
        present: !!payload?.scenario?.geo_locale_patch,
        language,
        localeSpecific: true,
      },
      countries: {
        count: countObjectKeys(payload?.scenario?.countries?.countries),
      },
      owners: {
        count: countObjectKeys(payload?.scenario?.owners?.owners),
      },
      controllers: {
        count: countObjectKeys(payload?.scenario?.controllers?.controllers),
      },
      cores: {
        count: countObjectKeys(payload?.scenario?.cores?.cores),
      },
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
    decodedCollections: {
      politicalData: decodeTopologyObject(runtimeTopologyResult.payload, "political"),
      scenarioLandMaskData:
        decodeTopologyObject(runtimeTopologyResult.payload, "land_mask")
        || decodeTopologyObject(runtimeTopologyResult.payload, "land"),
      scenarioContextLandMaskData: decodeTopologyObject(runtimeTopologyResult.payload, "context_land_mask"),
      scenarioWaterRegionsData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_water"),
      scenarioSpecialRegionsData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_special_land"),
    },
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

async function handleDecodeRuntimeChunk(message) {
  const taskId = String(message?.taskId || "").trim();
  const runtimeTopologyUrl = String(message?.runtimeTopologyUrl || "").trim();
  const chunkUrl = String(message?.chunkUrl || "").trim();
  const chunkType = String(message?.chunkType || "").trim().toLowerCase();
  const startedAt = nowMs();
  if (chunkType && chunkType !== "runtime-topology") {
    const chunkResult = await fetchJsonResource(chunkUrl, chunkType || "scenarioChunk");
    postWorkerMessage(MESSAGE_TYPES.RUNTIME_CHUNK_READY, {
      taskId,
      chunkPayload: chunkResult.payload || null,
      metrics: {
        totalMs: nowMs() - startedAt,
        chunkPayload: chunkResult.metrics || null,
      },
    });
    return;
  }
  const runtimeTopologyResult = await fetchJsonResource(runtimeTopologyUrl, "runtimePoliticalTopology");
  const metaStartedAt = nowMs();
  const runtimePoliticalMeta = buildRuntimePoliticalMeta(runtimeTopologyResult.payload);
  const metaCompletedAt = nowMs();

  postWorkerMessage(MESSAGE_TYPES.RUNTIME_CHUNK_READY, {
    taskId,
    runtimePoliticalTopology: runtimeTopologyResult.payload,
    runtimePoliticalMeta,
    decodedCollections: {
      politicalData: decodeTopologyObject(runtimeTopologyResult.payload, "political"),
      scenarioLandMaskData:
        decodeTopologyObject(runtimeTopologyResult.payload, "land_mask")
        || decodeTopologyObject(runtimeTopologyResult.payload, "land"),
      scenarioContextLandMaskData: decodeTopologyObject(runtimeTopologyResult.payload, "context_land_mask"),
      scenarioWaterRegionsData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_water"),
      scenarioSpecialRegionsData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_special_land"),
    },
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
    case MESSAGE_TYPES.LOAD_STARTUP_BUNDLE:
      await handleLoadStartupBundle(message);
      return;
    case MESSAGE_TYPES.LOAD_SCENARIO_RUNTIME_BOOTSTRAP:
      await handleLoadScenarioRuntimeBootstrap(message);
      return;
    case MESSAGE_TYPES.DECODE_RUNTIME_CHUNK:
      await handleDecodeRuntimeChunk(message);
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
