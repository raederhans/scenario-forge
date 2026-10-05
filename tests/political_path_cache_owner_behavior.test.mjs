import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createPoliticalPathCacheOwner } from "../js/core/renderer/political_path_cache_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { getProjectedPathResourceAccounting } from "../js/core/renderer/projected_path_resource_accounting.js";

const item = (id, x = 50, drawOrder = 0) => ({
  id, minX: x, maxX: x, minY: 50, maxY: 50, drawOrder,
  feature: { id, geometry: { type: "Polygon", coordinates: [] } },
});

function fixture(t, options = {}) {
  const { scheduleDeferredWork = null, ...ownerOptions } = options;
  const originalPath = globalThis.Path2D;
  globalThis.Path2D = class { constructor(path) { this.value = path; } };
  t.after(() => { globalThis.Path2D = originalPath; });
  const h = {
    state: { zoomTransform: { k: 1, x: 0, y: 0 }, width: 100, height: 100, renderPhase: "idle" },
    cache: { dirty: {} }, projection: {}, viewport: "v1", time: 0, pathCost: 0,
    candidates: { items: [item("a"), item("b", 60)] },
    timers: new Map(), cancelled: [], metrics: [], counters: {}, builds: [], serial: 0,
  };
  h.makePath = (draw) => {
    let context = null;
    const path = (feature) => draw(feature, context);
    path.context = (...args) => {
      if (!args.length) return context;
      [context] = args;
      return path;
    };
    return path;
  };
  h.path = h.makePath((feature, context) => {
    h.builds.push(feature.id); h.time += h.pathCost; context.value = `path:${feature.id}`;
  });
  h.resourceBudget = options.resourceBudget || createRuntimeResourceBudget();
  h.owner = createPoliticalPathCacheOwner(h.state, {
    rendererSurfaceHost: { getPathCanvas: () => h.path, getProjection: () => h.projection },
    getPoliticalPassStaticSignature: (transform) => `static:${transform.k}:${transform.x}:${transform.y}`,
    getProjectionRenderSignature: () => h.projection,
    getViewportRenderSignature: () => h.viewport,
    getRenderPassCacheState: () => h.cache,
    cancelDeferredWork: (handle) => { h.cancelled.push(handle); h.timers.delete(handle); },
    scheduleDeferredWork: scheduleDeferredWork || ((callback, options) => {
      const handle = ++h.serial;
      h.timers.set(handle, { callback, options });
      return handle;
    }),
    incrementPerfCounter: (name) => { h.counters[name] = (h.counters[name] || 0) + 1; },
    recordRenderPerfMetric: (...args) => h.metrics.push(args),
    areZoomTransformsEquivalent: (left, right) => !!left && left.k === right.k && left.x === right.x && left.y === right.y,
    cloneZoomTransform: (value) => ({ ...value }),
    getFeatureId: (value) => value?.id,
    screenRectToProjectedRect: (rect, transform) => { h.rect = rect; h.transform = transform; return rect; },
    collectLandSpatialItemsForProjectedRects: () => h.candidates,
    nowMs: () => h.time,
    RENDER_PHASE_IDLE: "idle",
    resourceBudget: h.resourceBudget,
    ...ownerOptions,
  });
  h.tick = (deadline = null) => {
    const [handle, timer] = h.timers.entries().next().value;
    h.timers.delete(handle);
    return timer.callback(deadline);
  };
  return h;
}

