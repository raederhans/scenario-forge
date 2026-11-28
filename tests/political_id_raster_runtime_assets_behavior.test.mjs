import { createDeferredPromise } from "./helpers/deferred_promise.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterRuntimeOwner } from "../js/core/renderer/political_id_raster_runtime_owner.js";
import { createPoliticalIdRasterCache } from "../js/core/renderer/political_id_raster_cache.js";
import { decodePoliticalIdRasterAsset, encodePoliticalIdRasterAsset } from "../js/core/renderer/political_id_raster_assets.js";

const EDGE_FLAG = 0x80000000;
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function drain(turns = 6) {
  for (let index = 0; index < turns; index += 1) await tick();
}

async function waitFor(predicate, message, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

function feature(id, bounds, color = "#123456") {
  return {
    id,
    bounds,
    color,
    geometry: { type: "Polygon", coordinates: [] },
  };
}

function makeTile(descriptor, { marker = "tile", edge = false } = {}) {
  const codes = new Uint32Array(descriptor.width * descriptor.height).fill(1);
  let edgeIds = new Uint32Array();
  let edgeWeights = new Float32Array();
  if (edge) {
    codes[Math.floor(descriptor.height / 2) * descriptor.width + Math.floor(descriptor.width / 2)] = EDGE_FLAG;
    edgeIds = new Uint32Array([2, 1, 2]);
    edgeWeights = new Float32Array([0, 0.4, 0.6]);
  }
  return {
    marker,
    originX: descriptor.originX,
    originY: descriptor.originY,
    width: descriptor.width,
    height: descriptor.height,
    codes,
    edgeIds,
    edgeWeights,
  };
}

function makeIdentityBuilder() {
  const calls = [];
  return {
    calls,
    getStats() { return {}; },
    dispose() {},
    async identify(input) {
      const { descriptor, entries } = input;
      calls.push({ descriptor: { ...descriptor } });
      return JSON.stringify([input.sceneKey, descriptor.key, entries.map(entry => [entry.id, entry.geometryVersion])]);
    },
  };
}

function makeAssetStore(load) {
  const loads = [];
  const saves = [];
  return {
    loads, saves,
    async load(identity, options = {}) {
      loads.push({ identity, ...options });
      return load(identity, options);
    },
    async save(identity, tile, options = {}) {
      const buffer = encodePoliticalIdRasterAsset(tile, { identity, codeToId: options.codeToId });
      saves.push({ identity, tile, buffer, options });
      return true;
    },
    stats() { return { pendingWrites: 0, failures: 0 }; },
    dispose() {},
  };
}

function makeClient() {
  const requests = [];
  return {
    requests,
    available: () => true,
    dispose() {},
    request(packet) {
      return new Promise(resolve => {
        const request = { packet, resolve };
        requests.push(request);
      });
    },
  };
}

function fixture({
  canonicalCoordinates = true,
  features = [feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 })],
  load = async () => null,
} = {}) {
  const state = { zoomTransform: { x: 200, y: 200, k: 1 }, dpr: 1 };
  const identity = { sceneKey: "scene-a", projectionKey: "projection-a", coverageKey: "coverage-a", version: 1, colorVersion: 0 };
  const client = makeClient();
  const assetStore = makeAssetStore(load);
  const identityBuilder = makeIdentityBuilder();
  const gpu = {
    canvas: {}, isAvailable: () => true, getStats: () => ({}),
    setPalette(bytes) { this.palette = bytes.slice(); },
    setTiles() {}, draw() {}, dispose() {},
  };
  const layout = { pixelWidth: 100, pixelHeight: 100, offsetX: 0, offsetY: 0 };
  const context = {
    save() {},
    restore() {},
    setTransform() {}, drawImage() {},
  };
  const helpers = {
    isEnabled: () => true,
    getFeatures: () => features,
    getFeatureId: (item) => item.id,
    getBounds: (item) => item.bounds,
    resolveColor: (item) => item.color,
    hasStroke: () => true,
    getSourceIdentity: () => ({ ...identity }),
    getLayout: () => layout,
    getAssetSceneKey: () => identity.sceneKey,
  };
  const cache = createPoliticalIdRasterCache();
  const owner = createPoliticalIdRasterRuntimeOwner({
    state,
    effects: { requestRender() {}, recordMetric() {} },
    surface: { getProjection: () => ({}), getContext: () => context },
    helpers,
    client,
    cache,
    createGpu: () => gpu,
    assetStore,
    identityBuilder,
    canonicalCoordinates,
  });
  return {
    owner,
    identity, features,
    requests: client.requests,
    assetStore,
    identityBuilder,
    cache,
    gpu,
  };
}

