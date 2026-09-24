import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { createChunkLoadScheduler } from "../js/core/scenario/chunk_load_scheduler.js";
import { estimateRoadPackRetentionBytes } from "../js/ui/transport_workbench_retention.js";

// Isolate only catalog/network and page snapshot registration. The real
// transport lifetime, resource ledger and scheduler execute unchanged.
let source = fs.readFileSync(new URL("../js/ui/transport_workbench_line_runtime_shared.js", import.meta.url), "utf8");
for (const [before, after] of [
  ['import { getTransportAsset } from "../core/data_service.js";', 'const getTransportAsset = () => { throw new Error("Test must inject its asset loader"); };'],
  ['import { registerMapcreatorSnapshotProvider } from "../core/mapcreator_snapshot.js";', 'const registerMapcreatorSnapshotProvider = () => {};'],
]) {
  assert.ok(source.includes(before)); source = source.replace(before, after);
}
for (const relative of ["../core/scenario/chunk_load_scheduler.js", "../core/runtime_resource_budget.js"]) {
  source = source.replace(JSON.stringify(relative), JSON.stringify(new URL(`../js/ui/${relative}`, import.meta.url).href));
}
const { createTransportWorkbenchLinePackRuntime } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let sequence = 0;
function fixture({ getAsset, buildPack, estimatePackBytes = () => 20, budget = 100, prepareCarrier } = {}) {
  const resources = createRuntimeResourceBudget({ softLimitBytes: budget });
  const requests = [], builds = [];
  const definition = {
    familyId: `fixture-${sequence++}`, manifestUrl: "manifest.json", estimatedLoadBytes: { preview: 10, full: 10 },
    estimatePackBytes, prepareCarrier,
    buildPack: async (options) => {
      builds.push(options.mode);
      return buildPack ? buildPack(options) : { mode: options.mode, value: await options.loadTransportAsset(`${options.mode}.json`) };
    },
  };
  const runtime = createTransportWorkbenchLinePackRuntime(definition, { resourceBudget: resources,
    scheduler: createChunkLoadScheduler({ resourceBudget: resources }), yieldTask: () => Promise.resolve(),
    getAsset: async (path, options) => {
      requests.push({ path, options });
      return getAsset ? getAsset(path, options) : path === "manifest.json" ? { paths: {} } : { path };
    },
  });
  return { resources, runtime, requests, builds };
}

test("duplicate demand builds once, records ownership and releases all owned pack references", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runtime.loadPack(), f.runtime.loadPack()]);
  assert.equal(a, b);
  assert.deepEqual(f.builds, ["preview"]);
  assert.equal(f.resources.snapshot().categories.transport, 20);
  f.runtime.runtime.activePack = a;
  f.runtime.runtime.selectedFeature = { id: "small-id", type: "road" };
  f.runtime.release({ preserveSelection: true });
  assert.equal(f.runtime.pickActivePack(), null);
  assert.equal(f.runtime.runtime.activePack, null);
  assert.equal(f.runtime.runtime.manifestPromise, null);
  assert.equal(f.runtime.runtime.packPromises.preview, null);
  assert.equal(f.resources.snapshot().ownerCount, 0);
  assert.equal(f.runtime.getSnapshot().selected.id, "small-id");
  assert.equal(a.value.path, "preview.json", "a borrowed caller snapshot is not mutated during release");
  f.runtime.release();
  assert.equal(f.runtime.getSnapshot().selected, null);
});

test("hide during fetch aborts the actual receiver and a late ignored response cannot refill the cache", async () => {
  const held = deferred();
  const f = fixture({ getAsset: (path) => path === "manifest.json" ? { paths: {} } : held.promise });
  const pending = f.runtime.loadPack();
  await tick();
  const signal = f.requests.find((request) => request.path === "preview.json").options.signal;
  f.runtime.release();
  assert.equal(signal.aborted, true);
  assert.equal(f.resources.snapshot().categories.inFlight, 10, "ignored cancellation retains the reservation until actual settlement");
  held.resolve({ late: true });
  assert.equal(await pending, null);
  assert.equal(f.runtime.pickActivePack(), null);
  assert.equal(f.resources.snapshot().ownerCount, 0);
});

test("pack switch keeps the new generation and rejects old results", async () => {
  const held = deferred(); let first = true;
  const f = fixture({ getAsset: (path) => {
    if (path.endsWith("manifest.json")) return { paths: {} };
    if (first) { first = false; return held.promise; }
    return { newGeneration: true };
  } });
  const old = f.runtime.loadPack(); await tick();
  f.runtime.setActivePack("new-country", "new-manifest.json");
  const current = await f.runtime.loadPack();
  held.resolve({ oldGeneration: true });
  assert.equal(await old, null);
  assert.equal(f.runtime.pickActivePack(), current);
  assert.equal(current.value.newGeneration, true);
  f.runtime.release();
});

