import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterRuntimeOwner } from "../js/core/renderer/political_id_raster_runtime_owner.js";
import { createPoliticalIdRasterCache, planPoliticalIdRasterView } from "../js/core/renderer/political_id_raster_cache.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function feature(id, bounds, color = "#123456") {
  return { id, bounds, color, geometry: { type: "Polygon", coordinates: [] } };
}

function makeTile(packet, marker = "tile") {
  return {
    marker,
    originX: packet.originX,
    originY: packet.originY,
    width: packet.width,
    height: packet.height,
    codes: new Uint32Array([1]),
    edgeIds: new Uint32Array(0),
    edgeWeights: new Float32Array(0),
  };
}

function makeClient() {
  const requests = [];
  let disposed = false;
  return {
    requests,
    available: () => !disposed,
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    request(packet, { signal } = {}) {
      return new Promise((resolve, reject) => {
        const item = {
          packet, signal, settled: false,
          resolve(tile) { this.settled = true; resolve(tile); },
          reject(error) { this.settled = true; reject(error); },
        };
        requests.push(item);
      });
    },
  };
}

function makeGpuFactory({ fail = false } = {}) {
  const instances = [];
  const createGpu = ({ onContextLost }) => {
    if (fail) throw new Error("mock GPU creation failed");
    const gpu = {
      canvas: { tag: `gpu-${instances.length}` },
      available: true,
      disposed: false,
      palettes: [],
      tileSets: [],
      draws: [],
      disposeCount: 0,
      isAvailable() { return this.available && !this.disposed; },
      setPalette(bytes, revision) { this.palettes.push({ bytes: bytes.slice(), revision }); },
      setTiles(tiles) { this.tileSets.push([...tiles]); },
      draw(plan) { this.draws.push(plan); },
      getStats() {
        return {
          gpuTextureBytes: this.tileSets.at(-1)?.reduce((sum, tile) => sum + tile.codes.byteLength, 0) || 0,
          outputSurfaceBytesEstimate: (this.draws.at(-1)?.width || 0) * (this.draws.at(-1)?.height || 0) * 4,
        };
      },
      loseContextForValidation() {
        this.available = false;
        onContextLost();
      },
      dispose() { this.disposed = true; this.disposeCount++; },
    };
    instances.push(gpu);
    return gpu;
  };
  return { createGpu, instances };
}

function fixture({
  width = 100,
  height = 100,
  transform = { x: 200, y: 200, k: 1 },
  features = [feature("a", { minX: -160, minY: -160, maxX: -140, maxY: -140 })],
  cache = createPoliticalIdRasterCache(),
  createGpu = null,
  resourceBudget = null,
  resolveColor = item => item.color,
  refineAfterMs = null,
} = {}) {
  const state = { zoomTransform: { ...transform }, dpr: 1 };
  const identity = { sceneKey: "scene-a", projectionKey: "projection-a", coverageKey: "coverage-a", version: 1, colorVersion: 0 };
  const requests = [], metrics = [], renders = [], blits = [];
  const client = makeClient();
  const context = {
    save() {}, restore() {}, setTransform() {},
    drawImage(image, ...args) { blits.push({ image, args }); },
  };
  const layout = { pixelWidth: width, pixelHeight: height, offsetX: 0, offsetY: 0 };
  const gpuHarness = createGpu ? null : makeGpuFactory();
  const h = {
    isEnabled: () => true,
    getFeatures: () => features,
    getFeatureId: (item) => item.id,
    getBounds: (item) => item.bounds,
    resolveColor,
    hasStroke: () => true,
    getSourceIdentity: () => ({ ...identity }),
    getLayout: () => layout,
  };
  const owner = createPoliticalIdRasterRuntimeOwner({
    state,
    surface: { getProjection: () => ({}), getContext: () => context },
    helpers: h,
    effects: {
      recordMetric: (...args) => metrics.push(args),
      requestRender: (reason) => renders.push(reason),
    },
    client,
    cache,
    createGpu: createGpu || gpuHarness.createGpu,
    resourceBudget, refineAfterMs,
  });
  return {
    owner, state, identity, features, setFeatures(next) { features = next; }, h, layout,
    client, requests: client.requests, metrics, renders, blits, cache,
    gpus: gpuHarness?.instances || [], resourceBudget,
  };
}

