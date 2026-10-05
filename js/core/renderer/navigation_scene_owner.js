import { createGeometryRasterWorkerClient } from "../geometry_raster_worker_client.js";
import { packGeometryCooperatively } from "../cooperative_geometry_transport.js";
import { createNavigationFrameOwner } from "./navigation_frame_owner.js";
import { getObjectIdentityToken } from "./object_identity.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { isScenarioPoliticalBaseChunk } from "../scenario_chunk_manager.js";
import { pageResourceBudget } from "../runtime_resource_budget.js";

// Navigation owns a small, whole-scene raster. Viewport chunk promotion is not
// a paint edit, and must not discard the only frame that covers a fast pan.
export function createNavigationSceneOwner(state, { surface, helpers: h, createFrameOwner = createNavigationFrameOwner,
  createWorkerClient = createGeometryRasterWorkerClient,
  createCanvas = () => document.createElement("canvas"),
  resourceBudget = pageResourceBudget,
  yieldTask = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)),
}) {
  let paintRevision = null;
  let paintSignature = "";
  let detailedFrame = null;
  const detailOwner = Symbol("navigation-base-detail");
  const maxDetailBytes = 32 * 1024 * 1024;
  function clearDetail() {
    if (detailedFrame) { detailedFrame.source.width = 0; detailedFrame.source.height = 0; }
    detailedFrame = null;
    resourceBudget.release(detailOwner);
  }
  let requestedIdentity = "";
  let sourceRequest = null;
  let sourcePayloads = null;
  let failedSourceIdentity = "";
  let prewarmedSourceIdentity = "";
  const frame = createFrameOwner({ getIdentity,
    shouldPause: () => state.renderPhase === "interacting" || state.renderPhase === "settling",
    recordMetric(name, duration, details) {
      if (name === "navigationFramePrepare" || name === "navigationFrameCancel") requestedIdentity = "";
      if (name === "navigationFrameCancel" && details.reason === "identity") queueMicrotask(prepare);
      h.recordMetric(name, duration, details);
    },
  });

  function getSourceIdentity() {
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    return JSON.stringify([state.activeScenarioId, state.sceneGeneration,
      getObjectIdentityToken(bundle), getObjectIdentityToken(bundle?.chunkRegistry)]);
  }

  function discardStaleSources() {
    if (sourcePayloads && sourcePayloads.identity !== getSourceIdentity()) sourcePayloads = null;
  }

  function prewarm() {
    discardStaleSources();
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    if (!bundle) return;
    prewarmedSourceIdentity = getSourceIdentity();
    const layers = ["political", "water", "scenario_atlantropa"]
      .filter((layer) => !bundle.chunkRegistry || getWholeLayerBases(layer).length);
    if (layers.length && !frame.isReady()) requestMissingSources(prewarmedSourceIdentity, layers);
  }

  function getWholeLayerBases(layer) {
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    return (bundle?.chunkRegistry?.byLayer?.[layer] || []).filter((chunk) => (
      chunk.globalCoverage === true && chunk.lod === "coarse"
    ));
  }

  function getWholeLayerPayloads(layer) {
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    const bases = getWholeLayerBases(layer);
    const prepared = sourcePayloads?.identity === getSourceIdentity() ? sourcePayloads.layers?.[layer] : null;
    return bases.length ? bases.map(({ id }, index) => bundle.chunkPayloadCacheById?.[id]?.payload
      || state.activeScenarioChunks?.payloadByChunkId?.[id] || prepared?.[index] || null) : null;
  }

  function requestMissingSources(identity, layers) {
    if (typeof h.ensureNavigationSources !== "function" || sourceRequest?.identity === identity
      || failedSourceIdentity === identity) return;
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    const request = { identity, startedAt: Date.now(), bundle, registry: bundle?.chunkRegistry,
      scenarioId: state.activeScenarioId, sceneGeneration: state.sceneGeneration };
    sourceRequest = request;
    Promise.resolve().then(() => h.ensureNavigationSources(layers)).then((payloads) => {
      if (sourceRequest !== request || state.activeScenarioId !== request.scenarioId
        || state.sceneGeneration !== request.sceneGeneration
        || state.scenarioBundleCacheById?.[state.activeScenarioId] !== request.bundle
        || (request.registry && request.registry !== request.bundle?.chunkRegistry)) return;
      // Registry discovery is the one allowed source-identity transition.
      const completedIdentity = getSourceIdentity();
      if (prewarmedSourceIdentity === identity) prewarmedSourceIdentity = completedIdentity;
      const complete = layers.every((layer) => Array.isArray(payloads?.[layer])
        && payloads[layer].length === getWholeLayerBases(layer).length
        && payloads[layer].every((payload) => Array.isArray(payload?.features)));
      if (!complete) throw new Error("Incomplete global navigation sources");
      h.recordMetric("navigationSourceLoad", Date.now() - request.startedAt, { layers });
      // Retain this complete source set until a raster job captures it. Early
      // prefetch may finish while scenario apply still blocks preparation.
      sourcePayloads = { identity: completedIdentity, layers: payloads };
      prepare();
    }).catch((error) => {
      if (sourceRequest !== request || getSourceIdentity() !== identity) return;
      failedSourceIdentity = identity;
      h.recordMetric("navigationSourceLoadFailed", 0, { message: String(error?.message || error) });
    }).finally(() => {
      if (sourceRequest === request) sourceRequest = null;
    });
  }

  function getWholeLayerIdentity(layer, fallback) {
    const bases = getWholeLayerBases(layer);
    // Completed pixels outlive decoded-payload cache eviction. Immutable chunk
    // descriptors identify their content; viewport residency does not.
    return bases.length ? bases.map(({ id, sha256, url }) => [id, sha256, url]) : getObjectIdentityToken(fallback);
  }

  function getIdentity() {
    if (paintRevision !== state.colorRevision) {
      paintRevision = state.colorRevision;
      paintSignature = JSON.stringify([state.visualOverrides, state.sovereignBaseColors]);
    }
    return JSON.stringify([
      state.activeScenarioId, state.sceneGeneration,
      getProjectionGeometryGeneration(surface.getProjection()),
      getObjectIdentityToken(state.topologyPrimary || state.topology),
      getObjectIdentityToken(state.topologyDetail), getObjectIdentityToken(state.ruCityOverrides),
      getObjectIdentityToken(state.scenarioBundleCacheById?.[state.activeScenarioId]?.chunkRegistry),
      getObjectIdentityToken(state.scenarioRuntimeTopologyData || state.runtimePoliticalTopology),
      getObjectIdentityToken(state.scenarioBaselineOwnersByFeatureId),
      state.sovereigntyRevision, state.scenarioShellOverlayRevision, state.mapSemanticMode,
      paintSignature, state.strategicChoroplethMetric,
      getObjectIdentityToken(state.scenarioStrategicValuesData),
      getWholeLayerIdentity("water", state.scenarioWaterRegionsData),
      getObjectIdentityToken(state.waterRegionsData),
      getObjectIdentityToken(state.contextLayerExternalDataByName?.lakes),
      getWholeLayerIdentity("scenario_atlantropa", state.scenarioAtlantropaData),
      getWholeLayerBases("scenario_atlantropa").length ? 0 : state.scenarioAtlantropaRevision,
      state.showWaterRegions, state.showOpenOceanRegions, state.showScenarioAtlantropa,
      state.waterRegionOverrides, state.styleConfig,
      Object.entries(state).filter(([key, value]) => key.startsWith("show") && typeof value === "boolean"),
    ]);
  }

  function getWholeSceneLand() {
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId];
    const bases = (bundle?.chunkRegistry?.byLayer?.political || []).filter(isScenarioPoliticalBaseChunk);
    if (bases.length) {
      const payloads = getWholeLayerPayloads("political");
      // Never mistake a viewport selection or a partially loaded base for a world.
      return payloads.every((payload) => Array.isArray(payload?.features))
        ? payloads.flatMap((payload) => payload.features) : null;
    }
    if (state.activeScenarioId && state.scenarioPoliticalChunkData?.globalCoverage !== true) return null;
    return (state.landDataFull || state.landData)?.features || null;
  }

  function prepare() {
    discardStaleSources();
    if (state.bootBlocking || (state.scenarioApplyInFlight
      && prewarmedSourceIdentity !== getSourceIdentity())) return;
    const identity = getIdentity();
    if (frame.isReady()) { sourcePayloads = null; return; }
    if (requestedIdentity === identity) return;
    const projection = surface.getProjection();
    const land = getWholeSceneLand();
    if (!projection || !globalThis.d3?.geoPath) return;
    const waterPayloads = getWholeLayerPayloads("water");
    const atlantropaPayloads = getWholeLayerPayloads("scenario_atlantropa");
    const missingLayers = [
      ...(!land?.length && getWholeLayerBases("political").length ? ["political"] : []),
      ...(waterPayloads?.some((payload) => !Array.isArray(payload?.features)) ? ["water"] : []),
      ...(atlantropaPayloads?.some((payload) => !Array.isArray(payload?.features)) ? ["scenario_atlantropa"] : []),
    ];
    if (missingLayers.length) {
      // Hold one complete input set across cache eviction while the missing
      // layers load; alternating independent loads could evict each other.
      requestMissingSources(getSourceIdentity(), ["political", "water", "scenario_atlantropa"]
        .filter((layer) => getWholeLayerBases(layer).length));
      return;
    }
    if (!land?.length) return;
    const path = globalThis.d3.geoPath(projection);
    path.digits?.(6);
    const bounds = path.bounds({ type: "Sphere" });
    const atlantropa = h.getEffectiveAtlantropaFeatures(atlantropaPayloads?.flatMap((payload) => payload.features));
    function fillGeometry(context, geometries) {
      if (globalThis.Path2D) {
        // Batched native parsing avoids tens of thousands of JS-to-native path
        // calls for coastlines with many holes. This path instance is private.
        const combined = new globalThis.Path2D();
        path.context(null);
        for (const geometry of geometries) {
          const text = path(geometry);
          if (text) combined.addPath(new globalThis.Path2D(text));
        }
        context.fill(combined);
      } else {
        context.beginPath();
        for (const geometry of geometries) path.context(context)(geometry);
        context.fill();
      }
    }
    const landEntry = (feature) => {
      const id = h.getFeatureId(feature);
      if (!feature?.geometry
        || h.isBaseGeographyScenarioFeature(feature) || h.shouldExcludePoliticalVisualFeature(feature, id)) return;
      return { feature, fillColor: h.getResolvedFeatureColor(feature, id) || h.landFill, alpha: 1 };
    };
    const drawLand = (context, feature) => {
      const entry = landEntry(feature);
      if (!entry) return;
      const id = h.getFeatureId(feature);
      context.globalAlpha = entry.alpha;
      context.fillStyle = entry.fillColor;
      const cached = h.getCachedLandPath?.(feature, id);
      if (cached) { context.fill(cached); return; }
      fillGeometry(context, [feature]);
    };
    const sharedLakeIds = new Set((state.contextLayerExternalDataByName?.lakes?.features || []).map(h.getFeatureId));
    const water = h.getEffectiveWaterRegionFeatures(atlantropa, waterPayloads?.flatMap((payload) => payload.features)).filter((feature) => (
      (state.showWaterRegions || sharedLakeIds.has(h.getFeatureId(feature))) && h.isWaterRegionRenderable(feature)
    ));
    const layers = [
      { items: [{ type: "Sphere" }], drawItem(context, sphere) {
        context.fillStyle = h.getOceanBaseFillColor();
        context.beginPath();
        path.context(context)(sphere);
        context.fill();
      } },
      { items: land, drawItem: drawLand },
      { items: [...atlantropa.land, ...atlantropa.shoal, ...atlantropa.relief], drawItem: drawLand },
      { items: water, drawItem(context, feature) {
        const opacity = h.getWaterRegionDefaultStyle(feature).opacity;
        if (!(opacity > 0)) return;
        context.globalAlpha = opacity;
        context.fillStyle = h.getWaterRegionColor(h.getFeatureId(feature), feature);
        const parts = h.collectSafeWaterRegionGeometryParts(feature);
        const cached = h.getCachedWaterPath?.(feature, parts);
        if (cached) { context.fill(cached); return; }
        fillGeometry(context, parts);
      } },
    ];
    const projectionOptions = { factory: "geoEqualEarth", pointRadius: 4.5 };
    for (const key of ["scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY", "precision", "clipAngle", "clipExtent"]) {
      if (typeof projection[key] === "function") projectionOptions[key] = projection[key]();
    }
    const renderRaster = async ({ width, height, bounds: rasterBounds, signal }) => {
      const worker = createWorkerClient({ packGeometry: packGeometryCooperatively,
        onMetric: (name, duration, details) => h.recordMetric(`navigation${name[0].toUpperCase()}${name.slice(1)}`, duration, details) });
      if (!worker.available()) { worker.dispose(); return null; }
      const onAbort = () => worker.dispose();
      signal.addEventListener("abort", onAbort, { once: true });
      const startedAt = performance.now();
      const entries = [];
      let sliceStartedAt = startedAt;
      try {
        // Yield before collecting/packing so initiating a frame never projects
        // geometry or traverses the full scene on a pointer event's stack.
        await yieldTask();
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
          const items = layers[layerIndex].items;
          for (let index = 0; index < items.length; index++) {
            if (signal.aborted) return null;
            const item = items[index];
            let entry;
            if (layerIndex === 0) {
              entry = { feature: { type: "Feature", geometry: { type: "Sphere" } }, fillColor: h.getOceanBaseFillColor(), alpha: 1 };
            } else if (layerIndex === 3) {
              const alpha = h.getWaterRegionDefaultStyle(item).opacity;
              if (alpha > 0) entry = { feature: { type: "Feature", geometry: { type: "GeometryCollection",
                geometries: h.collectSafeWaterRegionGeometryParts(item).map((part) => part.type === "Feature" ? part.geometry : part) } },
                fillColor: h.getWaterRegionColor(h.getFeatureId(item), item), alpha };
            } else entry = landEntry(item);
            if (entry) entries.push({ ...entry, id: `${layerIndex}:${index}` });
            if (performance.now() - sliceStartedAt >= 4) {
              await yieldTask();
              if (signal.aborted || getIdentity() !== identity) return null;
              sliceStartedAt = performance.now();
            }
          }
        }
        h.recordMetric("navigationEntryPrepare", performance.now() - startedAt, { entries: entries.length });
        if (signal.aborted || getIdentity() !== identity) return null;
        const [[minX, minY], [maxX, maxY]] = rasterBounds;
        const k = width / (maxX - minX), scaleY = height / (maxY - minY);
        return await worker.request({ kind: "navigation", identity, sceneKey: identity,
          projectionKey: String(getProjectionGeometryGeneration(projection)), projectionOptions,
          entries, width, height, dpr: 1,
          transform: { x: -minX * k, y: -minY * scaleY, k, scaleY } }, { signal });
      } finally {
        signal.removeEventListener("abort", onAbort);
        worker.dispose();
      }
    };
    if (frame.prepare({ bounds, layers, renderRaster, backgroundColor: "transparent" }) !== false) {
      requestedIdentity = identity;
      sourcePayloads = null;
    }
  }

  function captureDetail(source, transform, dpr, { completeExact = false, drawBase = null } = {}) {
    // Source supplies dimensions only. Copying the visible screenshot would
    // bake text into both the detail and the whole-world navigation raster.
    if (!completeExact || typeof drawBase !== "function" || !(transform?.k > 0) || !(dpr > 0)) return false;
    const bytes = Number(source?.width) * Number(source?.height) * 4;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxDetailBytes) return false;
    // Release the replaceable detail before allocating its successor; retained
    // detail never exceeds the local cap and the visible complete frame stays intact.
    clearDetail();
    const canvas = createCanvas();
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) { canvas.width = 0; canvas.height = 0; return false; }
    resourceBudget.update(detailOwner, { bitmaps: bytes });
    try {
      if (drawBase(context) !== true) { canvas.width = 0; canvas.height = 0; resourceBudget.release(detailOwner); return false; }
    } catch (error) {
      canvas.width = 0; canvas.height = 0; resourceBudget.release(detailOwner);
      throw error;
    }
    detailedFrame = { source: canvas, transform: { x: transform.x, y: transform.y, k: transform.k }, dpr,
      identity: getIdentity(), detailIdentity: h.getDetailIdentity?.(transform) };
    // A global raster must not inherit viewport-only context layers; the
    // cooperative world renderer remains its one consistent source.
    prepare();
    return true;
  }

  function draw(transform) {
    if (detailedFrame && (detailedFrame.identity !== getIdentity()
      || h.getDetailIdentity && detailedFrame.detailIdentity !== h.getDetailIdentity(detailedFrame.transform))) clearDetail();
    const detail = detailedFrame?.identity === getIdentity() ? detailedFrame : null;
    if (h.canDrawLabels && !h.canDrawLabels(transform)) return false;
    const drawn = frame.draw(surface.getContext(), transform, state.dpr || 1, {
      detailSource: detail?.source,
      detailTransform: detail?.transform,
      detailDpr: detail?.dpr,
    });
    if (!drawn) return false;
    return h.drawLabels ? h.drawLabels(transform) : true;
  }

  return Object.freeze({ prepare, prewarm, draw, captureDetail, isReady: frame.isReady,
    clear() {
      frame.clear(); requestedIdentity = ""; clearDetail();
      sourceRequest = null; sourcePayloads = null; failedSourceIdentity = ""; prewarmedSourceIdentity = "";
    } });
}
