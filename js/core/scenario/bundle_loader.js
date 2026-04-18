import {
  loadMeasuredJsonResource,
  normalizeScenarioGeoLocalePatchPayload,
} from "../data_loader.js";
import {
  normalizeIndexedCoreAssignmentPayload,
  normalizeIndexedTagAssignmentPayload,
  normalizeRuntimePoliticalMeta as normalizeStartupBundleRuntimePoliticalMeta,
} from "../startup_bundle_compaction.js";
import {
  decodeRuntimeChunkViaWorker,
  loadScenarioRuntimeBootstrapViaWorker,
  shouldUseStartupWorker,
} from "../startup_worker_client.js";
import {
  normalizeScenarioChunkManifest,
  normalizeScenarioContextLodManifest,
  normalizeScenarioRenderBudgetHints,
} from "../scenario_chunk_manager.js";
import {
  normalizeScenarioDistrictGroupsPayload,
} from "../scenario_districts.js";
import {
  cacheBust,
  getScenarioGeoLocalePatchDescriptor,
  loadOptionalScenarioResource as sharedLoadOptionalScenarioResource,
  normalizeScenarioId as sharedNormalizeScenarioId,
} from "./shared.js";

const SCENARIO_RUNTIME_SHELL_REQUIRED_OBJECTS = Object.freeze([
  "land_mask",
  "context_land_mask",
  "scenario_water",
]);

// Scenario bundle/registry loader helpers.
// 这个模块只承接“读 bundle / 读 registry / 读 audit / 做 baseline 对比”这类加载职责，
// 不直接拥有 runtime chunk、hydrate、UI transaction 或 scenario apply 流程。
// 外部仍然通过 scenario_resources.js 这个 facade 调用，避免一次性打破 import 面。

function getScenarioRegistryEntries(state) {
  return Array.isArray(state?.scenarioRegistry?.scenarios) ? state.scenarioRegistry.scenarios : [];
}

function getScenarioDisplayName(source, fallbackId = "", translate = (value) => value) {
  const entry = source && typeof source === "object" ? source : null;
  const rawDisplayName = String(
    entry?.display_name
    || entry?.displayName
    || fallbackId
    || (!entry ? source : "")
    || ""
  ).trim();
  if (!rawDisplayName) {
    return "";
  }
  return translate(rawDisplayName, "geo") || rawDisplayName;
}

function getScenarioNameMap(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const displayName = String(entry?.display_name || entry?.displayName || normalizedTag).trim();
    if (normalizedTag && displayName) {
      next[normalizedTag] = displayName;
    }
  });
  return next;
}

function getScenarioFixedOwnerColors(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const color = String(entry?.color_hex || entry?.colorHex || "").trim().toLowerCase();
    if (normalizedTag && /^#[0-9a-f]{6}$/.test(color)) {
      next[normalizedTag] = color;
    }
  });
  return next;
}

function mergeReleasableCatalogs(baseCatalog, overlayCatalog) {
  const baseEntries = Array.isArray(baseCatalog?.entries) ? baseCatalog.entries : [];
  const overlayEntries = Array.isArray(overlayCatalog?.entries) ? overlayCatalog.entries : [];
  if (!baseEntries.length && !overlayEntries.length) {
    return overlayCatalog || baseCatalog || null;
  }
  const mergedByTag = new Map();
  baseEntries.forEach((entry) => {
    const tag = String(entry?.tag || "").trim().toUpperCase();
    if (!tag) return;
    mergedByTag.set(tag, entry);
  });
  overlayEntries.forEach((entry) => {
    const tag = String(entry?.tag || "").trim().toUpperCase();
    if (!tag) return;
    mergedByTag.set(tag, entry);
  });
  const scenarioIds = Array.from(new Set([
    ...(Array.isArray(baseCatalog?.scenario_ids) ? baseCatalog.scenario_ids : []),
    ...(Array.isArray(overlayCatalog?.scenario_ids) ? overlayCatalog.scenario_ids : []),
  ]));
  return {
    ...(baseCatalog && typeof baseCatalog === "object" ? baseCatalog : {}),
    ...(overlayCatalog && typeof overlayCatalog === "object" ? overlayCatalog : {}),
    scenario_ids: scenarioIds,
    entries: Array.from(mergedByTag.values()),
  };
}

function getScenarioMetaById(state, normalizeScenarioId, scenarioId) {
  const targetId = normalizeScenarioId(scenarioId);
  return getScenarioRegistryEntries(state).find(
    (entry) => normalizeScenarioId(entry?.scenario_id) === targetId
  ) || null;
}

function getDefaultScenarioId(state, normalizeScenarioId) {
  return normalizeScenarioId(state?.scenarioRegistry?.default_scenario_id);
}

