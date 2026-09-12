import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchBorderMeshCacheState,
  clearSphericalFeatureDiagnosticsCacheState,
  commitProjectedBoundsCacheState,
  clearProjectedBoundsCacheEntriesState,
  setProjectedBoundsCacheEntryState,
  syncProjectedBoundsCacheEntryState,
  commitRenderPassCacheState,
  getSphericalFeatureDiagnosticsCacheEntryState,
  appendPreparedCountryBorderMeshesState,
  replaceCachedCoastlineMeshesState,
  replaceCachedDetailAdmBordersState,
  setDynamicBordersDirtyState,
  setPendingDynamicBorderTimerState,
  setSphericalFeatureDiagnosticsCacheEntryState,
} from "../js/core/state/actions/renderer_cache_actions.js";
import {
  createDefaultRenderPassCacheState,
  ensureRenderPassCacheState,
} from "../js/core/state/renderer_runtime_state.js";

test("renderer cache actions stay import-free with target-first exports", async () => {
  const source = await readFile(
    new URL("../js/core/state/actions/renderer_cache_actions.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /^\s*import\s/m);
  for (const name of [
    "commitRenderPassCacheState",
    "commitProjectedBoundsCacheState",
    "clearSphericalFeatureDiagnosticsCacheState",
    "getSphericalFeatureDiagnosticsCacheEntryState",
    "replaceCachedDetailAdmBordersState",
    "replaceCachedCoastlineMeshesState",
    "setDynamicBordersDirtyState",
    "setPendingDynamicBorderTimerState",
    "setSphericalFeatureDiagnosticsCacheEntryState",
  ]) {
    assert.match(source, new RegExp(`export function ${name}\\(\\s*target[,)]`));
  }
  assert.doesNotMatch(source, /ensureRenderPassCacheState/);
});

test("coastline publication retains all prepared containers and geometry identities", () => {
  const geometry = Object.freeze({ type: "MultiLineString", coordinates: Object.freeze([]) });
  const high = Object.freeze([geometry]);
  const mid = Object.freeze([geometry]);
  const collections = Object.freeze({
    cachedCoastlines: high, cachedCoastlinesHigh: high,
    cachedCoastlinesMid: mid, cachedCoastlinesLow: mid,
  });
  const unrelated = {};
  const state = { unrelated };
  replaceCachedCoastlineMeshesState(state, collections);
  for (const key of Object.keys(collections)) assert.equal(state[key], collections[key]);
  assert.equal(state.cachedCoastlines[0], geometry);
  assert.equal(state.unrelated, unrelated);
  assert.deepEqual(Object.keys(state).sort(), ["unrelated", ...Object.keys(collections)].sort());
});

test("border cache patch publishes only explicit owned fields without copying values", () => {
  const mesh = Object.freeze({ coordinates: Object.freeze([]) });
  const target = { unrelated: "keep", cachedFrontlineMeshHash: "old" };
  const patch = Object.assign(Object.create({ cachedBorders: "inherited" }), {
    cachedDynamicOwnerBorders: mesh, cachedDynamicBordersHash: undefined,
    cachedScenarioOpeningOwnerBorders: null, cachedFrontlineMesh: mesh,
    unrelated: "replace",
  });
  patchBorderMeshCacheState(target, patch);
  assert.deepEqual(target, {
    unrelated: "keep", cachedFrontlineMeshHash: "old",
    cachedDynamicOwnerBorders: mesh, cachedDynamicBordersHash: undefined,
    cachedScenarioOpeningOwnerBorders: null, cachedFrontlineMesh: mesh,
  });
  assert.equal(target.cachedDynamicOwnerBorders, mesh);
  assert.equal(Object.hasOwn(target, "cachedBorders"), false);
});

test("border lifecycle actions preserve prepared values and cache identity", () => {
  const target = {};
  const meshes = [{ coordinates: [[0, 0], [1, 1]] }];

  assert.equal(setDynamicBordersDirtyState(target, true, "owner-edit"), true);
  assert.equal(target.dynamicBordersDirty, true);
  assert.equal(target.dynamicBordersDirtyReason, "owner-edit");
  assert.equal(setDynamicBordersDirtyState(target, false, ""), false);
  assert.equal(target.dynamicBordersDirty, false);
  assert.equal(target.dynamicBordersDirtyReason, "");

  for (const handle of [0, null, undefined]) {
    assert.equal(setPendingDynamicBorderTimerState(target, handle), handle);
    assert.equal(target.pendingDynamicBorderTimerId, handle);
  }

  assert.equal(replaceCachedDetailAdmBordersState(target, meshes), meshes);
  assert.equal(target.cachedDetailAdmBorders, meshes);
});

test("prepared country border batches preserve cache identity and publish empty countries", () => {
  const provinceMap = new Map();
  const localMap = new Map();
  const provinces = [];
  const locals = [];
  const target = {
    cachedProvinceBordersByCountry: provinceMap,
    cachedLocalBordersByCountry: localMap,
    cachedProvinceBorders: provinces,
    cachedLocalBorders: locals,
  };
  const mesh = Object.freeze({ coordinates: Object.freeze([[0, 0], [1, 1]]) });
  const provinceEntries = Object.freeze([
    Object.freeze({ country: "AA", meshes: Object.freeze([mesh]) }),
    Object.freeze({ country: "EMPTY", meshes: Object.freeze([]) }),
  ]);
  const localEntries = Object.freeze([Object.freeze({ country: "AA", meshes: Object.freeze([mesh]) })]);
  assert.equal(appendPreparedCountryBorderMeshesState(target, provinceEntries, localEntries, { syncGridLines: true }), true);
  assert.equal(target.cachedProvinceBordersByCountry, provinceMap);
  assert.equal(target.cachedLocalBordersByCountry, localMap);
  assert.equal(target.cachedProvinceBorders, provinces);
  assert.equal(target.cachedLocalBorders, locals);
  assert.deepEqual(provinceMap.get("EMPTY"), []);
  assert.notEqual(provinceMap.get("AA"), provinceEntries[0].meshes);
  assert.notEqual(localMap.get("AA"), localEntries[0].meshes);
  assert.equal(provinceMap.get("AA")[0], mesh);
  assert.equal(localMap.get("AA")[0], mesh);
  assert.deepEqual(target.cachedGridLines, locals);
  assert.notEqual(target.cachedGridLines, locals);
  assert.equal(appendPreparedCountryBorderMeshesState(target, [], []), false);
  assert.deepEqual(provinces, [mesh]);
  assert.deepEqual(locals, [mesh]);
});

test("cache actions reject invalid targets", () => {
  for (const target of [null, undefined, [], "state"]) {
    assert.throws(() => commitRenderPassCacheState(target, {}), /target must be an object/);
    assert.throws(() => commitProjectedBoundsCacheState(target, {
      projectedBoundsById: new Map(),
      sphericalFeatureDiagnosticsById: new Map(),
    }), /target must be an object/);
    assert.throws(() => clearSphericalFeatureDiagnosticsCacheState(target), /target must be an object/);
    assert.throws(() => getSphericalFeatureDiagnosticsCacheEntryState(target, "A"), /target must be an object/);
    assert.throws(() => replaceCachedDetailAdmBordersState(target, []), /target must be an object/);
    assert.throws(() => setDynamicBordersDirtyState(target, false, ""), /target must be an object/);
    assert.throws(() => setPendingDynamicBorderTimerState(target, null), /target must be an object/);
    assert.throws(() => setSphericalFeatureDiagnosticsCacheEntryState(target, "A", {}), /target must be an object/);
  }
});

test("render pass cache commit preserves the prepared holder identity", () => {
  const target = {};
  const cache = { counters: { frames: 7 }, canvases: {} };
  assert.equal(commitRenderPassCacheState(target, cache), true);
  assert.equal(target.renderPassCache, cache);
});

test("runtime compatibility helper prepares before committing", () => {
  const original = createDefaultRenderPassCacheState();
  original.politicalPathCacheTransform = { x: 1, y: 2, k: 3 };
  delete original.dirty.background;
  const target = { renderPassCache: original };

  assert.throws(() => ensureRenderPassCacheState(target, {
    renderPassNames: ["background"],
    cloneZoomTransform() {
      throw new Error("clone failed");
    },
  }), /clone failed/);
  assert.equal(target.renderPassCache, original);
  assert.deepEqual(original.politicalPathCacheTransform, { x: 1, y: 2, k: 3 });
  assert.equal("background" in original.dirty, false);
});

test("projected bounds cache commit installs both exact Map identities", () => {
  const target = {};
  const projectedBoundsById = new Map([["A", { minX: 1 }]]);
  const sphericalFeatureDiagnosticsById = new Map([["A", null]]);
  assert.equal(commitProjectedBoundsCacheState(target, {
    projectedBoundsById,
    sphericalFeatureDiagnosticsById,
  }), true);
  assert.equal(target.projectedBoundsById, projectedBoundsById);
  assert.equal(target.sphericalFeatureDiagnosticsById, sphericalFeatureDiagnosticsById);
});

test("projected bounds cache commit validates both holders before writing", () => {
  const originalProjectedBounds = new Map([["old", { minX: 1 }]]);
  const originalDiagnostics = new Map([["old", null]]);
  const target = {
    projectedBoundsById: originalProjectedBounds,
  };
  Object.defineProperty(target, "sphericalFeatureDiagnosticsById", {
    configurable: false,
    enumerable: true,
    value: originalDiagnostics,
    writable: false,
  });

  assert.throws(
    () => commitProjectedBoundsCacheState(target, {
      projectedBoundsById: new Map([["new", { minX: 2 }]]),
      sphericalFeatureDiagnosticsById: new Map([["new", null]]),
    }),
    /sphericalFeatureDiagnosticsById must be writable/,
  );
  assert.equal(target.projectedBoundsById, originalProjectedBounds);
  assert.equal(target.sphericalFeatureDiagnosticsById, originalDiagnostics);
});

test("projected bounds entry actions mutate only the current shared Map and preserve bounds identity", () => {
  const oldCache = new Map();
  const target = { projectedBoundsById: oldCache, sphericalFeatureDiagnosticsById: new Map([["diagnostic", 1]]) };
  const bounds = Object.freeze({ minX: 3 });
  setProjectedBoundsCacheEntryState(target, "A", bounds);
  assert.equal(oldCache.get("A"), bounds);
  const nextCache = new Map([["B", bounds]]);
  target.projectedBoundsById = nextCache;
  setProjectedBoundsCacheEntryState(target, "C", bounds);
  syncProjectedBoundsCacheEntryState(target, "B", null);
  assert.deepEqual([...nextCache.keys()], ["C"]);
  clearProjectedBoundsCacheEntriesState(target);
  assert.equal(target.projectedBoundsById, nextCache);
  assert.equal(nextCache.size, 0);
  assert.equal(oldCache.get("A"), bounds);
  assert.equal(target.sphericalFeatureDiagnosticsById.get("diagnostic"), 1);
});

test("projected bounds entry actions reject missing holders without initializing or replacing them", () => {
  for (const mutate of [setProjectedBoundsCacheEntryState, syncProjectedBoundsCacheEntryState, clearProjectedBoundsCacheEntriesState]) {
    assert.throws(() => mutate(null, "A", {}), /target must be an object/);
    const target = {};
    assert.throws(() => mutate(target, "A", {}), /projectedBoundsById must be a Map/);
    assert.equal(Object.hasOwn(target, "projectedBoundsById"), false);
  }
});

test("projected bounds synchronization avoids redundant publication but rebuild setters remain unconditional", () => {
  const operations = [];
  class RecordingMap extends Map {
    set(key, value) { operations.push(["set", key]); return super.set(key, value); }
    delete(key) { operations.push(["delete", key]); return super.delete(key); }
  }
  const bounds = Object.freeze({ minX: 1 });
  const target = { projectedBoundsById: new RecordingMap() };
  syncProjectedBoundsCacheEntryState(target, "A", bounds);
  syncProjectedBoundsCacheEntryState(target, "A", bounds);
  assert.deepEqual(operations, [["set", "A"]]);
  setProjectedBoundsCacheEntryState(target, "A", bounds);
  syncProjectedBoundsCacheEntryState(target, "A", null);
  assert.deepEqual(operations, [["set", "A"], ["set", "A"], ["delete", "A"]]);
  assert.equal(target.projectedBoundsById.has("A"), false);
});

test("cache commits preserve existing own property descriptors", () => {
  const target = {};
  const originalRenderPassCache = { original: true };
  const originalProjectedBounds = new Map();
  const originalDiagnostics = new Map();
  Object.defineProperties(target, {
    renderPassCache: {
      configurable: false,
      enumerable: false,
      value: originalRenderPassCache,
      writable: true,
    },
    projectedBoundsById: {
      configurable: false,
      enumerable: false,
      value: originalProjectedBounds,
      writable: true,
    },
    sphericalFeatureDiagnosticsById: {
      configurable: false,
      enumerable: false,
      value: originalDiagnostics,
      writable: true,
    },
  });
  const nextRenderPassCache = { next: true };
  const nextProjectedBounds = new Map([["A", {}]]);
  const nextDiagnostics = new Map([["A", null]]);

  assert.equal(commitRenderPassCacheState(target, nextRenderPassCache), true);
  assert.equal(commitProjectedBoundsCacheState(target, {
    projectedBoundsById: nextProjectedBounds,
    sphericalFeatureDiagnosticsById: nextDiagnostics,
  }), true);
  assert.equal(target.renderPassCache, nextRenderPassCache);
  assert.equal(target.projectedBoundsById, nextProjectedBounds);
  assert.equal(target.sphericalFeatureDiagnosticsById, nextDiagnostics);
  for (const fieldName of [
    "renderPassCache",
    "projectedBoundsById",
    "sphericalFeatureDiagnosticsById",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
    assert.equal(descriptor.configurable, false);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
  }
});

test("plain spherical diagnostics cache entries are immutable and reuse one hot-path reference", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };
  const diagnostics = {
    area: 7,
    bounds: [[-10, -5], [10, 5]],
    invalid: false,
  };

  assert.equal(
    setSphericalFeatureDiagnosticsCacheEntryState(target, "B", diagnostics),
    true,
  );
  diagnostics.bounds[0][0] = 999;

  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "B");
  assert.deepEqual(firstRead, {
    area: 7,
    bounds: [[-10, -5], [10, 5]],
    invalid: false,
  });
  assert.equal(Object.isFrozen(firstRead), true);
  assert.equal(Object.isFrozen(firstRead.bounds), true);
  assert.equal(Object.isFrozen(firstRead.bounds[0]), true);
  assert.throws(() => {
    firstRead.bounds[1][1] = 999;
  }, TypeError);
  assert.equal(
    getSphericalFeatureDiagnosticsCacheEntryState(target, "B"),
    firstRead,
  );
  assert.equal(getSphericalFeatureDiagnosticsCacheEntryState(target, "missing"), null);

  assert.equal(clearSphericalFeatureDiagnosticsCacheState(target), true);
  assert.equal(target.sphericalFeatureDiagnosticsById.size, 0);
});

