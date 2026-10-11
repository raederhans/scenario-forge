import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterWorkerClient } from "../js/core/political_id_raster_worker_client.js";
import { createPoliticalIdRasterWorkerRuntime, recreatePoliticalIdRasterProjection } from "../js/workers/political_id_raster.worker.js";

function makeWorkerHarness() {
  const workers = [];
  const createWorker = () => {
    const worker = {
      messages: [], terminated: false,
      postMessage(message) { this.messages.push(message); },
      terminate() { this.terminated = true; },
      reply(data) { this.onmessage?.({ data }); },
      fail(error = new Error("worker crashed")) { this.onerror?.({ error }); },
    };
    workers.push(worker);
    return worker;
  };
  return { workers, createWorker };
}

test("request returns the worker tile payload and forwards its packet", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const tile = { codes: new Uint32Array([7]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  const packet = { entries: [{ id: "a", code: 7, feature: { type: "Feature" }, bounds: {} }], density: 2 };
  const result = client.request(packet);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.workers[0].messages[0].type, "BUILD_POLITICAL_ID_TILE");
  assert.equal(harness.workers[0].messages[0].packet, packet);
  harness.workers[0].reply({ type: "RESULT", taskId: harness.workers[0].messages[0].taskId, tile });
  assert.equal(await result, tile);
  client.dispose();
  assert.equal(harness.workers[0].terminated, true);
});

test("request forwards AbortSignal and rejects an aborted task", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const controller = new AbortController();
  const result = client.request({ entries: [] }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(harness.workers[0].messages.some((message) => message.type === "CANCEL_TASK"));
  client.dispose();
  assert.equal(harness.workers[0].terminated, true);
});

test("worker errors reject the request and dispose terminates the worker", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const result = client.request({ entries: [] });
  await new Promise((resolve) => setImmediate(resolve));
  harness.workers[0].reply({ type: "ERROR", taskId: harness.workers[0].messages[0].taskId, message: "bad projection" });
  await assert.rejects(result, /bad projection/);
  const second = client.request({ entries: [] });
  await new Promise((resolve) => setImmediate(resolve));
  client.dispose();
  await assert.rejects(second, /disposed/);
  assert.equal(harness.workers.at(-1).terminated, true);
  assert.equal(client.available(), false);
});

test("dispose in the request tick prevents deferred worker creation", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const pending = client.request({ entries: [] });
  client.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(harness.workers.length, 0);
  assert.equal(client.available(), false);
});

test("dispose between worker creation and task dispatch sends no build", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const pending = client.request({ entries: [] });
  await Promise.resolve();
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.workers[0].messages.length, 0);
  client.dispose();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.workers[0].messages.length, 0);
  assert.equal(harness.workers[0].terminated, true);
});

function projectionHarness() {
  const values = {};
  const projection = Object.fromEntries(["scale", "translate", "precision", "clipExtent", "rotate"].map((name) => [
    name,
    (value) => { values[name] = value; return projection; },
  ]));
  return { values, api: { geoEqualEarth: () => projection } };
}

test("preparation starts one reusable worker without dispatching an asset or build", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  await client.prepare();
  assert.equal(harness.workers.length, 1);
  assert.deepEqual(harness.workers[0].messages, []);
  const pending = client.assetStore.load("prepared");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.workers.length, 1);
  const worker = harness.workers[0];
  worker.reply({ type: "RESULT", taskId: worker.messages[0].taskId, value: null });
  assert.equal(await pending, null);
  client.dispose();
});