test("path budget evicts least-recent paths while returning usable transient oversized paths", (t) => {
  const h = fixture(t, { pathCacheBudget: 512 });
  const options = { allowBuild: true };
  const a = item("a").feature, b = item("b").feature, c = item("c").feature;
  h.owner.getPoliticalFeaturePathEntry(a, options);
  h.owner.getPoliticalFeaturePathEntry(b, options);
  h.owner.getPoliticalFeaturePathEntry(a, options);
  h.owner.getPoliticalFeaturePathEntry(c, options);
  assert.deepEqual([...h.cache.politicalPathCache.keys()], ["a", "c"]);
  const giant = { id: "giant", geometry: { type: "LineString", coordinates: Array.from({ length: 100 }, (_, i) => [i, 0]) } };
  assert.ok(h.owner.getPoliticalFeaturePathEntry(giant, options)?.path);
  assert.equal(h.cache.politicalPathCache.has("giant"), false);
  assert.equal(h.cache.politicalPathCache.getStats().estimatedBytes, 512);
  assert.ok(h.owner.getPoliticalFeaturePathEntry(b, options)?.path, "evicted geometry rebuilds on demand");
});

test("projected path accounting deduplicates LRU and group references and releases on eviction/reset", (t) => {
  const h = fixture(t, { pathCacheBudget: 512 });
  const groupOwner = Symbol("full-pass-group");
  const accounting = getProjectedPathResourceAccounting(h.resourceBudget);
  const options = { allowBuild: true };
  const featureA = item("a").feature;
  const featureB = item("b").feature;
  const featureC = item("c").feature;
  const a = h.owner.getPoliticalFeaturePathEntry(featureA, options);
  accounting.retain(groupOwner, a.path, a.estimatedBytes);
  h.owner.getPoliticalFeaturePathEntry(featureB, options);
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, 512);

  const beforeHit = h.resourceBudget.snapshot().revision;
  assert.equal(h.owner.getPoliticalFeaturePathEntry(featureA, options).path, a.path);
  assert.equal(h.resourceBudget.snapshot().revision, beforeHit, "cache hits do not rescan or republish retained paths");
  h.owner.getPoliticalFeaturePathEntry(featureB, options);

  h.owner.getPoliticalFeaturePathEntry(featureC, options);
  assert.deepEqual([...h.cache.politicalPathCache.keys()], ["b", "c"]);
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, 768,
    "the group keeps the evicted A path accounted alongside the two LRU entries");
  accounting.release(groupOwner, a.path);
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, 512);

  h.owner.invalidatePoliticalPathCache("test-reset");
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, undefined,
    "reset releases the remaining LRU references");
});

test("warmup paths are accounted when retained and released by cache invalidation", (t) => {
  const h = fixture(t, { pathCacheBudget: 1024 });
  h.owner.schedulePoliticalPathWarmup();
  h.tick();
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, 512);
  h.owner.invalidatePoliticalPathCache("warmup-reset");
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, undefined);
});

test("recreated cache owners release the previous accounted map before replacing it", (t) => {
  const h = fixture(t, { pathCacheBudget: 1024 });
  h.owner.getPoliticalFeaturePathEntry(item("a").feature, { allowBuild: true });
  const previousMap = h.cache.politicalPathCache;
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, 256);

  const replacementOwner = createPoliticalPathCacheOwner(h.state, {
    rendererSurfaceHost: { getProjection: () => h.projection },
    getRenderPassCacheState: () => h.cache,
    cloneZoomTransform: (transform) => ({ ...transform }),
    recordRenderPerfMetric: () => {},
    resourceBudget: h.resourceBudget,
  });
  const replacement = replacementOwner.getPoliticalPathCacheHandle(
    h.state.zoomTransform,
    { resetIfMismatch: true },
  );
  assert.notEqual(replacement.map, previousMap);
  assert.equal(previousMap.size, 0);
  assert.equal(h.resourceBudget.snapshot().categories.projectedPaths, undefined);
});