test("plain cyclic diagnostics freeze recursively and keep cycle identity", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };
  const diagnostics = { nested: { count: 1 } };
  diagnostics.self = diagnostics;

  setSphericalFeatureDiagnosticsCacheEntryState(target, "cycle", diagnostics);
  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "cycle");
  const secondRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "cycle");

  assert.equal(firstRead, secondRead);
  assert.equal(firstRead.self, firstRead);
  assert.equal(Object.isFrozen(firstRead), true);
  assert.equal(Object.isFrozen(firstRead.nested), true);
  assert.throws(() => {
    firstRead.nested.count = 2;
  }, TypeError);
});

test("spherical diagnostics cache keys use stable string semantics", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };

  setSphericalFeatureDiagnosticsCacheEntryState(target, 7, { label: "numeric" });
  setSphericalFeatureDiagnosticsCacheEntryState(target, "", { label: "empty" });
  setSphericalFeatureDiagnosticsCacheEntryState(target, null, { label: "null" });

  assert.deepEqual(getSphericalFeatureDiagnosticsCacheEntryState(target, "7"), { label: "numeric" });
  assert.deepEqual(getSphericalFeatureDiagnosticsCacheEntryState(target, ""), { label: "empty" });
  assert.deepEqual(getSphericalFeatureDiagnosticsCacheEntryState(target, null), { label: "null" });
});