function getScenarioManifestVersion(manifest) {
  const version = Number(manifest?.version || 1);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function getScenarioManifestSummary(manifest) {
  return manifest?.summary && typeof manifest.summary === "object" ? manifest.summary : {};
}

function getScenarioBaselineHashFromBundle(bundle) {
  return String(bundle?.manifest?.baseline_hash || bundle?.ownersPayload?.baseline_hash || "").trim();
}

function getScenarioBlockerCount(summary = {}) {
  const flattened = Number(summary.blocker_count);
  if (Number.isFinite(flattened)) {
    return flattened;
  }
  return (
    Number(summary.geometry_blocker_count || 0)
    + Number(summary.topology_blocker_count || 0)
    + Number(summary.scenario_rule_blocker_count || 0)
  );
}

function getScenarioDefaultCountryCode(manifest, countryMap = {}) {
  return String(
    manifest?.default_active_country_code
    || manifest?.default_country
    || Object.keys(countryMap || {})[0]
    || ""
  ).trim().toUpperCase();
}

function normalizeScenarioRuntimeTopologyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!payload.objects || typeof payload.objects !== "object") {
    return null;
  }
  if (
    !payload.objects.political
    && !payload.objects.scenario_water
    && !payload.objects.scenario_special_land
    && !payload.objects.land_mask
    && !payload.objects.land
  ) {
    return null;
  }
  return payload;
}

function normalizeScenarioRuntimePoliticalMeta(meta) {
  return normalizeStartupBundleRuntimePoliticalMeta(meta);
}

function getScenarioRuntimePoliticalFeatureCount(runtimeTopologyPayload, runtimePoliticalMeta = null) {
  const geometryCount = Array.isArray(runtimeTopologyPayload?.objects?.political?.geometries)
    ? runtimeTopologyPayload.objects.political.geometries.length
    : 0;
  if (geometryCount > 0) {
    return geometryCount;
  }
  return Array.isArray(runtimePoliticalMeta?.featureIds) ? runtimePoliticalMeta.featureIds.length : 0;
}

