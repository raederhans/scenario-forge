import { createPoliticalIdRasterOverview } from "./political_id_raster_overview.js";
import { createPoliticalIdRasterDisplayCache } from "./political_id_raster_display_cache.js";
import { createPoliticalIdRasterSource } from "./political_id_raster_source.js";
import { createPoliticalIdRasterCache, planPoliticalIdRasterView, scaleRasterViewportBudget, RASTER_BUDGET_MAX_PIXELS } from "./political_id_raster_cache.js";
import { createPoliticalIdRasterGpu } from "./political_id_raster_gpu.js";
import { createPoliticalIdRasterWorkerClient, POLITICAL_ID_ASSET_SAVE_MAX_BYTES } from "../political_id_raster_worker_client.js";
import { createPoliticalIdRasterCoordinateSpace } from "./political_id_raster_coordinates.js";
import { createPoliticalIdRasterIdentityBuilder } from "./political_id_raster_identity.js";
import { createPoliticalIdRasterAssetStore, encodePoliticalIdRasterAsset } from "./political_id_raster_assets.js";
import { queryPoliticalIdRasterCandidates } from "./political_id_raster_pick.js";
import { yieldToBackground } from "../background_yield.js";

const GPU_LIMIT = 80 * 1024 * 1024;
const GPU_HARD_LIMIT = scaleRasterViewportBudget(GPU_LIMIT, RASTER_BUDGET_MAX_PIXELS, 1);
const MAX_COLOR_DELTAS = 32;
const TILE_EVENT_LIMIT = 256;
const NO_ENTRIES = Object.freeze([]);
const projectionMethods = ["scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY", "precision", "clipAngle", "clipExtent"];

function matchesTileRegion(tile, descriptor) {
  if (descriptor.storageRect) {
    const { minX, minY, maxX, maxY } = descriptor.storageRect;
    return !!tile && tile.originX === minX && tile.originY === minY
      && tile.width === maxX - minX && tile.height === maxY - minY;
  }
  return !!tile && tile.width === descriptor.width && tile.height === descriptor.height
    && tile.originX === descriptor.originX && tile.originY === descriptor.originY;
}

function intersectsTile(bounds, tile, padding = 4) {
  if (!bounds) return true;
  const d = tile.density;
  return bounds.maxX * d >= tile.originX - padding && bounds.minX * d <= tile.originX + tile.width + padding
    && bounds.maxY * d >= tile.originY - padding && bounds.minY * d <= tile.originY + tile.height + padding;
}

