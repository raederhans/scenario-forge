import test from "node:test";
import assert from "node:assert/strict";
import { createWaterRasterWorkerClient } from "../js/core/water_raster_worker_client.js";

const geometry = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] };
const input = { sceneKey: "scene", identity: "one", revision: 1, projectionOptions: {},
  layout: { pixelWidth: 10, pixelHeight: 10, dpr: 1 }, transform: { x: 0, y: 0, k: 1 },
  features: [{ id: "water", geometryVersion: 1, parts: [geometry], opacity: 0.5, fillColor: "#123456" }] };

test("cancelled bitmap replies are closed on arrival", async () => {
  let delayedTask;
  const worker = {
    terminate() {},
    postMessage(message) {
      if (message.type === "CANCEL_TASK") return;
      if (message.type === "BUILD_WATER_BITMAP") { delayedTask = message; return; }
      const value = message.type === "SYNC_WATER_GEOMETRY" ? { resident: message.versions }
        : { bitmap: { close() {} }, identity: message.packet.identity };
      queueMicrotask(() => worker.onmessage({ data: { type: "RESULT", taskId: message.taskId, value } }));
    },
  };
  const client = createWaterRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
  try {
    const controller = new AbortController();
    const promise = client.request(input, { signal: controller.signal });
    while (!delayedTask) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(promise, { name: "AbortError" });
    let closed = 0;
    worker.onmessage({ data: { type: "RESULT", taskId: delayedTask.taskId, value: { bitmap: { close() { closed++; } } } } });
    assert.equal(closed, 1);
  } finally { client.dispose(); }
});

test("precision versions stay resident across fine and coarse requests", async () => {
  const messages = [], resident = new Map();
  const worker = { terminate() {}, postMessage(message) {
    messages.push(message);
    if (message.type === 'SYNC_WATER_GEOMETRY') for (const pair of message.versions) resident.set(...pair);
    const value = message.type === 'SYNC_WATER_GEOMETRY' ? { resident: [...resident] } : { bitmap: { close() {} } };
    queueMicrotask(() => worker.onmessage({ data: { type: 'RESULT', taskId: message.taskId, value } }));
  } };
  const client = createWaterRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
  try {
    await client.request(input);
    await client.request({ ...input, features: [{ ...input.features[0], geometryVersion: 2 }] });
    await client.request(input);
    assert.equal(messages.filter(m => m.type === 'SYNC_WATER_GEOMETRY').length, 2);
    const builds = messages.filter(m => m.type === 'BUILD_WATER_BITMAP');
    assert.equal(builds[0].packet.entries[0].id, builds[2].packet.entries[0].id);
    assert.notEqual(builds[0].packet.entries[0].id, builds[1].packet.entries[0].id);
  } finally { client.dispose(); }
});
