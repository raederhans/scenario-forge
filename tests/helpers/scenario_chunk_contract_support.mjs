import {
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent,
} from "../../js/core/scenario/pure_helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createScenarioChunkRuntimeController } from "../../js/core/scenario/chunk_runtime.js";
import {
  buildViewportGeoBounds,
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioChunkManifest,
  resolveRequiredScenarioSemanticLayers,
  selectScenarioChunks,
} from "../../js/core/scenario_chunk_manager.js";
import {
  getCountryCode as getSharedFeatureCountryCode,
  getFeatureId as getSharedFeatureId,
  normalizeFeatureCountryCode,
} from "../../js/core/feature_identity.js";
import { createRenderCacheOwner } from "../../js/core/renderer/render_cache_owner.js";
import { createColorResolutionStrategyOwner } from "../../js/core/renderer/color_resolution_strategy.js";
import { buildSpatialGridSnapshot, getSpatialBucketKey } from "../../js/core/renderer/spatial_index_runtime_builders.js";
import { isScenarioWaterLikeFeature } from "../../js/core/scenario_runtime_queries.js";
import { applyScenarioChunkCityExternalEffectState } from "../../js/core/state/actions/scenario_presentation_actions.js";
import {
  patchScenarioChunkLoadState,
  queueScenarioChunkPromotionState,
  resetScenarioChunkRuntimeState,
} from "../../js/core/state/actions/scenario_chunk_runtime_actions.js";
import {
  beginScenarioApplyRequestState,
  clearActiveScenarioApplyRequestState,
  setLatestScenarioApplyRequestState,
} from "../../js/core/state/actions/scenario_apply_request_actions.js";
import { applyScenarioChunkOptionalLayerState } from "../../js/core/state/actions/scenario_activation_actions.js";
import { bumpScenarioChunkDataGenerationState } from "../../js/core/state/actions/scenario_chunk_promotion_actions.js";
import { createScenarioChunkRegistryEnsurer } from "../../js/core/scenario/bundle_loader.js";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createInitialVisualRegistryContinuationHarness({
  currentScenarioApplyRequestId = 0,
} = {}) {
  const registryReady = createDeferredPromise();
  const chunk = {
    id: "political.coarse.world",
    layer: "political",
    lod: "coarse",
    url: "political.coarse.world.json",
  };
  const createBundle = (scenarioId, { registryLoaded = false } = {}) => ({
    manifest: { scenario_id: scenarioId },
    chunkRegistry: registryLoaded
      ? { chunks: [chunk], byLayer: { political: [chunk] } }
      : null,
    runtimeShell: { renderBudgetHints: {} },
    countriesPayload: { countries: {} },
    chunkPayloadCacheById: {},
  });
  const staleBundle = createBundle("scenario_a");
  const targetState = {
    activeScenarioId: "scenario_a",
    currentScenarioApplyRequestId,
    renderPerfMetrics: {},
    uiState: { developerMode: true },
    renderDiagnostics: { perfOverlayEnabled: true },
    zoomTransform: { k: 1 },
  };
  let selectionCalls = 0;
  const controller = createScenarioChunkRuntimeController({
    runtimeState: targetState,
    getSearchParams: () => new URLSearchParams(),
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
    normalizeScenarioPerformanceHints: (value) => value || {},
    normalizeScenarioFeatureCollection: (payload) => payload,
    getScenarioFeatureCollectionIdentityList: () => [],
    areScenarioFeatureCollectionsEquivalent: () => true,
    getScenarioDefaultCountryCode: () => "",
    getScenarioBundleId: (bundle) => String(bundle?.manifest?.scenario_id || ""),
    getCachedScenarioBundle: () => staleBundle,
    getVisibleScenarioChunkLayers: () => ["political"],
    selectScenarioChunks: () => {
      selectionCalls += 1;
      return {
        scenarioId: targetState.activeScenarioId,
        requiredChunks: [],
        optionalChunks: [],
        evictableChunkIds: [],
        selectedFeatureCountSum: 0,
      };
    },
    mergeScenarioChunkPayloads: () => null,
    normalizeScenarioRenderBudgetHints: (value) => value || {},
    loadScenarioChunkFile: async () => null,
    scenarioSupportsChunkedRuntime: () => true,
    scenarioBundleUsesChunkedLayer: (bundle, layerKey = "") => (
      layerKey
        ? !!bundle?.chunkRegistry?.byLayer?.[layerKey]?.length
        : !!bundle?.chunkRegistry?.chunks?.length
    ),
    getScenarioOptionalLayerConfig: () => null,
    syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: () => {},
    flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {},
    ensureScenarioChunkRegistryLoaded: async (bundle) => {
      await registryReady.promise;
      bundle.chunkRegistry = {
        chunks: [chunk],
        byLayer: { political: [chunk] },
      };
    },
  });

  return {
    controller,
    targetState,
    resolveRegistry: () => registryReady.resolve(),
    getSelectionCalls: () => selectionCalls,
  };
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function loadVendorD3() {
  const context = { window: {}, self: {}, globalThis: null, console };
  context.globalThis = context;
  context.window = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(readRepoFile("vendor", "d3.v7.min.js"), context);
  return context.d3;
}

function createTimerGenerationController(targetState, bundle) {
  return createScenarioChunkRuntimeController({
    runtimeState: targetState,
    getSearchParams: () => new URLSearchParams(),
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
    normalizeScenarioPerformanceHints: (value) => value || {},
    normalizeScenarioFeatureCollection: (payload) => payload,
    getScenarioFeatureCollectionIdentityList: () => [],
    areScenarioFeatureCollectionsEquivalent: () => true,
    getScenarioDefaultCountryCode: () => "",
    getScenarioBundleId: () => "tno_1962",
    getCachedScenarioBundle: () => bundle,
    getVisibleScenarioChunkLayers: () => ["political"],
    selectScenarioChunks: () => ({
      scenarioId: "tno_1962",
      requiredChunks: [],
      optionalChunks: [],
      evictableChunkIds: [],
      selectedFeatureCountSum: 0,
    }),
    mergeScenarioChunkPayloads: () => null,
    normalizeScenarioRenderBudgetHints: (value) => value || {},
    loadScenarioChunkFile: async () => null,
    scenarioSupportsChunkedRuntime: () => true,
    scenarioBundleUsesChunkedLayer: () => true,
    getScenarioOptionalLayerConfig: () => null,
    syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: () => {},
    flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {},
    ensureScenarioChunkRegistryLoaded: async () => {},
  });
}

function createChunkLoadGenerationFixture({
  ensureScenarioChunkRegistryLoaded = async () => {},
  loadScenarioChunkFile: loadChunkFileOverride = null,
  getCachedScenarioBundle = () => null,
} = {}) {
  const targetState = {
    activeScenarioId: "tno_1962",
    renderPerfMetrics: {},
    uiState: { developerMode: true },
    renderDiagnostics: { perfOverlayEnabled: true },
  };
  const deferredByUrl = new Map();
  let loadAttemptCount = 0;
  const createBundle = (url, scenarioId = "tno_1962") => ({
    manifest: { scenario_id: scenarioId },
    chunkRegistry: {
      byLayer: {
        political: [{
          id: "political.detail.tt",
          layer: "political",
          lod: "detail",
          url,
          countryCodes: ["TT"],
        }],
      },
    },
    runtimeShell: { renderBudgetHints: {} },
    countriesPayload: { countries: {} },
  });
  const controller = createScenarioChunkRuntimeController({
    runtimeState: targetState,
    getSearchParams: () => new URLSearchParams(),
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
    normalizeScenarioPerformanceHints: (value) => value || {},
    normalizeScenarioFeatureCollection: (payload) => payload,
    getScenarioFeatureCollectionIdentityList: () => [],
    areScenarioFeatureCollectionsEquivalent: () => true,
    getScenarioDefaultCountryCode: () => "TT",
    getScenarioBundleId: (bundle) => String(bundle?.manifest?.scenario_id || ""),
    getCachedScenarioBundle,
    getVisibleScenarioChunkLayers: () => ["political"],
    selectScenarioChunks: () => ({ requiredChunks: [], optionalChunks: [], evictableChunkIds: [] }),
    mergeScenarioChunkPayloads: () => null,
    normalizeScenarioRenderBudgetHints: (value) => value || {},
    loadScenarioChunkFile: (url, options) => {
      loadAttemptCount += 1;
      if (loadChunkFileOverride) return loadChunkFileOverride(url, options);
      const deferred = deferredByUrl.get(url);
      assert.ok(deferred, `missing deferred loader for ${url}`);
      if (deferred.throwError) throw deferred.throwError;
      return deferred.promise;
    },
    scenarioSupportsChunkedRuntime: () => true,
    scenarioBundleUsesChunkedLayer: () => true,
    getScenarioOptionalLayerConfig: () => null,
    syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: () => {},
    flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {},
    ensureScenarioChunkRegistryLoaded,
  });
  return {
    controller,
    createBundle,
    createDeferredLoad(url) {
      const deferred = createDeferredPromise();
      deferredByUrl.set(url, deferred);
      return deferred;
    },
    createSynchronousLoadFailure(url, error) {
      deferredByUrl.set(url, { throwError: error });
    },
    getLoadAttemptCount() {
      return loadAttemptCount;
    },
    targetState,
  };
}

async function runStalePromotionCommitSettlement({
  resetLoadState = false,
} = {}) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const timerCallbacks = new Map();
  const frameCallbacks = [];
  let nextTimerId = 0;
  const bundle = {
    manifest: { scenario_id: "tno_1962" },
    chunkRegistry: { byLayer: { political: [] } },
    runtimeShell: { renderBudgetHints: {} },
    countriesPayload: { countries: {} },
  };
  const targetState = {
    activeScenarioId: "tno_1962",
    renderPhase: "idle",
  };

  globalThis.setTimeout = (callback) => {
    nextTimerId += 1;
    timerCallbacks.set(nextTimerId, callback);
    return nextTimerId;
  };
  globalThis.clearTimeout = () => {};
  globalThis.requestAnimationFrame = (callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };

  try {
    const controller = createTimerGenerationController(targetState, bundle);
    const staleLoadState = controller.ensureRuntimeChunkLoadState();
    staleLoadState.selectionVersion = 1;
    staleLoadState.pendingPromotion = {
      scenarioId: "tno_1962",
      selectionVersion: 1,
      reason: "stale-generation",
      mergedLayerPayloads: {},
      primaryMergedLayerPayloads: {},
      changedLayerKeys: [],
      politicalFeatureIds: [],
      requiredChunkIds: [],
    };
    assert.equal(
      controller.scheduleScenarioChunkRefresh({
        reason: "stale-generation",
        delayMs: 0,
      }),
      "scheduled",
    );
    timerCallbacks.get(1)();
    const promotionTimerCallback = timerCallbacks.get(2);
    assert.equal(typeof promotionTimerCallback, "function");
    promotionTimerCallback();
    assert.equal(frameCallbacks.length, 1);
    assert.equal(targetState.scenarioChunkPromotionRenderLocked, true);

    if (resetLoadState) {
      controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
    } else {
      targetState.cancelScenarioChunkPromotionCommitFn("test-cancel");
    }
    assert.equal(targetState.scenarioChunkPromotionRenderLocked, false);
    const currentLoadState = targetState.runtimeChunkLoadState;
    const pendingPostCommitRefresh = {
      reason: "current-generation-replay",
      scenarioId: "tno_1962",
      selectionVersion: 77,
    };
    const currentRunId = resetLoadState ? 77 : 2;
    Object.assign(currentLoadState, {
      promotionCommitStatus: "current-generation",
      promotionCommitInFlight: true,
      promotionCommitRunId: currentRunId,
      pendingPostCommitRefresh,
    });
    targetState.scenarioChunkPromotionRenderLocked = true;

    frameCallbacks.shift()();
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }

    return {
      currentLoadState,
      currentRunId,
      pendingPostCommitRefresh,
      targetState,
    };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  }
}