test("spherical diagnostics cache keeps rich mutable collections detached", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };
  const diagnostics = {
    reasons: new Map([["unsafe", { count: 1 }]]),
    tags: new Set(["world-bounds"]),
  };
  diagnostics.self = diagnostics;

  setSphericalFeatureDiagnosticsCacheEntryState(target, "cyclic", diagnostics);
  diagnostics.reasons.get("unsafe").count = 99;
  diagnostics.tags.add("mutated");

  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "cyclic");
  assert.equal(firstRead.self, firstRead);
  assert.deepEqual(firstRead.reasons, new Map([["unsafe", { count: 1 }]]));
  assert.deepEqual(firstRead.tags, new Set(["world-bounds"]));

  firstRead.reasons.get("unsafe").count = 77;
  const secondRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "cyclic");
  assert.equal(secondRead.reasons.get("unsafe").count, 1);
});

test("typed arrays and array buffers stay detached on every cache read", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };
  setSphericalFeatureDiagnosticsCacheEntryState(target, "typed", {
    bytes: new Uint8Array([1, 2, 3]),
    buffer: new Uint8Array([4, 5, 6]).buffer,
  });

  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "typed");
  const secondRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "typed");
  assert.notEqual(firstRead, secondRead);
  assert.notEqual(firstRead.bytes, secondRead.bytes);
  assert.notEqual(firstRead.buffer, secondRead.buffer);

  firstRead.bytes[0] = 99;
  new Uint8Array(firstRead.buffer)[0] = 88;
  const thirdRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "typed");
  assert.deepEqual([...thirdRead.bytes], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(thirdRead.buffer)], [4, 5, 6]);
});

