import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerTaskClient } from "../js/core/worker_task_client.js";

test("worker task client cancels one task without recycling its shared worker", async () => {
  const postedMessages = [];
  const controller = new AbortController();
  const worker = { postMessage: (message) => postedMessages.push(message), terminate() {} };
  const client = createWorkerTaskClient({
    createWorker: () => worker,
    createTaskId: (type, sequence) => `${type}:${sequence}`,
  });

  await client.ensureWorker();
  const abortedTask = client.dispatchTask("LOAD_A", {}, { signal: controller.signal });
  const successfulTask = client.dispatchTask("LOAD_B", {});
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(postedMessages.map((message) => message.taskId), ["LOAD_A:1", "LOAD_B:2"]);
  controller.abort();

  await assert.rejects(abortedTask, (error) => error?.name === "AbortError");
  assert.deepEqual(postedMessages.at(-1), { type: "CANCEL_TASK", taskId: "LOAD_A:1" });

  worker.onmessage({ data: { type: "READY", taskId: "LOAD_A:1", value: "late" } });
  assert.equal(client.getPendingTaskCount(), 1);
  worker.onmessage({ data: { type: "READY", taskId: "LOAD_B:2", value: "kept" } });
  assert.equal((await successfulTask).value, "kept");
  assert.equal(client.getPendingTaskCount(), 0);
});

test("startup worker client restores transferred geometry", async () => {
  const originalWorker = globalThis.Worker;
  const postedMessages = [];
  let startupWorkerClient = null;

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
    }

    postMessage(message) {
      postedMessages.push(message);
    }

    terminate() {}
  }

  try {
    globalThis.Worker = FakeWorker;
    startupWorkerClient = await import("../js/core/startup_worker_client.js");
    const geometryResult = startupWorkerClient.decodeRuntimeChunkViaWorker({ chunkUrl: "/geometry.json", chunkType: "political" });
    await new Promise((resolve) => setImmediate(resolve));
    const original = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-0, 2, 3] } }] };
    const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(original, { minCoordinateCount: 0 });
    FakeWorker.instance.onmessage({ data: { type: "RUNTIME_CHUNK_READY", taskId: postedMessages[0].taskId,
      geometryTransport: { field: "chunkPayload", payload: structuredClone(packed.payload, { transfer: packed.transferables }) } } });
    assert.deepEqual((await geometryResult).chunkPayload, original);
  } finally {
    startupWorkerClient?.terminateStartupWorker();
    globalThis.Worker = originalWorker;
  }
});
