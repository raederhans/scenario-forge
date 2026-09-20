import test from "node:test";
import assert from "node:assert/strict";
import { createChunkLoadScheduler, estimateChunkLoadBytes } from "../js/core/scenario/chunk_load_scheduler.js";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
const flush = () => new Promise(setImmediate);
function gate() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test("scheduler admits work by both concurrent count and estimated bytes", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 2, maxInFlightBytes: 10 });
  const a = gate(), b = gate(); let starts = 0;
  const first = scheduler.schedule(() => { starts++; return a.promise; }, { bytes: 6 });
  const second = scheduler.schedule(() => { starts++; return b.promise; }, { bytes: 6 });
  await flush(); assert.equal(starts, 1); assert.equal(scheduler.getStats().inFlightEstimatedBytes, 6);
  a.resolve("a"); await first; await flush(); assert.equal(starts, 2);
  b.resolve("b"); assert.equal(await second, "b");
  assert.equal(scheduler.getStats().active, 0);
  assert.equal(scheduler.getStats().peakEstimatedBytes, 6);
});

test("scheduler honors count limit even with plenty of bytes", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 2, maxInFlightBytes: 100 });
  const gates = [gate(), gate(), gate()]; let starts = 0;
  const pending = gates.map((g) => scheduler.schedule(() => { starts++; return g.promise; }, { bytes: 1 }));
  await flush(); assert.equal(starts, 2);
  gates[0].resolve(); await flush(); assert.equal(starts, 3);
  gates[1].resolve(); gates[2].resolve(); await Promise.all(pending);
  assert.equal(scheduler.getStats().peakActive, 2);
});

test("oversized head runs alone without starvation from smaller jobs", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 4, maxInFlightBytes: 10 });
  const a = gate(), b = gate(), c = gate(), starts = [];
  const tasks = [[a, 2], [b, 20], [c, 1]].map(([g, bytes], i) => scheduler.schedule(() => { starts.push(i); return g.promise; }, { bytes }));
  await flush(); assert.deepEqual(starts, [0]);
  a.resolve(); await flush(); assert.deepEqual(starts, [0, 1]);
  assert.equal(scheduler.getStats().overBudgetBytes, 10);
  b.resolve(); await flush(); assert.deepEqual(starts, [0, 1, 2]);
  c.resolve(); await Promise.all(tasks); assert.equal(scheduler.getStats().overBudgetBytes, 0);
});

test("queued requests can be reprioritized without changing result ownership", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 1 });
  const first = gate(), starts = [];
  const a = scheduler.schedule(() => first.promise);
  await flush();
  const b = scheduler.schedule(() => { starts.push("old"); return "old"; }, { key: "old" });
  const c = scheduler.schedule(() => { starts.push("new"); return "new"; }, { key: "new" });
  scheduler.reprioritize("new", 2); first.resolve();
  assert.deepEqual(await Promise.all([a, b, c]), [undefined, "old", "new"]);
  assert.deepEqual(starts, ["new", "old"]);
});

test("queued abort does not start a fetch; running abort retains reservation until settlement", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 1 });
  const running = gate(), active = new AbortController(), queued = new AbortController();
  const a = scheduler.schedule(() => running.promise, { signal: active.signal });
  const rejectA = assert.rejects(a, { name: "AbortError" });
  await flush();
  let called = false;
  const b = scheduler.schedule(() => { called = true; }, { signal: queued.signal });
  const rejectB = assert.rejects(b, { name: "AbortError" });
  queued.abort(); active.abort(); await flush();
  assert.equal(called, false); assert.equal(scheduler.getStats().active, 1);
  running.resolve(); await Promise.all([rejectA, rejectB]);
  assert.equal(scheduler.getStats().active, 0); assert.equal(scheduler.getStats().queued, 0);
});

test("failure and throwing diagnostics cannot strand later tasks", async () => {
  const scheduler = createChunkLoadScheduler({ maxConcurrent: 1, onMetric() { throw new Error("diagnostics"); } });
  const bad = scheduler.schedule(() => { throw new Error("fetch failure"); });
  const good = scheduler.schedule(() => 42);
  await assert.rejects(bad, /fetch failure/); assert.equal(await good, 42);
  assert.equal(scheduler.getStats().inFlightEstimatedBytes, 0);
});

test("unknown or compressed-only weights do not bypass admission", () => {
  assert.ok(estimateChunkLoadBytes({}) > 0);
  assert.equal(estimateChunkLoadBytes({ decodedByteSize: 50, byteSize: 10, cacheByteSize: 60 }), 60);
  assert.equal(estimateChunkLoadBytes({ decodedByteSize: NaN, byteSize: 10 }), 10);
});

function loaderHarness() {
  const pending = new Map(), starts = [], scheduler = createChunkLoadScheduler({ maxConcurrent: 1, maxInFlightBytes: 10 });
  const bundle = { id: "tno" }, state = { activeScenarioId: "tno", activeScenarioChunks: { scenarioId: "tno", payloadByChunkId: {} }, scenarioBundleCacheById: { tno: bundle } };
  const loader = createScenarioChunkPayloadLoader({ runtimeState: state, normalizeScenarioId: (id) => String(id || "").trim(), getScenarioBundleId: (b) => b.id,
    loadScheduler: scheduler, loadScenarioChunkFile: (url) => { starts.push(url); const g = gate(); pending.set(url, g); return g.promise; } });
  const meta = (id) => ({ id, url: id, layer: "political", decodedByteSize: 6 });
  return { pending, starts, bundle, state, loader, meta };
}

test("real loader deduplicates queued and active callers while retaining generation-safe completion", async () => {
  const h = loaderHarness();
  const a = h.loader.loadScenarioChunkPayload(h.bundle, h.meta("a"));
  const again = h.loader.loadScenarioChunkPayload(h.bundle, h.meta("a"));
  const b = h.loader.loadScenarioChunkPayload(h.bundle, h.meta("b"));
  await flush(); assert.deepEqual(h.starts, ["a"]);
  h.pending.get("a").resolve({ payload: { features: [] } });
  assert.equal(await a, await again); await flush(); assert.deepEqual(h.starts, ["a", "b"]);
  h.pending.get("b").resolve({ payload: { features: [] } }); await b;
  assert.equal(h.loader.getLoadSchedulerStats().active, 0);
  assert.equal(await h.loader.loadScenarioChunkPayload(h.bundle, h.meta("a")), await a);
});

test("real loader scene switch cancels queued fetches and rejects late outgoing results", async () => {
  const h = loaderHarness();
  const a = h.loader.loadScenarioChunkPayload(h.bundle, h.meta("a"));
  const b = h.loader.loadScenarioChunkPayload(h.bundle, h.meta("b"));
  const failures = Promise.all([assert.rejects(a, { name: "AbortError" }), assert.rejects(b, { name: "AbortError" })]);
  await flush(); h.loader.resetScenarioChunkRequests("other");
  h.pending.get("a").resolve({ payload: { features: [] } }); await failures;
  assert.deepEqual(h.starts, ["a"]);
  assert.equal(h.bundle.chunkPayloadCacheById.a, undefined);
  assert.equal(h.state.runtimeChunkLoadState.inFlightByChunkId.a, undefined);
  assert.equal(h.state.runtimeChunkLoadState.inFlightByChunkId.b, undefined);
  assert.equal(h.loader.getLoadSchedulerStats().active, 0);
});