test("cache mismatch reads are non-destructive; preparation preserves map identity and snapshots transforms", (t) => {
  const h = fixture(t);
  const cold = h.owner.getPoliticalPathCacheHandle();
  assert.equal(cold.valid, false);
  assert.equal(h.cache.politicalPathCache, undefined);
  const first = h.owner.getPoliticalPathCacheHandle(undefined, { resetIfMismatch: true });
  first.map.set("old", { path: true });
  h.state.zoomTransform.x = 5;
  assert.equal(h.cache.politicalPathCacheTransform.x, 0);
  assert.equal(h.owner.getPoliticalPathCacheHandle().valid, true);
  h.state.zoomTransform.k = 3;
  h.viewport = "DPR2";
  h.state.colorRevision = 3;
  h.state.sovereigntyRevision = 2;
  h.state.scenarioShellOverlayRevision = 2;
  assert.equal(h.owner.getPoliticalPathCacheHandle().valid, true);
  markProjectionGeometryChanged(h.projection);
  assert.equal(h.owner.getPoliticalPathCacheHandle().valid, false);
  assert.equal(first.map.size, 1);
  const next = h.owner.getPoliticalPathCacheHandle(undefined, { resetIfMismatch: true });
  assert.equal(next.map, first.map);
  assert.equal(next.map.size, 0);
  assert.equal(next.resetSummary.previousSize, 1);
  assert.equal(next.cache.politicalPathCacheTransform.x, 5);
  for (const change of [
    () => { h.projection = {}; }, () => { h.state.topologyPrimary = {}; },
    () => { h.state.activeScenarioId = "new"; }, () => { h.state.sceneGeneration = 1; },
    () => { h.state.runtimePoliticalTopology = {}; },
  ]) {
    change();
    assert.equal(h.owner.getPoliticalPathCacheHandle().valid, false);
    h.owner.getPoliticalPathCacheHandle(undefined, { resetIfMismatch: true });
  }
  h.cache = { dirty: {} };
  assert.equal(h.owner.getPoliticalPathCacheHandle().valid, false);
});

test("entries build lazily, reuse cached paths, read live surfaces, and tolerate unavailable path generation", (t) => {
  const h = fixture(t), value = item("a").feature;
  assert.equal(h.owner.getPoliticalFeaturePathEntry(value, { countMiss: true }), null);
  assert.equal(h.counters.politicalPartialPathCacheMisses, 1);
  const entry = h.owner.getPoliticalFeaturePathEntry(value, { allowBuild: true, countBuild: true });
  assert.equal(entry.path.value, "path:a");
  h.path = h.makePath((_feature, context) => { context.value = "replacement"; });
  assert.equal(h.owner.getPoliticalFeaturePathEntry(value, { allowBuild: true }), entry);
  h.owner.invalidatePoliticalPathCache("surface-change");
  assert.equal(h.owner.getPoliticalFeaturePathEntry(value, { allowBuild: true }).path.value, "replacement");
  h.path = h.makePath(() => { throw Error("invalid geometry"); });
  const previousContext = { target: "visible-canvas" };
  h.path.context(previousContext);
  assert.equal(h.owner.getPoliticalFeaturePathEntry(item("b").feature, { allowBuild: true }), null);
  assert.equal(h.path.context(), previousContext);
  h.path = null;
  assert.equal(h.owner.getPoliticalFeaturePathEntry(item("c").feature, { allowBuild: true }), null);
  assert.equal(h.counters.politicalPathCacheBuild, 1);
});

test("validated handle avoids repeated cache normalization within one synchronous slice", (t) => {
  let cacheReads = 0;
  let h;
  h = fixture(t, { getRenderPassCacheState: () => { cacheReads += 1; return h.cache; } });
  const handle = h.owner.getPoliticalPathCacheHandle(undefined, { resetIfMismatch: true });
  const readsBefore = cacheReads;
  for (const id of ["a", "b", "c"]) {
    assert.ok(h.owner.getPoliticalFeaturePathEntry(item(id).feature, {
      allowBuild: true, validatedHandle: handle,
    })?.path);
  }
  assert.equal(cacheReads, readsBefore);
  h.state.sceneGeneration = 1;
  const nextHandle = h.owner.getPoliticalPathCacheHandle(undefined, { resetIfMismatch: true });
  assert.notEqual(nextHandle.signature, handle.signature);
  assert.ok(cacheReads > readsBefore);
});

