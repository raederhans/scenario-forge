import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const tick = () => new Promise(setImmediate);

test("worker eviction acknowledgement causes the next use to re-upload even after a stale frame", async () => {
  const { client, sent, reply } = fixture();
  const first = client.request(input("old"));
  const second = client.request(input("new"));
  await tick();
  reply(0, { result: { bitmap: { close() {} }, evictedGeometryIds: ["a"] } });
  await first; await tick();
  assert.equal(sent[1].packet.geometryUpdates.length, 1);
  assert.equal(sent[1].packet.geometryUpdates[0].id, "a");
  reply(1); await second; client.dispose();
});

test("large geometry dispatch transfers fresh buffers while source and acknowledged reuse remain usable", async () => {
  const sent = [];
  const worker = { postMessage(message, transfer) {
    sent.push(structuredClone(message, { transfer }));
    assert.ok(transfer.every((buffer) => buffer.byteLength === 0));
  }, terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true });
  const large = { type: "Feature", geometry: { type: "LineString", coordinates: Array.from({ length: 10_000 }, (_, i) => [i, -i]) } };
  const entries = [{ id: "large", feature: large }];
  const first = client.request(input("large-one", "political", { entries }));
  await tick();
  assert.equal(sent[0].packet.geometryUpdates, null);
  assert.deepEqual(globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(sent[0].packet.geometryTransport), [{ id: "large", feature: large }]);
  worker.onmessage({ data: { taskId: sent[0].taskId, result: { bitmap: { close() {} } } } });
  await first;
  const second = client.request(input("large-two", "hit", { entries }));
  await tick();
  assert.deepEqual(sent[1].packet.geometryUpdates, []);
  assert.equal(sent[1].packet.geometryTransport, null);
  assert.equal(large.geometry.coordinates.length, 10_000);
  worker.onmessage({ data: { taskId: sent[1].taskId, result: { bitmap: { close() {} } } } });
  await second;
  client.dispose();
});
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

// ── Acceptance criteria: removal tracking and bounded geometry retention ──

test("departed entry IDs receive null geometry updates to release worker kernel storage", async () => {
  const featureA = { geometry: { type: "Point", coordinates: [1, 2] } };
  const featureB = { geometry: { type: "Point", coordinates: [3, 4] } };
  const { client, sent, reply } = fixture();

  // First request: entries [a, b]
  const first = client.request({
    identity: "one", kind: "political", sceneKey: "tno", projectionKey: 1,
    entries: [{ id: "a", feature: featureA, fillColor: "#111" }, { id: "b", feature: featureB, fillColor: "#222" }],
  });
  await tick();
  assert.equal(sent[0].packet.resetGeometry, true);
  assert.equal(sent[0].packet.geometryUpdates.length, 2, "both entries uploaded on first request");
  reply(0); await first; await tick();

  // Second request: only entry [a] — b is removed
  const second = client.request({
    identity: "two", kind: "political", sceneKey: "tno", projectionKey: 1,
    entries: [{ id: "a", feature: featureA, fillColor: "#111" }],
  });
  await tick();
  assert.equal(sent[1].packet.resetGeometry, false, "same scene: no full reset");
  // geometry for 'a' unchanged → no upload; 'b' removed → null update
  const updates1 = sent[1].packet.geometryUpdates;
  assert.equal(updates1.length, 1, "exactly one removal update");
  assert.equal(updates1[0].id, "b");
  assert.equal(updates1[0].feature, null, "null signals kernel to release b");
  reply(1); await second;
  client.dispose();
});