async function settleOneWorker(f, options = {}) {
  await drain();
  assert.equal(f.requests.length, 1, "one worker request should be pending");
  const request = f.requests[0];
  request.resolve(makeTile(request.packet, options));
  await drain();
}

test("asset I/O maps only tile contributors while preserving edge IDs and global palette codes", async t => {
  const f = fixture({ canonicalCoordinates: false, features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
    feature("edge-only", { minX: 2, minY: -160, maxX: 3, maxY: -140 }),
    feature("distant", { minX: 10000, minY: 10000, maxX: 10010, maxY: 10010 }),
  ] });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  await settleOneWorker(f, { edge: true });
  assert.ok(f.owner.draw());
  await waitFor(() => f.assetStore.saves.length === 1, "published coverage persists in a later task");
  const saved = f.assetStore.saves[0];
  assert.deepEqual([...saved.options.codeToId], [[1, "stable-a"], [2, "edge-only"]]);
  const remapped = decodePoliticalIdRasterAsset(saved.buffer, {
    identity: saved.identity, idToCode: new Map([["stable-a", 17], ["edge-only", 29]]),
  });
  assert.deepEqual([...remapped.edgeIds], [2, 17, 29]);
  assert.deepEqual([...remapped.edgeWeights], [...saved.tile.edgeWeights]);
});

test("a late asset tile is rejected after geometry changes while the new request proceeds", async (t) => {
  const oldLoad = createDeferredPromise();
  let loadCount = 0;
  const f = fixture({ load: async (_identity, options) => {
    loadCount += 1;
    if (loadCount === 1) {
      fFirstLoadSignal = options.signal;
      return oldLoad.promise;
    }
    return null;
  } });
  let fFirstLoadSignal = null;
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await drain();
  assert.equal(f.assetStore.loads.length, 1);
  const oldDescriptor = f.identityBuilder.calls[0].descriptor;
  const oldTile = makeTile(oldDescriptor, { marker: "stale-asset" });

  const edited = f.features[0];
  edited.geometry = { type: "Polygon", coordinates: [[[-155, -155], [-145, -155], [-150, -145], [-155, -155]]] };
  edited.bounds = { minX: -155, minY: -155, maxX: -145, maxY: -145 };
  f.identity.version += 1;
  f.owner.draw();
  await drain();

  assert.equal(fFirstLoadSignal.aborted, true);
  assert.equal(f.assetStore.loads.length, 2);
  assert.equal(f.requests.length, 1, "the latest geometry falls through to a worker build");
  oldLoad.resolve(oldTile);
  await drain();
  assert.equal(f.cache.peek(oldDescriptor.key), undefined, "the old asset result is never cached");

  const request = f.requests[0];
  request.resolve(makeTile(request.packet, { marker: "latest-worker" }));
  await drain();
  assert.equal(f.cache.peek(request.packet.key)?.marker, "latest-worker");
});

test("an asset read failure falls back to worker without failing the owner", async (t) => {
  const f = fixture({ load: async () => { throw new Error("asset store unavailable"); } });
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await drain();
  assert.equal(f.assetStore.loads.length, 1);
  assert.equal(f.requests.length, 1);
  assert.match(f.owner.getDiagnostics().assetError, /asset store unavailable/);
  assert.equal(f.owner.getDiagnostics().failed, "");

  await settleOneWorker(f, { marker: "fallback-worker" });
  assert.equal(f.owner.getDiagnostics().failed, "");
  assert.ok(f.owner.draw());
});

test("the next commit uses the edited palette", async (t) => {
  const f = fixture({ features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
    feature("stable-b", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
  ] });
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await settleOneWorker(f, { marker: "palette-tile", edge: true });
  assert.ok(f.owner.draw());

  f.features[0].color = "#abcdef";
  f.identity.colorVersion += 1;
  assert.ok(f.owner.draw());

  assert.deepEqual([...f.gpu.palette.slice(4, 8)], [171, 205, 239, 255]);
});