test("deferred warmup scopes counted path builds to one synchronous slice", (t) => {
  const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const factoryStart = rendererSource.indexOf("function getPoliticalBackgroundRenderOwner() {");
  const factoryEnd = rendererSource.indexOf("\nfunction ", factoryStart + 1);
  assert.ok(factoryStart >= 0 && factoryEnd > factoryStart, "political background owner factory exists");
  const factorySource = rendererSource.slice(factoryStart, factoryEnd);
  const scheduleExpression = factorySource.match(/scheduleDeferredWork:\s*([\s\S]*?),\s*invalidateRenderPasses\b/)?.[1];
  assert.ok(scheduleExpression, "scheduler injection expression is present in the owner factory");
  let h;
  let cacheOwner;
  let validations = 0;
  const state = {};
  cacheOwner = createRenderCacheOwner({
    state,
    helpers: {
      ensureRenderPassCacheState: () => {
        validations += 1;
        state.renderPassCache ||= h.cache;
        return state.renderPassCache;
      },
    },
  });
  const scheduleDeferredWork = vm.runInNewContext(`(${scheduleExpression})`, {
    scheduleDeferredWork: (callback, options) => {
      const handle = ++h.serial;
      h.timers.set(handle, { callback, options });
      return handle;
    },
    getRenderCacheOwner: () => cacheOwner,
  });
  h = fixture(t, {
    getRenderPassCacheState: () => cacheOwner.getRenderPassCacheState(),
    incrementPerfCounter: (name) => {
      const cache = cacheOwner.getRenderPassCacheState();
      cache.perfCounters ||= {};
      cache.perfCounters[name] = (cache.perfCounters[name] || 0) + 1;
    },
    scheduleDeferredWork,
  });
  h.candidates = { items: Array.from({ length: 25 }, (_, index) => item(`warm-${index}`)) };

  assert.equal(h.owner.schedulePoliticalPathWarmup(), true);
  validations = 0;
  h.tick();
  assert.equal(validations, 1, "all counted builds in a slice share one cache validation");
  assert.equal(h.cache.perfCounters.politicalPathCacheBuild, 24);
  assert.equal(h.cache.perfCounters.politicalPathWarmupBuild, 24);
  assert.equal(h.cache.perfCounters.politicalPathWarmupSlices, 1);

  validations = 0;
  h.tick();
  assert.equal(validations, 1, "the next deferred slice validates its cache again");
  assert.equal(h.cache.perfCounters.politicalPathCacheBuild, 25);
  assert.equal(h.cache.perfCounters.politicalPathWarmupBuild, 25);
  assert.equal(h.cache.perfCounters.politicalPathWarmupSlices, 2);
});

