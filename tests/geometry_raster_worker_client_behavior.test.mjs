import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const tick = () => new Promise(setImmediate);
const feature = { geometry: { type: "Point", coordinates: [1, 2] } };
const input = (identity, kind = "political", extra = {}) => ({
  identity, kind, sceneKey: "tno", projectionKey: 1,
  entries: [{ id: "a", feature, fillColor: "#123456" }], ...extra,
});
function fixture(extra = {}) {
  const sent = [], metrics = [];
  let terminations = 0, creations = 0;
  const worker = { postMessage: (message) => sent.push(message), terminate: () => { terminations += 1; } };
  const client = createGeometryRasterWorkerClient({
    createWorker: () => { creations += 1; return worker; }, isSupported: () => true,
    onMetric: (...args) => metrics.push(args), ...extra,
  });
  const reply = (index, extraMessage = {}) => {
    const bitmap = { closes: 0, close() { this.closes += 1; } };
    worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[index].taskId, result: { bitmap }, ...extraMessage } });
    return bitmap;
  };
  return { client, sent, metrics, worker, reply, terminations: () => terminations, creations: () => creations };
}
test("one active plus latest per kind coalesces identical requests and retires replaced queued requests", async () => {
  const { client, sent, reply } = fixture();
  const first = client.request(input("one"));
  assert.equal(client.request(input("one")), first);
  const replaced = client.request(input("two"));
  const latest = client.request(input("three"));
  assert.equal(client.request(input("three")), latest);
  const hit = client.request(input("hit", "hit"));
  assert.equal(client.getQueueSize(), 3);
  assert.equal(await replaced, null);
  await tick();
  assert.equal(sent.length, 1);
  reply(0); await first; await tick();
  assert.equal(sent[1].packet.kind, "political");
  reply(1); await latest; await tick();
  assert.equal(sent[2].packet.kind, "hit");
  reply(2); await hit;
  assert.equal(client.getQueueSize(), 0);
  client.dispose();
});
test("geometry is acknowledged after success, replaced by geometry reference and reset for a new scene", async () => {
  const { client, sent, reply } = fixture();
  const first = client.request(input("one"));
  const second = client.request(input("two", "hit"));
  await tick();
  assert.equal(sent[0].packet.resetGeometry, true);
  assert.equal(sent[0].packet.geometryUpdates.length, 1);
  reply(0); await first; await tick();
  assert.equal(sent[1].packet.geometryUpdates.length, 0);
  assert.equal(sent[1].packet.resetGeometry, false);
  reply(1); await second;
  const replacement = { geometry: { type: "Point", coordinates: [3, 4] } };
  const third = client.request(input("three", "hit", { entries: [{ id: "a", feature: replacement }] }));
  await tick();
  assert.equal(sent[2].packet.geometryUpdates[0].feature, replacement);
  reply(2); await third;
  const fourth = client.request(input("four", "hit", { sceneKey: "hoi4" }));
  await tick();
  assert.equal(sent[3].packet.resetGeometry, true);
  assert.equal(sent[3].packet.geometryUpdates.length, 1);
  reply(3); await fourth;
  client.dispose();
});
test("worker failure disables fallback, drains queued promises and closes unknown or duplicate bitmaps", async () => {
  const { client, sent, reply, worker, terminations } = fixture();
  const first = client.request(input("one"));
  const queued = client.request(input("two"));
  await tick();
  const failed = reply(0, { type: "ERROR", message: "unsupported" });
  assert.equal(await first, null);
  assert.equal(await queued, null);
  assert.equal(failed.closes, 1);
  assert.equal(client.available(), false);
  assert.equal(terminations(), 1);
  const late = reply(0);
  assert.equal(late.closes, 1);
  assert.equal(await client.request(input("three")), null);
  assert.equal(sent.length, 1);
  const orphan = { closes: 0, close() { this.closes++; } };
  worker.onmessage({ data: { taskId: "orphan", result: { bitmap: orphan } } });
  assert.equal(orphan.closes, 1);
});
test("malformed entries and throwing diagnostics never strand requests", async () => {
  for (const entries of [null, [{}], [null]]) {
    const { client } = fixture({ onMetric: () => { throw Error("diagnostics"); } });
    assert.equal(await client.request(input("bad", "political", { entries })), null);
    assert.equal(client.getQueueSize(), 0);
    assert.equal(client.available(), false);
  }
});
test("missing bitmap is not an ACK and successful diagnostics failure does not disable rendering", async () => {
  const failed = fixture();
  const pending = failed.client.request(input("missing"));
  await tick();
  failed.reply(0, { result: {} });
  assert.equal(await pending, null);
  assert.equal(failed.client.available(), false);
  const healthy = fixture({ onMetric: () => { throw Error("diagnostics"); } });
  const valid = healthy.client.request(input("valid"));
  await tick();
  const bitmap = healthy.reply(0);
  assert.equal((await valid).bitmap, bitmap);
  assert.equal(bitmap.closes, 0, "successful result is owned by the caller");
  assert.equal(healthy.client.available(), true);
  healthy.client.dispose();
  bitmap.close();
});
test("dispose before dispatch and after response delivery releases requests and bitmap", async () => {
  const early = fixture();
  const pending = early.client.request(input("one"));
  early.client.dispose();
  assert.equal(await pending, null);
  assert.equal(early.creations(), 0);
  const late = fixture();
  const rendered = late.client.request(input("one"));
  const queued = late.client.request(input("two"));
  await tick();
  const bitmap = late.reply(0);
  const duplicate = late.reply(0);
  assert.equal(duplicate.closes, 1);
  late.client.dispose();
  assert.equal(await rendered, null);
  assert.equal(await queued, null);
  assert.equal(bitmap.closes, 1);
  assert.equal(late.client.getQueueSize(), 0);
});
