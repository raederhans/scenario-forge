import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const start = source.indexOf("function prepareScenarioSecondaryRegionIndexes(");
const end = source.indexOf("function syncScenarioSecondaryRegionIndexes(", start);
assert.ok(start >= 0 && end > start, "extract the actual renderer preparation wrapper");
const prepareSource = source.slice(start, end);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness() {
  const state = { secondarySpatialBuildPending: false, hitCanvasDirty: false };
  const calls = [], scheduled = [], jobs = [];
  let sceneSelected = true;
  const owner = {
    resetSecondarySpatialIndexState(options) {
      assert.equal(options.preserveCurrent, true);
      state.secondarySpatialBuildPending = true;
    },
    buildSecondarySpatialIndexesChunked(options) {
      return new Promise((resolve) => { jobs.push({ options, resolve }); });
    },
  };
  const dependencies = {
    runtimeState: state,
    getSpatialIndexRuntimeOwner: () => owner,
    isTnoRasterSceneSelected: () => sceneSelected,
    yieldToMain: () => Promise.resolve(),
    nowMs: () => 100,
    scheduleSecondarySpatialIndexBuild: (options) => { scheduled.push(options); },
    rebuildAuxiliaryRegionIndexes: () => { calls.push(["rebuildAuxiliaryRegionIndexes"]); },
    queueIndexUiRefresh: (options) => { calls.push(["queueIndexUiRefresh", options]); },
    scheduleHitCanvasBuildIfNeeded: (options) => { calls.push(["scheduleHitCanvasBuildIfNeeded", options]); },
    recordRenderPerfMetric: (...args) => { calls.push(["recordRenderPerfMetric", ...args]); },
    console: { error: (...args) => { calls.push(["error", ...args]); } },
  };
  const prepare = new Function(...Object.keys(dependencies),
    `let secondarySpatialPreparationVersion = 0;\n${prepareSource}\nreturn prepareScenarioSecondaryRegionIndexes;`
  )(...Object.values(dependencies));
  return {
    state, calls, scheduled, jobs, prepare,
    deselectScene() { sceneSelected = false; },
    async finish(index, status) {
      const job = jobs[index];
      if (status === "published" && job.options.isCurrent()) state.secondarySpatialBuildPending = false;
      job.resolve({ status, yieldCount: 2, maxSliceMs: 4, waterItems: 10, specialItems: 3 });
      await flush();
    },
  };
}

test("current source cancellation reschedules pending secondary preparation and eventually refreshes", async () => {
  const h = createHarness();
  h.prepare({ reason: "context-pack" });
  await flush();
  await h.finish(0, "cancelled");
  assert.equal(h.state.secondarySpatialBuildPending, true);
  assert.equal(h.calls.length, 0, "cancelled candidate must not refresh stale indexes");
  assert.deepEqual(h.scheduled, [{ reason: "context-pack-superseded-source" }]);

  h.prepare(h.scheduled.shift());
  await flush();
  await h.finish(1, "published");
  assert.equal(h.state.secondarySpatialBuildPending, false);
  assert.equal(h.state.hitCanvasDirty, true);
  assert.equal(h.calls.filter(([name]) => name === "rebuildAuxiliaryRegionIndexes").length, 1);
  assert.deepEqual(h.calls.find(([name]) => name === "queueIndexUiRefresh")[1],
    { renderWaterRegionList: true, renderSpecialRegionList: true });
  assert.equal(h.scheduled.length, 0, "completed replacement needs no additional retry");
});

for (const status of ["cancelled", "published"]) {
  test(`superseded root preparation ignores an old ${status} result`, async () => {
    const h = createHarness();
    h.prepare({ reason: "old-water", hasWaterChange: true, hasSpecialChange: false });
    await flush();
    h.prepare({ reason: "new-special", hasWaterChange: false, hasSpecialChange: true });
    await flush();
    assert.equal(h.jobs[0].options.isCurrent(), false);
    assert.equal(h.jobs[1].options.isCurrent(), true);
    await h.finish(0, status);
    assert.equal(h.calls.length, 0);
    assert.equal(h.scheduled.length, 0);
    assert.equal(h.state.hitCanvasDirty, false);
    await h.finish(1, "published");
    assert.equal(h.state.secondarySpatialBuildPending, false);
  });
}

test("a completed synchronous snapshot prevents retry after the async candidate cancels", async () => {
  const h = createHarness();
  h.prepare({ reason: "water" });
  await flush();
  h.state.secondarySpatialBuildPending = false;
  await h.finish(0, "cancelled");
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.hitCanvasDirty, false);
});

test("leaving the raster scene prevents retry or refresh from its cancelled preparation", async () => {
  const h = createHarness();
  h.prepare({ reason: "water" });
  await flush();
  h.deselectScene();
  await h.finish(0, "cancelled");
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.calls.length, 0);
});

test("water then special overlap refreshes both lists only from the latest publication", async () => {
  const h = createHarness();
  h.prepare({ reason: "water", hasWaterChange: true, hasSpecialChange: false });
  await flush();
  h.prepare({ reason: "special", hasWaterChange: false, hasSpecialChange: true });
  await flush();
  await h.finish(1, "published");
  const expectedCalls = h.calls.slice();
  assert.deepEqual(h.calls.filter(([name]) => name === "queueIndexUiRefresh"),
    [["queueIndexUiRefresh", { renderWaterRegionList: true, renderSpecialRegionList: true }]]);
  assert.deepEqual(h.calls.filter(([name]) => name === "scheduleHitCanvasBuildIfNeeded"),
    [["scheduleHitCanvasBuildIfNeeded", { reason: "special-hit-canvas" }]]);
  await h.finish(0, "cancelled");
  assert.deepEqual(h.calls, expectedCalls, "late cancellation cannot refresh or dirty the latest snapshot");
  assert.equal(h.scheduled.length, 0);
});
