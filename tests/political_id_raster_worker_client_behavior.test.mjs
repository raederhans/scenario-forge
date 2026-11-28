import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterWorkerClient } from "../js/core/political_id_raster_worker_client.js";

function makeWorkerHarness() {
  const workers = [];
  const createWorker = () => {
    const worker = {
      messages: [],
      postMessage(message) { this.messages.push(message); },
      terminate() {},
      reply(data) { this.onmessage?.({ data }); },
    };
    workers.push(worker);
    return worker;
  };
  return { workers, createWorker };
}

test("request resolves with the tile from its worker reply", async () => {
  const harness = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker: harness.createWorker, isSupported: () => true });
  const tile = { codes: new Uint32Array([7]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  const packet = { entries: [{ id: "a", code: 7, feature: { type: "Feature" }, bounds: {} }], density: 2 };
  const result = client.request(packet);
  await new Promise((resolve) => setImmediate(resolve));
  harness.workers[0].reply({ type: "RESULT", taskId: harness.workers[0].messages[0].taskId, tile });
  assert.equal(await result, tile);
  client.dispose();
});

test("cancelling one pooled request rejects its late reply and leaves its sibling running", async t => {
  const { workers, createWorker } = makeWorkerHarness();
  const client = createPoliticalIdRasterWorkerClient({ createWorker, isSupported: () => true, workerCount: 2 });
  t.after(() => client.dispose());
  const controller = new AbortController();
  const stale = client.request({ entries: [] }, { signal: controller.signal });
  const live = client.request({ entries: [] });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(stale, { name: "AbortError" });
  workers[0].reply({ taskId: workers[0].messages[0].taskId, tile: "late" });
  workers[1].reply({ taskId: workers[1].messages[0].taskId, tile: "current" });
  assert.equal(await live, "current");
});