test("cached paths stream the exact canvas coordinates for decimals, holes, parts and antimeridian clipping", (t) => {
  const h = fixture(t);
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
  const { d3 } = sandbox;
  class RecordingPath {
    constructor(...args) { assert.equal(args.length, 0, "No rounded SVG string may enter Path2D"); this.commands = []; }
    moveTo(...args) { this.commands.push(["moveTo", ...args]); }
    lineTo(...args) { this.commands.push(["lineTo", ...args]); }
    arc(...args) { this.commands.push(["arc", ...args]); }
    closePath(...args) { this.commands.push(["closePath", ...args]); }
  }
  globalThis.Path2D = RecordingPath;
  const projection = d3.geoEqualEarth().scale(123.456789).translate([50.123456789, 60.987654321]).precision(0.3);
  const direct = new RecordingPath();
  h.path = d3.geoPath(projection, direct).pointRadius(1.23456789);
  const geometries = [
    { type: "Polygon", coordinates: [
      [[0.123456789, 0.876543219], [0.1, 3.2], [4.3, 3.2], [4.3, 0.8], [0.123456789, 0.876543219]],
      [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
    ] },
    { type: "MultiPolygon", coordinates: [
      [[[179.1, 10.1], [-179.2, 10.1], [-179.2, 12.3], [179.1, 12.3], [179.1, 10.1]]],
      [[[20.1, 20.2], [20.1, 22.3], [22.4, 22.3], [22.4, 20.2], [20.1, 20.2]]],
    ] },
    { type: "Point", coordinates: [0.123456789, 0.876543219] },
  ];
  for (const [index, geometry] of geometries.entries()) {
    direct.commands = [];
    const feature = { type: "Feature", id: String(index), geometry };
    h.path(feature);
    const entry = h.owner.getPoliticalFeaturePathEntry(feature, { allowBuild: true });
    assert.ok(entry.path.commands.length > 0);
    assert.deepEqual(entry.path.commands, direct.commands);
    assert.equal(h.path.context(), direct);
    assert.equal(h.owner.getPoliticalFeaturePathEntry(feature), entry);
  }
  assert.ok(direct.commands.flat().some((value) => typeof value === "number" && value !== Math.round(value * 1000) / 1000));
});

test("warmup prioritizes viewport center and tie draw order, replaces timers, and cancels atomically", (t) => {
  const h = fixture(t);
  h.candidates.items = [item("far", 100), item("second", 50, 2), item("first", 50, 1)];
  assert.equal(h.owner.schedulePoliticalPathWarmup(), true);
  const previous = h.cache.politicalPathWarmupHandle;
  assert.equal(h.timers.get(previous).options.timeout, 24);
  assert.deepEqual(h.rect, { minX: -96, minY: -96, maxX: 196, maxY: 196 });
  assert.deepEqual(h.cache.politicalPathWarmupQueue.map(({ id }) => id), ["first", "second", "far"]);
  h.owner.schedulePoliticalPathWarmup();
  assert.deepEqual(h.cancelled, [previous]);
  assert.equal(h.timers.size, 1);
  h.owner.invalidatePoliticalPathCache("reset");
  assert.equal(h.timers.size, 0);
  assert.equal(h.cache.politicalPathWarmupHandle, null);
  assert.deepEqual(h.cache.politicalPathWarmupQueue, []);
  assert.equal(h.cache.politicalPathWarmupSignature, "");
  assert.equal(h.cache.politicalPathCacheSignature, "");
  assert.equal(h.cache.politicalPathCacheTransform, null);
  assert.equal(h.counters.politicalPathWarmupCancels, 1);
  h.owner.cancelPoliticalPathWarmup("again");
  assert.equal(h.counters.politicalPathWarmupCancels, 1);
});

test("slices cap work, honor CPU and idle budgets after progress, and finish without another timer", (t) => {
  const h = fixture(t);
  h.candidates.items = Array.from({ length: 30 }, (_, index) => item(String(index), 50 + index));
  h.owner.schedulePoliticalPathWarmup();
  assert.equal(h.tick(), true);
  assert.equal(h.builds.length, 24);
  assert.equal(h.cache.politicalPathWarmupQueue.length, 6);
  assert.equal(h.timers.size, 1);
  h.pathCost = 4;
  h.tick();
  assert.equal(h.builds.length, 25);
  h.pathCost = 0;
  h.tick({ timeRemaining: () => 0 });
  assert.equal(h.builds.length, 26);
  h.tick();
  assert.equal(h.builds.length, 30);
  assert.equal(h.timers.size, 0);
  assert.equal(h.cache.politicalPathWarmupSignature, "");
  assert.equal(h.cache.politicalPathWarmupHandle, null);
  assert.equal(h.counters.politicalPathWarmupSlices, 4);
  assert.equal(h.counters.politicalPathWarmupBuild, 30);
  assert.equal(h.owner.schedulePoliticalPathWarmup(), false);
  assert.equal(h.cache.politicalPathWarmupReason, "warmup-complete");
});

test("queued work rechecks phase, deferred exact work, dirty flags, and signature before building", (t) => {
  const h = fixture(t);
  for (const change of [
    () => { h.state.renderPhase = "drag"; },
    () => { h.state.deferExactAfterSettle = true; },
    () => { h.cache.dirty.political = true; },
  ]) {
    h.state.renderPhase = "idle"; h.state.deferExactAfterSettle = false; h.cache.dirty.political = false;
    h.owner.schedulePoliticalPathWarmup();
    change();
    assert.equal(h.tick(), false);
    assert.equal(h.cache.politicalPathWarmupReason, "warmup-non-idle");
    assert.equal(h.owner.schedulePoliticalPathWarmup(), false);
    assert.equal(h.timers.size, 0);
  }
  h.cache.dirty.political = false;
  h.owner.schedulePoliticalPathWarmup();
  h.state.activeScenarioId = "changed-before-callback";
  assert.equal(h.tick(), false);
  assert.equal(h.cache.politicalPathCacheReason, "warmup-signature-mismatch");
  assert.deepEqual(h.builds, []);
  h.candidates.overflow = true;
  assert.equal(h.owner.schedulePoliticalPathWarmup(), false);
  assert.equal(h.cache.politicalPathWarmupReason, "warmup-spatial-unavailable");
});

test("warmup viewport changes retire only the queue and preserve reusable projected paths", (t) => {
  const h = fixture(t);
  const feature = h.candidates.items[0].feature;
  const entry = h.owner.getPoliticalFeaturePathEntry(feature, { allowBuild: true });
  h.owner.schedulePoliticalPathWarmup();
  h.state.zoomTransform = { k: 4, x: 300, y: -60 };
  assert.equal(h.tick(), false);
  assert.equal(h.cache.politicalPathWarmupReason, "warmup-viewport-changed");
  assert.equal(h.owner.getPoliticalFeaturePathEntry(feature), entry);
  h.owner.schedulePoliticalPathWarmup();
  h.viewport = "resized-DPR2";
  assert.equal(h.tick(), false);
  assert.equal(h.owner.getPoliticalFeaturePathEntry(feature), entry);
});

test("same ID requires the current geometry while wrapper copies preserve cache hits", (t) => {
  const h = fixture(t);
  const original = item("a").feature;
  const cached = h.owner.getPoliticalFeaturePathEntry(original, { allowBuild: true });
  assert.equal(cached.geometryRef, original.geometry);
  assert.equal(h.owner.getPoliticalFeaturePathEntry({ ...original }), cached);
  const replacement = item("a").feature;
  assert.equal(h.owner.getPoliticalFeaturePathEntry(replacement), null);
  assert.equal(h.owner.isPoliticalFeaturePathEntryCurrent({ path: cached.path }, original), false);
  const rebuilt = h.owner.getPoliticalFeaturePathEntry(replacement, { allowBuild: true });
  assert.notEqual(rebuilt.path, cached.path);
  assert.equal(rebuilt.geometryRef, replacement.geometry);
  assert.equal(h.owner.getPoliticalFeaturePathEntry(original), null);
});

test("warmup queues and rebuilds same-ID stale geometry instead of skipping it", (t) => {
  const h = fixture(t);
  const old = item("a").feature;
  h.owner.getPoliticalFeaturePathEntry(old, { allowBuild: true });
  const current = item("a");
  h.candidates.items = [current];
  assert.equal(h.owner.schedulePoliticalPathWarmup(), true);
  assert.equal(h.cache.politicalPathWarmupQueue.length, 1);
  assert.equal(h.tick(), true);
  assert.equal(h.cache.politicalPathCache.get("a").geometryRef, current.feature.geometry);
  assert.equal(h.counters.politicalPathWarmupBuild, 1);
  assert.equal(h.owner.schedulePoliticalPathWarmup(), false);
});