async function resolveAll(f, marker = "tile") {
  let index = 0, guard = 0;
  while (guard++ < 100) {
    await tick();
    if (index < f.requests.length) {
      const request = f.requests[index++];
      if (!request.settled) request.resolve(makeTile(request.packet, marker));
      continue;
    }
    if (f.owner.getPendingWorkCount() === 0) break;
  }
  assert.ok(guard < 100, "tile worker queue should settle without an unbounded pump");
  await tick();
  return index;
}

test("the complete viewport is committed only after every required tile is cached", async (t) => {
  const f = fixture({ width: 600, height: 100, transform: { x: 0, y: 200, k: 1 },
    features: [feature("a", { minX: 100, minY: -160, maxX: 120, maxY: -140 })] });
  t.after(() => f.owner.dispose());
  const expected = planPoliticalIdRasterView({ transform: f.state.zoomTransform, dpr: 1, width: 600, height: 100 });
  assert.ok(expected.tiles.length > 1);

  assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 1, "the owner builds one missing tile at a time");
  assert.equal(f.gpus[0].draws.length, 0);
  assert.equal(f.metrics.length, 0, "incomplete coverage must not commit or report a render metric");
  assert.equal(await resolveAll(f), expected.tiles.length);
  assert.equal(f.metrics.length, 0, "tile readiness alone does not draw the viewport");

  const result = f.owner.draw();
  assert.ok(result);
  assert.equal(f.gpus[0].tileSets.at(-1).length, expected.tiles.length);
  assert.equal(f.gpus[0].draws.length, 1);
  assert.equal(f.metrics.length, 1);
  assert.equal(f.metrics[0][0], "politicalIdRasterCommit");
  assert.equal(f.metrics[0][2].tileCount, expected.tiles.length);
  assert.equal(f.blits.length, 1);
});

test("local palette updates resolve dirty IDs only, while a replaced color namespace refreshes all IDs", async (t) => {
  const resolved = [];
  const bounds = { minX: -160, minY: -160, maxX: -140, maxY: -140 };
  const f = fixture({ features: [feature('a', bounds), feature('b', bounds)],
    resolveColor: item => { resolved.push(item.id); return item.color; } });
  t.after(() => f.owner.dispose());
  f.identity.colorScope = 'table-1';
  f.h.getChangedColorIds = () => ['a'];
  f.owner.draw();
  await resolveAll(f);
  f.owner.draw();
  const builds = f.owner.getDiagnostics().builds;
  resolved.length = 0;
  f.features[0].color = '#abcdef';
  f.identity.colorVersion++;
  assert.ok(f.owner.draw());
  assert.deepEqual(resolved, ['a']);
  assert.equal(f.owner.getDiagnostics().builds, builds);
  resolved.length = 0;
  f.features[1].color = '#fedcba';
  f.identity.colorScope = 'table-2';
  f.identity.colorVersion++;
  assert.ok(f.owner.draw());
  assert.deepEqual(resolved, ['a', 'b']);
  assert.equal(f.owner.getDiagnostics().builds, builds);
});

test("a color change during a geometry build keeps the build and commits the latest palette", async (t) => {
  const f = fixture();
  t.after(() => f.owner.dispose());
  f.owner.draw();
  const request = f.requests[0];
  const oldGeometryVersion = f.owner.getDiagnostics().geometryRevision;
  f.features[0].color = "#abcdef";
  f.identity.colorVersion += 1;
  assert.equal(f.owner.draw(), null);
  assert.equal(request.signal.aborted, false, "palette edits must not cancel a geometry-only request");
  assert.equal(f.requests.length, 1);

  request.resolve(makeTile(request.packet));
  await tick();
  const result = f.owner.draw();
  assert.ok(result);
  assert.equal(f.owner.getDiagnostics().geometryRevision, oldGeometryVersion);
  assert.deepEqual([...f.gpus[0].palettes.at(-1).bytes.slice(4, 8)], [171, 205, 239, 255]);
  assert.equal(f.requests.length, 1);

  f.features[0].color = "#fedcba";
  f.identity.colorVersion += 1;
  assert.ok(f.owner.draw(), "warm recoloring reuses cached geometry");
  assert.equal(f.requests.length, 1, "warm palette changes make no tile requests");
  assert.deepEqual([...f.gpus[0].palettes.at(-1).bytes.slice(4, 8)], [254, 220, 186, 255]);
});

