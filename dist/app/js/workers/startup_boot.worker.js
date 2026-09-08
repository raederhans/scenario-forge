/* global importScripts, self */

importScripts(
  new URL("../core/feature_identity_shared.js", self.location.href).href,
  new URL("../../vendor/topojson-client.min.js", self.location.href).href
);

const MESSAGE_TYPES = Object.freeze({
  LOAD_BASE_STARTUP: "LOAD_BASE_STARTUP",
  LOAD_STARTUP_BUNDLE: "LOAD_STARTUP_BUNDLE",
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
  DECODE_RUNTIME_CHUNK: "DECODE_RUNTIME_CHUNK",
  BASE_STARTUP_READY: "BASE_STARTUP_READY",
  STARTUP_BUNDLE_READY: "STARTUP_BUNDLE_READY",
  SCENARIO_RUNTIME_BOOTSTRAP_READY: "SCENARIO_RUNTIME_BOOTSTRAP_READY",
  RUNTIME_CHUNK_READY: "RUNTIME_CHUNK_READY",
  CANCEL_TASK: "CANCEL_TASK",
  ERROR: "ERROR",
});

const decodeTaskControllers = new Map();

const COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});
const FEATURE_IDENTITY = globalThis.__scenarioForgeFeatureIdentityShared;

if (!FEATURE_IDENTITY) {
  throw new Error("[startup_worker] Feature identity shared helper failed to initialize.");
}

