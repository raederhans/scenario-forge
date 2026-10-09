import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterRuntimeOwner } from "../js/core/renderer/political_id_raster_runtime_owner.js";
import { createPoliticalIdRasterCache, planPoliticalIdRasterView } from "../js/core/renderer/political_id_raster_cache.js";
import { createPoliticalIdRasterAssetStore, decodePoliticalIdRasterAsset, encodePoliticalIdRasterAsset } from "../js/core/renderer/political_id_raster_assets.js";

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    stats: { buildMs: 3, pathBuilds: 2, pathCacheHits: 1, pathCacheEstimatedBytes: 128 },
  };
}

function makeIdentityBuilder() {
  const calls = [];
  let disposed = false;
  return {
    calls,
    async identify(input) {
      const record = {
        sceneKey: input.sceneKey,
        descriptor: { ...input.descriptor },
        projectionOptions: structuredClone(input.projectionOptions),
        entries: input.entries.map(({ id, geometryVersion, strokeCode }) => ({ id, geometryVersion, strokeCode })),
        strokeWidth: input.strokeWidth,
        gutter: input.gutter,
      };
      calls.push(record);
      return `asset:${JSON.stringify([
        record.sceneKey,
        record.descriptor.key,
        record.projectionOptions,
        record.entries.map(({ id, geometryVersion, strokeCode }) => [id, geometryVersion, strokeCode]),
        record.strokeWidth,
        record.gutter,
      ])}`;
    },
    getStats() { return { identityHashes: calls.length, cacheHits: 0 }; },
    dispose() { disposed = true; },
    get disposed() { return disposed; },
  };
}

function makeAssetStore(load = async () => null) {
  const loads = [];
  const saves = [];
  const buffers = new Map();
  const counts = { pendingBytes: 0, pendingReads: 0, pendingWrites: 0, memoryBytes: 0, disposed: false };
  let loadImpl = load;
  const store = {
    loads,
    saves,
    buffers,
    setLoad(next) { loadImpl = next; },
    async registerManifest() { return 0; },
    async load(identity, options = {}) {
      loads.push({ identity, ...options });
      counts.pendingReads += 1;
      try { return await loadImpl(identity, options); }
      finally { counts.pendingReads -= 1; }
    },
    async save(identity, tile, options = {}) {
      counts.pendingWrites += 1;
      let buffer;
      try {
        buffer = encodePoliticalIdRasterAsset(tile, { identity, codeToId: options.codeToId });
        counts.pendingBytes += buffer.byteLength;
        buffers.set(identity, buffer.slice(0));
        saves.push({ identity, tile, buffer: buffer.slice(0), options });
        counts.memoryBytes += buffer.byteLength;
        return true;
      } finally {
        if (buffer) counts.pendingBytes -= buffer.byteLength;
        counts.pendingWrites -= 1;
      }
    },
    stats() { return { ...counts, memoryEntries: buffers.size, failures: 0, misses: 0 }; },
    dispose() { counts.disposed = true; },
  };
  return store;
}

