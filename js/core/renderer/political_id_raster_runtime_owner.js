import { createPoliticalIdRasterSource } from "./political_id_raster_source.js";
import { createPoliticalIdRasterCache, planPoliticalIdRasterView } from "./political_id_raster_cache.js";
import { createPoliticalIdRasterGpu } from "./political_id_raster_gpu.js";
import { createPoliticalIdRasterWorkerClient } from "../political_id_raster_worker_client.js";
import { createPoliticalIdRasterCoordinateSpace } from "./political_id_raster_coordinates.js";
import { createPoliticalIdRasterIdentityBuilder } from "./political_id_raster_identity.js";
import { createPoliticalIdRasterAssetStore, encodePoliticalIdRasterAsset } from "./political_id_raster_assets.js";
import { queryPoliticalIdRasterCandidates } from "./political_id_raster_pick.js";

const GPU_LIMIT = 80 * 1024 * 1024;
const projectionMethods = ["scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY", "precision", "clipAngle", "clipExtent"];

function matchesTileRegion(tile, descriptor) {
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
  assetStore = globalThis.indexedDB ? createPoliticalIdRasterAssetStore() : null,
  identityBuilder = createPoliticalIdRasterIdentityBuilder(), canonicalCoordinates = true, gutter = 0,
  assetTimeoutMs = 1500,
}) {
  const worker = client || createPoliticalIdRasterWorkerClient();
  let coordinates = null, fittedProjectionKey = "", rawIdentity = null;
  let codeToId = new Map(), idToCode = new Map(), tileIdentities = new WeakMap();
  let committedPlan = null, manifestKey = "", manifestPromise = null, assetError = "", assetTimeout = false;
  let consecutiveAssetTimeouts = 0;
  let pathCacheEstimatedBytes = 0;
  const manifestController = new AbortController();
  const source = createPoliticalIdRasterSource({ getId: h.getFeatureId,
    getBounds: (feature, id) => {
      const bounds = h.getBounds(feature, id);
      return coordinates ? coordinates.mapBounds(bounds) : bounds;
    }, resolveColor: h.resolveColor });
  const resourceOwner = Symbol("political-id-raster");
  let snapshot = null, sourceVersion = null, paletteVersion = null, colorScope = null, namespace = null;
  let gpu = null, active = null, plan = null, disposed = false, failed = "";
  let gpuTiles = [];
  let epoch = 0, planKey = "", attempted = new Set();
  const stats = { builds: 0, cacheHits: 0, staleResults: 0, commits: 0, fallbacks: 0,
    geometryInvalidations: 0, contextLosses: 0, coldBuildMs: 0, lastCommitMs: 0,
    assetHits: 0, pathBuilds: 0, pathCacheHits: 0, pickInteriors: 0, pickFallbacks: 0,
    identityMs: 0, assetLookupMs: 0 };

  function account() {
    const retained = cache.getStats();
    const graphics = gpu?.getStats();
    const assets = assetStore?.stats();
    resourceBudget?.update(resourceOwner, { rasterTiles: retained.cpuBytes + (snapshot?.palette.byteLength || 0)
        + (assets?.memoryBytes || 0),
      gpuTextures: graphics?.gpuTextureBytes || 0,
      workerSurfaces: (graphics?.outputSurfaceBytesEstimate || 0)
        + (active ? (active.descriptor.width + 2 * gutter) * (active.descriptor.height + 2 * gutter) * 4 : 0),
      workerGeometry: active ? null : 0,
      decodeTransient: assets?.pendingBytes || 0,
      projectedPaths: pathCacheEstimatedBytes });
  }
  function releaseGpu() { gpu?.dispose(); gpu = null; gpuTiles = []; }
  function cancel() { active?.controller.abort(); active = null; }
  function usable() { return !disposed && !failed && h.isEnabled() && worker.available(); }
  function projectionOptions() {
    const projection = surface.getProjection();
    const options = { factory: "geoEqualEarth" };
    for (const key of projectionMethods) if (typeof projection[key] === "function") options[key] = projection[key]();
    return options;
  }

  function syncSource() {
    const raw = h.getSourceIdentity();
    const options = projectionOptions();
    const nextFitKey = JSON.stringify(options);
    coordinates = canonicalCoordinates ? createPoliticalIdRasterCoordinateSpace(options) : null;
    const identity = { ...raw, projectionKey: coordinates?.signature || raw.projectionKey };
    const nextNamespace = `${identity.sceneKey}|${identity.projectionKey}|${identity.coverageKey}`;
    const changedNamespace = namespace !== nextNamespace;
    if (changedNamespace || sourceVersion !== identity.version || fittedProjectionKey !== nextFitKey) {
      const next = source.publish({ collection: h.getFeatures(), ...identity, colorRevision: identity.colorVersion });
      if (changedNamespace) {
        epoch++;
        cancel();
        cache.clear();
        releaseGpu();
      } else if (next.geometryRevision !== snapshot?.geometryRevision) {
        epoch++;
        cancel();
        stats.geometryInvalidations += cache.invalidate(next.dirtyBounds).length;
        // Drop only invalidated resident textures. A local geometry change
        // must not upload every unchanged tile again when the frame completes.
        const retained = new Set(cache.entries().map(([, tile]) => tile));
        gpuTiles = gpuTiles.filter(tile => retained.has(tile));
        if (gpu?.isAvailable()) gpu.setTiles(gpuTiles);
      }
      if (changedNamespace || next.geometryRevision !== snapshot?.geometryRevision) {
        attempted.clear();
        planKey = "";
      }
      snapshot = next;
      codeToId = new Map(snapshot.entries.map(entry => [entry.code, entry.id]));
      idToCode = new Map(snapshot.entries.map(entry => [entry.id, entry.code]));
      namespace = nextNamespace;
      sourceVersion = identity.version;
      paletteVersion = identity.colorVersion;
      colorScope = identity.colorScope;
    } else if (paletteVersion !== identity.colorVersion) {
      // Only a caller-owned complete dirty set in the same palette namespace
      // may narrow color resolution. Table replacement/ocean/style changes fall
      // back to a full palette refresh even if an older local dirty set exists.
      const changedIds = identity.colorScope != null && identity.colorScope === colorScope
        ? h.getChangedColorIds?.() ?? null : null;
      snapshot = source.updateColors(changedIds, { colorRevision: identity.colorVersion });
      paletteVersion = identity.colorVersion;
      colorScope = identity.colorScope;
    }
    rawIdentity = raw;
    fittedProjectionKey = nextFitKey;
    account();
  }

  function updatePlan() {
    const layout = h.getLayout();
    plan = planPoliticalIdRasterView({ transform: coordinates?.mapTransform(state.zoomTransform) || state.zoomTransform, dpr: state.dpr,
      width: layout.pixelWidth ?? Math.floor(layout.paddedWidth * state.dpr),
      height: layout.pixelHeight ?? Math.floor(layout.paddedHeight * state.dpr),
      offsetX: layout.offsetX || 0, offsetY: layout.offsetY || 0 });
    const key = plan?.tiles.map(tile => tile.key).join("|") || "";
    if (key !== planKey) { attempted = new Set(); planKey = key; }
    // An obsolete view can finish only its current tile. There is no old-view
    // queue, and a return to that region can reuse the accepted geometry tile.
    return plan;
  }

  async function registerManifest() {
    const urlValue = h.getAssetManifestUrl?.();
    if (!assetStore || !urlValue) return;
    if (manifestKey === urlValue) return manifestPromise;
    manifestKey = urlValue;
    manifestPromise = (async () => {
      const url = new URL(urlValue, globalThis.location.href);
      if (url.origin !== globalThis.location.origin || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Political ID manifest must be same-origin.');
      }
      const response = await fetch(url, { signal: AbortSignal.any([manifestController.signal,
        AbortSignal.timeout(assetTimeoutMs)]), mode: 'same-origin' });
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
    })().catch(error => { assetError = String(error.message || error); });
    return manifestPromise;
  }

  async function assetOperation(task, callback) {
    const controller = new AbortController();
    const signal = AbortSignal.any([task.controller.signal, controller.signal]);
    let timeout, onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new DOMException('Asset operation interrupted.', 'AbortError'));
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => { assetTimeout = true; consecutiveAssetTimeouts++; controller.abort(); }, assetTimeoutMs);
    });
    try {
      const value = await Promise.race([interrupted, Promise.resolve().then(() => {
        signal.throwIfAborted();
        return callback(signal);
      })]);
      consecutiveAssetTimeouts = 0;
      return value;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); }
  }

  async function resolveTile(packet, task, maps) {
    if (!assetStore || consecutiveAssetTimeouts >= 3) return { tile: await worker.request(packet, { signal: task.controller.signal }), built: true };
    let identity = null;
    try {
      const identityStarted = performance.now();
      identity = await identityBuilder.identify({ sceneKey: h.getAssetSceneKey?.() || snapshot.sceneKey,
        descriptor: packet, projectionOptions: packet.projectionOptions, entries: packet.entries,
        strokeWidth: packet.strokeWidth, gutter });
      stats.identityMs += performance.now() - identityStarted;
      task.controller.signal.throwIfAborted();
      const lookupStarted = performance.now();
      try {
        // Prebuilt manifests are explicit; ordinary sessions issue no speculative requests.
        const tile = await assetOperation(task, async signal => {
          await registerManifest();
          return assetStore.load(identity, { idToCode: maps.idToCode, signal });
        });
        if (tile) {
          if (!matchesTileRegion(tile, packet)) {
            throw new Error("Political ID asset does not match its requested region.");
          }
          return { tile, built: false, identity };
        }
      } finally { stats.assetLookupMs += performance.now() - lookupStarted; }
    } catch (error) { assetError = String(error.message || error); }
    if (task.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return { tile: await worker.request(packet, { signal: task.controller.signal }), built: true, identity };
  }

  function pump() {
    if (!usable() || active || !plan || !snapshot) return;
    const descriptor = plan.tiles.find(tile => !cache.peek(tile.key) && !attempted.has(tile.key));
    if (!descriptor) return;
    attempted.add(descriptor.key);
    const controller = new AbortController();
    const task = { controller, epoch, descriptor };
    const entries = snapshot.entries.filter(entry => intersectsTile(entry.bounds, descriptor, 4 + state.dpr))
      .map(entry => ({ ...entry, strokeCode: h.hasStroke?.(entry.feature) === false ? 0 : entry.code }));
    // Bound D3's resampling error in physical raster pixels at every LOD.
    // The worker scales base-space precision by density when rebuilding paths.
    const options = coordinates ? { ...coordinates.projectionOptions,
      precision: coordinates.projectionOptions.precision / descriptor.density } : projectionOptions();
    const packet = { ...descriptor, entries, projectionOptions: options,
      geometryNamespace: namespace, gutter, strokeWidth: 0.75 * state.dpr };
    const maps = { codeToId, idToCode };
    active = task;
    account();
    task.promise = resolveTile(packet, task, maps).then(async ({ tile, built, identity }) => {
      if (disposed || controller.signal.aborted) return;
      // Re-read live geometry identity before accepting asynchronous data. Color
      // edits need not cancel a geometry build: the latest palette is used at draw.
      syncSource();
      if (epoch !== task.epoch) { stats.staleResults++; return; }
      if (!matchesTileRegion(tile, descriptor)) {
        throw new Error("Political ID tile response does not match its requested region.");
      }
      cache.set(descriptor.key, tile, descriptor);
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
          // Serial pumping also bounds encoded buffers waiting for persistence to one tile.
          try { await assetOperation(task, signal => {
            const save = assetStore.save(identity, tile, { codeToId: maps.codeToId, signal });
            account();
            return save;
          }); } catch (error) { assetError = String(error.message || error); }
        }
      }
      account();
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
      // Complete one latest viewport before requesting a repaint, avoiding a
      // full vector redraw for every tile that becomes available.
      pump();
      if (!active) e.requestRender("political-id-raster-ready");
    });
  }

  function ensureGpu() {
    if (gpu?.isAvailable()) return true;
    releaseGpu();
    gpu = createGpu({ onContextLost: () => {
      stats.contextLosses++;
      // The current frame stays with Canvas. Recreate on the next eligible draw;
      // CPU coverage remains valid and no geometry is rebuilt for context loss.
      e.requestRender("political-id-raster-context-lost");
    } });
    return gpu.isAvailable();
  }

  function draw() {
    if (!usable()) return null;
    try {
      syncSource();
      if (!updatePlan()) { stats.fallbacks++; return null; }
      // Probe availability before spending CPU time building unavailable output.
      if (!ensureGpu()) return null;
      const tiles = plan.tiles.map(tile => cache.get(tile.key));
      if (tiles.some(tile => !tile)) { stats.fallbacks++; pump(); return null; }
      // Padded edge textures are accounted by the GPU owner. This admission
      // estimate bounds one allocation before uploading; no driver-VRAM claim.
      const estimate = tiles.reduce((sum, tile) => sum + tile.codes.byteLength
        + Math.ceil(Math.max(1, tile.edgeIds.length) / 1024) * 1024 * 8, 0)
        + plan.width * plan.height * 4 + Math.ceil(snapshot.palette.length / 4096) * 4096;
      if (estimate > GPU_LIMIT) { stats.fallbacks++; return null; }
      const startedAt = performance.now();
      gpu.setPalette(snapshot.palette, `${namespace}:${snapshot.paletteRevision}`);
      gpu.setTiles(tiles);
      gpuTiles = tiles;
      gpu.draw(plan);
      const context = surface.getContext();
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "low";
        context.drawImage(gpu.canvas, plan.outputX, plan.outputY, plan.outputWidth, plan.outputHeight);
      } finally { context.restore(); }
      const renderedIds = new Set(snapshot.entries.filter(entry => intersectsTile(entry.bounds, {
        density: plan.density, originX: plan.originX, originY: plan.originY, width: plan.width, height: plan.height,
      })).map(entry => entry.id));
      stats.commits++;
      committedPlan = { plan, epoch, version: sourceVersion, dpr: state.dpr,
        transform: { ...state.zoomTransform }, rawIdentity: { ...rawIdentity }, fittedProjectionKey };
      stats.cacheHits += tiles.length;
      stats.lastCommitMs = performance.now() - startedAt;
      account();
      e.recordMetric?.("politicalIdRasterCommit", stats.lastCommitMs, {
        tileCount: tiles.length, level: plan.level, renderedCount: renderedIds.size,
        cpuBytes: cache.getStats().cpuBytes, ...gpu.getStats(),
      });
      return { fillMs: stats.lastCommitMs, strokeMs: 0, renderedCount: renderedIds.size, renderedIds };
    } catch (error) {
      failed = String(error?.message || error);
      cancel();
      releaseGpu();
      cache.clear();
      account();
      stats.fallbacks++;
      return null;
    }
  }

  function queryPoint(point) {
    const committed = committedPlan;
    const identity = h.getSourceIdentity();
    const transform = state.zoomTransform;
    if (!usable() || !committed || committed.epoch !== epoch || committed.dpr !== state.dpr
      || ['x', 'y', 'k'].some(key => transform[key] !== committed.transform[key])
      || ['sceneKey', 'projectionKey', 'coverageKey', 'version'].some(key => identity[key] !== committed.rawIdentity[key])
      || JSON.stringify(projectionOptions()) !== committed.fittedProjectionKey) {
      stats.pickFallbacks++;
      return { kind: 'missing', ids: [], primaryId: null, reason: 'stale-frame' };
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

  return Object.freeze({ draw, queryPoint,
    async exportAssets() {
      if (disposed || !snapshot) return [];
      return cache.entries().flatMap(([, tile]) => {
        const identity = tileIdentities.get(tile);
        return identity ? [{ identity, buffer: encodePoliticalIdRasterAsset(tile, { identity, codeToId }) }] : [];
      });
    },
    getPendingWorkCount: () => active ? 1 : 0,
    getDiagnostics: () => ({ ...stats, ...cache.getStats(), gpu: gpu?.getStats() || null,
      pending: active ? 1 : 0, failed, selected: h.isEnabled(),
      sceneKey: snapshot?.sceneKey || "", level: plan?.level ?? null,
      paletteRevision: snapshot?.paletteRevision ?? 0, geometryRevision: snapshot?.geometryRevision ?? 0,
      assets: assetStore?.stats() || null, identity: identityBuilder.getStats(), assetError, assetTimeout,
      pathCacheEstimatedBytes, canonicalCoordinates: !!coordinates, gutter,
      accounting: "typed-array-texture-and-surface-estimates-excludes-JS-and-driver" }),
    loseContextForValidation: () => gpu?.loseContextForValidation(),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      worker.dispose();
      releaseGpu();
      cache.clear();
      source.dispose();
      manifestController.abort();
      assetStore?.dispose();
      identityBuilder.dispose();
      tileIdentities = new WeakMap();
      committedPlan = null;
      snapshot = null;
      plan = null;
      resourceBudget?.release(resourceOwner);
    },
  });
}