test("a same-level pan within the cached tile grid draws without rebuilding", async (t) => {
  const f = fixture();
  t.after(() => f.owner.dispose());
  f.owner.draw();
  await resolveAll(f);
  assert.ok(f.owner.draw());
  const initialRequests = f.requests.length;
  const initialDraws = f.gpus[0].draws.length;

  f.state.zoomTransform.x = 205;
  assert.ok(f.owner.draw());
  assert.equal(f.requests.length, initialRequests);
  assert.equal(f.gpus[0].draws.length, initialDraws + 1);
  assert.equal(f.owner.getDiagnostics().cacheHits, 2);
});

test("moving geometry rebuilds only old/new tiles and recollects unchanged contributors", async (t) => {
  const a = feature("moving", { minX: 100, minY: -160, maxX: 120, maxY: -140 });
  const b = feature("old-contributor", { minX: 130, minY: -160, maxX: 150, maxY: -140 });
  const c = feature("new-contributor", { minX: 600, minY: -160, maxX: 620, maxY: -140 });
  const f = fixture({ width: 600, height: 100, transform: { x: 0, y: 200, k: 1 }, features: [a, b, c] });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  await resolveAll(f, "initial");
  f.owner.draw();
  const plan = planPoliticalIdRasterView({ transform: f.state.zoomTransform, dpr: 1, width: 600, height: 100 });
  const oldTile = plan.tiles.find((tile) => tile.originX === 0 && tile.originY === -512);
  const newTile = plan.tiles.find((tile) => tile.originX === 512 && tile.originY === -512);
  const untouchedTile = plan.tiles.find((tile) => tile.originX === -512 && tile.originY === -512);
  const originalRequestCount = f.requests.length;
  assert.equal(f.cache.peek(untouchedTile.key).marker, "initial");

  a.geometry = { type: "Polygon", coordinates: [[600, -150]] };
  a.bounds = { minX: 600, minY: -160, maxX: 620, maxY: -140 };
  f.identity.version += 1;
  assert.equal(f.owner.draw(), null);
  assert.equal(f.cache.peek(oldTile.key), undefined);
  assert.equal(f.cache.peek(newTile.key), undefined);
  assert.equal(f.cache.peek(untouchedTile.key).marker, "initial");
  assert.equal(f.requests.length, originalRequestCount + 1);
  assert.deepEqual(f.requests.at(-1).packet.entries.map((entry) => entry.id), ["old-contributor"]);
  f.requests.at(-1).resolve(makeTile(f.requests.at(-1).packet, "moved-old"));
  await tick();
  assert.equal(f.requests.length, originalRequestCount + 2);
  assert.deepEqual(f.requests.at(-1).packet.entries.map((entry) => entry.id), ["moving", "new-contributor"]);
  f.requests.at(-1).resolve(makeTile(f.requests.at(-1).packet, "moved-new"));
  await tick();
  assert.ok(f.owner.draw());
  assert.equal(f.requests.length, originalRequestCount + 2, "unaffected tiles require no rebuild");
  assert.equal(f.cache.peek(untouchedTile.key).marker, "initial");
  assert.equal(f.cache.peek(oldTile.key).marker, "moved-old");
  assert.equal(f.cache.peek(newTile.key).marker, "moved-new");
});

test("deletion rebuilds its old tile with every remaining contributor", async (t) => {
  const deleted = feature("deleted", { minX: 100, minY: -160, maxX: 120, maxY: -140 });
  const remaining = feature("remaining", { minX: 130, minY: -160, maxX: 150, maxY: -140 });
  const far = feature("far", { minX: 600, minY: -160, maxX: 620, maxY: -140 });
  const f = fixture({ width: 600, height: 100, transform: { x: 0, y: 200, k: 1 }, features: [deleted, remaining, far] });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  await resolveAll(f, "initial");
  f.owner.draw();
  const plan = planPoliticalIdRasterView({ transform: f.state.zoomTransform, dpr: 1, width: 600, height: 100 });
  const affected = plan.tiles.find((tile) => tile.originX === 0 && tile.originY === -512);
  const untouched = plan.tiles.find((tile) => tile.originX === 512 && tile.originY === -512);
  const initialRequests = f.requests.length;

  f.setFeatures([remaining, far]);
  f.identity.version += 1;
  assert.equal(f.owner.draw(), null);
  assert.equal(f.cache.peek(affected.key), undefined);
  assert.equal(f.cache.peek(untouched.key).marker, "initial");
  assert.equal(f.requests.length, initialRequests + 1);
  assert.deepEqual(f.requests.at(-1).packet.entries.map((entry) => entry.id), ["remaining"]);
  f.requests.at(-1).resolve(makeTile(f.requests.at(-1).packet, "after-delete"));
  await tick();
  assert.ok(f.owner.draw());
  assert.equal(f.requests.length, initialRequests + 1);
  assert.equal(f.cache.peek(affected.key).marker, "after-delete");
  assert.equal(f.cache.peek(untouched.key).marker, "initial");
});