test("background full pack defers under pressure but explicit demand promotes that same task", async () => {
  const f = fixture(); await f.runtime.loadPack();
  const external = Symbol(); f.resources.update(external, { workerGeometry: 80 });
  let hydrated = 0;
  f.runtime.startBackgroundFullPackLoad({ onHydrated: () => hydrated++ });
  await tick(); assert.deepEqual(f.builds, ["preview"]);
  const full = await f.runtime.loadPack("full");
  await tick(); assert.equal(full.mode, "full");
  assert.deepEqual(f.builds, ["preview", "full"]);
  assert.equal(hydrated, 1);
  f.runtime.release(); f.resources.release(external);
  assert.equal(f.resources.snapshot().ownerCount, 0);
});

test("hide cancels a queued background pack rather than restarting it after pressure falls", async () => {
  const f = fixture(); await f.runtime.loadPack();
  const external = Symbol(); f.resources.update(external, { workerGeometry: 100 });
  let hydrated = 0;
  f.runtime.startBackgroundFullPackLoad({ onHydrated: () => hydrated++ });
  await tick(); f.runtime.release(); f.resources.release(external); await tick();
  assert.deepEqual(f.builds, ["preview"]);
  assert.equal(hydrated, 0);
  assert.equal(f.resources.snapshot().ownerCount, 0);
});

test("a retired carrier preparation cannot start geometry conversion", async () => {
  const held = deferred();
  const f = fixture({ prepareCarrier: () => held.promise });
  const pending = f.runtime.loadPack(); await tick(); f.runtime.release(); held.resolve();
  assert.equal(await pending, null);
  assert.deepEqual(f.builds, []);
});

test("reopening the same country loads fresh resources instead of reusing a cancelled promise", async () => {
  const f = fixture();
  const first = await f.runtime.loadPack(); f.runtime.release();
  const second = await f.runtime.loadPack();
  assert.notEqual(first, second);
  assert.equal(f.requests.filter((request) => request.path === "manifest.json").length, 2);
  f.runtime.release();
});

test("missing estimates remain unknown and failure leaves no fabricated ready pack", async () => {
  const f = fixture({ estimatePackBytes: () => null });
  await f.runtime.loadPack();
  assert.equal(f.runtime.getSnapshot().lifetime.estimatedPackBytes, null);
  assert.ok(f.resources.snapshot().unmeasuredCategories.includes("transport"));
  f.runtime.release();
  const broken = fixture({ buildPack: () => { throw new Error("actual build failure"); } });
  await assert.rejects(broken.runtime.loadPack(), /actual build failure/);
  assert.equal(broken.runtime.getSnapshot().status, "error");
  assert.equal(broken.runtime.pickActivePack(), null);
  assert.equal(broken.resources.snapshot().ownerCount, 0);
  broken.runtime.release();
});

test("road retention reuses immutable geometry weights and does not count shared endpoint arrays twice", () => {
  const geometry = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
  const feature = { geometry, projectedGeometry: geometry, pathD: "M0 0 L1 1", projectedLines: [] };
  const pack = { roadFeatures: [feature], labelFeatures: [] };
  const estimated = estimateRoadPackRetentionBytes(pack);
  assert.ok(estimated > 0);
  assert.equal(estimateRoadPackRetentionBytes(pack), estimated);
  const distinct = { roadFeatures: [{ ...feature, projectedGeometry: structuredClone(geometry) }], labelFeatures: [] };
  assert.ok(estimateRoadPackRetentionBytes(distinct) > estimated);
  assert.equal(estimateRoadPackRetentionBytes({}), null);
});

test("current road hide and destroy entrypoints release the owning lifetime", () => {
  const road = fs.readFileSync(new URL("../js/ui/transport_workbench_road_preview.js", import.meta.url), "utf8");
  for (const name of ["clearJapanRoadPreview", "destroyJapanRoadPreview"]) {
    const start = road.indexOf(`export function ${name}()`);
    const end = road.indexOf("\nexport ", start + 1);
    const body = road.slice(start, end < 0 ? undefined : end);
    assert.ok(start >= 0 && body.includes("lineRuntime.release("), name);
  }
  assert.ok(road.includes("loadGeneration !== runtime.loadGeneration"));
  assert.ok(road.includes("estimatePackBytes: estimateRoadPackRetentionBytes"));
});
