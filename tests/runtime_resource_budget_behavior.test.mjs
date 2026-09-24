import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeResourceBudget, RESOURCE_CATEGORIES } from "../js/core/runtime_resource_budget.js";
import { createChunkLoadScheduler } from "../js/core/scenario/chunk_load_scheduler.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("resource snapshots distinguish unknown categories from measured zero and cannot mutate accounting", () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const a = Symbol("a"), b = Symbol("b");
  assert.deepEqual(budget.snapshot().unmeasuredCategories, RESOURCE_CATEGORIES);
  budget.update(a, { mainChunkPayload: 40, bitmaps: null });
  budget.update(b, { workerGeometry: 30, projectedPaths: 0 });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.estimatedBytes, 70);
  assert.ok(snapshot.unmeasuredCategories.includes("bitmaps"));
  assert.ok(!snapshot.unmeasuredCategories.includes("projectedPaths"));
  snapshot.categories.mainChunkPayload = 9000;
  assert.equal(budget.snapshot().estimatedBytes, 70);
  assert.equal(budget.admitSpeculative(30).admitted, true);
  assert.equal(budget.admitSpeculative(31).reason, "shared-resource-pressure");
  budget.release(a);
  assert.equal(budget.snapshot().estimatedBytes, 30);
  assert.equal(budget.snapshot().peakEstimatedBytes, 70);
  budget.release(b);
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("resource updates reject malformed values atomically and subscriptions are disposable", () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const owner = Symbol();
  budget.update(owner, { mainChunkPayload: 20 });
  for (const value of [-1, Infinity, NaN, "2", 1.5]) {
    assert.throws(() => budget.update(owner, { mainChunkPayload: 0, bitmaps: value }), TypeError);
    assert.equal(budget.snapshot().estimatedBytes, 20);
  }
  assert.throws(() => budget.update("name", {}), TypeError);
  assert.throws(() => budget.update(owner, { invented: 1 }), TypeError);
  assert.throws(() => budget.admitSpeculative(-1), TypeError);
  let changes = 0;
  const unsubscribe = budget.subscribe(() => { changes++; });
  const bad = budget.subscribe(() => { throw new Error("diagnostic failure"); });
  budget.update(owner, { mainChunkPayload: 20 });
  assert.equal(changes, 0);
  budget.release(owner);
  assert.equal(changes, 1);
  unsubscribe(); bad();
  budget.update(owner, { mainChunkPayload: 30 });
  assert.equal(changes, 1);
});

test("speculative work waits under pressure while required work passes and release wakes the queue", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const owner = Symbol();
  budget.update(owner, { workerGeometry: 90 });
  const scheduler = createChunkLoadScheduler({ resourceBudget: budget, maxConcurrent: 1, maxInFlightBytes: 100 });
  const events = [];
  const prewarm = scheduler.schedule(() => { events.push("prewarm"); return "warm"; }, { bytes: 20, speculative: true });
  await tick();
  assert.equal(scheduler.getStats().pressureBlocked, true);
  const visible = scheduler.schedule(() => { events.push("visible"); return "visible"; }, { bytes: 20, priority: 1 });
  assert.equal(await visible, "visible");
  assert.deepEqual(events, ["visible"]);
  budget.release(owner);
  assert.equal(await prewarm, "warm");
  assert.deepEqual(events, ["visible", "prewarm"]);
  await tick();
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("joining a blocked prewarm as an explicit request promotes rather than deadlocks", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const owner = Symbol(); budget.update(owner, { mainChunkPayload: 100 });
  const scheduler = createChunkLoadScheduler({ resourceBudget: budget });
  const key = {};
  const promise = scheduler.schedule(() => 7, { key, bytes: 10, speculative: true });
  await tick();
  assert.equal(scheduler.getStats().active, 0);
  scheduler.promote(key, 1);
  assert.equal(await promise, 7);
  budget.release(owner);
});

test("aborting a queued speculative load removes its subscriber and rejects without starting", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 10 });
  const owner = Symbol(); budget.update(owner, { transport: 10 });
  const scheduler = createChunkLoadScheduler({ resourceBudget: budget });
  const controller = new AbortController();
  let starts = 0;
  const promise = scheduler.schedule(() => { starts++; }, { bytes: 10, speculative: true, signal: controller.signal });
  const rejected = assert.rejects(promise, { name: "AbortError" });
  await tick(); controller.abort(); await rejected; await tick();
  budget.release(owner); await tick();
  assert.equal(starts, 0);
  assert.equal(scheduler.getStats().queued, 0);
  assert.equal(scheduler.getStats().pressureBlocked, false);
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("ignored abort retains its real in-flight reservation until the underlying operation settles", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const scheduler = createChunkLoadScheduler({ resourceBudget: budget, maxConcurrent: 1, maxInFlightBytes: 50 });
  const pending = deferred(), controller = new AbortController();
  const promise = scheduler.schedule(() => pending.promise, { bytes: 40, signal: controller.signal });
  const rejected = assert.rejects(promise, { name: "AbortError" });
  await tick(); controller.abort(); await tick();
  assert.equal(budget.snapshot().categories.inFlight, 40);
  assert.equal(scheduler.getStats().active, 1);
  pending.resolve(1); await rejected; await tick();
  assert.equal(budget.snapshot().estimatedBytes, 0);
});

test("two schedulers see the same reservations and an error releases capacity", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const first = createChunkLoadScheduler({ resourceBudget: budget });
  const second = createChunkLoadScheduler({ resourceBudget: budget });
  const pending = deferred();
  const active = first.schedule(() => pending.promise, { bytes: 70 });
  const failed = assert.rejects(active, /expected/);
  await tick();
  let started = false;
  const waiting = second.schedule(() => { started = true; }, { bytes: 40, speculative: true });
  await tick(); assert.equal(started, false);
  pending.reject(new Error("expected")); await failed; await waiting;
  assert.equal(started, true);
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("original per-scheduler limits and single required oversized admission are retained", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 100 });
  const scheduler = createChunkLoadScheduler({ resourceBudget: budget, maxConcurrent: 2, maxInFlightBytes: 20 });
  const pending = deferred();
  const first = scheduler.schedule(() => pending.promise, { bytes: 25 });
  await tick();
  let nextStarted = false;
  const second = scheduler.schedule(() => { nextStarted = true; }, { bytes: 1 });
  await tick(); assert.equal(nextStarted, false);
  assert.equal(scheduler.getStats().overBudgetBytes, 5);
  pending.resolve(); await first; await second;
  assert.equal(scheduler.getStats().peakActive, 1);
});