function makeClient() {
  const requests = [];
  let disposed = false;
  return {
    requests,
    available: () => !disposed,
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    request(packet, { signal } = {}) {
      return new Promise((resolve, reject) => {
        const request = {
          packet,
          signal,
          settled: false,
          resolve(tile) { this.settled = true; resolve(tile); },
          reject(error) { this.settled = true; reject(error); },
        };
        signal?.addEventListener("abort", () => {
          request.aborted = true;
          if (!request.settled) request.reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        requests.push(request);
      });
    },
  };
}

function makeGpuFactory() {
  const instances = [];
  return {
    instances,
    createGpu({ onContextLost }) {
      const gpu = {
        canvas: { index: instances.length },
        available: true,
        disposed: false,
        palettes: [],
        tileSets: [],
        draws: [],
        isAvailable() { return this.available && !this.disposed; },
        setPalette(bytes, revision) { this.palettes.push({ bytes: bytes.slice(), revision }); },
        setTiles(tiles) { this.tileSets.push([...tiles]); },
        draw(plan) { this.draws.push(plan); },
        getStats() {
          return {
            gpuTextureBytes: this.tileSets.at(-1)?.reduce((sum, tile) => sum + tile.codes.byteLength, 0) || 0,
            outputSurfaceBytesEstimate: (this.draws.at(-1)?.width || 0) * (this.draws.at(-1)?.height || 0) * 4,
          };
        },
        loseContextForValidation() { this.available = false; onContextLost(); },
        dispose() { this.disposed = true; },
      };
      instances.push(gpu);
      return gpu;
    },
  };
}

function makeProjection(mode) {
  if (mode !== "canonical") return {};
  return {
    scale: () => 512,
    translate: () => [20, -40],
    center: () => [0, 0],
    rotate: () => [0, 0, 0],
    angle: () => 0,
    reflectX: () => false,
    reflectY: () => false,
    precision: () => 0.7,
    clipAngle: () => null,
    clipExtent: () => null,
  };
}

function fixture({
  projectionMode = "empty",
  canonicalCoordinates = true,
  features = [feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 })],
  transform = { x: 200, y: 200, k: 1 },
  width = 100,
  height = 100,
  assetTimeoutMs = 1500,
  load = async () => null,
  assetStore: injectedAssetStore = null,
} = {}) {
  const state = { zoomTransform: { ...transform }, dpr: 1 };
  const identity = { sceneKey: "scene-a", projectionKey: "projection-a", coverageKey: "coverage-a", version: 1, colorVersion: 0 };
  let activeFeatures = features;
  const client = makeClient();
  const assetStore = injectedAssetStore || makeAssetStore(load);
  const identityBuilder = makeIdentityBuilder();
  const gpuFactory = makeGpuFactory();
  const metrics = [];
  const renders = [];
  const blits = [];
  let manifestUrlReads = 0;
  const layout = { pixelWidth: width, pixelHeight: height, offsetX: 0, offsetY: 0 };
  const context = {
    save() {},
    restore() {},
    setTransform() {},
    drawImage(image, ...args) { blits.push({ image, args }); },
  };
  const helpers = {
    isEnabled: () => true,
    getFeatures: () => activeFeatures,
    getFeatureId: (item) => item.id,
    getBounds: (item) => item.bounds,
    resolveColor: (item) => item.color,
    hasStroke: () => true,
    getSourceIdentity: () => ({ ...identity }),
    getLayout: () => layout,
    getAssetSceneKey: () => identity.sceneKey,
    getAssetManifestUrl: () => { manifestUrlReads += 1; return null; },
  };
  const cache = createPoliticalIdRasterCache();
  const owner = createPoliticalIdRasterRuntimeOwner({
    state,
    surface: { getProjection: () => makeProjection(projectionMode), getContext: () => context },
    helpers,
    effects: {
      recordMetric: (...args) => metrics.push(args),
      requestRender: (reason) => renders.push(reason),
    },
    client,
    cache,
    createGpu: gpuFactory.createGpu,
    assetStore,
    identityBuilder,
    canonicalCoordinates,
    assetTimeoutMs,
  });
  return {
    owner,
    state,
    identity,
    get features() { return activeFeatures; },
    setFeatures(value) { activeFeatures = value; },
    helpers,
    client,
    requests: client.requests,
    assetStore,
    identityBuilder,
    cache,
    gpus: gpuFactory.instances,
    metrics,
    renders,
    blits,
    get manifestUrlReads() { return manifestUrlReads; },
  };
}

async function settleOneWorker(f, options = {}) {
  await drain();
  assert.equal(f.requests.length, 1, "one worker request should be pending");
  const request = f.requests[0];
  request.resolve(makeTile(request.packet, options));
  await drain();
  return request;
}

test("an asset hit commits from CPU data without invoking the worker", async (t) => {
  const f = fixture({ projectionMode: "canonical", features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
  ] });
  f.assetStore.setLoad(async (_identity, { idToCode }) => {
    assert.equal(idToCode.get("stable-a"), 1);
    return makeTile(f.identityBuilder.calls.at(-1).descriptor, { marker: "asset" });
  });
  t.after(() => f.owner.dispose());

  assert.equal(f.owner.draw(), null);
  await drain();
  assert.equal(f.requests.length, 0);
  assert.equal(f.assetStore.loads.length, 1);
  assert.equal(f.owner.getDiagnostics().assetHits, 1);
  assert.equal(f.owner.getDiagnostics().canonicalCoordinates, true);
  assert.equal(f.identityBuilder.calls[0].projectionOptions.scale, 256);
  assert.deepEqual(f.identityBuilder.calls[0].projectionOptions.translate, [0, 0]);

  assert.ok(f.owner.draw());
  const hit = f.owner.queryPoint({ x: -150, y: -150 });
  assert.deepEqual(hit, { kind: "interior", ids: ["stable-a"], primaryId: "stable-a" });
  assert.equal(f.gpus[0].draws.length, 1);
  assert.equal(f.metrics.at(-1)[0], "politicalIdRasterCommit");
});

