import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";
const tick = () => new Promise(setImmediate);

test("worker ACK accounts persistent bytes; disposal releases accounting without closing caller-owned bitmaps", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 1000 });
  const sent = [];
  const worker = { postMessage: (message) => sent.push(message), terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true, resourceBudget: budget });
  const input = { identity: "one", sceneKey: "a", kind: "political", projectionKey: 1, width: 10, height: 5,
    entries: [{ id: "a", feature: { geometry: { type: "Point", coordinates: [1, 2] } }, fillColor: "red" }] };
  const pending = client.request(input); await tick();
  let closes = 0;
  const bitmap = { close() { closes++; } };
  worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[0].taskId,
    result: { bitmap, cacheBudget: { geometry: { estimatedBytes: 300 }, paths: { estimatedBytes: 100 } } } } });
  assert.equal((await pending).bitmap, bitmap);
  assert.equal(budget.snapshot().estimatedBytes, 600);
  assert.equal(budget.snapshot().categories.workerSurfaces, 200);
  assert.ok(budget.snapshot().unmeasuredCategories.includes("bitmaps"));
  client.dispose(); assert.equal(budget.snapshot().ownerCount, 0);
  assert.equal(closes, 0); bitmap.close(); assert.equal(closes, 1);
});

test("failed worker releases its transfer reservation and rejects late orphan bitmaps", async () => {
  const budget = createRuntimeResourceBudget();
  const sent = [], worker = { postMessage: (message) => sent.push(message), terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true, resourceBudget: budget });
  const pending = client.request({ identity: "large", sceneKey: "a", kind: "political", width: 10, height: 5,
    entries: [{ id: "large", feature: { geometry: { type: "LineString", coordinates: Array.from({ length: 10000 }, (_, i) => [i, -i]) } } }] });
  await tick(); assert.ok(budget.snapshot().categories.decodeTransient > 0);
  worker.onmessage({ data: { type: "ERROR", taskId: sent[0].taskId, message: "expected" } });
  assert.equal(await pending, null); assert.equal(budget.snapshot().ownerCount, 0);
  let closes = 0;
  worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[0].taskId, result: { bitmap: { close() { closes++; } } } } });
  assert.equal(closes, 1);
});