function validateScenarioRuntimeShellContract({
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  const normalizedTopologyPayload = normalizeScenarioRuntimeTopologyPayload(runtimeTopologyPayload);
  const normalizedMeta = normalizeScenarioRuntimePoliticalMeta(runtimePoliticalMeta);
  const missingObjects = normalizedTopologyPayload
    ? SCENARIO_RUNTIME_SHELL_REQUIRED_OBJECTS.filter((objectName) => !normalizedTopologyPayload?.objects?.[objectName])
    : [...SCENARIO_RUNTIME_SHELL_REQUIRED_OBJECTS];
  const politicalFeatureCount = getScenarioRuntimePoliticalFeatureCount(normalizedTopologyPayload, normalizedMeta);
  return {
    ok: !!normalizedTopologyPayload && missingObjects.length === 0 && politicalFeatureCount > 0,
    missingObjects,
    missingPoliticalMeta: politicalFeatureCount <= 0,
    politicalFeatureCount,
    runtimeTopologyPayload: normalizedTopologyPayload,
    runtimePoliticalMeta: normalizedMeta,
  };
}

function hasScenarioRuntimeShellContract({
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  return validateScenarioRuntimeShellContract({
    runtimeTopologyPayload,
    runtimePoliticalMeta,
  }).ok;
}

function normalizeScenarioRuntimeShell(manifest, { normalizeScenarioId } = {}) {
  if (!manifest || typeof manifest !== "object") {
    return null;
  }
  const startupTopologyUrl = String(
    manifest.startup_topology_url
    || manifest.runtime_bootstrap_topology_url
    || manifest.runtime_topology_url
    || ""
  ).trim();
  const detailChunkManifestUrl = String(manifest.detail_chunk_manifest_url || "").trim();
  const runtimeMetaUrl = String(manifest.runtime_meta_url || "").trim();
  const meshPackUrl = String(manifest.mesh_pack_url || "").trim();
  const contextLodManifestUrl = String(manifest.context_lod_manifest || "").trim();
  if (!startupTopologyUrl && !detailChunkManifestUrl && !runtimeMetaUrl && !meshPackUrl && !contextLodManifestUrl) {
    return null;
  }
  return {
    scenarioId: typeof normalizeScenarioId === "function" ? normalizeScenarioId(manifest.scenario_id) : String(manifest.scenario_id || "").trim(),
    startupTopologyUrl,
    detailChunkManifestUrl,
    runtimeMetaUrl,
    meshPackUrl,
    contextLodManifestUrl,
    renderBudgetHints: normalizeScenarioRenderBudgetHints(manifest.render_budget_hints || {}),
  };
}

function scenarioSupportsChunkedRuntime(bundleOrManifest, { normalizeScenarioId } = {}) {
  const manifest = bundleOrManifest?.manifest || bundleOrManifest;
  return !!normalizeScenarioRuntimeShell(manifest, { normalizeScenarioId })?.detailChunkManifestUrl;
}

function scenarioBundleHasChunkedData(bundle) {
  return Array.isArray(bundle?.chunkRegistry?.chunks) && bundle.chunkRegistry.chunks.length > 0;
}

function loadOptionalScenarioResource(d3Client, url, options = {}) {
  return sharedLoadOptionalScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

function getScenarioBundleId(bundle, { normalizeScenarioId = sharedNormalizeScenarioId } = {}) {
  return normalizeScenarioId(bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id);
}

function getScenarioDecodedCollection(bundle, collectionKey) {
  const decodedCollections = bundle?.runtimeDecodedCollections;
  const collection = decodedCollections?.[collectionKey];
  return Array.isArray(collection?.features) ? collection : null;
}

// Chunk registry loading stays inside bundle_loader because it only reads chunk-side resources
// and mutates the in-memory bundle. Runtime state ownership still stays in the facade.
async function loadScenarioChunkFile(
  url,
  {
    d3Client = globalThis.d3,
    scenarioId = "",
    resourceLabel = "scenario_chunk",
    useWorker = shouldUseStartupWorker(),
  } = {}
) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return null;
  if (useWorker) {
    try {
      const workerResult = await decodeRuntimeChunkViaWorker({
        chunkUrl: normalizedUrl,
        chunkType: "scenario-chunk",
      });
      if (workerResult.chunkPayload) {
        return {
          payload: workerResult.chunkPayload,
          metrics: workerResult.metrics?.chunkPayload || workerResult.metrics || null,
          reason: "worker",
        };
      }
    } catch (error) {
      console.warn(`[scenario] Worker chunk load failed for "${normalizedUrl}". Falling back to main thread.`, error);
    }
  }
  const result = await loadMeasuredJsonResource(cacheBust(normalizedUrl), {
    d3Client,
    label: `scenario:${resourceLabel}`,
  });
  return {
    payload: result.payload,
    metrics: result.metrics || null,
    reason: "main-thread",
    scenarioId,
  };
}

function createScenarioChunkRegistryEnsurer({
  ensureRuntimeChunkLoadState,
} = {}) {
  return async function ensureScenarioChunkRegistryLoaded(
    bundle,
    {
      d3Client = globalThis.d3,
    } = {}
  ) {
    if (!bundle?.manifest) return null;
    const runtimeShell = bundle.runtimeShell || normalizeScenarioRuntimeShell(bundle.manifest);
    if (!runtimeShell?.detailChunkManifestUrl) {
      return null;
    }
    bundle.runtimeShell = runtimeShell;
    if (bundle.chunkRegistry && bundle.contextLodManifest) {
      ensureRuntimeChunkLoadState().registryStatus = "ready";
      return bundle.chunkRegistry;
    }
    const chunkState = ensureRuntimeChunkLoadState();
    chunkState.registryStatus = "loading";
    const [chunkManifestResult, contextLodResult, runtimeMetaResult, meshPackResult] = await Promise.all([
      loadScenarioChunkFile(runtimeShell.detailChunkManifestUrl, {
        d3Client,
        scenarioId: runtimeShell.scenarioId,
        resourceLabel: "detail_chunk_manifest",
      }),
      runtimeShell.contextLodManifestUrl
        ? loadScenarioChunkFile(runtimeShell.contextLodManifestUrl, {
          d3Client,
          scenarioId: runtimeShell.scenarioId,
          resourceLabel: "context_lod_manifest",
        })
        : Promise.resolve(null),
      runtimeShell.runtimeMetaUrl
        ? loadScenarioChunkFile(runtimeShell.runtimeMetaUrl, {
          d3Client,
          scenarioId: runtimeShell.scenarioId,
          resourceLabel: "runtime_meta",
        })
        : Promise.resolve(null),
      runtimeShell.meshPackUrl
        ? loadScenarioChunkFile(runtimeShell.meshPackUrl, {
          d3Client,
          scenarioId: runtimeShell.scenarioId,
          resourceLabel: "mesh_pack",
        })
        : Promise.resolve(null),
    ]);
    bundle.chunkRegistry = normalizeScenarioChunkManifest(chunkManifestResult?.payload || {});
    bundle.contextLodManifest = normalizeScenarioContextLodManifest(contextLodResult?.payload || {});
    bundle.runtimeMetaPayload = runtimeMetaResult?.payload || null;
    bundle.meshPackPayload = meshPackResult?.payload || null;
    bundle.chunkRegistryLoadMetrics = {
      detailChunkManifest: chunkManifestResult?.metrics || null,
      contextLodManifest: contextLodResult?.metrics || null,
      runtimeMeta: runtimeMetaResult?.metrics || null,
      meshPack: meshPackResult?.metrics || null,
    };
    chunkState.registryStatus = scenarioBundleHasChunkedData(bundle) ? "ready" : "empty";
    return bundle.chunkRegistry;
  };
}

function buildIncompleteRuntimeShellReason({
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  const runtimeShellContract = validateScenarioRuntimeShellContract({
    runtimeTopologyPayload,
    runtimePoliticalMeta,
  });
  const missingParts = [
    ...runtimeShellContract.missingObjects.map((objectName) => `missing-${objectName}`),
    ...(runtimeShellContract.missingPoliticalMeta ? ["missing-runtime-political-meta"] : []),
  ];
  return missingParts.join(",") || "incomplete-runtime-shell";
}

function writeScenarioGeoLocalePatchIntoBundle(bundle, geoLocalePatchPayload, geoLocalePatchDescriptor) {
  if (!geoLocalePatchPayload) {
    return;
  }
  if (geoLocalePatchDescriptor?.localeSpecific) {
    bundle.geoLocalePatchPayloadsByLanguage[geoLocalePatchDescriptor.language] = geoLocalePatchPayload;
    return;
  }
  bundle.geoLocalePatchPayloadsByLanguage.en = geoLocalePatchPayload;
  bundle.geoLocalePatchPayloadsByLanguage.zh = geoLocalePatchPayload;
}

// Startup bootstrap bundles are pure assembly work: they rebuild a bundle shape from
// persistent cache hits without touching active scenario state or UI synchronization.
function createScenarioBootstrapBundleFromCache({
  priorBundle,
  meta,
  manifest,
  bundleLevel,
  cachedCorePayload,
  cachedLocalePayload,
  geoLocalePatchDescriptor,
  runtimeTopologyUrl,
} = {}) {
  const runtimeShell = normalizeScenarioRuntimeShell(manifest);
  const runtimeTopologyPayload = normalizeScenarioRuntimeTopologyPayload(cachedCorePayload?.runtimeTopologyPayload);
  const runtimePoliticalMeta = normalizeScenarioRuntimePoliticalMeta(cachedCorePayload?.runtimePoliticalMeta || null);
  const runtimeFeatureIds = Array.isArray(runtimePoliticalMeta?.featureIds)
    ? runtimePoliticalMeta.featureIds
    : [];
  const bundle = {
    ...(priorBundle && typeof priorBundle === "object" ? priorBundle : {}),
    meta,
    manifest,
    bundleLevel,
    runtimeShell,
    chunkRegistry: priorBundle?.chunkRegistry || null,
    contextLodManifest: priorBundle?.contextLodManifest || null,
    runtimeMetaPayload: priorBundle?.runtimeMetaPayload || null,
    meshPackPayload: priorBundle?.meshPackPayload || null,
    chunkPayloadCacheById: {
      ...(priorBundle?.chunkPayloadCacheById || {}),
    },
    chunkPayloadPromisesById: {},
    chunkPreloaded: !!priorBundle?.chunkPreloaded,
    countriesPayload: cachedCorePayload?.countriesPayload || null,
    ownersPayload: normalizeIndexedTagAssignmentPayload(cachedCorePayload?.ownersPayload, runtimeFeatureIds, "owners"),
    controllersPayload: normalizeIndexedTagAssignmentPayload(cachedCorePayload?.controllersPayload, runtimeFeatureIds, "controllers"),
    coresPayload: normalizeIndexedCoreAssignmentPayload(cachedCorePayload?.coresPayload, runtimeFeatureIds),
    waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
    specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
    reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
    cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(cachedLocalePayload?.geoLocalePatchPayload),
    geoLocalePatchPayloadsByLanguage: {
      ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
    },
    runtimeTopologyPayload,
    runtimePoliticalMeta,
    runtimeDecodedCollections: priorBundle?.runtimeDecodedCollections || null,
    releasableCatalog: priorBundle?.releasableCatalog || null,
    districtGroupsPayload: priorBundle?.districtGroupsPayload || null,
    auditPayload: priorBundle?.auditPayload || null,
    startupApplySeed: null,
    optionalLayerPromises: {
      ...(priorBundle?.optionalLayerPromises || {}),
    },
    optionalLayerSettledByKey: {
      ...(priorBundle?.optionalLayerSettledByKey || {}),
    },
    loadDiagnostics: {
      optionalResources: {
        runtime_topology: {
          ok: hasScenarioRuntimeShellContract({
            runtimeTopologyPayload,
            runtimePoliticalMeta,
          }),
          reason: "persistent-cache-hit",
          errorMessage: "",
          metrics: null,
          url: runtimeTopologyUrl,
        },
        geo_locale_patch: {
          ok: !!cachedLocalePayload?.geoLocalePatchPayload,
          reason: cachedLocalePayload?.geoLocalePatchPayload ? "persistent-cache-hit" : "not-cached",
          errorMessage: "",
          language: geoLocalePatchDescriptor?.language,
          localeSpecific: !!geoLocalePatchDescriptor?.localeSpecific,
          metrics: null,
        },
      },
      requiredResources: {
        manifest: null,
        countries: null,
        owners: null,
        controllers: null,
        cores: null,
      },
      bundleLevel,
      persistentCacheHit: true,
    },
  };
  writeScenarioGeoLocalePatchIntoBundle(bundle, bundle.geoLocalePatchPayload, geoLocalePatchDescriptor);
  if (!bundle.loadDiagnostics.optionalResources.runtime_topology.ok) {
    bundle.loadDiagnostics.optionalResources.runtime_topology.reason = buildIncompleteRuntimeShellReason({
      runtimeTopologyPayload: bundle.runtimeTopologyPayload,
      runtimePoliticalMeta: bundle.runtimePoliticalMeta,
    });
  }
  return bundle;
}

// Startup payload hydration also stays pure here: it turns a startup payload into the same
// bundle contract used by the rest of the loader without mutating active runtime state.
async function createStartupScenarioBundleFromPayload({
  scenarioId = "",
  language = "en",
  payload = null,
  runtimeDecodedCollections = null,
  runtimePoliticalMeta = null,
  loadDiagnostics = null,
  d3Client = globalThis.d3,
  normalizeScenarioId = sharedNormalizeScenarioId,
} = {}) {
  const normalizedScenarioId = normalizeScenarioId(
    scenarioId
    || payload?.scenario_id
    || payload?.manifest_subset?.scenario_id
  );
  if (!normalizedScenarioId) {
    throw new Error("Startup bundle is missing a valid scenario id.");
  }
  const manifestSubset = payload?.manifest_subset && typeof payload.manifest_subset === "object"
    ? payload.manifest_subset
    : {};
  const manifest = {
    ...manifestSubset,
    scenario_id: normalizedScenarioId,
    display_name: String(
      manifestSubset.display_name
      || payload?.display_name
      || normalizedScenarioId
    ).trim(),
    generated_at: String(
      payload?.generated_at
      || manifestSubset.generated_at
      || ""
    ).trim(),
    baseline_hash: String(
      payload?.baseline_hash
      || manifestSubset.baseline_hash
      || ""
    ).trim(),
    startup_bootstrap_strategy: String(
      manifestSubset.startup_bootstrap_strategy
      || payload?.scenario?.bootstrap_strategy
      || ""
    ).trim(),
  };
  const runtimeTopologyPayload = normalizeScenarioRuntimeTopologyPayload(payload?.scenario?.runtime_topology_bootstrap);
  const normalizedRuntimePoliticalMeta = normalizeScenarioRuntimePoliticalMeta(
    runtimePoliticalMeta || payload?.scenario?.runtime_political_meta || null
  );
  const runtimeFeatureIds = Array.isArray(normalizedRuntimePoliticalMeta?.featureIds)
    ? normalizedRuntimePoliticalMeta.featureIds
    : [];
  const bootstrapStrategy = String(payload?.scenario?.bootstrap_strategy || "").trim();
  const geoLocalePatchDescriptor = getScenarioGeoLocalePatchDescriptor(manifest, language);
  const geoLocalePatchResult = geoLocalePatchDescriptor.url
    ? await loadOptionalScenarioResource(d3Client, geoLocalePatchDescriptor.url, {
      scenarioId: normalizedScenarioId,
      resourceLabel: geoLocalePatchDescriptor.localeSpecific
        ? `geo_locale_patch_${geoLocalePatchDescriptor.language}`
        : "geo_locale_patch",
    })
    : { ok: false, value: null, metrics: null, reason: "not-configured", errorMessage: "" };
  const geoLocalePatchPayload = normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value);
  const bundle = {
    meta: {
      scenario_id: normalizedScenarioId,
      display_name: manifest.display_name,
      manifest_url: "",
    },
    manifest,
    bootstrapStrategy,
    bundleLevel: "bootstrap",
    runtimeShell: normalizeScenarioRuntimeShell(manifest),
    chunkRegistry: null,
    contextLodManifest: null,
    runtimeMetaPayload: null,
    meshPackPayload: null,
    chunkPayloadCacheById: {},
    chunkPayloadPromisesById: {},
    chunkPreloaded: false,
    countriesPayload: payload?.scenario?.countries || null,
    ownersPayload: normalizeIndexedTagAssignmentPayload(payload?.scenario?.owners, runtimeFeatureIds, "owners"),
    controllersPayload: normalizeIndexedTagAssignmentPayload(payload?.scenario?.controllers, runtimeFeatureIds, "controllers"),
    coresPayload: normalizeIndexedCoreAssignmentPayload(payload?.scenario?.cores, runtimeFeatureIds),
    waterRegionsPayload: null,
    specialRegionsPayload: null,
    reliefOverlaysPayload: null,
    cityOverridesPayload: null,
    geoLocalePatchPayload,
    geoLocalePatchPayloadsByLanguage: geoLocalePatchPayload ? { [language === "zh" ? "zh" : "en"]: geoLocalePatchPayload } : {},
    runtimeTopologyPayload,
    runtimePoliticalMeta: normalizedRuntimePoliticalMeta,
    runtimeDecodedCollections: runtimeTopologyPayload ? (runtimeDecodedCollections || null) : null,
    releasableCatalog: null,
    districtGroupsPayload: null,
    auditPayload: null,
    startupApplySeed: null,
    optionalLayerPromises: {},
    optionalLayerSettledByKey: {},
    loadDiagnostics: loadDiagnostics || {
      optionalResources: {
        runtime_topology: {
          ok: hasScenarioRuntimeShellContract({
            runtimeTopologyPayload,
            runtimePoliticalMeta: normalizedRuntimePoliticalMeta,
          }),
          reason: runtimeTopologyPayload ? "startup-bundle" : (bootstrapStrategy || "deferred"),
          errorMessage: "",
          metrics: payload?.metrics?.runtimeTopology || null,
          url: "",
        },
        geo_locale_patch: {
          ok: !!geoLocalePatchResult.ok,
          reason: geoLocalePatchResult.reason,
          errorMessage: geoLocalePatchResult.errorMessage,
          language,
          localeSpecific: geoLocalePatchDescriptor.localeSpecific,
          metrics: geoLocalePatchResult.metrics || null,
        },
      },
      requiredResources: {
        manifest: payload?.metrics?.startupBundle || null,
        countries: null,
        owners: null,
        controllers: null,
        cores: null,
      },
      bundleLevel: "bootstrap",
      startupBundle: true,
    },
  };
  if (!bundle.loadDiagnostics.optionalResources.runtime_topology.ok) {
    bundle.loadDiagnostics.optionalResources.runtime_topology.reason = buildIncompleteRuntimeShellReason({
      runtimeTopologyPayload,
      runtimePoliticalMeta: normalizedRuntimePoliticalMeta,
    });
  }
  return bundle;
}

async function loadScenarioRuntimeTopologyForBundle({
  d3Client,
  scenarioId,
  requestedBundleLevel,
  runtimeTopologyUrl,
} = {}) {
  const runtimeLabel = requestedBundleLevel === "bootstrap" ? "runtime_bootstrap_topology" : "runtime_topology";
  const allowWorkerDecode = !!runtimeTopologyUrl && shouldUseStartupWorker();
  if (allowWorkerDecode) {
    try {
      const workerResult = requestedBundleLevel === "bootstrap"
        ? await loadScenarioRuntimeBootstrapViaWorker({ runtimeTopologyUrl })
        : await decodeRuntimeChunkViaWorker({ runtimeTopologyUrl });
      return {
        ok: !!workerResult.runtimePoliticalTopology,
        value: workerResult.runtimePoliticalTopology || null,
        metrics: workerResult.metrics?.runtimePoliticalTopology || workerResult.metrics || null,
        reason: workerResult.runtimePoliticalTopology
          ? (requestedBundleLevel === "bootstrap" ? "worker-bootstrap" : "worker-full")
          : "empty",
        errorMessage: "",
        runtimePoliticalMeta: workerResult.runtimePoliticalMeta || null,
        decodedCollections: workerResult.decodedCollections || null,
        workerMetrics: workerResult.metrics || null,
      };
    } catch (error) {
      console.warn(`[scenario] Startup worker failed for ${runtimeLabel} of "${scenarioId}", falling back to main thread.`, error);
    }
  }
  const fallbackResult = await loadOptionalScenarioResource(d3Client, runtimeTopologyUrl, {
    scenarioId,
    resourceLabel: runtimeLabel,
  });
  return {
    ...fallbackResult,
    runtimePoliticalMeta: null,
    decodedCollections: null,
  };
}

// Full bundle assembly still belongs to the loader side: it only fetches resources,
// rebuilds the bundle object, and returns diagnostics. The facade decides when to cache,
// log, schedule deferred metadata, or update startup cache telemetry.
function createScenarioBundleAssembler({
  loadMeasuredRequiredScenarioResource,
  loadOptionalScenarioResource,
} = {}) {
  return async function assembleScenarioBundle({
    d3Client = globalThis.d3,
    targetId = "",
    requestedBundleLevel = "full",
    meta = null,
    manifest = null,
    priorBundle = null,
    runtimeShell = normalizeScenarioRuntimeShell(manifest),
    runtimeTopologyUrl = "",
    geoLocalePatchDescriptor = getScenarioGeoLocalePatchDescriptor(manifest),
  } = {}) {
    const [
      countriesResult,
      ownersResult,
      controllersResult,
      coresResult,
      runtimeTopologyResult,
      geoLocalePatchResult,
      releasableCatalogResult,
      districtGroupsResult,
      auditResult,
    ] = await Promise.all([
      loadMeasuredRequiredScenarioResource(d3Client, manifest?.countries_url, {
        scenarioId: targetId,
        resourceLabel: "countries",
        requiredField: "countries",
      }),
      loadMeasuredRequiredScenarioResource(d3Client, manifest?.owners_url, {
        scenarioId: targetId,
        resourceLabel: "owners",
        requiredField: "owners",
      }),
      manifest?.controllers_url
        ? loadMeasuredRequiredScenarioResource(d3Client, manifest.controllers_url, {
          scenarioId: targetId,
          resourceLabel: "controllers",
          requiredField: "controllers",
        })
        : Promise.resolve({ payload: null, metrics: null }),
      loadMeasuredRequiredScenarioResource(d3Client, manifest?.cores_url, {
        scenarioId: targetId,
        resourceLabel: "cores",
        requiredField: "cores",
      }),
      loadScenarioRuntimeTopologyForBundle({
        d3Client,
        scenarioId: targetId,
        requestedBundleLevel,
        runtimeTopologyUrl,
      }),
      loadOptionalScenarioResource(d3Client, geoLocalePatchDescriptor?.url, {
        scenarioId: targetId,
        resourceLabel: geoLocalePatchDescriptor?.localeSpecific
          ? `geo_locale_patch_${geoLocalePatchDescriptor.language}`
          : "geo_locale_patch",
      }),
      Promise.resolve({
        ok: false,
        value: priorBundle?.releasableCatalog || null,
        metrics: null,
        reason: requestedBundleLevel === "full" ? "deferred-idle" : "deferred",
        errorMessage: "",
      }),
      Promise.resolve({
        ok: false,
        value: priorBundle?.districtGroupsPayload || null,
        metrics: null,
        reason: requestedBundleLevel === "full" ? "deferred-idle" : "deferred",
        errorMessage: "",
      }),
      Promise.resolve({
        ok: false,
        value: priorBundle?.auditPayload || null,
        metrics: null,
        reason: requestedBundleLevel === "full" ? "deferred-on-demand" : "deferred",
        errorMessage: "",
      }),
    ]);

    const bundle = {
      ...(priorBundle && typeof priorBundle === "object" ? priorBundle : {}),
      meta,
      manifest,
      bundleLevel: requestedBundleLevel,
      runtimeShell,
      chunkRegistry: priorBundle?.chunkRegistry || null,
      contextLodManifest: priorBundle?.contextLodManifest || null,
      runtimeMetaPayload: priorBundle?.runtimeMetaPayload || null,
      meshPackPayload: priorBundle?.meshPackPayload || null,
      chunkPayloadCacheById: {
        ...(priorBundle?.chunkPayloadCacheById || {}),
      },
      chunkPayloadPromisesById: {},
      chunkPreloaded: !!priorBundle?.chunkPreloaded,
      countriesPayload: countriesResult.payload,
      ownersPayload: ownersResult.payload,
      controllersPayload: controllersResult.payload,
      coresPayload: coresResult.payload,
      waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
      specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
      reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
      cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
      geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value),
      geoLocalePatchPayloadsByLanguage: {
        ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
      },
      runtimeTopologyPayload: normalizeScenarioRuntimeTopologyPayload(runtimeTopologyResult.value),
      runtimePoliticalMeta: runtimeTopologyResult.runtimePoliticalMeta || null,
      runtimeDecodedCollections: runtimeTopologyResult.decodedCollections || null,
      releasableCatalog: releasableCatalogResult.value || null,
      districtGroupsPayload: normalizeScenarioDistrictGroupsPayload(districtGroupsResult.value, targetId),
      auditPayload: auditResult.value || null,
      optionalLayerPromises: {
        ...(priorBundle?.optionalLayerPromises || {}),
      },
      optionalLayerSettledByKey: {
        ...(priorBundle?.optionalLayerSettledByKey || {}),
      },
      loadDiagnostics: {
        optionalResources: {
          runtime_topology: {
            ok: !!runtimeTopologyResult.ok,
            reason: runtimeTopologyResult.reason,
            errorMessage: runtimeTopologyResult.errorMessage,
            metrics: runtimeTopologyResult.metrics || null,
            url: runtimeTopologyUrl,
          },
          geo_locale_patch: {
            ok: !!geoLocalePatchResult.ok,
            reason: geoLocalePatchResult.reason,
            errorMessage: geoLocalePatchResult.errorMessage,
            language: geoLocalePatchDescriptor?.language,
            localeSpecific: geoLocalePatchDescriptor?.localeSpecific,
            metrics: geoLocalePatchResult.metrics || null,
          },
          releasable_catalog: {
            ok: !!releasableCatalogResult.ok,
            reason: releasableCatalogResult.reason,
            errorMessage: releasableCatalogResult.errorMessage,
            metrics: releasableCatalogResult.metrics || null,
          },
          district_groups: {
            ok: !!districtGroupsResult.ok,
            reason: districtGroupsResult.reason,
            errorMessage: districtGroupsResult.errorMessage,
            metrics: districtGroupsResult.metrics || null,
          },
          audit: {
            ok: !!auditResult.ok,
            reason: auditResult.reason,
            errorMessage: auditResult.errorMessage,
            metrics: auditResult.metrics || null,
          },
        },
        requiredResources: {
          manifest: null,
          countries: countriesResult.metrics || null,
          owners: ownersResult.metrics || null,
          controllers: controllersResult.metrics || null,
          cores: coresResult.metrics || null,
        },
        bundleLevel: requestedBundleLevel,
      },
    };
    writeScenarioGeoLocalePatchIntoBundle(bundle, bundle.geoLocalePatchPayload, geoLocalePatchDescriptor);
    const ownerCount = Object.keys(bundle.ownersPayload?.owners || {}).length;
    const controllerCount = Object.keys(bundle.controllersPayload?.controllers || {}).length;
    const countryCount = Object.keys(bundle.countriesPayload?.countries || {}).length;
    return {
      bundle,
      countriesResult,
      ownersResult,
      controllersResult,
      coresResult,
      runtimeTopologyResult,
      geoLocalePatchResult,
      ownerCount,
      controllerCount,
      countryCount,
    };
  };
}

function createScenarioRegistryLoader({
  state,
  scenarioRegistryUrl,
  loadScenarioJsonWithTimeout,
} = {}) {
  let scenarioRegistryPromise = null;
  return async function loadScenarioRegistry({ d3Client = globalThis.d3 } = {}) {
    if (state.scenarioRegistry) {
      return state.scenarioRegistry;
    }
    if (scenarioRegistryPromise) {
      return scenarioRegistryPromise;
    }
    if (!d3Client || typeof d3Client.json !== "function") {
      throw new Error("d3.json is not available for scenario registry loading.");
    }
    scenarioRegistryPromise = loadScenarioJsonWithTimeout(d3Client, scenarioRegistryUrl, {
      resourceLabel: "scenario_registry",
    })
      .then((registry) => {
        state.scenarioRegistry = registry || { version: 1, default_scenario_id: "", scenarios: [] };
        return state.scenarioRegistry;
      })
      .catch((error) => {
        scenarioRegistryPromise = null;
        throw error;
      });
    return scenarioRegistryPromise;
  };
}

function createScenarioAuditPayloadLoader({
  state,
  normalizeScenarioId,
  loadScenarioBundle,
  setScenarioAuditUiState,
  syncScenarioUi,
  loadMeasuredJsonResource,
  cacheBust,
} = {}) {
  return async function loadScenarioAuditPayload(
    bundleOrScenarioId,
    {
      d3Client = globalThis.d3,
      forceReload = false,
    } = {}
  ) {
    const bundle = typeof bundleOrScenarioId === "string"
      ? await loadScenarioBundle(bundleOrScenarioId, { d3Client, bundleLevel: "full" })
      : bundleOrScenarioId;
    const requestedScenarioId = normalizeScenarioId(
      bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id
    );
    if (!bundle?.manifest?.audit_url) {
      return null;
    }
    if (bundle.auditPayload && !forceReload) {
      if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
        state.scenarioAudit = bundle.auditPayload;
        setScenarioAuditUiState({
          loading: false,
          loadedForScenarioId: requestedScenarioId,
          errorMessage: "",
        });
        syncScenarioUi();
      }
      return bundle.auditPayload;
    }
    if (!d3Client || typeof d3Client.json !== "function") {
      throw new Error("d3.json is not available for scenario audit loading.");
    }

    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      setScenarioAuditUiState({
        loading: true,
        errorMessage: "",
      });
      syncScenarioUi();
    }

    try {
      const { payload: auditPayload } = await loadMeasuredJsonResource(cacheBust(bundle.manifest.audit_url), {
        d3Client,
        label: "scenario:audit",
      });
      bundle.auditPayload = auditPayload || null;
      if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
        state.scenarioAudit = bundle.auditPayload;
        setScenarioAuditUiState({
          loading: false,
          loadedForScenarioId: bundle.auditPayload ? requestedScenarioId : "",
          errorMessage: "",
        });
        syncScenarioUi();
      }
      return bundle.auditPayload;
    } catch (error) {
      if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
        setScenarioAuditUiState({
          loading: false,
          errorMessage: String(error?.message || "Unable to load audit details."),
        });
        syncScenarioUi();
      }
      throw error;
    }
  };
}