test("an asset miss builds with the worker, saves stable IDs, and exported bytes remap on readback", async (t) => {
  const f = fixture({ projectionMode: "canonical", features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
    feature("stable-b", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
  ] });
  t.after(() => f.owner.dispose());

  assert.equal(f.owner.draw(), null);
  await drain();
  assert.equal(f.assetStore.loads.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].packet.projectionOptions.scale, 256);
  assert.deepEqual(f.requests[0].packet.projectionOptions.translate, [0, 0]);

  const request = await settleOneWorker(f, { marker: "worker-built", edge: true });
  assert.equal(f.owner.getPendingWorkCount(), 0);
  assert.equal(f.assetStore.saves.length, 1);
  assert.equal(f.assetStore.loads[0].identity, f.assetStore.saves[0].identity);
  assert.equal(f.owner.getDiagnostics().builds, 1);
  assert.equal(f.owner.getDiagnostics().failed, "");
  assert.ok(f.owner.draw());

  const exports = await f.owner.exportAssets();
  assert.equal(exports.length, 1);
  assert.equal(exports[0].identity, f.assetStore.saves[0].identity);
  const remapped = decodePoliticalIdRasterAsset(exports[0].buffer, {
    identity: exports[0].identity,
    idToCode: new Map([["stable-a", 7], ["stable-b", 9]]),
  });
  assert.equal(remapped.codes[0], 7);
  const edgeIndex = Math.floor(request.packet.height / 2) * request.packet.width + Math.floor(request.packet.width / 2);
  assert.equal(remapped.codes[edgeIndex], EDGE_FLAG);
  assert.deepEqual([...remapped.edgeIds], [2, 7, 9]);
  assert.equal(remapped.edgeWeights[0], 0);
  assert.ok(Math.abs(remapped.edgeWeights[1] - 0.4) < 1e-6);
  assert.ok(Math.abs(remapped.edgeWeights[2] - 0.6) < 1e-6);
});

for (const mismatch of ["size", "origin"]) {
  test(`a validly encoded asset with wrong ${mismatch} rebuilds and repairs the cached region`, async (t) => {
    let f, repaired;
    const assetStore = createPoliticalIdRasterAssetStore({
      indexedDB: null,
      backend: {
        async read(identity) {
          const descriptor = f.identityBuilder.calls.at(-1).descriptor;
          const wrongRegion = mismatch === "size" ? { ...descriptor, width: 1, height: 1 }
            : { ...descriptor, originX: descriptor.originX + 512 };
          return encodePoliticalIdRasterAsset(makeTile(wrongRegion), {
            identity, codeToId: new Map([[1, "stable-a"]]),
          });
        },
        async writeBounded(entry) { repaired = entry; return true; },
        close() {},
      },
    });
    f = fixture({ assetStore });
    t.after(() => f.owner.dispose());
    assert.equal(f.owner.draw(), null);
    const request = await settleOneWorker(f);
    assert.equal(assetStore.stats().indexedDBHits, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.owner.getDiagnostics().failed, "");
    assert.match(f.owner.getDiagnostics().assetError, /requested region/);
    assert.equal(f.owner.getDiagnostics().assetHits, 0);
    assert.equal(f.owner.getDiagnostics().builds, 1);
    assert.ok(f.owner.draw());
    const tile = decodePoliticalIdRasterAsset(repaired.payload, {
      identity: repaired.identity, idToCode: new Map([["stable-a", 1]]),
    });
    assert.deepEqual([tile.width, tile.height, tile.originX, tile.originY],
      [request.packet.width, request.packet.height, request.packet.originX, request.packet.originY]);
  });
}

