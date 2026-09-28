import assert from "node:assert/strict";
import test from "node:test";

import "../js/core/geometry_transfer_codec_shared.js";
import { createBathymetryWorkerClient } from "../js/core/bathymetry_worker_client.js";

const tick = () => new Promise(setImmediate);

function fixture(options = {}) {
  const sent = [];
  const worker = {
    terminated: false,
    postMessage(message) { sent.push(message); },
    terminate() { this.terminated = true; },
  };
  const client = createBathymetryWorkerClient({
    createWorker: () => worker,
    isSupported: () => true,
    ...options,
  });
  const reply = (index, fields) => worker.onmessage({ data: { taskId: sent[index].taskId, ...fields } });
  return { client, sent, worker, reply };
}

test("worker load returns unpacked detail and overview geometry with measured unpack time", async () => {
  const { client, sent, reply } = fixture();
  const pending = client.load("/data/bathymetry.topo.json");
  await tick();
  assert.equal(sent[0].type, "LOAD_BATHYMETRY");
  assert.match(sent[0].url, /\/data\/bathymetry\.topo\.json$/);
  const entry = {
    url: sent[0].url,
    topology: { type: "Topology", bbox: [0, 0, 1, 1] },
    bands: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: Array.from({ length: 9000 }, (_, i) => [i, i]) } }] },
    contours: null,
    bandsOverview: { type: "FeatureCollection", features: [] },
    contoursOverview: null,
    geometryDiagnostics: { polygonCount: 1 },
    overviewGeometryDiagnostics: { polygonCount: 0 },
    timings: { decodeMs: 4 },
  };
  const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(entry);
  assert.equal(packed.transferables.length, 2);
  reply(0, { type: "BATHYMETRY_READY", geometryTransport: packed.payload, timings: { packMs: 2 } });
  const result = await pending;
  assert.deepEqual(result.bands, entry.bands);
  assert.deepEqual(result.bandsOverview, entry.bandsOverview);
  assert.equal(result.timings.decodeMs, 4);
  assert.equal(result.timings.packMs, 2);
  assert.ok(result.timings.unpackMs >= 0);
  client.dispose();
});

test("asset task errors reject without disabling worker or retrying the URL", async () => {
  const { client, sent, reply, worker } = fixture();
  const pending = client.load("/missing.json");
  await tick();
  reply(0, { type: "ERROR", errorKind: "asset", message: "HTTP 404" });
  await assert.rejects(pending, /HTTP 404/);
  assert.equal(client.available(), true);
  assert.equal(worker.terminated, false);
  assert.equal(sent.length, 1);
  const invalid = client.load("/invalid.json");
  await tick();
  reply(1, { type: "ERROR", errorKind: "asset", message: "Invalid bathymetry topology." });
  await assert.rejects(invalid, /Invalid bathymetry topology/);
  client.dispose();
});

test("unsupported, creation error, crash and timeout allow main-thread fallback", async () => {
  const unsupported = createBathymetryWorkerClient({ isSupported: () => false });
  assert.equal(await unsupported.load("/a.json"), null);

  const creation = createBathymetryWorkerClient({ isSupported: () => true, createWorker: () => { throw Error("blocked"); } });
  assert.equal(await creation.load("/a.json"), null);
  assert.equal(creation.available(), false);

  const crashed = fixture();
  const pending = crashed.client.load("/a.json");
  await tick();
  crashed.worker.onerror({ message: "worker crashed" });
  assert.equal(await pending, null);
  assert.equal(crashed.client.available(), false);
  assert.equal(crashed.worker.terminated, true);

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let fireTimeout;
  try {
    globalThis.setTimeout = (callback) => { fireTimeout = callback; return 1; };
    globalThis.clearTimeout = () => {};
    const timed = fixture();
    const task = timed.client.load("/a.json");
    await tick();
    fireTimeout();
    assert.equal(await task, null);
    assert.equal(timed.client.available(), false);
    assert.equal(timed.worker.terminated, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("dispose resolves pending load as fallback and terminates worker", async () => {
  const { client, worker } = fixture();
  const pending = client.load("/a.json");
  await tick();
  client.dispose();
  assert.equal(await pending, null);
  assert.equal(worker.terminated, true);
  assert.equal(client.available(), false);
});

test("runtime task error disables the worker and lets the caller use its fallback", async () => {
  const { client, worker, reply } = fixture();
  const pending = client.load("/a.json");
  await tick();
  reply(0, { type: "ERROR", errorKind: "runtime", message: "transport failed" });
  assert.equal(await pending, null);
  assert.equal(worker.terminated, true);
  assert.equal(client.available(), false);
});