function normalizeWorkerCountryCodeAlias(rawCode) {
  const code = FEATURE_IDENTITY.defaultCountryCodeNormalizer(rawCode);
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function getFeatureId(feature) {
  return FEATURE_IDENTITY.getFeatureId(feature) || null;
}

function getFeatureCountryCodeNormalized(feature) {
  return FEATURE_IDENTITY.getCountryCode(feature, {
    normalizeAlias: normalizeWorkerCountryCodeAlias,
  });
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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function createWorkerAbortError(reason = null) {
  if (reason instanceof Error && reason.name === "AbortError") {
    return reason;
  }
  if (typeof DOMException === "function") {
    return new DOMException("Startup worker task aborted.", "AbortError");
  }
  const error = new Error("Startup worker task aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createWorkerAbortError(signal.reason);
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

async function fetchJsonResource(url, label, { signal = null } = {}) {
  throwIfAborted(signal);
  if (!url) {
    throw new Error(`[startup_worker] Missing URL for ${label}.`);
  }
  const resolvedUrl = new URL(String(url), `${self.location.origin}/`).toString();
  const startedAt = nowMs();
  const response = await fetch(resolvedUrl, {
    cache: "default",
    credentials: "same-origin",
    signal,
  });
  const headersReceivedAt = nowMs();
  if (!response.ok) {
    throw new Error(`[startup_worker] Failed to fetch ${label} at ${url} (${response.status} ${response.statusText}).`);
  }
  const rawText = await response.text();
  throwIfAborted(signal);
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

async function fetchJsonResourceWithOptionalGzip(url, label, { signal = null } = {}) {
  throwIfAborted(signal);
  const gzipUrl = buildGzipCandidateUrl(url);
  if (gzipUrl) {
    try {
      const resolvedUrl = new URL(gzipUrl, `${self.location.origin}/`).toString();
      const startedAt = nowMs();
      const response = await fetch(resolvedUrl, {
        cache: "default",
        credentials: "same-origin",
        signal,
      });
      const headersReceivedAt = nowMs();
      if (response.ok) {
        const compressedBytes = await response.arrayBuffer();
        throwIfAborted(signal);
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
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (signal?.aborted) {
        throw createWorkerAbortError(signal.reason);
      }
      // Fall back to plain JSON below.
    }
  }
  const plainResult = await fetchJsonResource(url, label, { signal });
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
  const objectNames = ["political", "scenario_atlantropa"];
  const featureIds = [];
  const featureIndexById = {};
  const canonicalCountryByFeatureId = {};
  const neighborGraph = [];

  objectNames.forEach((objectName) => {
    const runtimeObject = runtimePoliticalTopology?.objects?.[objectName];
    const geometries = Array.isArray(runtimeObject?.geometries) ? runtimeObject.geometries : [];
    const neighbors = Array.isArray(runtimeObject?.computed_neighbors) ? runtimeObject.computed_neighbors : [];
    geometries.forEach((geometry, index) => {
      const id = getEntityFeatureId(geometry);
      if (!id) return;
      featureIndexById[id] = featureIds.length;
      featureIds.push(id);
      canonicalCountryByFeatureId[id] = getEntityCountryCode(geometry);
      neighborGraph.push(
        objectName === "political" && Array.isArray(neighbors[index])
          ? neighbors[index]
          : []
      );
    });
  });

  return {
    featureIds,
    featureIndexById,
    canonicalCountryByFeatureId,
    neighborGraph,
  };
}

function normalizeRuntimePoliticalMetaPayload(meta) {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const featureIds = Array.isArray(meta.featureIds)
    ? meta.featureIds.map((featureId) => String(featureId || "").trim()).filter(Boolean)
    : [];
  const featureIndexById = {};
  featureIds.forEach((featureId, index) => {
    featureIndexById[featureId] = index;
  });
  const canonicalCountryByFeatureId = {};
  if (Array.isArray(meta.canonicalCountryByIndex)) {
    featureIds.forEach((featureId, index) => {
      canonicalCountryByFeatureId[featureId] = normalizeWorkerCountryCodeAlias(meta.canonicalCountryByIndex[index]);
    });
  } else if (meta.canonicalCountryByFeatureId && typeof meta.canonicalCountryByFeatureId === "object") {
    Object.entries(meta.canonicalCountryByFeatureId).forEach(([featureId, countryCode]) => {
      const normalizedFeatureId = String(featureId || "").trim();
      if (!normalizedFeatureId) return;
      canonicalCountryByFeatureId[normalizedFeatureId] = normalizeWorkerCountryCodeAlias(countryCode);
      if (!(normalizedFeatureId in featureIndexById)) {
        featureIndexById[normalizedFeatureId] = featureIds.length;
        featureIds.push(normalizedFeatureId);
      }
    });
  }
  return {
    featureIds,
    featureIndexById: meta.featureIndexById && typeof meta.featureIndexById === "object"
      ? { ...featureIndexById, ...meta.featureIndexById }
      : featureIndexById,
    canonicalCountryByFeatureId,
    neighborGraph: Array.isArray(meta.neighborGraph) ? [...meta.neighborGraph] : [],
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
  const needTopologyPrimary = message?.needTopologyPrimary !== false;
  const needLocales = message?.needLocales !== false;
  const needGeoAliases = message?.needGeoAliases !== false;
  const startedAt = nowMs();

  const [topologyResult, localesResult, geoAliasesResult] = await Promise.all([
    needTopologyPrimary
      ? fetchJsonResource(topologyUrl, "topologyPrimary")
      : Promise.resolve({ payload: null, metrics: null }),
    needLocales
      ? fetchJsonResource(localesUrl, "locales")
      : Promise.resolve({ payload: null, metrics: null }),
    needGeoAliases
      ? fetchJsonResource(geoAliasesUrl, "geoAliases")
      : Promise.resolve({ payload: null, metrics: null }),
  ]);

  const topologyForDecode = topologyResult.payload || message?.cachedTopologyPrimary || null;
  postWorkerMessage(MESSAGE_TYPES.BASE_STARTUP_READY, {
    taskId,
    topologyPrimary: topologyResult.payload,
    locales: needLocales ? (localesResult.payload || { ui: {}, geo: {} }) : null,
    geoAliases: needGeoAliases ? (geoAliasesResult.payload || { alias_to_stable_key: {} }) : null,
    decodedCollections: topologyForDecode
      ? {
        landData: decodeTopologyObject(topologyForDecode, "political"),
        specialZonesData: decodeTopologyObject(topologyForDecode, "special_zones"),
        riversData: decodeTopologyObject(topologyForDecode, "rivers"),
        waterRegionsData: decodeTopologyObject(topologyForDecode, "water_regions"),
        oceanData: decodeTopologyObject(topologyForDecode, "ocean"),
        landBgData: decodeTopologyObject(topologyForDecode, "land"),
        urbanData: decodeTopologyObject(topologyForDecode, "urban"),
        physicalData: decodeTopologyObject(topologyForDecode, "physical"),
      }
      : null,
    metrics: {
      totalMs: nowMs() - startedAt,
      topologyPrimary: topologyResult.payload
        ? {
          ...(topologyResult.metrics || {}),
          featureCount: getPoliticalGeometryCount(topologyResult.payload),
        }
        : null,
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
  const runtimePoliticalMetaPayload = normalizeRuntimePoliticalMetaPayload(payload?.scenario?.runtime_political_meta || null);
  const bootstrapStrategy = String(payload?.scenario?.bootstrap_strategy || "").trim();
  if (!topologyPrimary?.objects?.political) {
    throw new Error("[startup_worker] Startup bundle is missing base topology.");
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
  let runtimeDecodedCollections = null;
  let runtimePoliticalMeta = null;
  let runtimeDecodeCompletedAt = baseDecodeCompletedAt;
  let metaCompletedAt = runtimeDecodeCompletedAt;
  if (runtimeTopology?.objects) {
    const runtimeDecodeStartedAt = nowMs();
    runtimeDecodedCollections = {
      politicalData: runtimeTopology?.objects?.political
        ? decodeTopologyObject(runtimeTopology, "political")
        : null,
      scenarioLandMaskData:
        decodeTopologyObject(runtimeTopology, "land_mask")
        || decodeTopologyObject(runtimeTopology, "land"),
      scenarioContextLandMaskData: decodeTopologyObject(runtimeTopology, "context_land_mask"),
      scenarioWaterRegionsData: decodeTopologyObject(runtimeTopology, "scenario_water"),
      scenarioSpecialRegionsData: decodeTopologyObject(runtimeTopology, "scenario_special_land"),
      scenarioAtlantropaData: decodeTopologyObject(runtimeTopology, "scenario_atlantropa"),
    };
    runtimeDecodeCompletedAt = nowMs();
    runtimePoliticalMeta = runtimePoliticalMetaPayload
      || (runtimeTopology?.objects?.political ? buildRuntimePoliticalMeta(runtimeTopology) : null);
    metaCompletedAt = nowMs();
  }
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
        bootstrapStrategy,
      },
      topologyPrimary: {
        featureCount: getPoliticalGeometryCount(topologyPrimary),
        decodeMs: baseDecodeCompletedAt - baseDecodeStartedAt,
      },
      runtimeTopology: runtimeTopology?.objects
        ? {
          featureCount: runtimeTopology?.objects?.political
            ? getPoliticalGeometryCount(runtimeTopology)
            : (Array.isArray(runtimePoliticalMeta?.featureIds) ? runtimePoliticalMeta.featureIds.length : 0),
          decodeMs: runtimeDecodeCompletedAt - baseDecodeCompletedAt,
          deferred: !runtimeTopology?.objects?.political,
        }
        : {
          featureCount: 0,
          decodeMs: 0,
          deferred: true,
        },
      runtimePoliticalMeta: runtimePoliticalMeta
        ? {
          featureCount: Array.isArray(runtimePoliticalMeta.featureIds)
            ? runtimePoliticalMeta.featureIds.length
            : 0,
          buildMs: metaCompletedAt - runtimeDecodeCompletedAt,
        }
        : {
          featureCount: 0,
          buildMs: 0,
          deferred: true,
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
      scenarioAtlantropaData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_atlantropa"),
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

async function handleDecodeRuntimeChunk(message, { signal = null } = {}) {
  const taskId = String(message?.taskId || "").trim();
  const runtimeTopologyUrl = String(message?.runtimeTopologyUrl || "").trim();
  const chunkUrl = String(message?.chunkUrl || "").trim();
  const chunkType = String(message?.chunkType || "").trim().toLowerCase();
  const startedAt = nowMs();
  if (chunkType && chunkType !== "runtime-topology") {
    const chunkResult = await fetchJsonResource(chunkUrl, chunkType || "scenarioChunk", { signal });
    throwIfAborted(signal);
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
  const runtimeTopologyResult = await fetchJsonResource(runtimeTopologyUrl, "runtimePoliticalTopology", { signal });
  const metaStartedAt = nowMs();
  const runtimePoliticalMeta = buildRuntimePoliticalMeta(runtimeTopologyResult.payload);
  const metaCompletedAt = nowMs();

  throwIfAborted(signal);
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
      scenarioAtlantropaData: decodeTopologyObject(runtimeTopologyResult.payload, "scenario_atlantropa"),
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
      await dispatchDecodeRuntimeChunk(message);
      return;
    case MESSAGE_TYPES.CANCEL_TASK:
      cancelDecodeRuntimeChunk(message);
      return;
    default:
      throw new Error(`[startup_worker] Unsupported message type: ${String(message?.type || "") || "<empty>"}`);
  }
}

async function dispatchDecodeRuntimeChunk(message) {
  const taskId = String(message?.taskId || "").trim();
  const controller = new AbortController();
  decodeTaskControllers.set(taskId, controller);
  try {
    await handleDecodeRuntimeChunk(message, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    throw error;
  } finally {
    if (decodeTaskControllers.get(taskId) === controller) {
      decodeTaskControllers.delete(taskId);
    }
  }
}

function cancelDecodeRuntimeChunk(message) {
  const taskId = String(message?.taskId || "").trim();
  const controller = decodeTaskControllers.get(taskId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
}

self.onmessage = (event) => {
  const message = event?.data || {};
  void dispatchMessage(message).catch((error) => {
    postWorkerMessage(MESSAGE_TYPES.ERROR, {
      taskId: String(message?.taskId || "").trim(),
      stage: String(message?.type || "").trim() || "unknown",
      message: error?.message || String(error || "Unknown startup worker error."),
      name: error?.name || "Error",
    });
  });
};
