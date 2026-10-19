import test from "node:test";
import assert from "node:assert/strict";
import { createWaterRasterWorkerClient } from "../js/core/water_raster_worker_client.js";

const geometry = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] };
const input = { sceneKey: "scene", identity: "one", revision: 1, projectionOptions: {},
  layout: { pixelWidth: 10, pixelHeight: 10, dpr: 1 }, transform: { x: 0, y: 0, k: 1 },
  features: [{ id: "water", geometryVersion: 1, parts: [geometry], opacity: 0.5, fillColor: "#123456" }] };

test("water client uploads once, reuses geometry, and closes late cancelled bitmaps", async () => {
  const messages = [];
  let delayed = false, delayedTask;
  const worker = {
    terminate() {},
    postMessage(message) {
      messages.push(message);
      if (message.type === "CANCEL_TASK") return;
      if (delayed && message.type === "BUILD_WATER_BITMAP") { delayedTask = message; return; }
      const value = message.type === "SYNC_WATER_GEOMETRY" ? { resident: message.versions }
        : { bitmap: { close() {} }, identity: message.packet.identity };
      queueMicrotask(() => worker.onmessage({ data: { type: "RESULT", taskId: message.taskId, value } }));
    },
  };
  const client = createWaterRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
  try {
    await client.request(input);
    await client.request({ ...input, identity: "two" });
    assert.equal(messages.filter(message => message.type === "SYNC_WATER_GEOMETRY").length, 1);
    assert.deepEqual(messages.find(message => message.type === "SYNC_WATER_GEOMETRY").sourceIds,
      [[JSON.stringify(["water", 1]), "water"]], "versioned aliases carry an explicit stable source ID");
    const builds = messages.filter(message => message.type === "BUILD_WATER_BITMAP");
    assert.equal(Object.hasOwn(builds[0].packet.entries[0], "parts"), false);
    delayed = true;
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

test("cancelled pattern upload is explicitly cleared by the next pattern-free build", async () => {
  const messages = [];
  let pattern = null, delayedTask;
  let closed = false;
  const bitmap = { width: 8, height: 8, close() { closed = true; } };
  const worker = {
    terminate() {},
    postMessage(message) {
      messages.push(message);
      if (message.type === "CANCEL_TASK") return;
      if (message.type === "BUILD_WATER_BITMAP" && message.patternSource !== undefined) {
        pattern?.bitmap.close();
        pattern = message.patternSource;
      }
      if (message.type === "BUILD_WATER_BITMAP" && message.packet.identity === "cancelled") {
        delayedTask = message;
        return;
      }
      const value = message.type === "SYNC_WATER_GEOMETRY" ? { resident: message.versions }
        : { bitmap: { close() {} }, stats: { patternBytes: pattern ? 256 : 0 } };
      queueMicrotask(() => worker.onmessage({ data: { type: "RESULT", taskId: message.taskId, value } }));
    },
  };
  const client = createWaterRasterWorkerClient({ createWorker: () => worker, isSupported: () => true,
    createBitmap: async () => bitmap });
  try {
    const controller = new AbortController();
    const request = client.request({ ...input, identity: "cancelled",
      patternSource: { canvas: {}, revision: "pattern-R" } }, { signal: controller.signal });
    while (!delayedTask) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(pattern.bitmap, bitmap);
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    const result = await client.request({ ...input, patternSource: null });
    const builds = messages.filter(message => message.type === "BUILD_WATER_BITMAP");
    assert.equal(builds[1].patternSource, null);
    assert.equal(pattern, null);
    assert.equal(closed, true);
    assert.equal(result.stats.patternBytes, 0);
    assert.equal(messages.filter(message => message.type === "SYNC_WATER_GEOMETRY").length, 1);
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

test("water phase timings separate cold uploads from hot builds and retain worker stats", async () => {
  let clock = 100, packCalls = 0, syncCalls = 0;
  const bitmap = { close() {} };
  const worker = { terminate() {}, postMessage(message) {
    const sync = message.type === "SYNC_WATER_GEOMETRY";
    if (sync) syncCalls++;
    clock += sync ? 7 : 11;
    const value = sync ? { resident: message.versions } : { bitmap, stats: { totalMs: 4, pathBuildCount: 0 } };
    queueMicrotask(() => worker.onmessage({ data: { type: "RESULT", taskId: message.taskId, value } }));
  } };
  const client = createWaterRasterWorkerClient({ isSupported: () => true, nowMs: () => clock,
    createWorker: () => { clock += 2; return worker; },
    packGeometry: async () => { packCalls++; clock += 5;
      return { payload: {}, transfer: [new ArrayBuffer(24), new ArrayBuffer(8)] }; },
    createBitmap: async () => { clock += 3; return { close() {} }; },
  });
  const patternedInput = { ...input, patternSource: { revision: "R", canvas: {} } };
  try {
    const cold = await client.request(patternedInput);
    assert.equal(cold.bitmap, bitmap);
    assert.deepEqual(cold.stats, { totalMs: 4, pathBuildCount: 0, queueWaitMs: 0,
      prepareMs: 2, packingMs: 5, syncRoundTripMs: 7, patternMs: 3, buildRoundTripMs: 11,
      geometryUploadCount: 1, geometryUploadBytes: 32 });
    for (const value of Object.values(cold.stats)) assert.ok(Number.isFinite(value) && value >= 0);
    const hot = await client.request(patternedInput);
    assert.equal(hot.stats.packingMs, 0);
    assert.equal(hot.stats.syncRoundTripMs, 0);
    assert.equal(hot.stats.geometryUploadCount, 0);
    assert.equal(hot.stats.geometryUploadBytes, 0);
    assert.equal(hot.stats.patternMs, 0);
    assert.equal(hot.stats.buildRoundTripMs, 11);
    assert.equal(packCalls, 1);
    assert.equal(syncCalls, 1);
  } finally { client.dispose(); }
});

test("water queue waiting is observable independently from the active build", async () => {
  let clock = 0, delayedBuild, markFirstStarted;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const worker = { terminate() {}, postMessage(message) {
    if (message.type === "BUILD_WATER_BITMAP" && message.packet.identity === "one") {
      delayedBuild = message;
      markFirstStarted();
      return;
    }
    const value = message.type === "SYNC_WATER_GEOMETRY" ? { resident: message.versions } : { bitmap: { close() {} } };
    queueMicrotask(() => worker.onmessage({ data: { type: "RESULT", taskId: message.taskId, value } }));
  } };
  const client = createWaterRasterWorkerClient({ createWorker: () => worker, isSupported: () => true, nowMs: () => clock });
  try {
    const first = client.request(input);
    await firstStarted;
    clock = 10;
    const second = client.request({ ...input, identity: "two" });
    clock = 40;
    worker.onmessage({ data: { type: "RESULT", taskId: delayedBuild.taskId, value: { bitmap: { close() {} } } } });
    const [active, queued] = await Promise.all([first, second]);
    assert.equal(active.stats.queueWaitMs, 0);
    assert.equal(active.stats.buildRoundTripMs, 40);
    assert.equal(queued.stats.queueWaitMs, 30);
    assert.equal(queued.stats.buildRoundTripMs, 0);
    assert.equal(queued.stats.packingMs, 0);
    assert.equal(queued.stats.syncRoundTripMs, 0);
  } finally { client.dispose(); }
});