/** Derived display and advisory picking. Canonical edits/export retain their owners. */
export function createPoliticalIdRasterRuntimeOwner({
  state, surface, helpers: h, effects: e,
  client = null, cache = createPoliticalIdRasterCache(),
  createGpu = createPoliticalIdRasterGpu, resourceBudget = null,
  createDisplayCache = createPoliticalIdRasterDisplayCache,
  assetStore = undefined,
  identityBuilder = createPoliticalIdRasterIdentityBuilder(), canonicalCoordinates = true, gutter = 0,
  assetTimeoutMs = 1500, assetRetryAfterMs = 5000, refineAfterMs = null, displayMode = "hybrid",
  directPresentation = false,
}) {
  if (!["raster", "hybrid"].includes(displayMode)) throw new TypeError("Invalid raster display mode.");
  let gpuLimit = GPU_LIMIT, maxPixels = 12 * 1024 * 1024;
  const persistent = displayMode === "raster";
  // Diagnostic A/B only; no persisted preference or change to auto eligibility.
  const displayCache = !directPresentation && persistent && new URLSearchParams(globalThis.location?.search || "").get("political_raster_present") !== "full"
    ? createDisplayCache() : null;
  let tileDependencies = new WeakMap(), lastTiming = null;
  let tileEventsEnabled = false, nextTileEventId = 0, tileEventIds = new WeakMap();
  const tileEvents = new Map();
  const tileRecords = new Map();
  let tileRecordStampKey = "";
  let tileRecordPlanKey = "", demandedTileKeys = new Set();
  const dirtyTileKeys = new Set(), tileRecordKeys = new WeakMap(), handleRecordKeys = new Map();
  const unsubscribeCache = cache.subscribe(key => dirtyTileKeys.add(key));
  let stageTimingsEnabled = false, snapshotBuilds = 0, tileRecordUpdates = 0;
  const stageTimings = {};
  let navigationSnapshot = null;
  let navigationTileSnapshot = null;
  function recordStage(stage, ms, taskKind, key) {
    if (!stageTimingsEnabled) return;
    const timing = stageTimings[stage] ||= { count: 0, totalMs: 0, maxMs: 0, tasks: {} };
    timing.count++; timing.totalMs += ms; timing.maxMs = Math.max(timing.maxMs, ms);
    const task = timing.tasks[taskKind] ||= { count: 0, totalMs: 0, maxMs: 0 };
    task.count++; task.totalMs += ms; task.maxMs = Math.max(task.maxMs, ms);
    const event = tileEvents.get(tileEventIds.get(cache.peek(key)));
    if (event) (event.stages ||= {})[stage] = { ms, taskKind };
    e.recordMetric?.(`politicalIdRaster${stage[0].toUpperCase()}${stage.slice(1)}`, ms, { taskKind, key });
  }
  function recordTileUpload(tile, uploadSubmittedAt) {
    const event = tileEvents.get(tileEventIds.get(tile));
    if (event && event.uploadSubmittedAt === null) event.uploadSubmittedAt = uploadSubmittedAt;
    const key = tileRecordKeys.get(tile);
    dirtyTileKeys.add(key);
    const record = tileRecords.get(key);
    if (record) record.uploadSubmittedAt = uploadSubmittedAt;
  }
  const worker = client || createPoliticalIdRasterWorkerClient();
  if (assetStore === undefined) assetStore = globalThis.indexedDB
    ? worker.assetStore || createPoliticalIdRasterAssetStore() : null;
  let coordinates = null, fittedProjectionKey = "", rawIdentity = null;
  let sourceLayoutKey = "", deferredForegroundOrder = false, foregroundSyncRequested = false;
  let codeToId = new Map(), tileIdentities = new WeakMap();
  let sourcePreparation = null;
  const sourcePreparationStats = { started: 0, cancelled: 0, committed: 0, lastMs: 0, maxSliceMs: 0, commitMs: 0 };
  let committedPlan = null, manifestKey = "", manifestPromise = null, assetError = "", assetTimeout = false;
  let directFrame = null, publishedEntries = [], publishedPalette = null, publishedBaselinePalette = null;
  let publishedPaletteKey = "", publishedResult = null, stagedFrame = null;
  let stagedRejectionReason = "", stagedRejections = 0;
  let publishedEditRenderQueued = false;
  let gpuPreparation = null, gpuAcceptedKey = "";
  const gpuTileTokens = new WeakMap(); let nextGpuTileToken = 0;
  const gpuPreparationStats = { started: 0, cancelled: 0, committed: 0, capacityFallbacks: 0,
    unsupportedFallbacks: 0, lastPath: "not-started", lastMs: 0, maxTaskMs: 0, uploadedTiles: 0 };
  let overviewBaselinePalette = null;
  let overviewFrame = null, overviewCommitted = null, overviewEntries = [], overviewPalette = null, overviewPaletteKey = "", overviewReason = "not-created";
  let manifestReadyKey = "";
  let consecutiveAssetTimeouts = 0;
  let nextAssetProbeAt = 0, assetFailureKind = "", assetFailureOperation = "";
  let lastAssetFailure = null;
  let assetRecoveryTimer = null, coveredAssetProbes = 0;
  let backgroundSave = null, lastAssetSaveFailure = null;
  let saveCandidate = null, saveIdle = null, assetPublishedViewKey = "";
  let pathCacheEstimatedBytes = 0;
  let manifestController = new AbortController();
  let displayState = "preparing", reason = "awaiting-coverage";
  let viewKey = "", refinedViewKey = "", refinementTimer = null;
  let nativePartialPending = false, forceNativeRefinement = false;
  let viewStartedAt = 0, firstRasterReadyMs = null, lastDrawTotalMs = 0, nativeRefinements = 0;
  function cancelRefinement() {
    if (refinementTimer !== null) clearTimeout(refinementTimer);
    refinementTimer = null; nativePartialPending = false;
  }
  function cancelAssetRecovery() { if (assetRecoveryTimer !== null) clearTimeout(assetRecoveryTimer); assetRecoveryTimer = null; }
  function getViewIdentity() {
    return JSON.stringify([namespace, sourceVersion, snapshot.paletteRevision, state.dpr,
      state.zoomTransform.x, state.zoomTransform.y, state.zoomTransform.k,
      plan.width, plan.height, plan.outputX, plan.outputY, plan.scale]);
  }
  function updateViewIdentity() {
    const next = getViewIdentity();
    if (next !== viewKey) {
      cancelAssetSave();
      assetPublishedViewKey = "";
      cancelAssetRecovery(); coveredAssetProbes = 0;
      cancelRefinement(); viewKey = next; refinedViewKey = "";
      viewStartedAt = performance.now(); firstRasterReadyMs = null;
    }
  }
  function scheduleRefinement() {
    if (persistent) return;
    // Pixel alignment does not make canonical tessellation identical to the
    // native path; every configured view must finish with the exact producer.
    if (!(Number.isFinite(refineAfterMs) && refineAfterMs >= 0) || refinementTimer !== null) return;
    const scheduledKey = viewKey;
    const transform = { ...state.zoomTransform };
    const identity = { ...rawIdentity };
    refinementTimer = setTimeout(() => {
      refinementTimer = null;
      if (disposed || !h.isEnabled() || viewKey !== scheduledKey) return;
      const current = h.getSourceIdentity();
      if (["x", "y", "k"].some(key => state.zoomTransform[key] !== transform[key])
        || ["sceneKey", "projectionKey", "coverageKey", "version", "colorVersion"].some(key => current[key] !== identity[key])) {
        // A final camera tick or history cleanup can change state after the frame.
        // Refresh the live source and schedule its refinement instead of leaving
        // this otherwise idle view permanently in approximate display.
        e.requestRender("political-id-raster-refinement-refresh");
        return;
      }
      // Refinement never rebuilds ID tiles: the existing vector producer draws
      // the current visible political pass at the exact device-pixel scale.
      refinedViewKey = scheduledKey;
      nativeRefinements++;
      e.requestRender("political-id-raster-refine");
    }, refineAfterMs);
  }
  function noteNativePartialRepaint() {
    if (persistent) return;
    if (disposed || !h.isEnabled() || !(Number.isFinite(refineAfterMs) && refineAfterMs >= 0)) return;
    cancelRefinement();
    nativePartialPending = true;
    displayState = "accelerated"; reason = "native-partial-feedback";
    // A held brush keeps its local feedback; finish the exact full pass once
    // the gesture owner closes the stroke, rather than between pointer moves.
    if (h.isBrushActive?.()) return;
    refinementTimer = setTimeout(() => {
      refinementTimer = null; nativePartialPending = false;
      if (disposed || !h.isEnabled()) return;
      // Coalesce a stroke's local feedback, then redraw the exact native pass.
      // Clipped antialiasing edges cannot be treated as a final full-frame oracle.
      forceNativeRefinement = true;
      e.requestRender("political-id-raster-partial-refine");
    }, refineAfterMs);
  }
  const source = createPoliticalIdRasterSource({ getId: h.getFeatureId,
    getBounds: (feature, id) => {
      const bounds = h.getBounds(feature, id);
      return coordinates ? coordinates.mapBounds(bounds) : bounds;
    }, resolveColor: h.resolveColor });
  const resourceOwner = Symbol("political-id-raster");
  let snapshot = null, sourceVersion = null, paletteVersion = null, colorScope = null, namespace = null;
  // Explicit dirty-ID palette edits of one accepted source. Published and
  // overview palettes may replay an unbroken chain from their own version; a
  // full refresh, scope change or replaced snapshot forces full resolution.
  let sourceGeneration = 0, colorDeltas = [];
  let publishedColorState = null, overviewColorState = null;
  const entryIndexes = new WeakMap();
  let gpu = null, active = null, plan = null, disposed = false, failed = "";
  let gpuTiles = [];
  let renderedCoverage = null;
  let epoch = 0, planKey = "", attempted = new Set();
  let navigationDemand = null, navigationProducing = false, navigationTask = null;
  let navigationUpload = null, navigationUploadAvailable = false;
  let navigationRevision = 0;
  const stats = { builds: 0, cacheHits: 0, staleResults: 0, commits: 0, fallbacks: 0,
    geometryInvalidations: 0, contextLosses: 0, coldBuildMs: 0, lastCommitMs: 0,
    assetHits: 0, pathBuilds: 0, pathCacheHits: 0, pickInteriors: 0, pickFallbacks: 0,
    identityMs: 0, assetLookupMs: 0, assetTimeouts: 0, assetErrors: 0,
    assetProbes: 0, assetRecoveries: 0, assetBypasses: 0,
    assetSavesDropped: 0, assetSaveTimeouts: 0, assetSaveErrors: 0,
    renderedCoverageScans: 0, renderedCoverageCacheHits: 0 };

  function recordAssetFailure(error, operation, probe = false) {
    assetFailureKind = error.name === "TimeoutError" ? "timeout" : "error";
    assetFailureOperation = operation;
    assetError = String(error.message || error);
    lastAssetFailure = { kind: assetFailureKind, operation, phase: active?.assetPhase || operation,
      durationMs: performance.now() - (active?.assetOperationStartedAt || performance.now()) };
    if (assetFailureKind === "timeout") {
      assetTimeout = true;
      stats.assetTimeouts++;
      if (operation === "load") consecutiveAssetTimeouts++;
    } else stats.assetErrors++;
    if (operation === "load" && (probe || consecutiveAssetTimeouts >= 3)) {
      nextAssetProbeAt = performance.now() + assetRetryAfterMs;
    }
  }
  function clearAssetFailure() {
    assetError = ""; assetFailureKind = ""; assetFailureOperation = "";
  }

  function scheduleCoveredAssetRecovery() {
    if (!usable() || active || consecutiveAssetTimeouts < 3 || coveredAssetProbes >= 2 || assetRecoveryTimer !== null
      || !plan?.tiles.some(tile => cache.peek(tile.key))) return;
    // Worker coverage must not leave the circuit open forever. At most two
    // idle probes per view share the serial producer and the original deadline.
    assetRecoveryTimer = setTimeout(() => {
      assetRecoveryTimer = null;
      if (!usable() || active) return;
      try {
        if (!syncSource()) return;
        if (!updatePlan()) return;
        updateViewIdentity();
        pump(true);
      } catch (error) {
        failed = String(error?.message || error);
        cancel();
        e.requestRender("political-id-raster-recovery-fallback");
      }
    }, Math.max(0, nextAssetProbeAt - performance.now()));
  }

  function syncTileRecords(taskKind = "producer") {
    if (!snapshot || !plan || disposed) {
      tileRecords.clear(); handleRecordKeys.clear(); dirtyTileKeys.clear();
      tileRecordStampKey = ""; tileRecordPlanKey = ""; navigationSnapshot = null; navigationTileSnapshot = null;
      return;
    }
    const sourceStamp = { namespace, geometryEpoch: epoch, mappingRevision: snapshot.mappingRevision,
      projectionSignature: coordinates?.signature || fittedProjectionKey, dpr: state.dpr,
      rasterizationVariant: `${directPresentation ? "halo-1-v1" : "core-v1"}:gutter=${gutter}:stroke=${0.75 * state.dpr}` };
    const stampKey = JSON.stringify(sourceStamp);
    if (tileRecordStampKey !== stampKey) {
      tileRecords.clear(); handleRecordKeys.clear(); dirtyTileKeys.clear();
      tileRecordStampKey = stampKey; tileRecordPlanKey = null; navigationSnapshot = null; navigationTileSnapshot = null;
    }
    if (tileRecordPlanKey !== planKey) {
      demandedTileKeys = new Set(plan.tiles.map(tile => tile.key));
      for (const key of tileRecords.keys()) if (!demandedTileKeys.has(key)) dirtyTileKeys.add(key);
      tileRecordPlanKey = planKey;
      for (const descriptor of plan.tiles) {
        if (tileRecords.has(descriptor.key)) continue;
        const { key, level, density, originX, originY, width, height } = descriptor;
        const coreRect = { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
        tileRecords.set(key, { key, sourceStamp, level, density, coreRect, storageRect: { ...(descriptor.storageRect || coreRect) },
          worldRect: { minX: originX / density, minY: originY / density,
            maxX: (originX + width) / density, maxY: (originY + height) / density },
          state: "requested", cpuCacheKey: key, gpuHandle: null, requestedAt: performance.now(),
          cpuReadyAt: null, uploadSubmittedAt: null });
        dirtyTileKeys.add(key);
      }
    }
    for (const key of dirtyTileKeys) {
      const record = tileRecords.get(key);
      if (!record) continue;
      const started = stageTimingsEnabled ? performance.now() : 0;
      const tile = cache.peek(key);
      if (tile) tileRecordKeys.set(tile, key);
      const prepared = gpuPreparation?.status === "ready" ? gpuPreparation.handle.getTileHandle?.(tile) : null;
      const resident = tile ? gpu?.getTileHandle?.(tile) : null;
      const previousHandle = record.gpuHandle;
      record.gpuHandle = resident || (gpu?.hasTileHandle?.(record.gpuHandle) ? record.gpuHandle : null) || prepared;
      if (record.gpuHandle !== previousHandle) {
        handleRecordKeys.delete(previousHandle);
        if (record.gpuHandle) handleRecordKeys.set(record.gpuHandle, key);
        navigationRevision++; navigationSnapshot = null;
      }
      record.state = record.gpuHandle ? "gpu-ready" : tile ? "cpu-ready" : "requested";
      if (tile && record.cpuReadyAt === null) record.cpuReadyAt = performance.now();
      if (!tile && !record.gpuHandle && !demandedTileKeys.has(key)) tileRecords.delete(key);
      tileRecordUpdates++;
      if (stageTimingsEnabled) recordStage("snapshot", performance.now() - started, taskKind, key);
    }
    dirtyTileKeys.clear();
  }

  function account(taskKind = "producer") {
    syncTileRecords(taskKind);
    if (saveCandidate && tileIdentities.get(cache.peek(saveCandidate.cacheKey)) !== saveCandidate.identity) {
      dropSaveCandidate();
    }
    const retained = cache.getStats();
    const graphics = gpu?.getStats();
    const assets = assetStore?.stats();
    const presentation = displayCache?.getStats();
    const workerStats = worker.getStats?.();
    const dependencyBytes = displayCache ? cache.entries().reduce((sum, [, tile]) => sum + (tileDependencies.get(tile)?.byteLength || 0), 0) : 0;
    // Initial palettes share their live buffer until a retained color refresh
    // replaces it. Count each retained typed array once, including frozen bases.
    const paletteBytes = [...new Set([snapshot?.palette, publishedPalette, overviewPalette,
      publishedBaselinePalette, overviewBaselinePalette])].reduce((sum, palette) => sum + (palette?.byteLength || 0), 0);
    resourceBudget?.update(resourceOwner, { rasterTiles: retained.cpuBytes + paletteBytes
        + (assets?.memoryBytes || 0) + (presentation?.paletteSnapshotBytes || 0) + dependencyBytes,
      gpuTextures: graphics?.gpuTextureBytes || 0,
      workerSurfaces: (directPresentation ? 0 : graphics?.outputSurfaceBytesEstimate || 0) + (presentation?.retainedSurfaceBytes || 0)
        + (active ? (active.descriptor.width + 2 * (gutter + Number(directPresentation)))
          * (active.descriptor.height + 2 * (gutter + Number(directPresentation))) * 4 : 0),
      workerGeometry: workerStats?.residentGeometryBytes ?? (active ? null : 0),
      decodeTransient: assets?.pendingBytes || 0,
      projectedPaths: workerStats?.pathBytes ?? pathCacheEstimatedBytes });
  }
  function releaseGpu() { cancelGpuPreparation(); gpuAcceptedKey = ""; publishedBaselinePalette = null; overviewBaselinePalette = null; overviewFrame = null; overviewCommitted = null; overviewEntries = []; overviewPalette = null; stagedFrame = null; directFrame = null; publishedEntries = []; publishedPalette = null; publishedResult = null; gpu?.dispose(); gpu = null; gpuTiles = []; displayCache?.reset(); }
  function cancel() {
    cancelNavigationUpload();
    cancelGpuPreparation();
    stagedFrame = null; active?.controller.abort(); active = null;
    cancelAssetSave(); dropSaveCandidate(); assetPublishedViewKey = "";
  }
  function getRenderedIds() {
    // Color edits and camera movement within the same tile rectangle do not
    // change this conservative coverage. Keep one ID list, never source objects
    // or tile buffers, and return a fresh Set for the pending-edit consumer.
    const key = JSON.stringify([epoch, namespace, snapshot.geometryRevision, snapshot.mappingRevision,
      plan.density, plan.originX, plan.originY, plan.width, plan.height]);
    if (renderedCoverage?.key !== key || renderedCoverage.entries !== snapshot.entries) {
      const ids = snapshot.entries.filter(entry => intersectsTile(entry.bounds, plan)).map(entry => entry.id);
      renderedCoverage = { key, entries: snapshot.entries, ids };
      stats.renderedCoverageScans++;
    } else stats.renderedCoverageCacheHits++;
    return new Set(renderedCoverage.ids);
  }
  function usable() { return !disposed && !failed && h.isEnabled() && worker.available(); }
  function cancelGpuPreparation() {
    const job = gpuPreparation;
    if (!job) return;
    gpuPreparation = null;
    job.controller.abort(); job.handle?.cancel();
    for (const key of tileRecords.keys()) dirtyTileKeys.add(key);
    gpuPreparationStats.cancelled++;
  }
  function gpuCandidateKey() {
    const tiles = plan?.tiles.map(descriptor => {
      const tile = cache.peek(descriptor.key);
      if (!tile) return 0;
      if (!gpuTileTokens.has(tile)) gpuTileTokens.set(tile, ++nextGpuTileToken);
      return gpuTileTokens.get(tile);
    });
    return JSON.stringify([namespace, sourceVersion, epoch, state.dpr, fittedProjectionKey, sourceLayoutKey, planKey, tiles]);
  }
  function gpuCandidateCurrent(job) {
    if (!usable() || sourcePreparation || gpuPreparation !== job || gpu !== job.gpu
      || job.controller.signal.aborted || !gpu.isAvailable() || gpuCandidateKey() !== job.key
      || sourceLayoutKey !== layoutKey() || fittedProjectionKey !== JSON.stringify(projectionOptions())) return false;
    const current = h.getSourceIdentity();
    // Palette-only edits may arrive while textures prepare. Geometry keeps its
    // identity, and publication validates/resolves the latest palette separately.
    const keys = Object.keys(rawIdentity || {}).filter(key => key !== "colorVersion" && key !== "colorScope");
    return keys.every(key => current[key] === rawIdentity[key]);
  }
  function prepareGpuFrame() {
    try {
      if (!usable() || !directPresentation || navigationProducing || !plan || !snapshot || sourcePreparation || active) return false;
      const key = gpuCandidateKey();
      if (gpuAcceptedKey === key) { cancelGpuPreparation(); return false; }
      if (gpuPreparation?.key === key) return gpuPreparation.status === "pending";
      cancelGpuPreparation();
      const tiles = plan.tiles.map(tile => cache.peek(tile.key));
      if (tiles.some(tile => !tile)) return false;
      if (!ensureGpu()) return false;
      const job = { key, gpu, controller: new AbortController(), status: "pending", handle: null };
      gpuPreparation = job;
      if (typeof gpu.prepareFrame !== "function") {
        job.status = "fallback"; gpuPreparationStats.unsupportedFallbacks++;
        gpuPreparationStats.lastPath = "synchronous-unsupported";
        return false;
      }
      const startedAt = performance.now();
      gpuPreparationStats.started++; gpuPreparationStats.lastPath = "preparing";
      job.promise = gpu.prepareFrame({ tiles, palette: snapshot.palette, signal: job.controller.signal,
        onTileUploadSubmitted: recordTileUpload,
        onTileTiming: (tile, ms, taskKind) => recordStage("upload", ms, taskKind, tileRecordKeys.get(tile)),
        isCurrent: () => gpuCandidateCurrent(job), onProgress: account,
        ...(h.yieldGpuPreparation ? { yieldTask: h.yieldGpuPreparation } : {}),
      }).then(handle => {
        if (!gpuCandidateCurrent(job)) {
          handle?.cancel();
          if (gpuPreparation === job) { gpuPreparation = null; if (usable()) e.requestRender("political-id-gpu-superseded"); }
          return;
        }
        gpuPreparationStats.lastMs = performance.now() - startedAt;
        if (handle) {
          job.handle = handle; job.status = "ready";
          for (const descriptor of plan.tiles) dirtyTileKeys.add(descriptor.key);
          gpuPreparationStats.lastPath = "asynchronous-ready";
          gpuPreparationStats.maxTaskMs = Math.max(gpuPreparationStats.maxTaskMs, handle.stats.maxTaskMs);
          gpuPreparationStats.uploadedTiles += handle.stats.uploadedTiles;
        } else {
          job.status = "fallback"; gpuPreparationStats.capacityFallbacks++;
          gpuPreparationStats.lastPath = "synchronous-capacity";
        }
        account(); e.requestRender("political-id-gpu-prepared");
      }).catch(error => {
        if (gpuPreparation !== job || job.controller.signal.aborted) return;
        gpuPreparation = null;
        if (error?.name !== "AbortError") failProducer(error);
        account(); e.requestRender("political-id-gpu-preparation-finished");
      });
      return true;
    } catch (error) {
      failProducer(error);
      e.requestRender("political-id-gpu-preparation-fallback");
      return false;
    }
  }
  function projectionOptions() {
    const projection = surface.getProjection();
    const options = { factory: "geoEqualEarth" };
    for (const key of projectionMethods) if (typeof projection[key] === "function") options[key] = projection[key]();
    return options;
  }

  function layoutKey() {
    const layout = h.getLayout();
    return JSON.stringify([layout.pixelWidth, layout.pixelHeight, layout.paddedWidth,
      layout.paddedHeight, layout.offsetX, layout.offsetY, state.dpr]);
  }
  function sameIdentity(left, right) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
  }
  function cancelSourcePreparation() {
    if (!sourcePreparation) return;
    sourcePreparation.controller.abort();
    sourcePreparation = null;
    sourcePreparationStats.cancelled++;
  }
  const sourceHostTask = yieldToBackground;

  // Draw and tile completion may request work, but never collect or publish a
  // complete scene. The accepted source remains immutable until this private
  // candidate passes its final identity fence in a separate task.
  function syncSourceAsync() {
    const raw = h.getSourceIdentity(), options = projectionOptions();
    const nextFitKey = JSON.stringify(options), nextLayoutKey = layoutKey();
    const nextCoordinates = fittedProjectionKey === nextFitKey ? coordinates
      : canonicalCoordinates ? createPoliticalIdRasterCoordinateSpace(options) : null;
    const identity = { ...raw, projectionKey: nextCoordinates?.signature || raw.projectionKey };
    const nextNamespace = `${identity.sceneKey}|${identity.projectionKey}|${identity.coverageKey}`;
    const changedNamespace = namespace !== nextNamespace;
    const hardInvalidation = !!rawIdentity && (raw.sceneKey !== rawIdentity.sceneKey
      || raw.projectionKey !== rawIdentity.projectionKey || fittedProjectionKey !== nextFitKey
      || sourceLayoutKey !== nextLayoutKey);
    if (hardInvalidation) releaseGpu();
    const previewOrder = !!snapshot && !!h.isBrushActive?.() && !changedNamespace
      && fittedProjectionKey === nextFitKey && sourceLayoutKey === nextLayoutKey
      && raw.projectionKey === rawIdentity?.projectionKey
      && raw.geometryContentVersion != null && raw.geometryContentVersion === rawIdentity?.geometryContentVersion;
    const changed = changedNamespace || sourceVersion !== identity.version || fittedProjectionKey !== nextFitKey
      || sourceLayoutKey !== nextLayoutKey || raw.geometryContentVersion !== rawIdentity?.geometryContentVersion;
    if (sourcePreparation && (!sameIdentity(sourcePreparation.raw, raw)
      || sourcePreparation.fitKey !== nextFitKey || sourcePreparation.layoutKey !== nextLayoutKey || previewOrder)) {
      cancelSourcePreparation();
    }
    if (previewOrder) {
      if (sourceVersion !== identity.version) deferredForegroundOrder = true;
      foregroundSyncRequested = false;
    }
    if ((!changed && !deferredForegroundOrder) || previewOrder) {
      if (paletteVersion !== identity.colorVersion) updateSourceColors(identity);
      rawIdentity = raw;
      account();
      return true;
    }
    // A first override changes foreground order, so a new source must still be
    // prepared. Its colors are already known: record them on the current source so
    // the retained frame updates by dirty IDs instead of re-resolving every entry.
    if (snapshot && !changedNamespace && !hardInvalidation && paletteVersion !== identity.colorVersion) {
      updateSourceColors(identity);
    }
    if (sourcePreparation) return false;
    cancel(); // No obsolete producer can accept a tile while preparation waits.
    attempted.clear();
    const controller = new AbortController();
    const task = { controller, raw, fitKey: nextFitKey, layoutKey: nextLayoutKey };
    sourcePreparation = task;
    sourcePreparationStats.started++;
    const startedAt = performance.now();
    const current = () => !disposed && sourcePreparation === task && h.isEnabled()
      && sameIdentity(raw, h.getSourceIdentity()) && nextFitKey === JSON.stringify(projectionOptions())
      && nextLayoutKey === layoutKey();
    const check = () => { if (!current()) controller.abort(); controller.signal.throwIfAborted(); };
    let sliceStarted = performance.now();
    const yieldControl = async () => {
      sourcePreparationStats.maxSliceMs = Math.max(sourcePreparationStats.maxSliceMs, performance.now() - sliceStarted);
      check(); await (h.yieldSourcePreparation?.() || sourceHostTask()); check(); sliceStarted = performance.now();
    };
    task.promise = (async () => {
      // Even the first slice runs outside requestAnimationFrame/tile callbacks.
      await yieldControl();
      const preparationOptions = { signal: controller.signal, yieldControl, timeBudgetMs: 3, workBatch: 2048 };
      const collection = await h.prepareFeatures(preparationOptions);
      check();
      const candidate = await source.prepare({ collection, ...identity, colorRevision: identity.colorVersion }, {
        ...preparationOptions,
        getBounds: (feature, id) => {
          const bounds = h.getBounds(feature, id);
          return nextCoordinates ? nextCoordinates.mapBounds(bounds) : bounds;
        },
      });
      check();
      sourcePreparationStats.maxSliceMs = Math.max(sourcePreparationStats.maxSliceMs, performance.now() - sliceStarted);
      // Leave the last preparation slice before publishing and requesting paint.
      await yieldControl();
      const commitStarted = performance.now();
      const next = source.commitPrepared(candidate);
      if (changedNamespace || next.geometryRevision !== snapshot?.geometryRevision) {
        epoch++; cancel();
        if (changedNamespace) cache.clear();
        else stats.geometryInvalidations += cache.invalidate(next.dirtyBounds).length;
        attempted.clear(); planKey = "";
      }
      coordinates = nextCoordinates; snapshot = next; sourceGeneration++; colorDeltas = [];
      codeToId = new Map(next.entries.map(entry => [entry.code, entry.id]));
      namespace = nextNamespace; sourceVersion = identity.version;
      paletteVersion = identity.colorVersion; colorScope = identity.colorScope;
      rawIdentity = raw; fittedProjectionKey = nextFitKey; sourceLayoutKey = nextLayoutKey;
      deferredForegroundOrder = false; foregroundSyncRequested = false;
      sourcePreparationStats.commitMs = performance.now() - commitStarted;
      sourcePreparationStats.lastMs = performance.now() - startedAt;
      sourcePreparationStats.committed++;
      sourcePreparation = null;
      account();
      e.recordMetric?.("politicalIdSourcePreparation", sourcePreparationStats.lastMs, { ...sourcePreparationStats });
      // Only the published snapshot may start the next producer.
      if (updatePlan()) { updateViewIdentity(); pump(); prepareGpuFrame(); scheduleNavigationWork(); }
      e.requestRender("political-id-source-prepared");
    })().catch(error => {
      if (sourcePreparation !== task) return;
      sourcePreparation = null;
      if (controller.signal.aborted || error?.name === "AbortError") {
        sourcePreparationStats.cancelled++;
        if (!disposed && h.isEnabled()) e.requestRender("political-id-source-superseded");
      } else { failProducer(error); e.requestRender("political-id-source-fallback"); }
    });
    return false;
  }

  function syncSource() {
    if (directPresentation && h.prepareFeatures) return syncSourceAsync();
    const raw = h.getSourceIdentity();
    const options = projectionOptions();
    const nextFitKey = JSON.stringify(options);
    if (fittedProjectionKey !== nextFitKey || (canonicalCoordinates && !coordinates)) {
      coordinates = canonicalCoordinates ? createPoliticalIdRasterCoordinateSpace(options) : null;
    }
    const identity = { ...raw, projectionKey: coordinates?.signature || raw.projectionKey };
    const nextNamespace = `${identity.sceneKey}|${identity.projectionKey}|${identity.coverageKey}`;
    const changedNamespace = namespace !== nextNamespace;
    const hardInvalidation = !!rawIdentity && (raw.sceneKey !== rawIdentity.sceneKey
      || raw.projectionKey !== rawIdentity.projectionKey || fittedProjectionKey !== nextFitKey
      || directFrame?.dpr !== undefined && directFrame.dpr !== state.dpr);
    if (directPresentation && hardInvalidation) releaseGpu();
    const layout = h.getLayout();
    const nextLayoutKey = JSON.stringify([layout.pixelWidth, layout.pixelHeight, layout.paddedWidth,
      layout.paddedHeight, layout.offsetX, layout.offsetY, state.dpr]);
    if (directPresentation && directFrame && sourceLayoutKey !== nextLayoutKey) releaseGpu();
    // A brush may temporarily retain the accepted painter order, but never an
    // old geometry set. The caller's separate content identity excludes only
    // foreground promotion; canonical edits and history remain caller-owned.
    const previewOrder = directPresentation && !!snapshot && !!h.isBrushActive?.()
      && !changedNamespace && fittedProjectionKey === nextFitKey && sourceLayoutKey === nextLayoutKey
      && raw.projectionKey === rawIdentity?.projectionKey
      && raw.geometryContentVersion != null && raw.geometryContentVersion === rawIdentity?.geometryContentVersion;
    const sourceChanged = changedNamespace || sourceVersion !== identity.version || fittedProjectionKey !== nextFitKey
      || (directPresentation && (sourceLayoutKey !== nextLayoutKey
        || raw.geometryContentVersion !== rawIdentity?.geometryContentVersion));
    if (previewOrder) {
      if (sourceVersion !== identity.version) deferredForegroundOrder = true;
      // A new stroke may consume an earlier release render before it runs an
      // accurate publish. Its own release must still be able to request one.
      foregroundSyncRequested = false;
    }
    if ((sourceChanged && !previewOrder) || (deferredForegroundOrder && !previewOrder)) {
      cancelAssetSave(); dropSaveCandidate(); assetPublishedViewKey = "";
      const next = source.publish({ collection: h.getFeatures(), ...identity, colorRevision: identity.colorVersion });
      // Clear only after an accurate publish succeeds, including a cancelled
      // stroke whose final order happens to match the accepted source again.
      deferredForegroundOrder = false;
      foregroundSyncRequested = false;
      if (changedNamespace) {
        epoch++;
        cancel();
        cache.clear();
        if (!directPresentation || hardInvalidation) releaseGpu();
      } else if (next.geometryRevision !== snapshot?.geometryRevision) {
        epoch++;
        cancel();
        stats.geometryInvalidations += cache.invalidate(next.dirtyBounds).length;
        // Drop only invalidated resident textures. A local geometry change
        // must not upload every unchanged tile again when the frame completes.
        if (!directPresentation) {
          const retained = new Set(cache.entries().map(([, tile]) => tile));
          gpuTiles = gpuTiles.filter(tile => retained.has(tile));
          if (gpu?.isAvailable()) gpu.setTiles(gpuTiles, recordTileUpload);
        }
      }
      if (changedNamespace || next.geometryRevision !== snapshot?.geometryRevision) {
        attempted.clear();
        planKey = "";
      }
      snapshot = next; sourceGeneration++; colorDeltas = [];
      codeToId = new Map(snapshot.entries.map(entry => [entry.code, entry.id]));
      namespace = nextNamespace;
      sourceVersion = identity.version;
      paletteVersion = identity.colorVersion;
      colorScope = identity.colorScope;
    } else if (paletteVersion !== identity.colorVersion) {
      updateSourceColors(identity);
    }
    rawIdentity = raw;
    fittedProjectionKey = nextFitKey;
    sourceLayoutKey = nextLayoutKey;
    account();
    return true;
  }

  function updatePlan(transform = state.zoomTransform) {
    const layout = h.getLayout();
    const width = layout.pixelWidth ?? Math.floor(layout.paddedWidth * state.dpr);
    const height = layout.pixelHeight ?? Math.floor(layout.paddedHeight * state.dpr);
    cache.setViewport(width, height);
    gpuLimit = scaleRasterViewportBudget(GPU_LIMIT, width, height);
    maxPixels = Math.min(scaleRasterViewportBudget(12 * 1024 * 1024, width, height), Math.floor((cache.maxBytes - 1) / 4));
    plan = planPoliticalIdRasterView({ transform: coordinates?.mapTransform(transform) || transform, dpr: state.dpr,
      width, height, maxPixels,
      offsetX: layout.offsetX || 0, offsetY: layout.offsetY || 0 });
    if (directPresentation && plan) {
      for (const descriptor of plan.tiles) {
        const { originX, originY, width, height } = descriptor;
        descriptor.key += ":halo-1-v1";
        descriptor.coreRect = { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
        descriptor.storageRect = { minX: originX - 1, minY: originY - 1, maxX: originX + width + 1, maxY: originY + height + 1 };
      }
    }
    const key = plan?.tiles.map(tile => tile.key).join("|") || "";
    if (key !== planKey) { attempted = new Set(); planKey = key; }
    syncTileRecords();
    // An obsolete view can finish only its current tile. There is no old-view
    // queue, and a return to that region can reuse the accepted geometry tile.
    return plan;
  }

  function cancelNavigationUpload() {
    const job = navigationUpload;
    navigationUpload = null;
    job?.controller.abort();
    job?.handle?.cancel();
  }

  function stopNavigationProduction() {
    navigationProducing = false;
    cancelNavigationUpload();
  }

  function navigationSourceCurrent() {
    const current = h.getSourceIdentity();
    return rawIdentity && ["sceneKey", "projectionKey", "coverageKey", "version", "geometryContentVersion"]
      .every(key => current[key] === rawIdentity[key])
      && fittedProjectionKey === JSON.stringify(projectionOptions()) && sourceLayoutKey === layoutKey();
  }

  function navigationTiles() {
    const { transform, layout } = navigationDemand;
    const camera = coordinates?.mapTransform(transform) || transform;
    const scale = camera.k * state.dpr / plan.density;
    const width = layout.pixelWidth ?? layout.paddedWidth * state.dpr;
    const height = layout.pixelHeight ?? layout.paddedHeight * state.dpr;
    const viewport = { minX: -camera.x * state.dpr / scale, minY: -camera.y * state.dpr / scale,
      maxX: (width - 2 * (layout.offsetX || 0) * state.dpr - camera.x * state.dpr) / scale,
      maxY: (height - 2 * (layout.offsetY || 0) * state.dpr - camera.y * state.dpr) / scale };
    const cx = (viewport.minX + viewport.maxX) / 2, cy = (viewport.minY + viewport.maxY) / 2;
    const priority = tile => {
      const left = Math.max(viewport.minX, tile.originX), top = Math.max(viewport.minY, tile.originY);
      const right = Math.min(viewport.maxX, tile.originX + tile.width), bottom = Math.min(viewport.maxY, tile.originY + tile.height);
      const visible = right > left && bottom > top;
      return { visible, distance: ((visible ? (left + right) / 2 : tile.originX + tile.width / 2) - cx) ** 2
        + ((visible ? (top + bottom) / 2 : tile.originY + tile.height / 2) - cy) ** 2 };
    };
    return [...plan.tiles].sort((a, b) => {
      const pa = priority(a), pb = priority(b);
      return Number(pb.visible) - Number(pa.visible) || pa.distance - pb.distance;
    });
  }

  function scheduleNavigationWork() {
    if (!navigationProducing || navigationTask || navigationUpload || !usable()) return;
    const task = {};
    navigationTask = task;
    task.promise = (async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!navigationProducing || !usable() || !syncSource()) return;
      if (!updatePlan(navigationDemand.transform) || plan.level !== navigationDemand.level) return;
      navigationDemand.plan = plan;
      updateViewIdentity();
      syncTileRecords("host-task");
      const descriptor = navigationTiles().find(tile => cache.peek(tile.key) && !tileRecords.get(tile.key)?.gpuHandle);
      if (descriptor && navigationUploadAvailable && ensureGpu()) {
        navigationUploadAvailable = false;
        cancelGpuPreparation();
        const job = { controller: new AbortController(), epoch, gpu, handle: null };
        task.upload = job;
        navigationUpload = job;
        const tile = cache.peek(descriptor.key);
        const current = () => navigationProducing && navigationUpload === job && job.epoch === epoch
          && gpu === job.gpu && navigationSourceCurrent();
        job.handle = await gpu.prepareTile({ tile, palette: snapshot.palette, signal: job.controller.signal,
          isCurrent: current, onTileUploadSubmitted: recordTileUpload, onProgress: account,
          onTileTiming: (tile, ms, taskKind) => recordStage("upload", ms, taskKind, tileRecordKeys.get(tile)),
          ...(h.yieldGpuPreparation ? { yieldTask: h.yieldGpuPreparation } : {}) });
        if (!current()) {
          job.handle?.cancel();
          if (navigationUpload === job) navigationUpload = null;
          return;
        }
        if (job.handle) {
          if (paletteVersion !== h.getSourceIdentity().colorVersion) updateSourceColors(h.getSourceIdentity());
          job.handle.commit({ palette: snapshot.palette, revision: `${namespace}:${snapshot.paletteRevision}:${paletteVersion}` });
          dirtyTileKeys.add(descriptor.key);
          syncTileRecords("host-task");
          account();
        }
        navigationUpload = null;
      }
      pump();
    })().catch(error => {
      if (error?.name !== "AbortError") failProducer(error);
    }).finally(() => {
      if (navigationTask === task) navigationTask = null;
      if (navigationUpload === task.upload) navigationUpload = null;
      if (!task.upload && navigationProducing && navigationUploadAvailable && plan
        && plan.tiles.some(tile => cache.peek(tile.key) && !tileRecords.get(tile.key)?.gpuHandle)) scheduleNavigationWork();
    });
  }

  function updateNavigationDemand(transform) {
    if (!directPresentation || !usable() || !snapshot || !directFrame) return false;
    const previousPlan = plan;
    const target = updatePlan(transform);
    if (!target || target.level !== directFrame.plan.level) {
      stopNavigationProduction();
      navigationDemand = null;
      plan = previousPlan;
      return false;
    }
    const layout = h.getLayout();
    const demandKey = JSON.stringify([transform.x, transform.y, transform.k, layout, state.dpr]);
    if (navigationDemand?.key !== demandKey) {
      navigationDemand = { key: demandKey, transform: { ...transform }, layout: { ...layout }, level: target.level, plan: target };
      navigationSnapshot = null;
    }
    cancelGpuPreparation();
    navigationProducing = true;
    navigationUploadAvailable = true;
    scheduleNavigationWork();
    return true;
  }

  function getNavigationSnapshot() {
    if (!navigationDemand || !usable() || sourcePreparation || !navigationSourceCurrent() || !gpu?.isAvailable()) return null;
    syncTileRecords("present");
    const paletteKey = `${namespace}:${snapshot.paletteRevision}:${paletteVersion}`;
    if (navigationSnapshot?.revision === navigationRevision && navigationSnapshot.paletteKey === paletteKey) return navigationSnapshot;
    const started = stageTimingsEnabled ? performance.now() : 0;
    if (navigationTileSnapshot?.revision !== navigationRevision || navigationTileSnapshot.level !== navigationDemand.level) {
      const records = [...tileRecords.values()].filter(record => record.level === navigationDemand.level && gpu.hasTileHandle(record.gpuHandle));
      if (!records.length) return null;
      snapshotBuilds++;
      navigationTileSnapshot = { revision: navigationRevision, level: navigationDemand.level, sourceStamp: records[0].sourceStamp,
        tiles: records.map(record => ({ key: record.key,
          originX: record.coreRect.minX, originY: record.coreRect.minY,
          width: record.coreRect.maxX - record.coreRect.minX, height: record.coreRect.maxY - record.coreRect.minY,
        })), drawTiles: records.map(record => record.gpuHandle) };
    }
    navigationSnapshot = { gpu, revision: navigationRevision, sourceStamp: navigationTileSnapshot.sourceStamp,
      palette: snapshot.palette, paletteRevision: snapshot.paletteRevision,
      paletteKey,
      plan: { ...navigationDemand.plan, tiles: navigationTileSnapshot.tiles }, drawTiles: navigationTileSnapshot.drawTiles,
      transform: navigationDemand.transform, layout: navigationDemand.layout, dpr: state.dpr, epoch,
      exactForView: false };
    if (stageTimingsEnabled) recordStage("snapshot", performance.now() - started, "present");
    return navigationSnapshot;
  }

  async function registerManifest(urlValue) {
    if (!assetStore || !urlValue) return;
    if (manifestKey === urlValue) return manifestPromise;
    manifestController.abort();
    manifestController = new AbortController();
    manifestKey = urlValue;
    manifestPromise = (async () => {
      const url = new URL(urlValue, globalThis.location.href);
      if (url.origin !== globalThis.location.origin || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Political ID manifest must be same-origin.');
      }
      // This shared request belongs to the owner, not the first tile's deadline.
      // A slow manifest can finish after that tile falls back to the Worker.
      const response = await fetch(url, { signal: manifestController.signal, mode: 'same-origin' });
      if (!response.ok || (response.url && new URL(response.url).origin !== url.origin)) throw new Error('Political ID manifest unavailable.');
      if (Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error('Political ID manifest exceeds 1 MiB.');
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) throw new Error('Political ID manifest exceeds 1 MiB.');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder().decode(bytes);
      const manifest = JSON.parse(text);
      if (disposed || manifestKey !== urlValue) return;
      assetStore.registerManifest({ ...manifest, tiles: manifest.tiles?.map(tile => ({ ...tile, url: new URL(tile.url, url).href })) });
      manifestReadyKey = urlValue;
      clearAssetFailure();
      consecutiveAssetTimeouts = 0;
      nextAssetProbeAt = 0;
    })().catch(error => { if (!disposed && manifestKey === urlValue) recordAssetFailure(error, "manifest"); });
    return manifestPromise;
  }

  async function assetOperation(task, callback) {
    task.assetOperationStartedAt = performance.now();
    const controller = new AbortController();
    const signal = AbortSignal.any([task.controller.signal, controller.signal]);
    let timeout, onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => controller.abort(new DOMException("Asset operation timed out.", "TimeoutError")), assetTimeoutMs);
    });
    try {
      const value = await Promise.race([interrupted, Promise.resolve().then(() => {
        signal.throwIfAborted();
        return callback(signal);
      })]);
      return value;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); }
  }

  function dropSaveCandidate() {
    if (saveCandidate) stats.assetSavesDropped++;
    saveCandidate = null;
  }

  function cancelAssetSave() {
    if (saveIdle) {
      if (saveIdle.idle) globalThis.cancelIdleCallback?.(saveIdle.id);
      else clearTimeout(saveIdle.id);
      saveIdle = null;
    }
    if (backgroundSave) {
      backgroundSave.controller.abort();
      backgroundSave = null;
      stats.assetSavesDropped++;
    }
  }

  function retainSaveCandidate(cacheKey, identity, tile, codeToId) {
    const bytes = tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength;
    dropSaveCandidate();
    if (bytes > POLITICAL_ID_ASSET_SAVE_MAX_BYTES || cache.peek(cacheKey) !== tile) {
      stats.assetSavesDropped++;
      return;
    }
    // The CPU LRU remains the sole tile owner. Replacement can discard this
    // regenerable cache entry without retaining arrays or a viewport/packet.
    saveCandidate = { cacheKey, identity, codeToId };
  }

  function scheduleAssetSave() {
    if (!saveCandidate || saveIdle || backgroundSave || active || !plan
      || assetPublishedViewKey !== viewKey || !plan.tiles.every(tile => cache.peek(tile.key))) return;
    const scheduled = { idle: typeof globalThis.requestIdleCallback === "function", id: null };
    saveIdle = scheduled;
    const run = () => {
      if (saveIdle !== scheduled) return;
      saveIdle = null;
      if (!usable() || active || !sourceStillCurrent() || assetPublishedViewKey !== getViewIdentity()
        || !plan.tiles.every(tile => cache.peek(tile.key))) { dropSaveCandidate(); return; }
      const candidate = saveCandidate;
      if (!candidate) return;
      const tile = cache.peek(candidate.cacheKey);
      if (!tile || tileIdentities.get(tile) !== candidate.identity || assetStore.stats().pendingWrites) {
        dropSaveCandidate(); return;
      }
      saveCandidate = null;
      saveAssetInBackground(candidate.identity, tile, candidate.codeToId);
    };
    // No encoding or Worker structured clone on tile admission or publication.
    // Without IdleCallback the next task still yields the completed frame first.
    scheduled.id = scheduled.idle ? globalThis.requestIdleCallback(run) : setTimeout(run, 0);
  }

  function saveAssetInBackground(identity, tile, codeToId) {
    const bytes = tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength;
    const write = { controller: new AbortController(), bytes, assetOperationStartedAt: 0 };
    backgroundSave = write;
    void assetOperation(write, signal => {
      const saving = assetStore.save(identity, tile, { codeToId, signal });
      account();
      return saving;
    }).catch(error => {
      if (disposed || write.controller.signal.aborted || backgroundSave !== write) return;
      const timeout = error.name === "TimeoutError";
      if (timeout) stats.assetSaveTimeouts++; else stats.assetSaveErrors++;
      lastAssetSaveFailure = { kind: timeout ? "timeout" : "error", operation: "save",
        message: String(error.message || error), durationMs: performance.now() - write.assetOperationStartedAt };
    }).finally(() => {
      if (backgroundSave === write) backgroundSave = null;
      if (!disposed) account();
    });
  }

  function sourceStillCurrent() {
    if (!rawIdentity || deferredForegroundOrder) return false;
    const current = h.getSourceIdentity();
    // The caller owns this token contract. Compare every supplied field rather
    // than guessing which revisions might affect a future source snapshot.
    const keys = Object.keys(rawIdentity);
    if (Object.keys(current).length !== keys.length
      || keys.some(key => !Object.hasOwn(current, key) || current[key] !== rawIdentity[key])) return false;
    const layout = h.getLayout();
    return fittedProjectionKey === JSON.stringify(projectionOptions())
      && sourceLayoutKey === JSON.stringify([layout.pixelWidth, layout.pixelHeight, layout.paddedWidth,
        layout.paddedHeight, layout.offsetX, layout.offsetY, state.dpr]);
  }

  async function resolveTile(packet, task, maps) {
    const probe = consecutiveAssetTimeouts >= 3;
    if (!assetStore || (probe && performance.now() < nextAssetProbeAt)) {
      if (assetStore) stats.assetBypasses++;
      return { tile: await worker.request(packet, { signal: task.controller.signal }), built: true };
    }
    // Both demand and bounded idle probes use the same serial pump.
    if (probe) { task.assetProbe = true; stats.assetProbes++; }
    let identity = null;
    try {
      // Start the existing worker while geometry is hashed, overlapping module
      // loading without extending the following asset deadline.
      const workerReady = Promise.resolve().then(() => worker.prepare?.()).then(
        () => ({ ready: true }), error => ({ ready: false, error }));
      const identityStarted = performance.now();
      identity = await identityBuilder.identify({ sceneKey: h.getAssetSceneKey?.() || snapshot.sceneKey,
        descriptor: packet, projectionOptions: packet.projectionOptions, entries: packet.entries,
        strokeWidth: packet.strokeWidth, gutter });
      stats.identityMs += performance.now() - identityStarted;
      task.controller.signal.throwIfAborted();
      const lookupStarted = performance.now();
      try {
        // Prebuilt manifests are explicit; ordinary sessions issue no speculative requests.
        const failuresBefore = assetStore.stats().failures;
        const tile = await assetOperation(task, async signal => {
          task.assetPhase = "read";
          const startup = await workerReady;
          signal.throwIfAborted();
          if (!startup.ready) throw startup.error;
          const manifestUrl = h.getAssetManifestUrl?.();
          const readCacheFirst = !!manifestUrl && manifestReadyKey !== manifestUrl;
          if (readCacheFirst) {
            // A valid persisted tile must not depend on a fresh network manifest.
            // The bounded cache probe and any subsequent fetch share this deadline.
            task.assetPhase = "cache-read";
            const cached = await assetStore.load(identity, { idToCode: maps.idToCode, signal, cacheMode: "only" });
            signal.throwIfAborted();
            if (cached) return cached;
          }
          task.assetPhase = "manifest";
          await registerManifest(manifestUrl);
          signal.throwIfAborted();
          task.assetPhase = "read";
          return assetStore.load(identity, { idToCode: maps.idToCode, signal, cacheMode: readCacheFirst ? "skip" : "normal" });
        });
        task.controller.signal.throwIfAborted();
        if (tile) {
          if (!matchesTileRegion(tile, packet)) {
            throw new Error("Political ID asset does not match its requested region.");
          }
          clearAssetFailure();
          consecutiveAssetTimeouts = 0; nextAssetProbeAt = 0; cancelAssetRecovery();
          if (probe) stats.assetRecoveries++;
          return { tile, built: false, identity };
        }
        const assets = assetStore.stats();
        if (assets.failures > failuresBefore) throw new Error(assets.lastError?.message || "Asset lookup failed.");
        // A genuine coverage miss completed normally; it is not a timeout.
        // Keep a real earlier error visible until a validated asset is admitted.
        consecutiveAssetTimeouts = 0; nextAssetProbeAt = 0; cancelAssetRecovery();
      } finally { stats.assetLookupMs += performance.now() - lookupStarted; }
    } catch (error) { if (!task.controller.signal.aborted) recordAssetFailure(error, "load", probe); }
    if (task.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (task.existingTile) return { tile: task.existingTile, reused: true };
    return { tile: await worker.request(packet, { signal: task.controller.signal }), built: true, identity };
  }

  function pump(probeCovered = false) {
    if (!usable() || sourcePreparation || active || !plan || !snapshot) return;
    let descriptor = (navigationProducing ? navigationTiles() : plan.tiles)
      .find(tile => !cache.peek(tile.key) && !attempted.has(tile.key)
        && (!navigationProducing || !tileRecords.get(tile.key)?.gpuHandle));
    let existingTile = null;
    if (!descriptor && probeCovered && consecutiveAssetTimeouts >= 3 && coveredAssetProbes < 2
      && performance.now() >= nextAssetProbeAt) {
      descriptor = plan.tiles.find(tile => cache.peek(tile.key));
      if (descriptor) { existingTile = cache.peek(descriptor.key); coveredAssetProbes++; }
    }
    if (!descriptor) { scheduleCoveredAssetRecovery(); return; }
    // Abort the physical IDB transaction before a new producer dispatches I/O.
    cancelAssetSave(); assetPublishedViewKey = "";
    attempted.add(descriptor.key);
    const controller = new AbortController();
    const task = { controller, epoch, descriptor, existingTile, navigation: navigationProducing };
    if (tileEventsEnabled) {
      task.tileEventId = ++nextTileEventId;
      tileEvents.set(task.tileEventId, { id: task.tileEventId, ...descriptor, namespace, epoch,
        requestedAt: performance.now(), cpuReadyAt: null, uploadSubmittedAt: null });
      if (tileEvents.size > TILE_EVENT_LIMIT) tileEvents.delete(tileEvents.keys().next().value);
    }
    const storage = descriptor.storageRect;
    const sampling = storage ? { ...descriptor, originX: storage.minX, originY: storage.minY,
      width: storage.maxX - storage.minX, height: storage.maxY - storage.minY } : descriptor;
    const entries = snapshot.entries.filter(entry => intersectsTile(entry.bounds, sampling, 4 + state.dpr))
      .map(entry => ({ ...entry, strokeCode: h.hasStroke?.(entry.feature) === false ? 0 : entry.code }));
    // Bound D3's resampling error in physical raster pixels at every LOD.
    // The worker scales base-space precision by density when rebuilding paths.
    const options = coordinates ? { ...coordinates.projectionOptions,
      precision: coordinates.projectionOptions.precision / descriptor.density } : projectionOptions();
    const packet = { ...sampling, entries, projectionOptions: options,
      geometryNamespace: namespace, gutter, strokeWidth: 0.75 * state.dpr };
    // The validated identity covers exactly these contributors, including the
    // stroke margin. Avoid copying unrelated scene IDs into every Worker task.
    const maps = {
      codeToId: new Map(entries.map(entry => [entry.code, entry.id])),
      idToCode: new Map(entries.map(entry => [entry.id, entry.code])),
    };
    active = task;
    account();
    task.promise = resolveTile(packet, task, maps).then(async ({ tile, built, identity, reused }) => {
      if (task.navigation || navigationProducing) await new Promise(resolve => setTimeout(resolve, 0));
      if (disposed || controller.signal.aborted || reused) return;
      // Re-read live geometry identity before accepting asynchronous data. Color
      // edits need not cancel a geometry build: the latest palette is used at draw.
      if (!sourceStillCurrent() && !syncSource()) { stats.staleResults++; return; }
      if (controller.signal.aborted || epoch !== task.epoch) { stats.staleResults++; return; }
      if (!matchesTileRegion(tile, descriptor)) {
        throw new Error("Political ID tile response does not match its requested region.");
      }
      if (descriptor.coreRect) {
        tile.coreRect = { ...descriptor.coreRect };
        tile.storageRect = { ...descriptor.storageRect };
      }
      const admissionStarted = stageTimingsEnabled ? performance.now() : 0;
      const cached = cache.set(descriptor.key, tile, descriptor, navigationProducing ? { compressionBudget: 1 } : undefined);
      const event = tileEvents.get(task.tileEventId);
      if (cached && event) {
        event.cpuReadyAt = performance.now();
        tileEventIds.set(tile, task.tileEventId);
      }
      if (stageTimingsEnabled) recordStage("admission", performance.now() - admissionStarted,
        task.navigation || navigationProducing ? "host-task" : "tile-completion", descriptor.key);
      // Conservative contributor set from the validated build/asset identity.
      // It includes fill and stroke contributors, never a second ID namespace.
      if (displayCache) tileDependencies.set(tile, Uint32Array.from(entries, entry => entry.code));
      if (built) {
        stats.builds++;
        stats.coldBuildMs += Number(tile.stats?.buildMs || 0);
        stats.pathBuilds += Number(tile.stats?.pathBuilds || 0);
        stats.pathCacheHits += Number(tile.stats?.pathCacheHits || 0);
        pathCacheEstimatedBytes = Number(tile.stats?.pathCacheEstimatedBytes || 0);
      } else stats.assetHits++;
      if (identity) {
        tileIdentities.set(tile, identity);
        if (built && consecutiveAssetTimeouts === 0) {
          retainSaveCandidate(descriptor.key, identity, tile, maps.codeToId);
        }
      }
      account(task.navigation || navigationProducing ? "host-task" : "tile-completion");
    }).catch(error => {
      if (disposed || controller.signal.aborted) return;
      failed = String(error?.message || error);
      cache.clear();
      releaseGpu();
      account();
    }).finally(() => {
      if (active === task) active = null;
      if (disposed) return;
      account();
      if (navigationProducing) { scheduleNavigationWork(); return; }
      if (task.navigation && !navigationDemand) return;
      // Complete one latest viewport before requesting a repaint, avoiding a
      // full vector redraw for every tile that becomes available.
      pump();
      if (!active) {
        prepareGpuFrame();
        const current = h.getSourceIdentity();
        const alreadyExact = plan && rawIdentity && !failed && !assetError && !task.assetProbe
          && refinedViewKey === getViewIdentity()
          && fittedProjectionKey === JSON.stringify(projectionOptions())
          && ["sceneKey", "projectionKey", "coverageKey", "version", "colorVersion"].every(key => current[key] === rawIdentity[key]);
        if (!alreadyExact) e.requestRender("political-id-raster-ready");
      }
    });
  }

  function ensureGpu() {
    if (gpu?.isAvailable()) return true;
    releaseGpu();
    gpu = createGpu({ maxTextureBytes: GPU_HARD_LIMIT,
      onTileReleased: handle => {
        const key = handleRecordKeys.get(handle);
        if (key !== undefined) dirtyTileKeys.add(key);
      },
      reserveUploadBytes: bytes => {
        const release = cache.reserveTransient(bytes);
        account();
        return () => { release(); account(); };
      },
      getReservedTextureBytes: () => GPU_HARD_LIMIT - gpuLimit, onContextLost: () => {
      cancelGpuPreparation(); gpuAcceptedKey = "";
      directFrame = null; publishedBaselinePalette = null; publishedPalette = null; publishedEntries = [];
      overviewFrame = null; overviewBaselinePalette = null; overviewPalette = null; overviewEntries = [];
      account();
      cancelSourcePreparation();
      stats.contextLosses++;
      // The current frame stays with Canvas. Recreate on the next eligible draw;
      // CPU coverage remains valid and no geometry is rebuilt for context loss.
      e.requestRender("political-id-raster-context-lost");
    } });
    return gpu.isAvailable();
  }

  function failProducer(error) {
    failed = String(error?.message || error);
    cancelSourcePreparation();
    cancel();
    releaseGpu();
    cache.clear();
    account();
    stats.fallbacks++;
    displayState = "fallback"; reason = "producer-error";
    return null;
  }

  function prepare() {
    stopNavigationProduction();
    stagedFrame = null;
    if (!usable()) { directFrame = null; displayState = "fallback"; reason = failed ? "producer-error" : "unavailable"; return false; }
    try {
      if (!syncSource()) return true;
      if (!updatePlan()) { directFrame = null; stats.fallbacks++; displayState = "fallback"; reason = "view-budget"; return false; }
      updateViewIdentity();
      if (!ensureGpu()) { directFrame = null; displayState = "fallback"; reason = "gpu-unavailable"; return false; }
      // Start the same bounded producer without repainting a still-current
      // native frame. The ready callback requests the first accelerated draw.
      pump();
      if (!active && plan.tiles.every(tile => cache.peek(tile.key))) {
        e.requestRender("political-id-raster-ready");
      }
      return true;
    } catch (error) { failProducer(error); return false; }
  }

  function draw() {
    stopNavigationProduction();
    stagedFrame = null;
    const drawStartedAt = performance.now();
    if (!usable()) { directFrame = null; displayState = "fallback"; reason = failed ? "producer-error" : "unavailable"; return null; }
    try {
      if (!syncSource()) { displayState = "preparing"; reason = "source-preparation"; return retainPublishedFrame(); }
      const sourceDoneAt = performance.now();
      if (!updatePlan()) { stats.fallbacks++; displayState = "fallback"; reason = "view-budget"; return null; }
      updateViewIdentity();
      if (forceNativeRefinement) {
        forceNativeRefinement = false; refinedViewKey = viewKey; nativeRefinements++;
      }
      scheduleCoveredAssetRecovery();
      if (refinedViewKey === viewKey) {
        displayState = "precise"; reason = "idle-refinement";
        // Finish invalidated coverage for this exact view as part of the edit,
        // so returning to it after a zoom does not inherit an unfinished tile.
        pump();
        return null;
      }
      // Probe availability before spending CPU time building unavailable output.
      if (!ensureGpu()) { displayState = "fallback"; reason = "gpu-unavailable"; return null; }
      const tiles = plan.tiles.map(tile => cache.get(tile.key));
      if (tiles.some(tile => !tile)) {
        // Actual edge coverage can exceed the CPU budget even when the pixel
        // plan fits. Exhausted coverage must not remain permanently preparing.
        const exhausted = !active && plan.tiles.every(tile => cache.peek(tile.key) || attempted.has(tile.key));
        stats.fallbacks++; displayState = exhausted ? "fallback" : "preparing";
        reason = exhausted ? "cpu-budget" : "awaiting-coverage";
        if (!exhausted) pump();
        return retainPublishedFrame();
      }
      if (prepareGpuFrame()) {
        displayState = "preparing"; reason = "gpu-preparation";
        return retainPublishedFrame();
      }
      // Padded edge textures are accounted by the GPU owner. This admission
      // estimate bounds one allocation before uploading; no driver-VRAM claim.
      const estimate = tiles.reduce((sum, tile) => sum + (directPresentation ? tile.width * tile.height * 4 : tile.codes.byteLength)
        + Math.ceil(Math.max(1, tile.edgeIds.length) / 1024) * 1024 * 8, 0)
        // Base full-GPU estimate; optional retained output is admitted separately
        // against the current limit before allocation.
        + (directPresentation ? 0 : plan.width * plan.height * 4) + Math.ceil(snapshot.palette.length / 4096) * 4096;
      if (estimate > gpuLimit) { stats.fallbacks++; displayState = "fallback"; reason = "gpu-budget"; return null; }
      // Keep legacy raster eligibility at large DPR: when the additional
      // retained surface would exceed the existing cap, use full GPU output.
      const useRetained = !!displayCache && estimate + plan.width * plan.height * 4 <= gpuLimit;
      if (!useRetained) displayCache?.reset();
      const startedAt = performance.now();
      const paletteKey = `${namespace}:${snapshot.paletteRevision}`;
      if (!directPresentation) gpu.setPalette(snapshot.palette, paletteKey);
      const paletteDoneAt = performance.now();
      if (!directPresentation) gpu.setTiles(tiles, recordTileUpload);
      // Shared GPU residents keep lightweight descriptors; the bounded CPU LRU
      // alone owns direct tile payloads while a new candidate is prepared.
      gpuTiles = directPresentation ? [] : tiles;
      const tilesDoneAt = performance.now();
      let frame;
      if (useRetained) frame = displayCache.draw({ gpu, plan, tiles, palette: snapshot.palette,
        revision: paletteKey, dependencies: tile => tileDependencies.get(tile) });
      else if (!directPresentation) { gpu.draw(plan); frame = gpu.canvas; }
      const rasterDoneAt = performance.now();
      if (!directPresentation) {
        const context = surface.getContext();
        context.save();
        try {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "low";
          context.drawImage(frame, plan.outputX, plan.outputY, plan.outputWidth, plan.outputHeight);
        } finally { context.restore(); }
      }
      const compositeDoneAt = performance.now();
      const renderedIds = getRenderedIds();
      if (!directPresentation) stats.commits++;
      displayState = "accelerated"; reason = "coverage-ready";
      if (firstRasterReadyMs === null) firstRasterReadyMs = performance.now() - viewStartedAt;
      scheduleRefinement();
      const nextCommittedPlan = { plan, epoch, version: sourceVersion, dpr: state.dpr,
        transform: { ...state.zoomTransform }, rawIdentity: { ...rawIdentity }, fittedProjectionKey };
      if (!directPresentation) committedPlan = nextCommittedPlan;
      stats.cacheHits += tiles.length;
      stats.lastCommitMs = performance.now() - startedAt;
      account();
      lastDrawTotalMs = performance.now() - drawStartedAt;
      const presentation = displayCache?.getStats();
      lastTiming = { sourceMs: sourceDoneAt - drawStartedAt, planningMs: startedAt - sourceDoneAt,
        paletteUploadMs: paletteDoneAt - startedAt, tileBindingMs: tilesDoneAt - paletteDoneAt,
        rasterMs: rasterDoneAt - tilesDoneAt, gpuSubmitMs: useRetained ? presentation.lastGpuMs : rasterDoneAt - tilesDoneAt,
        captureMs: useRetained ? presentation.lastCaptureMs : 0, targetCompositeMs: compositeDoneAt - rasterDoneAt,
        finishMs: performance.now() - compositeDoneAt, totalMs: lastDrawTotalMs,
        phase: "CPU wall time including any browser synchronization; not GPU execution or presentation" };
      if (!directPresentation) e.recordMetric?.("politicalIdRasterCommit", stats.lastCommitMs, {
        drawTotalMs: lastDrawTotalMs, firstRasterReadyMs, phase: "cpu-submission-not-presentation",
        tileCount: tiles.length, level: plan.level, renderedCount: renderedIds.size,
        cpuBytes: cache.getStats().cpuBytes, ...gpu.getStats(),
      });
      const result = { fillMs: stats.lastCommitMs, strokeMs: 0, renderedCount: renderedIds.size, renderedIds };
      if (directPresentation) {
        // The orchestration pipeline may yield between passes. Keep the current
        // GPU generation intact until the caller commits the whole scene.
        if (directFrame) retainPublishedFrame();
        stagedRejectionReason = "";
        stagedFrame = { tiles, palette: snapshot.palette, entries: snapshot.entries, paletteKey,
          colorState: currentColorState(paletteVersion),
          gpuPreparation: gpuPreparation?.status === "ready" ? gpuPreparation : null, gpuKey: gpuCandidateKey(),
          committed: nextCommittedPlan, result,
          frame: { gpu, plan, transform: { ...state.zoomTransform }, dpr: state.dpr,
            layout: { ...h.getLayout() }, epoch, paletteRevision: snapshot.paletteRevision,
            sourceVersion, presentationState: "published", geometryCurrent: true } };
        return { ...result, staged: true };
      }
      assetPublishedViewKey = viewKey;
      scheduleAssetSave();
      return result;
    } catch (error) {
      return failProducer(error);
    }
  }

  function publishDirectFrame() {
    const staged = stagedFrame;
    if (!staged) return false;
    stagedFrame = null;
    const reject = reason => { stagedRejectionReason = reason; stagedRejections++; return false; };
    if (!usable()) return reject("unavailable");
    const current = h.getSourceIdentity();
    const accepted = staged.committed;
    if (accepted.epoch !== epoch || accepted.dpr !== state.dpr
      || ["x", "y", "k"].some(key => state.zoomTransform[key] !== accepted.transform[key])
      || ["sceneKey", "projectionKey", "coverageKey", "version", "colorVersion", "geometryContentVersion"].some(key => current[key] !== accepted.rawIdentity[key])
      || JSON.stringify(projectionOptions()) !== accepted.fittedProjectionKey
      || JSON.stringify(h.getLayout()) !== JSON.stringify(staged.frame.layout)) return reject("stale-candidate");
    try {
      if (!gpu?.isAvailable()) return reject("gpu-unavailable");
      stopNavigationProduction();
      const startedAt = performance.now();
      let frameTiming;
      if (staged.gpuPreparation) {
        if (gpuPreparation !== staged.gpuPreparation || !gpuCandidateCurrent(gpuPreparation)) return reject("stale-gpu-candidate");
        frameTiming = gpuPreparation.handle.commit({ palette: staged.palette, revision: staged.paletteKey });
        gpuPreparation = null; gpuPreparationStats.committed++; gpuPreparationStats.lastPath = "asynchronous-committed";
      } else if (gpu.setFrame) {
        frameTiming = gpu.setFrame({ tiles: staged.tiles, palette: staged.palette, revision: staged.paletteKey,
          onTileUploadSubmitted: recordTileUpload });
      } else {
        if (gpu.canSetFrame && !gpu.canSetFrame({ tiles: staged.tiles, palette: staged.palette })) return reject("gpu-budget");
        const plannedAt = performance.now();
        gpu.setPalette(staged.palette, staged.paletteKey);
        const paletteDoneAt = performance.now();
        gpu.setTiles(staged.tiles, recordTileUpload);
        frameTiming = { planningMs: plannedAt - startedAt, paletteUploadMs: paletteDoneAt - plannedAt,
          tileBindingMs: performance.now() - paletteDoneAt };
      }
      const tilesDoneAt = performance.now();
      publishedEntries = staged.entries;
      publishedPalette = staged.palette.slice();
      publishedColorState = staged.colorState;
      publishedBaselinePalette = publishedPalette;
      publishedPaletteKey = staged.paletteKey;
      publishedResult = staged.result;
      committedPlan = accepted;
      directFrame = staged.frame;
      directFrame.drawTiles = gpu.getTileHandle ? staged.tiles.map(tile => gpu.getTileHandle(tile)) : undefined;
      for (const key of tileRecords.keys()) dirtyTileKeys.add(key);
      navigationDemand = null;
      navigationSnapshot = null; navigationTileSnapshot = null;
      gpuAcceptedKey = staged.gpuKey;
      maybeCreateOverview(staged);
      refreshOverviewPalette();
      stats.commits++;
      stats.lastCommitMs = tilesDoneAt - startedAt;
      if (lastTiming) lastTiming = { ...lastTiming, paletteUploadMs: frameTiming.paletteUploadMs,
        tileBindingMs: frameTiming.planningMs + frameTiming.tileBindingMs,
        gpuPlanningMs: frameTiming.planningMs, gpuSubmitMs: stats.lastCommitMs };
      e.recordMetric?.("politicalIdRasterCommit", stats.lastCommitMs, {
        phase: "cpu-submission-not-presentation", tileCount: staged.tiles.length,
        level: staged.frame.plan.level, renderedCount: staged.result.renderedCount,
        cpuBytes: cache.getStats().cpuBytes, ...gpu.getStats(),
      });
      account();
      // Pending edit IDs contribute to foreground order and therefore source
      // identity. Consume them only after the validated candidate is published.
      if (e.commitPublishedColorEdit) {
        e.commitPublishedColorEdit({ ...staged.result, paintSource: "political-id-raster" });
        const afterCommit = h.getSourceIdentity();
        if (["version", "geometryContentVersion", "colorVersion", "coverageKey"].some(key => afterCommit[key] !== current[key])) {
          // The current render boundary is still pending until renderFn's
          // finally. A synchronous request here would be coalesced into that
          // consumed frame and leave the post-consumption identity dirty.
          if (!publishedEditRenderQueued) {
            publishedEditRenderQueued = true;
            queueMicrotask(() => {
              publishedEditRenderQueued = false;
              if (usable()) e.requestRender("political-id-raster-published-edit");
            });
          }
        }
      }
      assetPublishedViewKey = viewKey;
      scheduleAssetSave();
      return true;
    } catch (error) {
      if (error instanceof RangeError && /budget/i.test(error.message)) {
        if (staged.gpuPreparation && gpuPreparation === staged.gpuPreparation) {
          cancelGpuPreparation();
          gpuPreparation = { key: staged.gpuKey, gpu, controller: new AbortController(), status: "fallback", handle: null };
          gpuPreparationStats.capacityFallbacks++; gpuPreparationStats.lastPath = "synchronous-capacity";
          account(); e.requestRender("political-id-gpu-capacity-fallback");
        }
        return reject("gpu-budget");
      }
      failProducer(error); return false;
    }
  }

  // Only a caller-owned complete dirty set in the same palette namespace
  // may narrow color resolution. Table replacement/ocean/style changes fall
  // back to a full palette refresh even if an older local dirty set exists.
  function updateSourceColors(identity) {
    const changedIds = identity.colorScope != null && identity.colorScope === colorScope
      ? h.getChangedColorIds?.() ?? null : null;
    snapshot = source.updateColors(changedIds, { colorRevision: identity.colorVersion });
    if (Array.isArray(changedIds)) {
      colorDeltas.push({ from: paletteVersion, to: identity.colorVersion, ids: changedIds.slice() });
      if (colorDeltas.length > MAX_COLOR_DELTAS) colorDeltas.shift();
    } else {
      colorDeltas = [];
    }
    paletteVersion = identity.colorVersion; colorScope = identity.colorScope;
  }

  function currentColorState(colorVersion) {
    return { version: colorVersion, generation: sourceGeneration };
  }

  // IDs changed since a palette's own color state, or null when no unbroken
  // explicit chain within the current source reaches the requested version.
  function collectColorDeltaIds(colorState, colorVersion) {
    if (!colorState || colorState.generation !== sourceGeneration) return null;
    if (colorState.version === colorVersion) return [];
    let version = colorState.version, ids = null;
    for (const delta of colorDeltas) {
      if (!ids) {
        if (delta.from !== version) continue;
        ids = new Set();
      } else if (delta.from !== version) return null;
      for (const id of delta.ids) ids.add(id);
      version = delta.to;
      if (version === colorVersion) return [...ids];
    }
    return null;
  }

  function getEntryIndex(entries) {
    let index = entryIndexes.get(entries);
    if (!index) {
      index = new Map(entries.map(entry => [entry.id, entry]));
      entryIndexes.set(entries, index);
    }
    return index;
  }

  function resolvePublishedPalette(entries, palette, changedIds = null) {
    const colors = palette.slice();
    const currentEntries = getEntryIndex(snapshot?.entries || NO_ENTRIES);
    const publishedIndex = changedIds ? getEntryIndex(entries) : null;
    const targets = changedIds ? changedIds.map(id => publishedIndex.get(id)).filter(Boolean) : entries;
    for (const entry of targets) {
      const color = h.resolveColor(currentEntries.get(entry.id)?.feature || entry.feature, entry.id);
      const rgba = typeof color === "string" && /^#[\da-f]{6}$/i.test(color)
        ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255] : color;
      if (!Array.isArray(rgba) || rgba.length !== 4 || rgba[3] !== 255
        || !rgba.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new TypeError("Invalid published raster color.");
      colors.set(rgba, entry.code * 4);
      }
    return colors;
  }

  function maybeCreateOverview(staged) {
    if (!gpu.createOverview) return;
    const next = staged.frame.plan, previous = overviewFrame?.plan;
    if (previous) {
      const bounds = frame => {
        const { plan, transform, dpr, layout } = frame;
        const left = (plan.outputX / dpr - (layout.offsetX || 0) - transform.x) / transform.k;
        const top = (plan.outputY / dpr - (layout.offsetY || 0) - transform.y) / transform.k;
        return [left, top, left + plan.outputWidth / dpr / transform.k, top + plan.outputHeight / dpr / transform.k];
      };
      const a = bounds(staged.frame), b = bounds(overviewFrame), epsilon = 1e-7;
      const aw = a[2] - a[0], ah = a[3] - a[1], bw = b[2] - b[0], bh = b[3] - b[1];
      const broader = a[0] <= b[0] + epsilon && a[1] <= b[1] + epsilon && a[2] >= b[2] - epsilon && a[3] >= b[3] - epsilon
        && aw * ah > bw * bh * 1.01;
      const sameSize = Math.abs(aw - bw) <= epsilon && Math.abs(ah - bh) <= epsilon;
      // The scene also retains viewport-sized sibling pass textures. A pan
      // within the same ID tile grid must refresh their capture reference even
      // when the ID grid's normalized bounds happen to remain identical.
      const moved = a.some((value, index) => Math.abs(value - b[index]) > epsilon)
        || ["x", "y", "k"].some(key => staged.frame.transform[key] !== overviewFrame.transform[key])
        || JSON.stringify(staged.frame.layout) !== JSON.stringify(overviewFrame.layout);
      // Codes and entries belong to the publishing source geometry. A same-view
      // republish after a geometry change (e.g. the startup coarse collection
      // replaced by detailed subdivisions) must replace the overview, or its
      // stale IDs keep resolving to the replaced features' colors.
      const geometryChanged = staged.committed.rawIdentity?.geometryContentVersion
        !== overviewCommitted?.rawIdentity?.geometryContentVersion;
      if (!broader && !(sameSize && moved) && !geometryChanged) return;
    }
    const reduced = createPoliticalIdRasterOverview({ tiles: staged.tiles, plan: next, dpr: state.dpr,
      maxBytes: Math.max(0, cache.maxBytes - cache.getStats().cpuBytes) });
    // An overview of replaced geometry must not survive a failed rebuild: its
    // stale codes would show wrong colors while dragging.
    const dropStaleOverview = () => {
      if (!overviewFrame || staged.committed.rawIdentity?.geometryContentVersion
        === overviewCommitted?.rawIdentity?.geometryContentVersion) return;
      overviewFrame.gpu.dispose(); overviewFrame = null; overviewCommitted = null;
      overviewPalette = null; overviewBaselinePalette = null; overviewEntries = [];
      account();
    };
    if (!reduced) { overviewReason = "cpu-budget"; dropStaleOverview(); return; }
    const overviewGpu = gpu.createOverview({ tiles: reduced.tiles, palette: staged.palette, revision: staged.paletteKey });
    if (!overviewGpu) { overviewReason = "gpu-budget"; dropStaleOverview(); return; }
    overviewFrame = { ...staged.frame, gpu: overviewGpu, plan: reduced.plan, sourceFrame: staged.frame,
      presentationState: "overview", geometryCurrent: false };
    overviewCommitted = staged.committed;
    overviewEntries = staged.entries; overviewPalette = staged.palette.slice(); overviewBaselinePalette = overviewPalette; overviewPaletteKey = staged.paletteKey;
    overviewColorState = staged.colorState;
    overviewReason = "ready";
  }

  function refreshOverviewPalette(colorVersion = h.getSourceIdentity().colorVersion) {
    if (!overviewFrame?.gpu.isAvailable()) return;
    const key = `${namespace}:${snapshot?.paletteRevision}:${colorVersion}`;
    if (key === overviewPaletteKey) return;
    const colors = resolvePublishedPalette(overviewEntries, overviewPalette,
      collectColorDeltaIds(overviewColorState, colorVersion));
    overviewFrame.gpu.setPalette(colors, `overview:${key}`);
    overviewPalette = colors; overviewPaletteKey = key; overviewColorState = currentColorState(colorVersion);
    overviewFrame.paletteRevision = snapshot.paletteRevision;
  }

  function getOverviewFrame() {
    if (!overviewFrame) return null;
    if (!isPresentationCompatible(overviewFrame, overviewCommitted)) {
      overviewFrame.gpu.dispose(); overviewFrame = null; overviewPalette = null; overviewBaselinePalette = null; overviewEntries = [];
      account();
    }
    return overviewFrame;
  }

  function retainPublishedFrame() {
    const { colorVersion } = h.getSourceIdentity();
    refreshOverviewPalette(colorVersion);
    const frame = getDirectFrame();
    if (!frame) return null;
    const key = `${namespace}:${snapshot?.paletteRevision}:${colorVersion}`;
    if (key !== publishedPaletteKey) {
      // Resolve the published ID set itself: a candidate may omit a still-visible
      // old ID, whose zero alpha in the candidate palette must not punch a hole.
      const colors = resolvePublishedPalette(publishedEntries, publishedPalette,
        collectColorDeltaIds(publishedColorState, colorVersion));
      gpu.setPalette(colors, `published:${key}`);
      publishedPalette = colors; publishedPaletteKey = key; publishedColorState = currentColorState(colorVersion);
      frame.paletteRevision = snapshot?.paletteRevision || 0;
    }
    frame.presentationState = "retained";
    frame.geometryCurrent = false;
    account();
    return { ...publishedResult, retained: true, presentationState: "retained" };
  }

  function isPresentationCompatible(frame, accepted) {
    const compatible = h.isDirectFrameCompatible
      ? h.isDirectFrameCompatible(frame, accepted?.rawIdentity)
      : (() => {
        const current = h.getSourceIdentity();
        return ["sceneKey", "projectionKey"].every(key => current[key] === accepted?.rawIdentity[key])
          && JSON.stringify(projectionOptions()) === accepted?.fittedProjectionKey
          && JSON.stringify(h.getLayout()) === JSON.stringify(frame.layout);
      })();
    return usable() && frame.gpu.isAvailable() && frame.dpr === state.dpr && compatible;
  }

  function getDirectFrame() {
    if (directFrame && !isPresentationCompatible(directFrame, committedPlan)) {
      directFrame = null; publishedBaselinePalette = null; publishedPalette = null; publishedEntries = [];
      account();
    }
    return directFrame;
  }

  // The scene owner calls this once when changing the displayed source frame.
  // Later edits replace live arrays without moving this preview-session baseline.
  function capturePublishedColorBaseline({ overview = false } = {}) {
    if (!(overview ? getOverviewFrame() : getDirectFrame())) return false;
    const palette = overview ? overviewPalette : publishedPalette;
    if (!palette) return false;
    if (overview) overviewBaselinePalette = palette;
    else publishedBaselinePalette = palette;
    account();
    return true;
  }

  function matchesPublishedColor(id, { overview = false } = {}) {
    if (!(overview ? getOverviewFrame() : getDirectFrame())) return false;
    const baseline = overview ? overviewBaselinePalette : publishedBaselinePalette;
    const entries = overview ? overviewEntries : publishedEntries;
    const featureId = String(id ?? "").trim();
    const entry = getEntryIndex(entries).get(featureId);
    if (!baseline || !entry) return false;
    const current = getEntryIndex(snapshot?.entries || NO_ENTRIES).get(featureId) || entry;
    const color = h.resolveColor(current.feature, featureId);
    const rgba = typeof color === "string" && /^#[\da-f]{6}$/i.test(color)
      ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255] : color;
    return Array.isArray(rgba) && rgba.length === 4
      && rgba.every((value, channel) => value === baseline[entry.code * 4 + channel]);
  }

  function queryPoint(point) {
    const committed = committedPlan;
    const identity = h.getSourceIdentity();
    const transform = state.zoomTransform;
    if (deferredForegroundOrder || !usable() || !committed || committed.epoch !== epoch || committed.dpr !== state.dpr
      || ['x', 'y', 'k'].some(key => transform[key] !== committed.transform[key])
      || ['sceneKey', 'projectionKey', 'coverageKey', 'version'].some(key => identity[key] !== committed.rawIdentity[key])
      || JSON.stringify(projectionOptions()) !== committed.fittedProjectionKey) {
      stats.pickFallbacks++;
      return { kind: 'missing', ids: [], primaryId: null,
        reason: deferredForegroundOrder ? 'deferred-foreground-order' : 'stale-frame' };
    }
    const projected = coordinates?.mapPoint([point.x, point.y]) || [point.x, point.y];
    const query = queryPoliticalIdRasterCandidates({
      tiles: committed.plan.tiles.map(descriptor => ({ tile: cache.peek(descriptor.key), descriptor })),
      point: { x: projected[0] * committed.plan.density, y: projected[1] * committed.plan.density },
      codeToId, density: committed.plan.density, samplesPerPixel: 1 / committed.plan.scale,
    });
    if (query.kind === 'interior') stats.pickInteriors++; else stats.pickFallbacks++;
    return query;
  }

  return Object.freeze({ prepare, draw, publishDirectFrame, updateNavigationDemand, getNavigationSnapshot, queryPoint, getDirectFrame, getOverviewFrame, capturePublishedColorBaseline, matchesPublishedColor, noteNativePartialRepaint,
    // draw() can rebuild the wrapper during a continuation without changing its
    // content. Use the existing exact GPU key plus bounded presentation values.
    getStagedFrameIdentity: () => stagedFrame ? JSON.stringify([stagedFrame.gpuKey, stagedFrame.paletteKey,
      stagedFrame.committed.epoch, stagedFrame.frame.dpr, stagedFrame.frame.transform.x,
      stagedFrame.frame.transform.y, stagedFrame.frame.transform.k, stagedFrame.frame.layout]) : null,
    finishNativePartialRepaint() {
      if (!disposed && deferredForegroundOrder && !h.isBrushActive?.() && !foregroundSyncRequested) {
        foregroundSyncRequested = true;
        e.requestRender("political-id-raster-foreground-order");
      }
      if (nativePartialPending) noteNativePartialRepaint();
    },
    hasNativeFrame: () => !disposed && !persistent && (displayState === "precise" || nativePartialPending),
    async exportAssets() {
      if (disposed || !snapshot) return [];
      return cache.entries().flatMap(([, tile]) => {
        const identity = tileIdentities.get(tile);
        return identity ? [{ identity, buffer: encodePoliticalIdRasterAsset(tile, { identity, codeToId }) }] : [];
      });
    },
    isSourcePreparing: () => !!sourcePreparation,
    prepareSource: () => {
      stopNavigationProduction();
      if (!usable()) return false;
      try {
        if (syncSource()) {
          // Preflight can overlap camera tile work with other private pass
          // producers without letting the pipeline commit an incomplete pass.
          if (updatePlan()) { updateViewIdentity(); pump(); prepareGpuFrame(); }
        }
        const pending = sourcePreparation?.promise || active?.promise
          || (gpuPreparation?.status === "pending" ? gpuPreparation.promise : null);
        // Navigation draws the accepted scene separately. Keep its edit/undo
        // palette current while the complete candidate remains a pipeline gate.
        if (pending && getDirectFrame()) retainPublishedFrame();
        return pending || false;
      } catch (error) { failProducer(error); return false; }
    },
    getPendingWorkCount: () => Number(!!active) + Number(!!sourcePreparation) + Number(gpuPreparation?.status === "pending")
      + Number(!!navigationTask) + Number(!!navigationUpload),
    getDiagnostics: ({ tileEvents: enabled, stageTimings: timingEnabled } = {}) => {
      if (timingEnabled !== undefined) stageTimingsEnabled = timingEnabled;
      syncTileRecords();
      if (enabled !== undefined) {
        tileEventsEnabled = enabled;
        if (!enabled) { tileEvents.clear(); tileEventIds = new WeakMap(); }
      }
      return { displayMode, persistent, directPresentation, ...stats, ...cache.getStats(), gpu: gpu?.getStats() || null,
      stageTimingsEnabled, stageTimings: structuredClone(stageTimings), snapshotBuilds, tileRecordUpdates,
      compression: cache.getCompressionStats(),
      tileRecords: [...tileRecords.values()].map(record => ({ ...record,
        sourceStamp: { ...record.sourceStamp }, coreRect: { ...record.coreRect },
        storageRect: { ...record.storageRect }, worldRect: { ...record.worldRect } })),
      cpuTransient: cache.getTransientStats(),
      tileEventsEnabled, tileEventLimit: TILE_EVENT_LIMIT, tileEvents: [...tileEvents.values()].map(event => ({ ...event })),
      worker: worker.getStats?.() || null,
      pending: Number(!!active) + Number(!!sourcePreparation) + Number(gpuPreparation?.status === "pending")
        + Number(!!navigationTask) + Number(!!navigationUpload),
      gpuPreparation: { ...gpuPreparationStats, pending: gpuPreparation?.status === "pending", ready: gpuPreparation?.status === "ready" },
      sourcePreparation: { ...sourcePreparationStats, pending: !!sourcePreparation }, failed, selected: h.isEnabled(), displayState, reason, deferredForegroundOrder,
      presentation: directPresentation ? "direct-gpu" : displayCache?.getStats().retainedSurfaceBytes ? "retained-regions" : "full-gpu",
      overview: { ready: !!overviewFrame, reason: overviewReason, textureBytes: overviewFrame?.gpu.getStats().gpuTextureBytes || 0 },
      stagedPending: !!stagedFrame, stagedRejectionReason, stagedRejections,
      publishedFrame: directFrame ? { state: directFrame.presentationState, epoch: directFrame.epoch, sourceVersion: directFrame.sourceVersion } : null,
      presentationCache: displayCache?.getStats() || null, lastTiming: lastTiming && { ...lastTiming },
      firstRasterReadyMs, lastDrawTotalMs, nativeRefinements, refinementPending: refinementTimer !== null || forceNativeRefinement,
      sceneKey: snapshot?.sceneKey || "", level: plan?.level ?? null,
      budgets: { maxPixels, cpuBytes: cache.maxBytes, gpuBytes: gpuLimit,
        hardViewportPixels: RASTER_BUDGET_MAX_PIXELS }, downgraded: plan?.downgraded ?? false,
      view: committedPlan ? { ...committedPlan.transform, dpr: committedPlan.dpr } : null,
      paletteRevision: snapshot?.paletteRevision ?? 0, geometryRevision: snapshot?.geometryRevision ?? 0,
      assets: assetStore?.stats() || null, identity: identityBuilder.getStats(), assetError, assetTimeout,
      backgroundSave: { pending: !!backgroundSave, bytes: backgroundSave?.bytes || 0,
        candidatePending: !!saveCandidate, idleScheduled: !!saveIdle,
        maxPending: 1, maxBytes: POLITICAL_ID_ASSET_SAVE_MAX_BYTES,
        lastFailure: lastAssetSaveFailure && { ...lastAssetSaveFailure } },
      lastAssetFailure: lastAssetFailure && { ...lastAssetFailure },
      assetFailureKind, assetFailureOperation,
      assetRecovery: { consecutiveTimeouts: consecutiveAssetTimeouts,
        state: consecutiveAssetTimeouts < 3 ? "ready" : active?.assetProbe ? "probing" : "cooldown",
        scheduled: assetRecoveryTimer !== null, coveredProbes: coveredAssetProbes,
        retryInMs: Math.max(0, nextAssetProbeAt - performance.now()) },
      pathCacheEstimatedBytes, canonicalCoordinates: !!coordinates, gutter,
      accounting: "typed-array-texture-and-surface-estimates-excludes-JS-and-driver" };
    },
    loseContextForValidation: () => gpu?.loseContextForValidation(),
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeCache();
      cancelRefinement();
      cancelAssetRecovery();
      cancelSourcePreparation();
      cancel();
      worker.dispose();
      releaseGpu();
      cache.clear();
      source.dispose();
      manifestController.abort();
      assetStore?.dispose();
      identityBuilder.dispose();
      displayCache?.dispose();
      tileDependencies = new WeakMap();
      tileIdentities = new WeakMap();
      tileEvents.clear(); tileEventIds = new WeakMap();
      committedPlan = null;
      renderedCoverage = null;
      snapshot = null; sourceGeneration++; colorDeltas = [];
      plan = null;
      resourceBudget?.release(resourceOwner);
    },
  });
}