test("asset proxy uses the same worker, forwards cancellation and receives background persistence statistics", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  client.assetStore.registerManifest({ schemaVersion: 1, tiles: [] });
  const controller = new AbortController();
  const pending = client.assetStore.load("first", { idToCode: new Map([["a", 1]]), signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  const worker = harness.workers[0], task = worker.messages[0];
  assert.equal(task.type, "LOAD_POLITICAL_ID_ASSET");
  assert.equal(task.idToCode.get("a"), 1);
  assert.equal(client.assetStore.stats().pendingReads, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(worker.messages.some(message => message.type === "CANCEL_TASK" && message.taskId === task.taskId));
  const ready = client.assetStore.load("second");
  await new Promise(resolve => setImmediate(resolve));
  const tile = { codes: new Uint32Array([1]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  worker.reply({ taskId: worker.messages.at(-1).taskId, type: "RESULT", value: tile, assets: { indexedDBHits: 1, pendingWrites: 1, pendingBytes: 200 } });
  assert.equal(await ready, tile);
  assert.equal(client.assetStore.stats().pendingBytes, 200);
  worker.reply({ type: "ASSET_STATS", assets: { pendingWrites: 0, pendingBytes: 0 } });
  assert.equal(client.assetStore.stats().pendingBytes, 0);
  assert.equal(client.assetStore.stats().indexedDBHits, 1);
  assert.equal(harness.workers.length, 1);
  client.dispose();
  assert.equal(client.assetStore.stats().disposed, true);
});

test("asset save accounts for the caller-preserving tile copy and releases it on cancellation", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const tile = { codes: new Uint32Array([1, 2]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  const saving = client.assetStore.save("tile", tile, { codeToId: new Map([[1, "a"], [2, "b"]]) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.assetStore.stats().pendingBytes, 8);
  assert.equal(harness.workers[0].messages[0].type, "SAVE_POLITICAL_ID_ASSET");
  assert.deepEqual([...tile.codes], [1, 2]);
  client.dispose();
  await assert.rejects(saving, /disposed/);
  assert.equal(client.assetStore.stats().pendingBytes, 0);
});

test("worker asset reads validate one manifest revision, transfer coverage and abort without late publication", async () => {
  const sent = [], calls = [];
  let readSignal, release;
  const tile = { codes: new Uint32Array([1]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  const runtime = createPoliticalIdRasterWorkerRuntime({
    postMessage: (message, transfer) => sent.push({ message, transfer }),
    buildTile: () => { throw new Error("assets must not rebuild geometry"); },
    createAssetStore: () => ({
      registerManifest: value => calls.push(value),
      load: async (identity, { idToCode, signal }) => {
        assert.equal(idToCode.get("a"), 1); readSignal = signal;
        if (identity === "held") await new Promise(resolve => { release = resolve; });
        return tile;
      },
      stats: () => ({ indexedDBHits: 1 }), dispose: () => calls.push("disposed"),
    }),
  });
  const data = { type: "LOAD_POLITICAL_ID_ASSET", manifest: { schemaVersion: 1, tiles: [] }, manifestRevision: 1, idToCode: new Map([["a", 1]]) };
  runtime.handleMessage({ ...data, taskId: "ready", identity: "ready" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].message.value, tile);
  assert.deepEqual(sent[0].transfer, [tile.codes.buffer, tile.edgeIds.buffer, tile.edgeWeights.buffer]);
  runtime.handleMessage({ ...data, taskId: "cancelled", identity: "held" });
  await new Promise(resolve => setImmediate(resolve));
  runtime.handleMessage({ type: "CANCEL_TASK", taskId: "cancelled" });
  assert.equal(readSignal.aborted, true);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1, "cancelled coverage cannot publish");
  assert.equal(calls.length, 1, "unchanged manifests are not rebuilt per tile");
  assert.equal(runtime.getPendingTaskCount(), 0);
  runtime.dispose(); assert.equal(calls.at(-1), "disposed");
});

test("worker runtime scales projection and bounds while preserving physical tile dimensions and origin", async () => {
  const harness = projectionHarness();
  const normalized = recreatePoliticalIdRasterProjection({
    factory: "geoEqualEarth",
    methods: { scale: 100, translate: [10, 20], precision: 0.5, clipExtent: [[-4, -5], [30, 40]], rotate: [1, 2, 3] },
  }, 2, harness.api);
  assert.ok(normalized);
  assert.deepEqual(harness.values, {
    rotate: [1, 2, 3], scale: 200, translate: [20, 40], precision: 1, clipExtent: [[-8, -10], [60, 80]],
  });

  let captured;
  const sent = [];
  const runtime = createPoliticalIdRasterWorkerRuntime({
    postMessage: (message) => sent.push(message), projectionApi: harness.api,
    buildTile: async (input) => {
      captured = input;
      return { codes: new Uint32Array(0), edgeIds: new Uint32Array(0), edgeWeights: new Float32Array(0) };
    },
  });
  runtime.handleMessage({ taskId: "physical", type: "BUILD_POLITICAL_ID_TILE", packet: {
    density: 2, width: 512, height: 256, originX: -512, originY: 64, strokeWidth: 1.5,
    projectionOptions: { factory: "geoEqualEarth", methods: { scale: 100, translate: [0, 0] } },
    entries: [{ id: "x", code: 1, feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [] } },
      bounds: { minX: -2, minY: 3, maxX: 4, maxY: 5 } }],
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([captured.width, captured.height, captured.originX, captured.originY, captured.strokeWidth], [512, 256, -512, 64, 1.5]);
  assert.deepEqual(captured.entries[0].bounds, { minX: -4, minY: 6, maxX: 8, maxY: 10 });
  assert.equal(sent[0].type, "RESULT");
});

test("worker runtime serializes builds and drops a queued task cancelled before execution", async () => {
  const harness = projectionHarness();
  let releaseFirst;
  const started = [];
  const posted = [];
  const runtime = createPoliticalIdRasterWorkerRuntime({
    postMessage: (message) => posted.push(message), projectionApi: harness.api,
    buildTile: async ({ isCancelled }) => {
      started.push(isCancelled);
      if (started.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      return { codes: new Uint32Array(0), edgeIds: new Uint32Array(0), edgeWeights: new Float32Array(0) };
    },
  });
  const packet = { density: 1, width: 1, height: 1, projectionOptions: { factory: "geoEqualEarth", methods: {} }, entries: [] };
  runtime.handleMessage({ taskId: "first", type: "BUILD_POLITICAL_ID_TILE", packet });
  runtime.handleMessage({ taskId: "queued", type: "BUILD_POLITICAL_ID_TILE", packet });
  runtime.handleMessage({ taskId: "queued", type: "CANCEL_TASK" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1);
  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1);
  assert.deepEqual(posted.map(({ taskId }) => taskId), ["first"]);
  assert.equal(runtime.getPendingTaskCount(), 0);
});

function pathCacheHarness(options = {}) {
  const sent = [], paths = [], inputs = [];
  let sequence = 0;
  const runtime = createPoliticalIdRasterWorkerRuntime({
    projectionApi: projectionHarness().api,
    postMessage: (message) => sent.push(message),
    buildTile: async (input) => {
      inputs.push(input);
      for (const entry of input.entries) {
        paths.push(input.getCachedPath(entry, () => ({ sequence: ++sequence })));
      }
      await options.afterPaths?.(input);
      return { codes: new Uint32Array(), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
    },
    ...options,
  });
  const packet = {
    geometryNamespace: "scene", density: 1, width: 1, height: 1,
    projectionOptions: { factory: "geoEqualEarth", methods: { scale: 100, precision: 0.5 } },
    entries: [{ id: "a", geometryVersion: 1, code: 1, feature: { type: "Point", coordinates: [0, 0] } }],
  };
  async function request(changes = {}) {
    runtime.handleMessage({ type: "BUILD_POLITICAL_ID_TILE", taskId: `task-${inputs.length}`, packet: { ...packet, ...changes } });
    await new Promise((resolve) => setImmediate(resolve));
    return sent.at(-1)?.tile;
  }
  return { runtime, sent, paths, inputs, packet, request };
}

test("worker paths reuse stable geometry across tiles and style-only changes", async () => {
  const harness = pathCacheHarness();
  const first = await harness.request();
  const second = await harness.request({ originX: 10, gutter: 2, strokeWidth: 2,
    entries: [{ ...harness.packet.entries[0], code: 2, strokeCode: 3 }],
    projectionOptions: { methods: { precision: 0.5, scale: 100 }, factory: "geoEqualEarth" },
  });
  assert.equal(harness.paths[0], harness.paths[1]);
  assert.equal(first.stats.pathBuilds, 1);
  assert.equal(second.stats.pathBuilds, 0);
  assert.equal(second.stats.pathCacheHits, 1);
  assert.equal(second.stats.pathCacheEntries, 1);
  assert.equal(second.stats.pathCacheEstimatedBytes, 320);
  assert.equal(harness.inputs[1].gutter, 2);
});

test("worker path identity invalidates on geometry version, projection precision, density and namespace", async () => {
  const harness = pathCacheHarness();
  await harness.request();
  for (const changes of [
    { entries: [{ ...harness.packet.entries[0], geometryVersion: 2 }] },
    { projectionOptions: { factory: "geoEqualEarth", methods: { scale: 100, precision: 0.25 } } },
    { density: 2 },
    { geometryNamespace: "another-scene" },
    { geometryNamespace: "scene" },
  ]) {
    const tile = await harness.request(changes);
    assert.equal(tile.stats.pathBuilds, 1);
    assert.equal(tile.stats.pathCacheHits, 0);
  }
  assert.equal(new Set(harness.paths).size, 6);
  assert.equal(harness.runtime.getPathCacheStats().pathCacheEntries, 1, "namespace switch releases prior paths");
});

test("legacy packets and entries without geometry identity build safely without reuse", async () => {
  const harness = pathCacheHarness();
  for (const changes of [
    { geometryNamespace: null },
    { entries: [{ ...harness.packet.entries[0], geometryVersion: undefined }] },
    { entries: [{ ...harness.packet.entries[0], id: undefined }] },
  ]) {
    const first = await harness.request(changes), second = await harness.request(changes);
    assert.equal(first.stats.pathBuilds, 1);
    assert.equal(second.stats.pathBuilds, 1);
    assert.equal(second.stats.pathCacheEntries, 0);
  }
});

test("worker path budgets bound retention and LRU evicts entries; oversized paths are not retained", async () => {
  for (const options of [{ pathCacheMaxEntries: 1 }, { pathCacheMaxEstimatedBytes: 320 }]) {
    const harness = pathCacheHarness(options);
    const entries = [harness.packet.entries[0], { ...harness.packet.entries[0], id: "b" }];
    const first = await harness.request({ entries });
    assert.equal(first.stats.pathCacheEntries, 1);
    assert.equal(first.stats.pathCacheEstimatedBytes, 320);
    const hit = await harness.request({ entries: [entries[1]] });
    assert.equal(hit.stats.pathCacheHits, 1);
    const evicted = await harness.request({ entries: [entries[0]] });
    assert.equal(evicted.stats.pathBuilds, 1);
  }
  const oversized = pathCacheHarness({ pathCacheMaxEstimatedBytes: 319 });
  await oversized.request();
  assert.equal((await oversized.request()).stats.pathCacheEntries, 0);
  assert.equal(oversized.paths[0] === oversized.paths[1], false);
  assert.throws(() => pathCacheHarness({ pathCacheMaxEntries: -1 }), /budgets/);
});

test("cancelled and failed worker transactions cannot replace accepted paths or namespace", async () => {
  let release, fail = false;
  const harness = pathCacheHarness({ afterPaths: async () => {
    if (fail) throw new Error("build failed");
    if (release === null) await new Promise((resolve) => { release = resolve; });
  } });
  await harness.request();
  const accepted = harness.runtime.getPathCacheStats();
  release = null;
  harness.runtime.handleMessage({ type: "BUILD_POLITICAL_ID_TILE", taskId: "cancel", packet: {
    ...harness.packet, geometryNamespace: "cancelled-scene",
  } });
  await new Promise((resolve) => setImmediate(resolve));
  harness.runtime.handleMessage({ type: "CANCEL_TASK", taskId: "cancel" });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.runtime.getPathCacheStats(), accepted);
  assert.equal(harness.sent.length, 1);
  fail = true;
  await harness.request({ geometryNamespace: "failed-scene" });
  assert.equal(harness.sent.at(-1).type, "ERROR");
  assert.deepEqual(harness.runtime.getPathCacheStats(), accepted);
  fail = false;
  const hit = await harness.request();
  assert.equal(hit.stats.pathCacheHits, 1);
  assert.equal(harness.paths.at(-1), harness.paths[0]);
  harness.runtime.dispose();
  assert.deepEqual(harness.runtime.getPathCacheStats(), {
    geometryNamespace: null, pathCacheEntries: 0, pathCacheEstimatedBytes: 0,
  });
});

test("accepted hits promote LRU entries and dispose cancels an active transaction", async () => {
  let release;
  const harness = pathCacheHarness({ pathCacheMaxEntries: 2, afterPaths: async () => {
    if (release === null) await new Promise((resolve) => { release = resolve; });
  } });
  const a = harness.packet.entries[0], b = { ...a, id: "b" }, c = { ...a, id: "c" };
  await harness.request({ entries: [a, b] });
  await harness.request({ entries: [a] });
  await harness.request({ entries: [c] });
  assert.equal((await harness.request({ entries: [a] })).stats.pathCacheHits, 1);
  assert.equal((await harness.request({ entries: [b] })).stats.pathBuilds, 1);
  const beforeDisposeMessages = harness.sent.length;
  release = null;
  harness.runtime.handleMessage({ type: "BUILD_POLITICAL_ID_TILE", taskId: "active", packet: harness.packet });
  await new Promise((resolve) => setImmediate(resolve));
  harness.runtime.dispose();
  assert.equal(harness.inputs.at(-1).isCancelled(), true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sent.length, beforeDisposeMessages);
  assert.equal(harness.runtime.getPathCacheStats().pathCacheEntries, 0);
  assert.equal(harness.runtime.getPendingTaskCount(), 0);
});