function isWorldGeoBounds(bounds) {
  return Array.isArray(bounds)
    && bounds.length === 2
    && bounds[0]?.[0] <= -179.999
    && bounds[0]?.[1] <= -89.999
    && bounds[1]?.[0] >= 179.999
    && bounds[1]?.[1] >= 89.999;
}

function getManifestChunksByLayer(chunkManifest, layerKey) {
  return (chunkManifest.chunks || []).filter((chunk) => chunk.layer === layerKey);
}

function readManifestChunkPayload(chunk) {
  return JSON.parse(readRepoFile(...String(chunk.url || "").split("/")));
}

function getFeatureId(feature) {
  return String(feature?.properties?.id || feature?.id || "").trim();
}

function getTopologyGeometryId(geometry) {
  return String(geometry?.properties?.id || geometry?.id || "").trim();
}

function getCoordinateBounds(coordinates, bounds = {
  minLon: Infinity,
  minLat: Infinity,
  maxLon: -Infinity,
  maxLat: -Infinity,
}) {
  if (!Array.isArray(coordinates)) return bounds;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      bounds.minLon = Math.min(bounds.minLon, lon);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLon = Math.max(bounds.maxLon, lon);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
    }
    return bounds;
  }
  coordinates.forEach((child) => getCoordinateBounds(child, bounds));
  return bounds;
}