function createImportedScenarioBaselineValidator({
  normalizeScenarioId,
  loadScenarioBundle,
  getScenarioManifestVersion,
  getScenarioBaselineHashFromBundle,
} = {}) {
  return async function validateImportedScenarioBaseline(projectScenario, { d3Client = globalThis.d3 } = {}) {
    const scenarioId = normalizeScenarioId(projectScenario?.id);
    if (!scenarioId) {
      return { ok: true, bundle: null, message: "" };
    }

    let bundle = null;
    try {
      bundle = await loadScenarioBundle(scenarioId, { d3Client, bundleLevel: "full" });
    } catch (error) {
      return {
        ok: false,
        bundle: null,
        message: `Scenario "${scenarioId}" is not available in the current asset set.`,
        reason: "missing_scenario",
        error,
      };
    }

    const currentVersion = getScenarioManifestVersion(bundle.manifest);
    const currentBaselineHash = getScenarioBaselineHashFromBundle(bundle);
    const expectedVersion = Number(projectScenario?.version || 1) || 1;
    const expectedBaselineHash = String(projectScenario?.baselineHash || "").trim();
    const mismatches = [];

    if (currentVersion !== expectedVersion) {
      mismatches.push(`version ${expectedVersion} -> ${currentVersion}`);
    }
    if (expectedBaselineHash !== currentBaselineHash) {
      mismatches.push("baseline hash differs");
    }

    return {
      ok: mismatches.length === 0,
      bundle,
      message: mismatches.length
        ? `Saved scenario baseline does not match current assets (${mismatches.join(", ")}).`
        : "",
      reason: mismatches.length ? "baseline_mismatch" : "",
      currentVersion,
      currentBaselineHash,
    };
  };
}