test("in-flight work from a changed scene or projection cannot enter the cache", async (t) => {
  for (const key of ["sceneKey", "projectionKey"]) {
    const f = fixture();
    t.after(() => f.owner.dispose());
    f.owner.draw();
    const stale = f.requests[0];
    const descriptor = planPoliticalIdRasterView({ transform: f.state.zoomTransform, dpr: 1, width: 100, height: 100 }).tiles[0];
    f.identity[key] = `${f.identity[key]}-next`;
    f.identity.version += 1;
    f.owner.draw();
    assert.equal(stale.signal.aborted, true);
    assert.equal(f.requests.length, 2, `${key} change starts new-namespace work`);
    stale.resolve(makeTile(stale.packet, "stale"));
    await tick();
    assert.equal(f.cache.peek(descriptor.key), undefined, `${key}: stale tile must not commit`);
    f.requests[1].resolve(makeTile(f.requests[1].packet, "current"));
    await tick();
    assert.equal(f.cache.peek(descriptor.key).marker, "current");
  }
});

test("a tile rejected by the CPU budget is attempted once, not pumped forever", async (t) => {
  const f = fixture({ cache: createPoliticalIdRasterCache({ maxBytes: 0 }) });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(makeTile(f.requests[0].packet, "too-large"));
  await tick();
  assert.equal(f.cache.getStats().tileCount, 0);
  assert.equal(f.owner.getPendingWorkCount(), 0);
  for (let index = 0; index < 5; index += 1) assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 1);
});

test("GPU creation failure returns fallback and stops requesting raster work", (t) => {
  const f = fixture({ createGpu: () => { throw new Error("GPU unavailable"); } });
  t.after(() => f.owner.dispose());
  assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 0);
  assert.match(f.owner.getDiagnostics().failed, /GPU unavailable/);
  assert.equal(f.owner.getDiagnostics().fallbacks, 1);
  assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 0);
});

test("context loss recreates GPU resources from cached CPU tiles without rebuilding them", async (t) => {
  const f = fixture();
  t.after(() => f.owner.dispose());
  f.owner.draw();
  await resolveAll(f);
  assert.ok(f.owner.draw());
  const requestsBeforeLoss = f.requests.length;
  const firstGpu = f.gpus[0];
  const cacheTilesBeforeLoss = f.cache.getStats().tileCount;
  f.owner.loseContextForValidation();
  assert.equal(f.owner.getDiagnostics().contextLosses, 1);
  assert.ok(f.renders.includes("political-id-raster-context-lost"));

  assert.ok(f.owner.draw());
  assert.equal(firstGpu.disposed, true);
  assert.equal(f.gpus.length, 2);
  assert.equal(f.requests.length, requestsBeforeLoss);
  assert.equal(f.cache.getStats().tileCount, cacheTilesBeforeLoss);
  assert.equal(f.gpus[1].draws.length, 1);
});

test("dispose cancels work and releases worker, GPU, cache, and resource budget", (t) => {
  const updates = [], releases = [];
  const budget = {
    update: (owner, resources) => updates.push({ owner, resources }),
    release: (owner) => releases.push(owner),
  };
  const f = fixture({ resourceBudget: budget });
  f.owner.draw();
  const request = f.requests[0];
  const gpu = f.gpus[0];
  assert.equal(request.signal.aborted, false);
  assert.ok(updates.length > 0);

  f.owner.dispose();
  assert.equal(request.signal.aborted, true);
  assert.equal(f.client.disposed, true);
  assert.equal(gpu.disposed, true);
  assert.deepEqual(f.cache.getStats(), { cpuBytes: 0, tileCount: 0, evictions: 0 });
  assert.equal(releases.length, 1);
});