function extractRendererFunction(source, functionName) {
  const startToken = `function ${functionName}`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const parametersStart = source.indexOf("(", start + startToken.length);
  assert.notEqual(parametersStart, -1, `${functionName} must have parameters`);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parameterDepth += 1;
    if (char === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  assert.notEqual(parametersEnd, -1, `${functionName} parameters must close`);
  const bodyStart = source.indexOf("{", parametersEnd);
  assert.notEqual(bodyStart, -1, `${functionName} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${functionName} body must close`);
}

function extractRendererPassSignatureBranch(source, passName) {
  const marker = `if (passName === "${passName}") {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${passName} signature branch must exist`);
  const next = source.indexOf("\n  if (passName ===", start + marker.length);
  assert.notEqual(next, -1, `${passName} signature branch must end before the next pass branch`);
  return source.slice(start, next);
}

function createRendererShellPolicyHarness(rendererSource, politicalPartialOwnerSource) {
  const functionNames = [
    "isScenarioShellFeature",
    "isRuntimeOnlyShellFallbackPoliticalFeature",
    "isPoliticalShellUnderlayFeature",
    "isPoliticalPrimaryUnderlayFeature",
    "isPoliticalUnderlayFeature",
    "hasPoliticalForegroundColorOverride",
    "isPendingPoliticalColorEditFeature",
    "isPoliticalForegroundFeature",
    "orderPoliticalShellUnderlayFirst",
    "shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature",
    "isBaseGeographyScenarioFeature",
    "isPoliticalVisualRenderableFeature",
    "isPoliticalInteractionRenderableFeature",
    "getRuntimePoliticalBaseCollection",
  ];
  const partialFillSource = extractRendererFunction(politicalPartialOwnerSource, "getPoliticalFeatureFillColor");
  assert.match(rendererSource, /function getPoliticalPartialRepaintOwner\(\) \{[\s\S]*?createPoliticalPartialRepaintOwner\(\{[\s\S]*?getRuntimeState: \(\) => runtimeState,[\s\S]*?getResolvedFeatureColor,[\s\S]*?effects: \{/);
  const source = `
    const runtimeState = {
      mapSemanticMode: "ownership",
      activeScenarioId: "test",
      colorRevision: 1,
      colors: {},
      visualOverrides: {},
      featureOverrides: {},
      renderPassCache: {
        pendingPoliticalColorEditIds: new Set(),
        pendingPoliticalColorEditRevision: 1,
        pendingPoliticalColorEditScenarioId: "test",
      },
    };
    const getFeatureId = (feature) => String(feature?.properties?.id || feature?.id || "").trim();
    const getSafeCanvasColor = (value, fallback = null) => (typeof value === "string" && value.trim() ? value : fallback);
    const debugMode = "PROD";
    const LAND_FILL_COLOR = "#f0f0f0";
    const isAtlantropaSeaFeature = () => false;
    const getAtlantropaSeaPoliticalFillColor = () => "#123456";
    const getResolvedFeatureColor = (feature, id) => (
      runtimeState.featureOverrides?.[id]
      || runtimeState.visualOverrides?.[id]
      || feature?.properties?.fill
      || ""
    );
    const getRenderPassCacheState = () => runtimeState.renderPassCache;
    const getRuntimeState = () => runtimeState;
    const getDebugMode = () => debugMode;
    const landFillColor = LAND_FILL_COLOR;
    const surface = { getPathCanvas: () => ({ bounds: () => [[0, 0], [1, 1]] }) };
    const helper = {
      isAtlantropaSeaFeature,
      getAtlantropaSeaPoliticalFillColor,
      getSafeCanvasColor,
      getResolvedFeatureColor,
      hashToColor: () => "#abcdef",
    };
    function hasPendingPoliticalColorEdit() {
      const cache = getRenderPassCacheState();
      return cache.pendingPoliticalColorEditIds instanceof Set
        && cache.pendingPoliticalColorEditIds.size > 0
        && String(cache.pendingPoliticalColorEditScenarioId || "") === String(runtimeState.activeScenarioId || "")
        && Number(cache.pendingPoliticalColorEditRevision ?? -1) === Number(runtimeState.colorRevision || 0);
    }
    const isAtlantropaFieldDrivenFeature = () => false;
    const isScenarioAtlantropaVisible = () => true;
    const isAntarcticSectorFeature = () => false;
    const isAtlantropaVisualSupportHelperFeature = () => false;
    const isAtlantropaSupportHelperFeature = () => false;
    ${functionNames.map((name) => extractRendererFunction(rendererSource, name)).join("\n")}
    ${partialFillSource}
    globalThis.__shellPolicyHarness = {
      isScenarioShellFeature,
      isRuntimeOnlyShellFallbackPoliticalFeature,
      isPoliticalShellUnderlayFeature,
      isPoliticalPrimaryUnderlayFeature,
      isPoliticalUnderlayFeature,
      hasPoliticalForegroundColorOverride,
      isPendingPoliticalColorEditFeature,
      isPoliticalForegroundFeature,
      orderPoliticalShellUnderlayFirst,
      shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature,
      isPoliticalVisualRenderableFeature,
      isPoliticalInteractionRenderableFeature,
      getRuntimePoliticalBaseCollection,
      getPoliticalFeatureFillColor,
      setColors: (value) => { runtimeState.colors = value || {}; },
      setMapSemanticMode: (value) => { runtimeState.mapSemanticMode = value; },
      setVisualOverrides: (value) => {
        runtimeState.visualOverrides = value || {};
        runtimeState.featureOverrides = { ...(value || {}) };
      },
      setPendingColorEditIds: (ids) => {
        runtimeState.renderPassCache.pendingPoliticalColorEditIds = new Set(ids || []);
      },
    };
  `;
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__shellPolicyHarness;
}

function createFirstVisibleFrameGateHarness(rendererSource) {
  const source = `
    const runtimeState = {
      activeScenarioId: "startup-scenario",
      zoomTransform: { x: 0, y: 0, k: 1 },
    };
    const referenceTransform = { x: 0, y: 0, k: 1 };
    let fullReferenceTransform = null;
    const cache = {
      dirty: { political: false },
      signatures: { political: "political::ocean-fill:#101820" },
      politicalPassDataStage: "coarse",
      politicalPassFineCacheReady: false,
    };
    function getRenderPassCacheState() {
      return cache;
    }
    function getRenderPassSignature() {
      return "political::ocean-fill:#101820";
    }
    function getCachedPoliticalPassStaticSignature(signature) {
      return String(signature || "");
    }
    function getOceanBaseFillColor() {
      return "#101820";
    }
    function getPassReferenceTransform() {
      return referenceTransform;
    }
    function getPassFullReferenceTransform() {
      return fullReferenceTransform;
    }
    function areZoomTransformsEquivalent(first, second) {
      return !!first && !!second
        && Number(first.x || 0) === Number(second.x || 0)
        && Number(first.y || 0) === Number(second.y || 0)
        && Number(first.k || 1) === Number(second.k || 1);
    }
    ${extractRendererFunction(rendererSource, "getFirstVisiblePoliticalFrameBlockReason")}
    globalThis.__firstVisibleFrameGateHarness = {
      blockReason: getFirstVisiblePoliticalFrameBlockReason,
      setPoliticalStage: (stage, fineReady) => {
        cache.politicalPassDataStage = stage;
        cache.politicalPassFineCacheReady = !!fineReady;
      },
      setFullReferenceTransform: (transform) => {
        fullReferenceTransform = transform;
      },
    };
  `;
  const context = { globalThis: {}, d3: { zoomIdentity: { x: 0, y: 0, k: 1 } } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__firstVisibleFrameGateHarness;
}

function getPolygonCoordinateSets(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  if (geometry.type === "Polygon") {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  return [];
}

function getRingSignedArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const first = ring[index];
    const second = ring[index + 1];
    if (!Array.isArray(first) || !Array.isArray(second)) continue;
    total += (Number(first[0]) * Number(second[1])) - (Number(second[0]) * Number(first[1]));
  }
  return total / 2;
}

async function runOptionalChunkPromotionScenario({
  layerKey,
  stateField,
  revisionField = "",
  visibilityField = "",
  visibilityState = {},
  reason = "optional-only",
  featureId = "optional-feature",
  initialPayload = null,
  initialRevision = 0,
  staleBeforeVisualCommit = false,
  supersedeWithLatestTargetAtFrame = 0,
  beginSupersedingRequestAtFrame = 0,
  replacePromotionOwnerAtFrame = 0,
  failOnRenderFlush = false,
  awaitInitialPromotion = false,
} = {}) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const chunk = {
    id: `${layerKey}.coarse.world`,
    layer: layerKey,
    lod: "coarse",
    url: `${layerKey}.coarse.world.json`,
    bounds: [-180, -90, 180, 90],
  };
  const payload = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: featureId, properties: {}, geometry: null },
    ],
  };
  const bundle = {
    manifest: { scenario_id: "tno_1962" },
    chunkRegistry: { byLayer: { [layerKey]: [chunk] } },
    runtimeShell: { renderBudgetHints: {} },
    countriesPayload: { countries: {} },
    chunkPayloadCacheById: {},
  };
  const hasScenarioApplyRequest = (
    supersedeWithLatestTargetAtFrame > 0
    || beginSupersedingRequestAtFrame > 0
    || replacePromotionOwnerAtFrame > 0
  );
  const targetState = {
    activeScenarioId: "tno_1962",
    currentScenarioApplyRequestId: hasScenarioApplyRequest ? 1 : 0,
    latestScenarioApplyRequestId: hasScenarioApplyRequest ? 1 : 0,
    latestScenarioApplyTargetId: hasScenarioApplyRequest ? "tno_1962" : "",
    activeScenarioChunks: {
      scenarioId: "tno_1962",
      loadedChunkIds: [],
      payloadByChunkId: {},
      mergedLayerPayloads: {},
      lruChunkIds: [],
    },
    runtimeChunkLoadState: {
      shellStatus: "ready",
      selectionVersion: 0,
      layerSelectionSignatures: {},
      mergedLayerPayloadCache: {},
    },
    renderPerfMetrics: {},
    uiState: { developerMode: true },
    renderDiagnostics: { perfOverlayEnabled: true },
    zoomTransform: { k: 1 },
    getViewportGeoBoundsFn: () => [-180, -90, 180, 90],
  };
  const defaultVisibilityFields = {
    water: "showWaterRegions",
    special: "showScenarioSpecialRegions",
    scenario_atlantropa: "showScenarioAtlantropa",
    specialzonelayers: "showSpecialZones",
    relief: "showScenarioReliefOverlays",
    cities: "showCityPoints",
    strategicvalues: "showStrategicResourceMarkers",
  };
  const resolvedVisibilityField = visibilityField || defaultVisibilityFields[layerKey] || "";
  Object.assign(targetState, visibilityState);
  if (initialPayload) {
    targetState[stateField] = initialPayload;
  }
  if (revisionField && initialRevision) {
    targetState[revisionField] = initialRevision;
  }
  const refreshCalls = [];
  const citySyncSnapshots = [];
  const promotionError = failOnRenderFlush
    ? new Error("promotion render flush failed")
    : null;
  let rafCount = 0;
  let nextTimerId = 0;
  const deferredTimers = new Map();

  globalThis.setTimeout = (callback) => {
    if (awaitInitialPromotion) {
      nextTimerId += 1;
      deferredTimers.set(nextTimerId, callback);
      return nextTimerId;
    }
    callback();
    return 1;
  };
  globalThis.clearTimeout = (timerId) => {
    deferredTimers.delete(timerId);
  };
  globalThis.requestAnimationFrame = (callback) => {
    rafCount += 1;
    if (staleBeforeVisualCommit && rafCount === 2) {
      targetState.runtimeChunkLoadState.selectionVersion += 1;
    }
    if (supersedeWithLatestTargetAtFrame === rafCount) {
      targetState.latestScenarioApplyRequestId = 2;
      targetState.latestScenarioApplyTargetId = "scenario_b";
    }
    if (beginSupersedingRequestAtFrame === rafCount) {
      setLatestScenarioApplyRequestState(targetState, {
        requestId: 2,
        targetId: "scenario_b",
      });
      beginScenarioApplyRequestState(targetState, {
        requestId: 2,
        targetId: "scenario_b",
      });
    }
    if (replacePromotionOwnerAtFrame === rafCount) {
      queueScenarioChunkPromotionState(targetState, { promotion: {
        scenarioId: "tno_1962",
        scenarioApplyRequestId: 1,
        owner: "replacement",
      } });
      applyScenarioChunkOptionalLayerState(targetState, "scenario_atlantropa", {
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "atl-new-owner", properties: {}, geometry: null },
        ],
      });
      bumpScenarioChunkDataGenerationState(targetState, "new-promotion-owner");
    }
    callback();
    return rafCount;
  };

  try {
    const controller = createScenarioChunkRuntimeController({
      runtimeState: targetState,
      getSearchParams: () => new URLSearchParams(),
      normalizeScenarioId: (value) => String(value || "").trim(),
      normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
      normalizeScenarioFeatureCollection,
      getScenarioFeatureCollectionIdentityList,
      areScenarioFeatureCollectionsEquivalent,
      getScenarioDefaultCountryCode: () => "",
      getScenarioBundleId: () => "tno_1962",
      getCachedScenarioBundle: () => bundle,
      getVisibleScenarioChunkLayers: () => [layerKey],
      selectScenarioChunks: () => ({
        scenarioId: "tno_1962",
        requiredChunks: [chunk],
        optionalChunks: [],
        evictableChunkIds: [],
        viewportBbox: [-180, -90, 180, 90],
        selectedFeatureCountSum: 1,
      }),
      mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
        type: "FeatureCollection",
        features: payloads.flatMap((payload) => payload?.features || []),
      }),
      normalizeScenarioRenderBudgetHints: (value) => value || {},
      loadScenarioChunkFile: async () => ({ payload }),
      scenarioSupportsChunkedRuntime: () => true,
      scenarioBundleUsesChunkedLayer: (_bundle, requestedLayerKey = "") => !requestedLayerKey || requestedLayerKey === layerKey,
      getScenarioOptionalLayerConfig: (requestedLayerKey) => (
        String(requestedLayerKey || "").trim().toLowerCase() === layerKey
          ? {
            stateField,
            revisionField,
            visibilityField: resolvedVisibilityField,
          }
          : null
      ),
      isScenarioOptionalLayerRequestedForVisibility: (requestedLayerKey, config) => {
        const normalizedLayerKey = String(requestedLayerKey || "").trim().toLowerCase();
        if (normalizedLayerKey === "strategicvalues") {
          return !!targetState.showStrategicResourceMarkers || !!String(targetState.strategicChoroplethMetric || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(targetState, config.visibilityField)) {
          return !!targetState[config.visibilityField];
        }
        return config.visibilityField !== "showSpecialZones" && config.visibilityField !== "showStrategicResourceMarkers";
      },
      syncScenarioLocalizationState: ({ cityOverridesPayload } = {}) => {
        if (layerKey !== "cities") return;
        applyScenarioChunkCityExternalEffectState(targetState, cityOverridesPayload);
        citySyncSnapshots.push({
          payload: targetState.scenarioCityOverridesData,
          revision: targetState.cityLayerRevision,
        });
      },
      refreshMapDataForScenarioChunkPromotion: (options) => {
        refreshCalls.push(options);
      },
      flushRenderBoundary: () => {
        if (promotionError) {
          throw promotionError;
        }
      },
      recordScenarioPerfMetric: () => {},
      ensureScenarioChunkRegistryLoaded: async () => {},
    });

    let awaitedError = null;
    if (awaitInitialPromotion) {
      try {
        await controller.awaitInitialScenarioChunkVisualPromotion({ reason });
      } catch (error) {
        awaitedError = error;
      }
    } else {
      assert.equal(controller.scheduleScenarioChunkRefresh({ reason, delayMs: 0 }), "scheduled");
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    }

    return {
      controller,
      runtimeState: targetState,
      refreshCalls,
      citySyncSnapshots,
      promotionError,
      awaitedError,
    };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  }
}

