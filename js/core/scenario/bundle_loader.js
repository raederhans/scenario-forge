import {
  normalizeRuntimePoliticalMeta as normalizeStartupBundleRuntimePoliticalMeta,
} from "../startup_bundle_compaction.js";
import {
  normalizeScenarioRenderBudgetHints,
} from "../scenario_chunk_manager.js";

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
  createScenarioRegistryLoader,
  createScenarioAuditPayloadLoader,
  createImportedScenarioBaselineValidator,
};
