import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalPatchPreviewBudget } from "../js/core/renderer/political_patch_preview_budget.js";
import { createContextLayerRenderScheduler } from "../js/core/renderer/context_layer_render_scheduler.js";
const pointFeature = (count = 5) => ({ geometry: { type: "Polygon", coordinates: [Array.from({ length: count }, (_, i) => [i, 0])] } });

test("small previews fit; bulk rejection never traverses geometry", () => {
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  assert.equal(budget.inspect([{ feature: pointFeature() }]).allowed, true);
  const entries = Array.from({ length: 25 }, () => ({ get feature() { throw Error("must not scan bulk"); } }));
  assert.equal(budget.inspect(entries).reason, "feature-budget");
  assert.equal(budget.isDeferred(), true);
  budget.reset(); assert.equal(budget.isDeferred(), false);
});
test("one giant cold polygon has bounded inspection but cached paths remain cheap", () => {
  let reads = 0;
  const coordinates = new Proxy(Array.from({ length: 2500 }, () => [1, 2]), {
    get(target, prop, receiver) { if (/^\d+$/.test(String(prop))) reads++; return Reflect.get(target, prop, receiver); },
  });
  const entries = [{ feature: { geometry: { type: "Polygon", coordinates: [coordinates] } } }];
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  assert.equal(budget.inspect(entries).reason, "cold-path-budget");
  assert.ok(reads <= 2500);
  reads = 0;
  assert.equal(budget.inspect(entries, () => true).allowed, true);
  assert.equal(reads, 0);
});
test("structurally huge empty multipolygons cannot monopolize the estimator", () => {
  const budget = createPoliticalPatchPreviewBudget({ now: () => 0 });
  const entries = [{ feature: { geometry: { type: "MultiPolygon", coordinates: new Array(100000).fill([]) } } }];
  assert.equal(budget.inspect(entries).reason, "structure-budget");
});
test("inspection and between-feature time limits are independent of frame scheduling", () => {
  let clock = 0;
  const budget = createPoliticalPatchPreviewBudget({ now: () => clock++ });
  assert.equal(budget.inspect(Array.from({ length: 10 }, () => ({ feature: pointFeature() })), () => true).reason, "inspection-time-budget");
  assert.equal(budget.timeRemaining(0), false);
});
function schedulerFixture() {
  let identity = ["tno", 1], time = 0;
  const jobs = [], calls = [], metrics = [];
  const owner = createContextLayerRenderScheduler({ getIdentity: () => identity,
    now: () => time, schedule: (fn, delay) => { const job = { fn, delay }; jobs.push(job); return job; },
    cancel: (job) => { job.cancelled = true; }, requestRender: (...args) => calls.push(args),
    recordMetric: (...args) => metrics.push(args) });
  return { owner, jobs, calls, metrics, switchScene: () => { identity = ["hoi4", 2]; }, advance: () => { time += 10; } };
}
test("layer completions share a non-restarting bounded window and never flush", () => {
  const f = schedulerFixture();
  f.owner.request(["urban"], "preset"); f.advance(); f.owner.request(["rivers", "urban"], "preset");
  assert.equal(f.jobs.length, 1); assert.equal(f.jobs[0].delay, 32); assert.equal(f.calls.length, 0);
  f.jobs[0].fn();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].flush, false);
  assert.deepEqual(f.metrics[0][2].layers, ["urban", "rivers"]); assert.equal(f.metrics[0][2].requestCount, 2);
  assert.equal(f.owner.hasPending(), false);
});
test("a scene change or reset invalidates an already queued layer callback", () => {
  const f = schedulerFixture(); f.owner.request(["urban"], "old"); f.switchScene();
  f.jobs[0].fn(); assert.equal(f.calls.length, 0);
  f.owner.request(["rivers"], "new"); f.owner.reset(); f.jobs[1].fn();
  assert.equal(f.calls.length, 0); assert.equal(f.jobs[1].cancelled, true);
});
test("new scene replaces old batch while stale callbacks cannot cancel new work", () => {
  const f = schedulerFixture(); f.owner.request(["urban"], "old"); f.switchScene(); f.owner.request(["physical"], "new");
  f.jobs[0].fn(); assert.equal(f.owner.hasPending(), true);
  f.jobs[1].fn(); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.metrics[0][2].layers, ["physical"]);
});