function createCoarsePrewarmContinuationHarness({
  currentScenarioApplyRequestId = 1,
  seedCurrentPoliticalChunkData = false,
  initialPoliticalVisibleChunkData = undefined,
  initialScenarioDataGeneration = undefined,
  initialScenarioDataGenerationReason = undefined,
} = {}) {
  const chunkLoadStarted = createDeferredPromise();
  const chunkLoadResult = createDeferredPromise();
  const politicalChunk = {
    id: "political.coarse.world",
    layer: "political",
    lod: "coarse",
    url: "political.coarse.world.json",
    bounds: [-180, -90, 180, 90],
    featureCount: 1,
  };
  const stalePayload = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "old-prewarm", properties: {}, geometry: null },
    ],
  };
  const currentPayload = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "current-request", properties: {}, geometry: null },
    ],
  };
  const bundle = {
    manifest: {
      scenario_id: "scenario_a",
      summary: { feature_count: 22502 },
      render_budget_hints: {},
      performance_hints: {},
    },
    chunkRegistry: {
      chunks: [politicalChunk],
      byLayer: { political: [politicalChunk] },
    },
    contextLodManifest: {},
    runtimeShell: { renderBudgetHints: {} },
    countriesPayload: { countries: {} },
    chunkPayloadCacheById: {},
  };
  const targetState = {
    activeScenarioId: "scenario_a",
    currentScenarioApplyRequestId,
    scenarioPoliticalChunkData:
      seedCurrentPoliticalChunkData ? currentPayload : undefined,
    scenarioPoliticalVisibleChunkData: initialPoliticalVisibleChunkData,
    scenarioDataGeneration: initialScenarioDataGeneration,
    scenarioDataGenerationReason: initialScenarioDataGenerationReason,
    renderPerfMetrics: {},
    uiState: { developerMode: true },
    renderDiagnostics: { perfOverlayEnabled: true },
    zoomTransform: { k: 1 },
  };
  let promotionRefreshCalls = 0;
  const controller = createScenarioChunkRuntimeController({
    runtimeState: targetState,
    getSearchParams: () => new URLSearchParams(),
    normalizeScenarioId: (value) => String(value || "").trim(),
    normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
    normalizeScenarioPerformanceHints: () => ({
      waterRegionsDefault: false,
      specialRegionsDefault: false,
      scenarioReliefOverlaysDefault: false,
      scenarioAtlantropaDefault: false,
    }),
    normalizeScenarioFeatureCollection: (payload) => payload,
    getScenarioFeatureCollectionIdentityList,
    areScenarioFeatureCollectionsEquivalent: () => false,
    getScenarioDefaultCountryCode: () => "",
    getScenarioBundleId: (candidate) => String(candidate?.manifest?.scenario_id || ""),
    getCachedScenarioBundle: () => bundle,
    getVisibleScenarioChunkLayers: () => ["political"],
    selectScenarioChunks: ({ viewportBbox }) => ({
      scenarioId: "scenario_a",
      requiredChunks: [politicalChunk],
      optionalChunks: [],
      evictableChunkIds: [],
      viewportBbox,
      selectedFeatureCountSum: 1,
      selectedVisibleFeatureCountSum: 1,
      selectedPoliticalFeatureCountSum: 1,
      selectedPoliticalVisibleFeatureCountSum: 1,
      politicalVisibleFeatureSubsetSignature: "political.coarse.world:0",
    }),
    mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
      type: "FeatureCollection",
      features: payloads.flatMap((payload) => payload?.features || []),
    }),
    mergeScenarioChunkPayloadsForViewport,
    normalizeScenarioRenderBudgetHints: (value) => value || {},
    loadScenarioChunkFile: async () => {
      chunkLoadStarted.resolve();
      return chunkLoadResult.promise;
    },
    scenarioSupportsChunkedRuntime: () => true,
    scenarioBundleUsesChunkedLayer: (_bundle, layerKey = "") => !layerKey || layerKey === "political",
    getScenarioOptionalLayerConfig: () => null,
    syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: () => {
      promotionRefreshCalls += 1;
    },
    flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {},
    ensureScenarioChunkRegistryLoaded: async () => {},
  });

  return {
    bundle,
    controller,
    currentPayload,
    targetState,
    awaitChunkLoadStarted: () => chunkLoadStarted.promise,
    getPromotionRefreshCalls: () => promotionRefreshCalls,
    resolveChunkLoad: () => chunkLoadResult.resolve({ payload: stalePayload }),
  };
}