test("a late asset tile is rejected after geometry changes while the new request proceeds", async (t) => {
  const oldLoad = deferred();
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
  const cached = f.cache.entries().map(([, tile]) => tile);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].marker, "latest-worker");
  assert.equal(f.owner.getDiagnostics().failed, "");
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
  assert.equal(f.owner.getDiagnostics().builds, 1);
  assert.ok(f.owner.draw());
});

test("palette edits keep geometry identity and the next commit uses the new palette", async (t) => {
  const f = fixture({ features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
    feature("stable-b", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
  ] });
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await settleOneWorker(f, { marker: "palette-tile", edge: true });
  assert.ok(f.owner.draw());
  const initialIdentityCalls = f.identityBuilder.calls.length;
  const initialExport = await f.owner.exportAssets();
  const initialBuilds = f.owner.getDiagnostics().builds;
  const initialRequests = f.requests.length;

  f.features[0].color = "#abcdef";
  f.identity.colorVersion += 1;
  assert.ok(f.owner.draw());

  assert.equal(f.identityBuilder.calls.length, initialIdentityCalls);
  assert.equal(f.owner.getDiagnostics().builds, initialBuilds);
  assert.equal(f.requests.length, initialRequests);
  assert.deepEqual([...f.gpus[0].palettes.at(-1).bytes.slice(4, 8)], [171, 205, 239, 255]);
  const recoloredExport = await f.owner.exportAssets();
  assert.equal(recoloredExport[0].identity, initialExport[0].identity);
  assert.deepEqual(new Uint8Array(recoloredExport[0].buffer), new Uint8Array(initialExport[0].buffer));
});

test("queryPoint requires a committed current frame and reads actual direct-code neighborhoods", async (t) => {
  const f = fixture({ projectionMode: "empty", features: [
    feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
    feature("stable-b", { minX: -160, minY: -160, maxX: -140, maxY: -140 }),
  ] });
  t.after(() => f.owner.dispose());

  assert.equal(f.owner.getDiagnostics().canonicalCoordinates, false);
  assert.equal(f.owner.queryPoint({ x: -150, y: -150 }).reason, "stale-frame");
  f.owner.draw();
  await settleOneWorker(f, { marker: "pick-tile" });
  assert.equal(f.owner.queryPoint({ x: -150, y: -150 }).reason, "stale-frame", "worker completion alone is not a committed frame");
  assert.ok(f.owner.draw());

  const point = { x: -150, y: -150 };
  const interior = f.owner.queryPoint(point);
  assert.deepEqual(interior, { kind: "interior", ids: ["stable-a"], primaryId: "stable-a" });
  const tile = f.cache.entries()[0][1];
  const localX = Math.floor(point.x - tile.originX);
  const localY = Math.floor(point.y - tile.originY);
  const centerIndex = localY * tile.width + localX;

  tile.codes[centerIndex] = 0;
  assert.equal(f.owner.queryPoint(point).reason, "transparent");
  tile.codes[centerIndex] = 1;
  tile.codes[centerIndex + 1] = 2;
  const edge = f.owner.queryPoint(point);
  assert.deepEqual(edge, { kind: "edge", ids: ["stable-a", "stable-b"], primaryId: null });

  tile.codes[centerIndex + 1] = 1;
  f.state.zoomTransform.x += 1;
  assert.equal(f.owner.queryPoint(point).reason, "stale-frame");
  f.state.zoomTransform.x -= 1;
  assert.equal(f.owner.queryPoint(point).kind, "interior");
  f.identity.version += 1;
  assert.equal(f.owner.queryPoint(point).reason, "stale-frame");
});

test("dispose aborts a pending asset load and disposes injected dependencies", async (t) => {
  let loadingSignal = null;
  const f = fixture({ load: (_identity, options) => {
    loadingSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  } });
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await drain();
  assert.ok(loadingSignal);
  assert.equal(loadingSignal.aborted, false);
  assert.equal(f.owner.getPendingWorkCount(), 1);

  f.owner.dispose();
  assert.equal(loadingSignal.aborted, true);
  assert.equal(f.client.disposed, true);
  assert.equal(f.assetStore.stats().disposed, true);
  assert.equal(f.identityBuilder.disposed, true);
  assert.equal(f.owner.getPendingWorkCount(), 0);
  await drain();
  assert.equal(f.requests.length, 0);
});