test("custom prototype values and independent writes never inherit shareable trust", () => {
  class DiagnosticRecord {
    constructor(value) {
      this.value = value;
    }
  }

  const firstTarget = { sphericalFeatureDiagnosticsById: new Map() };
  const secondTarget = { sphericalFeatureDiagnosticsById: new Map() };
  const diagnostics = { record: new DiagnosticRecord(7), nested: { count: 1 } };
  setSphericalFeatureDiagnosticsCacheEntryState(firstTarget, "custom", diagnostics);
  setSphericalFeatureDiagnosticsCacheEntryState(secondTarget, "custom", diagnostics);

  diagnostics.nested.count = 99;
  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(firstTarget, "custom");
  const firstReadAgain = getSphericalFeatureDiagnosticsCacheEntryState(firstTarget, "custom");
  const secondRead = getSphericalFeatureDiagnosticsCacheEntryState(secondTarget, "custom");
  assert.notEqual(firstRead, firstReadAgain);
  assert.notEqual(firstRead, secondRead);
  assert.equal(firstRead.nested.count, 1);
  assert.equal(secondRead.nested.count, 1);
});

test("accessor shape changes cannot mark a rich detached clone as shareable", () => {
  const target = { sphericalFeatureDiagnosticsById: new Map() };
  let reads = 0;
  const diagnostics = {};
  Object.defineProperty(diagnostics, "payload", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1
        ? { count: 1 }
        : new Map([["count", 1]]);
    },
  });

  setSphericalFeatureDiagnosticsCacheEntryState(target, "accessor", diagnostics);
  const firstRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "accessor");
  const secondRead = getSphericalFeatureDiagnosticsCacheEntryState(target, "accessor");
  assert.notEqual(firstRead, secondRead);
  assert.equal(firstRead.payload instanceof Map, true);
  firstRead.payload.set("count", 99);
  assert.equal(
    getSphericalFeatureDiagnosticsCacheEntryState(target, "accessor").payload.get("count"),
    1,
  );
});

test("cache actions reject malformed prepared holders", () => {
  const target = {};
  for (const invalid of [null, [], "cache"]) {
    assert.throws(() => commitRenderPassCacheState(target, invalid), /renderPassCache must be an object/);
  }
  assert.throws(() => commitProjectedBoundsCacheState(target, {
    projectedBoundsById: {},
    sphericalFeatureDiagnosticsById: new Map(),
  }), /projectedBoundsById must be a Map/);
  assert.throws(() => clearSphericalFeatureDiagnosticsCacheState(target), /sphericalFeatureDiagnosticsById must be a Map/);
  assert.throws(() => getSphericalFeatureDiagnosticsCacheEntryState(target, "A"), /sphericalFeatureDiagnosticsById must be a Map/);
  assert.throws(() => setSphericalFeatureDiagnosticsCacheEntryState(target, "A", {}), /sphericalFeatureDiagnosticsById must be a Map/);
});