test("same-scene topology revision does not reset geometry store; only changed geometry is re-uploaded", async () => {
  const featureA = { geometry: { type: "Point", coordinates: [1, 2] } };
  const featureAv2 = { geometry: { type: "Point", coordinates: [9, 9] } };
  const { client, sent, reply } = fixture();

  // First dispatch with sceneKey "tno:1" (workerSceneKey format from runtime owner)
  const first = client.request({
    identity: "one", kind: "political", sceneKey: "tno:1", projectionKey: 1,
    entries: [{ id: "a", feature: featureA, fillColor: "#111" }],
  });
  await tick();
  assert.equal(sent[0].packet.resetGeometry, true, "first ever dispatch resets");
  reply(0); await first; await tick();

  // Simulate topology revision (scenarioDataGeneration bump): sceneKey unchanged
  const second = client.request({
    identity: "two", kind: "political", sceneKey: "tno:1", projectionKey: 1,
    entries: [{ id: "a", feature: featureA, fillColor: "#111" }],
  });
  await tick();
  assert.equal(sent[1].packet.resetGeometry, false, "same sceneKey: incremental, no reset");
  assert.equal(sent[1].packet.geometryUpdates.length, 0, "unchanged geometry: no re-upload");
  reply(1); await second; await tick();

  // Now geometry for 'a' changed (e.g. new chunk promoted same ID)
  const third = client.request({
    identity: "three", kind: "political", sceneKey: "tno:1", projectionKey: 1,
    entries: [{ id: "a", feature: featureAv2, fillColor: "#111" }],
  });
  await tick();
  assert.equal(sent[2].packet.resetGeometry, false, "still same scene");
  assert.equal(sent[2].packet.geometryUpdates.length, 1, "changed geometry uploads only that ID");
  assert.equal(sent[2].packet.geometryUpdates[0].id, "a");
  assert.equal(sent[2].packet.geometryUpdates[0].feature, featureAv2);
  reply(2); await third;
  client.dispose();
});

test("geometry refs are bounded to current active IDs after each successful round-trip", async () => {
  // This validates that departed IDs don't accumulate across many round-trips.
  const features = Array.from({ length: 5 }, (_, i) => ({ geometry: { type: "Point", coordinates: [i, i] } }));
  const { client, sent, reply } = fixture();

  // Round 1: IDs 0-4
  const first = client.request({
    identity: "r1", kind: "political", sceneKey: "s", projectionKey: 1,
    entries: features.map((feature, i) => ({ id: String(i), feature, fillColor: "#aaa" })),
  });
  await tick();
  reply(0); await first; await tick();

  // Round 2: only ID 0
  const second = client.request({
    identity: "r2", kind: "political", sceneKey: "s", projectionKey: 1,
    entries: [{ id: "0", feature: features[0], fillColor: "#aaa" }],
  });
  await tick();
  const updates = sent[1].packet.geometryUpdates;
  // IDs 1-4 departed → 4 null removals
  const removals = updates.filter((u) => u.feature === null);
  assert.equal(removals.length, 4, "4 null removals for 4 departed IDs");
  assert.ok(removals.every((u) => u.id !== "0"), "active ID not removed");
  reply(1); await second; await tick();

  // Round 3: only ID 0 again — no removals, no uploads
  const third = client.request({
    identity: "r3", kind: "political", sceneKey: "s", projectionKey: 1,
    entries: [{ id: "0", feature: features[0], fillColor: "#aaa" }],
  });
  await tick();
  assert.equal(sent[2].packet.geometryUpdates.length, 0, "no spurious re-removal of already-gone IDs");
  reply(2); await third;
  client.dispose();
});

test("alternating hit and political requests retain their active union then release departed IDs", async () => {
  const { client, sent, reply } = fixture();
  const a = { geometry: { type: "Point", coordinates: [0, 0] } };
  const b = { geometry: { type: "Point", coordinates: [1, 1] } };
  const entries = [{ id: "a", feature: a }, { id: "b", feature: b }];
  const requests = [["political", entries], ["hit", entries.slice(0, 1)], ["political", entries], ["political", entries.slice(0, 1)]];
  for (let index = 0; index < requests.length; index += 1) {
    const [kind, selected] = requests[index];
    const promise = client.request({ identity: String(index), sceneKey: "same", kind, entries: selected });
    await tick();
    if (index === 1 || index === 2) assert.deepEqual(sent[index].packet.geometryUpdates, []);
    if (index === 3) assert.deepEqual(sent[index].packet.geometryUpdates, [{ id: "b", feature: null }]);
    reply(index); await promise; await tick();
  }
  client.dispose();
});