test("a never-settling asset save times out, releases the pump, and still commits later tiles", async (t) => {
  const f = fixture({
    transform: { x: 0, y: 200, k: 1 },
    width: 600,
    height: 100,
    assetTimeoutMs: 10,
    features: [feature("stable-a", { minX: -700, minY: -300, maxX: 1200, maxY: 100 })],
  });
  const hangingSaves = [];
  f.assetStore.save = (identity, tile, options) => {
    hangingSaves.push({ identity, tile, signal: options.signal, settled: false });
    // Deliberately ignore AbortSignal and never settle, as a broken backend can.
    return new Promise(() => {});
  };
  t.after(() => f.owner.dispose());

  const expected = planPoliticalIdRasterView({
    transform: f.state.zoomTransform,
    dpr: f.state.dpr,
    width: 600,
    height: 100,
  });
  assert.equal(expected.tiles.length, 3);
  assert.equal(f.owner.draw(), null);
  await drain();

  for (let index = 0; index < expected.tiles.length; index += 1) {
    const request = f.requests[index];
    assert.ok(request, `worker request ${index + 1} should follow the previous save timeout`);
    request.resolve(makeTile(request.packet, { marker: `timeout-tile-${index}` }));
    await waitFor(() => hangingSaves.length === index + 1 && hangingSaves[index].signal.aborted,
      `asset save ${index + 1} should time out and abort its operation signal`);
    assert.equal(hangingSaves[index].settled, false);
    if (index + 1 < expected.tiles.length) {
      await waitFor(() => f.requests.length === index + 2,
        `the pump should request tile ${index + 2} after the prior save timeout`);
    }
  }

  await waitFor(() => f.owner.getPendingWorkCount() === 0, "the final tile task should complete after its save timeout");
  assert.equal(f.requests.length, expected.tiles.length);
  assert.equal(f.cache.getStats().tileCount, expected.tiles.length);
  assert.equal(f.owner.getDiagnostics().assetTimeout, true);
  assert.equal(f.owner.getDiagnostics().failed, "");
  assert.ok(f.owner.draw(), "the complete CPU tile set remains drawable after save timeouts");
  assert.equal(f.gpus[0].draws.length, 1);
  assert.equal(f.metrics.at(-1)[0], "politicalIdRasterCommit");
});

test("a cancelled identity that resolves late starts no manifest lookup, asset load, or stale worker request", async (t) => {
  const f = fixture();
  const lateIdentity = deferred();
  const identify = f.identityBuilder.identify.bind(f.identityBuilder);
  let identifyCalls = 0;
  f.identityBuilder.identify = (input) => {
    identifyCalls += 1;
    const current = identify(input);
    if (identifyCalls === 1) return current.then((identity) => lateIdentity.promise.then(() => identity));
    return current;
  };
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await drain();
  assert.equal(identifyCalls, 1);
  assert.equal(f.manifestUrlReads, 0);
  assert.equal(f.assetStore.loads.length, 0);
  assert.equal(f.requests.length, 0);

  const edited = f.features[0];
  edited.geometry = { type: "Polygon", coordinates: [[[-155, -155], [-145, -155], [-150, -145], [-155, -155]]] };
  edited.bounds = { minX: -155, minY: -155, maxX: -145, maxY: -145 };
  f.identity.version += 1;
  f.owner.draw();
  await drain();
  assert.equal(identifyCalls, 2);
  assert.equal(f.manifestUrlReads, 1, "only the latest task may enter manifest resolution");
  assert.equal(f.assetStore.loads.length, 1);
  assert.equal(f.requests.length, 1, "only the latest geometry may start a worker request");

  lateIdentity.resolve();
  await drain();
  assert.equal(f.manifestUrlReads, 1, "the cancelled identity must stop before manifest lookup");
  assert.equal(f.assetStore.loads.length, 1, "the cancelled identity must not load a stale asset");
  assert.equal(f.requests.length, 1, "the cancelled identity must not start a stale worker request");

  const latestRequest = f.requests[0];
  latestRequest.resolve(makeTile(latestRequest.packet, { marker: "latest-identity" }));
  await drain();
  assert.equal(f.cache.peek(latestRequest.packet.key)?.marker, "latest-identity");
  assert.equal(f.owner.getDiagnostics().failed, "");
});
