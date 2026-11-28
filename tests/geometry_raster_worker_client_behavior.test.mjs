import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const tick = () => new Promise(setImmediate);
const updatesOf = packet => packet.geometryTransport?.encoding === "geo-f64-batches-v1"
  ? packet.geometryTransport.batches.flatMap(batch => batch?.encoding === "geo-f64-v1"
    ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(batch) : batch)
  : packet.geometryUpdates || globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(packet.geometryTransport);

test("large geometry dispatch transfers fresh buffers while source coordinates remain usable", async () => {
  const sent = [];
  const worker = { postMessage(message, transfer) {
    sent.push(structuredClone(message, { transfer }));
    assert.ok(transfer.every((buffer) => buffer.byteLength === 0));
  }, terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
  const large = { type: "Feature", geometry: { type: "LineString", coordinates: Array.from({ length: 10_000 }, (_, i) => [i + 0.123456789, -i]) } };
  const entries = [{ id: "large", feature: large }];
  const first = client.request({ identity: "large-one", kind: "political", sceneKey: "tno", projectionKey: 1, entries });
  await tick();
  assert.equal(sent[0].packet.geometryUpdates, null);
  assert.deepEqual(updatesOf(sent[0].packet), [{ id: "large", feature: large }]);
  worker.onmessage({ data: { taskId: sent[0].taskId, result: { bitmap: { close() {} } } } });
  await first;
  assert.equal(large.geometry.coordinates.length, 10_000);
  client.dispose();
});