export {
  getScenarioRegistryEntries,
  getScenarioDisplayName,
  getScenarioNameMap,
  getScenarioFixedOwnerColors,
  mergeReleasableCatalogs,
  getScenarioMetaById,
  getDefaultScenarioId,
  getScenarioManifestVersion,
  getScenarioManifestSummary,
  getScenarioBaselineHashFromBundle,
  getScenarioBlockerCount,
  getScenarioDefaultCountryCode,
  normalizeScenarioRuntimeTopologyPayload,
  normalizeScenarioRuntimePoliticalMeta,
  getScenarioRuntimePoliticalFeatureCount,
  validateScenarioRuntimeShellContract,
  hasScenarioRuntimeShellContract,
  normalizeScenarioRuntimeShell,
  scenarioSupportsChunkedRuntime,
  scenarioBundleHasChunkedData,
  getScenarioBundleId,
  getScenarioDecodedCollection,
  loadScenarioChunkFile,
  createScenarioChunkRegistryEnsurer,
  createScenarioBootstrapBundleFromCache,
  createStartupScenarioBundleFromPayload,
  loadScenarioRuntimeTopologyForBundle,
  createScenarioBundleAssembler,
  createScenarioRegistryLoader,
  createScenarioAuditPayloadLoader,
  createImportedScenarioBaselineValidator,
};