test("local geometry invalidation retains unaffected GPU tile objects during rebuild and recommit", async (t) => {
  const moving = feature("moving-gpu", { minX: 100, minY: -160, maxX: 120, maxY: -140 });
  const oldContributor = feature("old-gpu-contributor", { minX: 130, minY: -160, maxX: 150, maxY: -140 });
  const farContributor = feature("far-gpu-contributor", { minX: 600, minY: -160, maxX: 620, maxY: -140 });
  const f = fixture({
    width: 600,
    height: 100,
    transform: { x: 0, y: 200, k: 1 },
    features: [moving, oldContributor, farContributor],
  });
  t.after(() => f.owner.dispose());

  f.owner.draw();
  await resolveAll(f, "initial");
  assert.ok(f.owner.draw(), "the complete multi-tile viewport commits before the edit");

  const plan = planPoliticalIdRasterView({
    transform: f.state.zoomTransform,
    dpr: 1,
    width: 600,
    height: 100,
  });
  const untouchedDescriptor = plan.tiles.find((tile) => tile.originX === -512 && tile.originY === -512);
  const oldDescriptor = plan.tiles.find((tile) => tile.originX === 0 && tile.originY === -512);
  const newDescriptor = plan.tiles.find((tile) => tile.originX === 512 && tile.originY === -512);
  const untouchedTile = f.cache.peek(untouchedDescriptor.key);
  const oldTile = f.cache.peek(oldDescriptor.key);
  const priorSetCount = f.gpus[0].tileSets.length;
  const priorRequestCount = f.requests.length;
  assert.ok(untouchedTile && oldTile && f.cache.peek(newDescriptor.key));
  assert.equal(f.gpus[0].tileSets.at(-1).length, plan.tiles.length);

  moving.geometry = { type: "Polygon", coordinates: [[600, -150]] };
  moving.bounds = { minX: 600, minY: -160, maxX: 620, maxY: -140 };
  f.identity.version += 1;

  assert.equal(f.owner.draw(), null, "the incomplete replacement viewport is not drawn");
  assert.equal(f.requests.length, priorRequestCount + 1, "replacement tiles are still pending");
  assert.ok(f.gpus[0].tileSets.length > priorSetCount, "invalidation updates the resident GPU tile set");
  const pendingSet = f.gpus[0].tileSets.at(-1);
  assert.equal(pendingSet.length, 1);
  assert.equal(pendingSet[0], untouchedTile, "the unaffected resident GPU tile object is retained");
  assert.equal(f.cache.peek(oldDescriptor.key), undefined);
  assert.equal(f.cache.peek(newDescriptor.key), undefined);

  const rebuiltOld = makeTile(f.requests.at(-1).packet, "rebuilt-old");
  f.requests.at(-1).resolve(rebuiltOld);
  await tick();
  assert.equal(f.requests.length, priorRequestCount + 2);
  const rebuiltNew = makeTile(f.requests.at(-1).packet, "rebuilt-new");
  f.requests.at(-1).resolve(rebuiltNew);
  await tick();

  assert.ok(f.owner.draw(), "the complete replacement viewport commits after both builds finish");
  const committedSet = f.gpus[0].tileSets.at(-1);
  assert.equal(committedSet.length, plan.tiles.length);
  assert.ok(committedSet.includes(untouchedTile), "the same unaffected tile object remains resident");
  assert.ok(committedSet.includes(rebuiltOld));
  assert.ok(committedSet.includes(rebuiltNew));
  assert.ok(!committedSet.includes(oldTile), "the invalidated old GPU tile is replaced");
});


test("fractional display refines only its current view and preserves cached geometry", async t => {
  const f = fixture({ transform: { x: 200.25, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const builds = f.requests.length;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(f.renders.includes("political-id-raster-refine"));
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, "precise");
  assert.equal(f.requests.length, builds);
  f.identity.colorVersion++;
  assert.ok(f.owner.draw(), "new palette gets immediate raster feedback before refinement");
  assert.equal(f.owner.getDiagnostics().displayState, "accelerated");
});

test("obsolete view and disposed owners cannot schedule exact refinement", async t => {
  const f = fixture({ transform: { x: 200, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  f.state.zoomTransform.x++;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-refine").length, 0);
  f.owner.draw(); f.owner.dispose();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-refine").length, 0);
});


test("post-frame history identity changes refresh before refining the latest source", async t => {
  const f = fixture({ transform: { x: 200, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  f.identity.version++;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(f.renders.includes("political-id-raster-refinement-refresh"));
  assert.equal(f.owner.getDiagnostics().nativeRefinements, 0);
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, "precise");
});
