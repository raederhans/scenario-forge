import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createPoliticalIdRasterWorkerClient } from "../js/core/political_id_raster_worker_client.js";
import { createPoliticalIdRasterWorkerRuntime } from "../js/workers/political_id_raster.worker.js";
import { isPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";
const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = (id = "a", geometryVersion = 1) => ({ id, geometryVersion, code: 1,
  feature: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } });
const packet = (entries = [entry()], geometryNamespace = "scene") => ({ entries, geometryNamespace,
  density: 1, width: 1, height: 1, projectionOptions: { factory: "geoEqualEarth", scale: 1, translate: [0, 0] } });

function harness(options = {}) {
  const workers = [], inputs = [];
  const client = createPoliticalIdRasterWorkerClient({ isSupported: () => true, createWorker: () => {
    const worker = { messages: [], transfers: [], terminated: false,
      postMessage(message, transfer = []) {
        this.transfers.push(transfer.length);
        const data = structuredClone(message, { transfer });
        this.messages.push(data); runtime.handleMessage(data);
      },
      terminate() { this.terminated = true; runtime.dispose(); },
    };
    const runtime = createPoliticalIdRasterWorkerRuntime({
      projectionApi: d3,
      postMessage: (data, transfer = []) => {
        const cloned = structuredClone(data, { transfer });
        if (options.holdAck?.(cloned, worker)) return;
        worker.onmessage?.({ data: cloned });
      },
      buildTile: async input => {
        inputs.push(input);
        for (const item of input.entries) assert.equal(isPackedRasterGeometry(item.feature), true);
        await options.onBuild?.(input);
        return { codes: new Uint32Array([1]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
      }, ...options.runtime,
    });
    worker.runtime = runtime; workers.push(worker); return worker;
  } });
  return { client, workers, inputs };
}

test("resident upload transfers binary once; warm tiles and recolor send only references", async () => {
  const h = harness();
  try {
    const p = packet();
    await h.client.request(p);
    await h.client.request({ ...p, originX: 1, entries: [{ ...p.entries[0], code: 2 }] });
    assert.deepEqual(h.workers[0].messages.map(m => m.type), ["SYNC_POLITICAL_ID_GEOMETRY", "BUILD_POLITICAL_ID_TILE", "BUILD_POLITICAL_ID_TILE"]);
    assert.deepEqual(h.workers[0].transfers, [2, 0, 0]);
    const builds = h.workers[0].messages.filter(m => m.type === "BUILD_POLITICAL_ID_TILE");
    assert.ok(builds.every(m => !Object.hasOwn(m.packet.entries[0], "feature")));
    assert.deepEqual(p.entries[0].feature.coordinates, [[0, 0], [1, 1]], "caller facts remain usable");
    assert.equal(h.inputs[0].entries[0].feature, h.inputs[1].entries[0].feature);
    assert.equal(h.client.getStats().geometryUploads, 1);
    assert.equal(h.client.getStats().geometryReuses, 1);
    assert.ok(h.client.getStats().residentGeometryBytes > 0);
    await h.client.clearGeometry();
    assert.equal(h.client.getStats().residentGeometryBytes, 0);
  } finally { h.client.dispose(); }
});

test("replacement, deletion, scene changes and crashed worker reupload correct geometry", async () => {
  const h = harness();
  try {
    await h.client.request(packet());
    await h.client.request(packet([entry("a", 2)]));
    await h.client.releaseGeometry(["a"]);
    assert.equal(h.client.getStats().residentGeometryBytes, 0);
    await h.client.request(packet([entry("a", 2)]));
    await h.client.request(packet([entry("a", 2)], "next"));
    h.workers[0].onerror({ error: new Error("crash") });
    await h.client.request(packet([entry("a", 2)], "next"));
    assert.equal(h.workers.length, 2);
    assert.equal(h.client.getStats().geometryUploads, 5);
    assert.equal(h.workers[0].runtime.getGeometryStats().residentGeometryBytes, 0);
    assert.equal(h.inputs.at(-1).entries[0].geometryVersion, 2);
  } finally { h.client.dispose(); }
});

test("LRU evictions are acknowledged and oversized tile fails without exceeding budget", async () => {
  const h = harness({ runtime: { geometryCacheMaxBytes: 400 } });
  try {
    await h.client.request(packet([entry("a")]));
    await h.client.request(packet([entry("b")]));
    await h.client.request(packet([entry("a")]));
    assert.equal(h.client.getStats().geometryUploads, 3, "evicted a must be uploaded again");
    await assert.rejects(h.client.request(packet([entry("a"), entry("b")])), /exceeds worker budget/);
    assert.ok(h.workers[0].runtime.getGeometryStats().residentGeometryBytes <= 400);
    await h.client.request(packet([entry("b")]));
    assert.equal(h.inputs.at(-1).entries[0].id, "b");
  } finally { h.client.dispose(); }
});

test("cancelled queued builds do not publish; subsequent requests recover", async () => {
  let release;
  const h = harness({ onBuild: async () => { if (!release) await new Promise(resolve => { release = resolve; }); } });
  try {
    const controller = new AbortController();
    const pending = h.client.request(packet(), { signal: controller.signal });
    await tick(); controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    release(); await tick();
    await h.client.request(packet());
    assert.equal(h.client.getStats().geometryUploads, 1);
    assert.equal(h.workers[0].runtime.getPendingTaskCount(), 0);
  } finally { h.client.dispose(); }
});

test("packed projected path streams equal D3 path commands without nested-array decoding", async () => {
  const oldPath = globalThis.Path2D;
  class Path {
    commands = [];
    moveTo(...args) { this.commands.push(["M", ...args]); }
    lineTo(...args) { this.commands.push(["L", ...args]); }
    closePath() { this.commands.push(["Z"]); }
    arc(...args) { this.commands.push(["A", ...args]); }
  }
  globalThis.Path2D = Path;
  const h = harness({ onBuild: input => {
    const actual = input.createProjectedPath(input.entries[0]);
    const expected = new Path();
    d3.geoPath(input.projection).context(expected)(entry().feature);
    assert.deepEqual(actual.commands, expected.commands);
  } });
  try { await h.client.request(packet()); }
  finally { h.client.dispose(); globalThis.Path2D = oldPath; }
});

test("lost sync acknowledgement after cancellation cannot leave stale scene residency", async () => {
  let held = false;
  const h = harness({ holdAck: data => {
    if (held && data.value?.resident) return true;
    return false;
  } });
  try {
    await h.client.request(packet());
    held = true;
    const controller = new AbortController();
    const pending = h.client.request(packet([entry("b")], "other"), { signal: controller.signal });
    await tick(); controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    held = false;
    await h.client.request(packet());
    assert.equal(h.inputs.at(-1).entries[0].id, "a");
    assert.equal(h.client.getStats().geometryUploads, 3);
  } finally { h.client.dispose(); }
});

test("empty polygon geometry remains packed and releases its budget", async () => {
  const h = harness();
  try {
    await h.client.request(packet([{ ...entry(), feature: { type: "Polygon", coordinates: [] } }]));
    assert.equal(h.inputs[0].entries[0].feature.coordinates.length, 0);
    assert.equal(h.inputs[0].entries[0].feature.lengths.length, 1);
    await h.client.clearGeometry();
    assert.equal(h.workers[0].runtime.getGeometryStats().residentGeometryBytes, 0);
  } finally { h.client.dispose(); }
});

test("geometry and path budgets are independent while both retain bounded LRU caches", async () => {
  const h = harness({ runtime: { geometryCacheMaxBytes: 700, pathCacheMaxEstimatedBytes: 320 },
    onBuild: input => {
      for (const item of input.entries) input.getCachedPath(item, () => ({ id: item.id }));
    } });
  try {
    await h.client.request(packet([entry("a"), entry("b")]));
    const stats = h.client.getStats();
    assert.equal(stats.residentGeometryBytes, 600);
    assert.equal(stats.pathBytes, 320);
    assert.equal(stats.geometryBudgetBytes, 700);
    assert.equal(stats.pathBudgetBytes, 320);
    assert.equal(h.workers[0].runtime.getPathCacheStats().pathCacheEntries, 1);
    const warm = await h.client.request(packet([entry("b")]));
    assert.equal(warm.stats.pathCacheHits, 1);
    assert.equal(h.client.getStats().geometryUploads, 2);
    await h.client.releaseGeometry(["b"]);
    assert.equal(h.client.getStats().residentGeometryBytes, 300);
    assert.equal(h.client.getStats().pathBytes, 0, "evicted geometry also releases its projected path");
  } finally { h.client.dispose(); }
});

test("default binary residency admits a required set above the old 16 MiB path cap", async () => {
  const sent = [];
  const runtime = createPoliticalIdRasterWorkerRuntime({ postMessage: message => sent.push(message) });
  const points = 900_000;
  const coordinates = new Float64Array(points * 2);
  const lengths = new Uint32Array(points + 1).fill(2);
  lengths[0] = points;
  try {
    runtime.handleMessage({ type: "SYNC_POLITICAL_ID_GEOMETRY", taskId: "large", geometryNamespace: "tno",
      updates: { encoding: "geo-f64-v1", coordinates, lengths,
        value: [{ id: "large", feature: { type: "LineString", coordinates: [0, 0] } }] },
      versions: [["large", 1]], requiredIds: ["large"],
    });
    await tick();
    assert.equal(sent[0].type, "RESULT");
    const stats = runtime.getGeometryStats();
    assert.ok(stats.residentGeometryBytes > 16 * 1024 * 1024);
    assert.ok(stats.residentGeometryBytes < 48 * 1024 * 1024);
    assert.equal(stats.geometryBudgetBytes + stats.pathBudgetBytes, 64 * 1024 * 1024);
    assert.equal(stats.pathBudgetBytes, 16 * 1024 * 1024);
  } finally { runtime.dispose(); }
  assert.equal(runtime.getGeometryStats().residentGeometryBytes, 0);
  assert.throws(() => createPoliticalIdRasterWorkerRuntime({ geometryCacheMaxBytes: -1 }), /geometry budget/);
});
