import assert from "node:assert/strict";
import test from "node:test";
import { packGeometryCooperatively } from "../js/core/cooperative_geometry_transport.js";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const feature = (x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x, x] } });
const tick = () => new Promise(setImmediate);

test("cooperative batches retain ordered lossless updates and yield between bounded codec calls", async () => {
  const updates = Array.from({ length: 65 }, (_, index) => ({ id: String(index), feature: feature(index) }));
  const sizes = [], yielded = [];
  const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
  const result = await packGeometryCooperatively(updates, {
    pack: (batch) => { sizes.push(batch.length); return codec.pack(batch, { minCoordinateCount: 0 }); },
    now: (() => { let time = 0; return () => time += 5; })(),
    yieldTask: async () => { yielded.push(true); },
  });
  assert.deepEqual(sizes, [32, 32, 1]);
  assert.equal(yielded.length, 2);
  assert.equal(result.payload.encoding, "geo-f64-batches-v1");
  assert.deepEqual(result.payload.batches.flatMap((batch) => codec.unpack(batch)), updates);
  assert.equal(result.transferables.length, 6);
});

test("packing checks cancellation before the next batch", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(packGeometryCooperatively(Array.from({ length: 33 }, (_, i) => ({ id: String(i), feature: feature(i) })), {
    signal: controller.signal,
    pack: (batch) => { calls++; controller.abort(); return { payload: batch, transferables: [] }; },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("client dispatches empty-buffer batch transport and cancels during asynchronous packing", async () => {
  const sent = [];
  const metrics = [];
  const worker = { postMessage(message) { sent.push(message); }, terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true,
    onMetric: (...args) => metrics.push(args),
    packGeometry: (updates) => packGeometryCooperatively(updates) });
  const request = client.request({ identity: "one", sceneKey: "scene", projectionKey: 1, kind: "navigation",
    width: 8, height: 8, entries: [{ id: "a", feature: feature(1), fillColor: "red" }] });
  await tick();
  assert.equal(sent[0].packet.geometryTransport.encoding, "geo-f64-batches-v1");
  assert.equal(sent[0].packet.geometryUpdates, null);
  const navigationTimings = { pathBuildMs: 7, fillMs: 3 };
  worker.onmessage({ data: { taskId: sent[0].taskId, result: { bitmap: { close() {} }, navigationTimings } } });
  await request;
  assert.equal(metrics.find(([name]) => name === "geometryWorkerRoundTrip")[2].navigationTimings, navigationTimings);
  client.dispose();

  let resume;
  const blocked = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true,
    packGeometry: () => new Promise((resolve) => { resume = resolve; }) });
  const controller = new AbortController();
  const pending = blocked.request({ identity: "two", sceneKey: "scene", kind: "navigation",
    entries: [{ id: "a", feature: feature(2) }] }, { signal: controller.signal });
  controller.abort();
  resume({ payload: { encoding: "geo-f64-batches-v1", batches: [] }, transferables: [] });
  assert.equal(await pending, null);
  assert.equal(sent.length, 1);
  assert.equal(blocked.available(), true);
  blocked.dispose();
});