export {
  test,
  assert,
  fs,
  path,
  vm,
  createScenarioChunkRuntimeController,
  buildViewportGeoBounds,
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioChunkManifest,
  resolveRequiredScenarioSemanticLayers,
  selectScenarioChunks,
  getSharedFeatureCountryCode,
  getSharedFeatureId,
  normalizeFeatureCountryCode,
  createRenderCacheOwner,
  createColorResolutionStrategyOwner,
  buildSpatialGridSnapshot,
  getSpatialBucketKey,
  isScenarioWaterLikeFeature,
  applyScenarioChunkCityExternalEffectState,
  patchScenarioChunkLoadState,
  queueScenarioChunkPromotionState,
  resetScenarioChunkRuntimeState,
  beginScenarioApplyRequestState,
  clearActiveScenarioApplyRequestState,
  setLatestScenarioApplyRequestState,
  applyScenarioChunkOptionalLayerState,
  bumpScenarioChunkDataGenerationState,
  createScenarioChunkRegistryEnsurer,
  REPO_ROOT,
  readRepoFile,
  createDeferredPromise,
  createInitialVisualRegistryContinuationHarness,
  sliceBetween,
  loadVendorD3,
  createTimerGenerationController,
  createChunkLoadGenerationFixture,
  runStalePromotionCommitSettlement,
  isWorldGeoBounds,
  getManifestChunksByLayer,
  readManifestChunkPayload,
  getFeatureId,
  getTopologyGeometryId,
  getCoordinateBounds,
  extractRendererFunction,
  extractRendererPassSignatureBranch,
  createRendererShellPolicyHarness,
  createFirstVisibleFrameGateHarness,
  getPolygonCoordinateSets,
  getRingSignedArea,
  runOptionalChunkPromotionScenario,
  createCoarsePrewarmContinuationHarness,
};
