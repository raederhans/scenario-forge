import { createPoliticalIdRasterDisplayCache } from "../js/core/renderer/political_id_raster_display_cache.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterRuntimeOwner } from "../js/core/renderer/political_id_raster_runtime_owner.js";
import { createPoliticalIdRasterCache, planPoliticalIdRasterView } from "../js/core/renderer/political_id_raster_cache.js";
import { bindRenderBoundary, requestRender, markRenderBoundaryFlushed, getRenderBoundaryDebugState } from "../js/core/render_boundary.js";

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

function makeGpuFactory({ fail = false, prepareFrame = null } = {}) {
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
    if (prepareFrame) gpu.prepareFrame = options => prepareFrame(gpu, options);
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
  displayMode = "hybrid",
  directPresentation = false,
  autoPublish = true,
  commitPublishedColorEdit = undefined,
  requestRenderEffect = null,
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
      commitPublishedColorEdit,
      recordMetric: (...args) => metrics.push(args),
      requestRender: (reason) => { renders.push(reason); requestRenderEffect?.(reason); },
    },
    client,
    cache,
    createGpu: createGpu || gpuHarness.createGpu,
    resourceBudget, refineAfterMs, displayMode, directPresentation,
    createDisplayCache: () => createPoliticalIdRasterDisplayCache({ createCanvas: (width, height) => ({
      width, height, getContext: () => ({ save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} }),
    }) }),
  });
  return {
    owner: autoPublish && directPresentation ? { ...owner, draw() {
      const result = owner.draw();
      if (result?.staged) assert.equal(owner.publishDirectFrame(), true);
      return result;
    } } : owner, state, identity, features, setFeatures(next) { features = next; }, h, layout,
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

function asyncGpuFixture({ autoPublish = true } = {}) {
  const preparations = [];
  const factory = makeGpuFactory({ prepareFrame(gpu, options) {
    return new Promise(resolve => preparations.push({ gpu, options, cancelled: 0,
      ready() {
        const request = this;
        resolve({ stats: { maxTaskMs: 2, uploadedTiles: options.tiles.length },
          cancel() { request.cancelled++; },
          commit({ palette, revision }) {
            assert.equal(options.isCurrent(), true);
            if (request.commitError) throw request.commitError;
            gpu.setPalette(palette, revision); gpu.setTiles(options.tiles);
            return { planningMs: 0, paletteUploadMs: 1, tileBindingMs: 1 };
          } });
      }, capacityRejected() { resolve(null); } }));
  } });
  const f = fixture({ directPresentation: true, displayMode: "raster", createGpu: factory.createGpu, autoPublish });
  async function cpuReady(marker = "candidate") {
    for (let guard = 0; guard < 100; guard++) {
      await tick();
      const request = f.requests.find(value => !value.settled);
      if (request) { request.resolve(makeTile(request.packet, marker)); continue; }
      if (f.owner.getDiagnostics().gpuPreparation.pending || f.owner.getPendingWorkCount() === 0) return;
    }
    assert.fail("CPU tile work must reach the independent GPU preflight");
  }
  async function publish() {
    f.owner.prepareSource(); await cpuReady(); preparations.at(-1).ready(); await tick();
    assert.ok(f.owner.draw());
    if (!autoPublish) assert.equal(f.owner.publishDirectFrame(), true);
  }
  return { f, preparations, factory, cpuReady, publish };
}

test("direct GPU preparation starts from tile completion and atomically commits the latest palette after unrelated passes wait", async t => {
  const { f, preparations, factory, cpuReady, publish } = asyncGpuFixture();
  t.after(() => f.owner.dispose());
  await publish();
  const old = f.owner.getDirectFrame(), gpu = factory.instances[0];
  const before = [gpu.tileSets.length, gpu.palettes.length, gpu.draws.length];
  f.state.zoomTransform = { k: 2.5, x: 150, y: 175 };
  f.owner.prepareSource(); await cpuReady("gpu-prepared");
  assert.equal(preparations.length, 2, "the last CPU tile starts GPU work without draw being called");
  assert.equal(f.owner.getPendingWorkCount(), 1);
  assert.deepEqual([gpu.tileSets.length, gpu.palettes.length, gpu.draws.length], [before[0], before[1] + 1, before[2]], "only the accepted palette preview may refresh during preflight");
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(f.owner.draw().retained, true, "an unfinished private upload cannot publish");
  f.features[0].color = "#abcdef"; f.identity.colorVersion++;
  assert.equal(typeof f.owner.prepareSource().then, "function", "GPU preparation remains a pipeline publication gate");
  assert.equal(preparations[1].options.signal.aborted, false, "palette-only edits reuse geometry preparation");
  assert.equal(preparations[1].options.isCurrent(), true);
  assert.deepEqual([...gpu.palettes.at(-1).bytes.slice(4, 8)], [171, 205, 239, 255], "the accepted frame receives the live palette while its replacement stays private");
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(gpu.tileSets.length, before[0]);
  preparations[1].ready(); await tick();
  assert.equal(f.owner.getPendingWorkCount(), 0);
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(gpu.tileSets.length, before[0]);
  assert.ok(f.owner.draw());
  assert.notEqual(f.owner.getDirectFrame(), old);
  assert.deepEqual([...gpu.palettes.at(-1).bytes.slice(4, 8)], [171, 205, 239, 255]);
  assert.equal(f.owner.getDiagnostics().gpuPreparation.lastPath, "asynchronous-committed");
  const requestCount = preparations.length, renders = f.renders.length;
  f.owner.prepareSource(); f.owner.prepareSource();
  assert.equal(preparations.length, requestCount, "accepted textures do not start no-op asynchronous jobs");
  assert.equal(f.renders.length, renders);
});

test("superseded private GPU completion is cancelled and cannot displace the accepted frame or a newer preparation", async t => {
  const { f, preparations, factory, cpuReady, publish } = asyncGpuFixture();
  t.after(() => f.owner.dispose());
  await publish();
  const old = f.owner.getDirectFrame(), gpu = factory.instances[0], tileSets = gpu.tileSets.length;
  f.state.zoomTransform = { k: 2.5, x: 150, y: 175 };
  f.owner.prepareSource(); await cpuReady();
  const stale = preparations[1];
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] }; f.identity.version++;
  f.owner.prepareSource();
  assert.equal(stale.options.signal.aborted, true);
  await cpuReady("latest-gpu");
  assert.equal(preparations.length, 3);
  stale.ready(); await tick();
  assert.equal(stale.cancelled, 1);
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(gpu.tileSets.length, tileSets);
  assert.equal(f.owner.getDiagnostics().gpuPreparation.pending, true);
  preparations[2].ready(); await tick(); f.owner.draw();
  assert.ok(gpu.tileSets.at(-1).every(tile => tile.marker === "latest-gpu"));
  assert.equal(f.owner.getDiagnostics().gpuPreparation.committed, 2);
});

test("an out-of-coverage accepted frame cannot let the pipeline pass CPU or GPU candidate gates", async t => {
  const { f, preparations, factory, cpuReady, publish } = asyncGpuFixture();
  t.after(() => f.owner.dispose());
  await publish();
  const old = f.owner.getDirectFrame(), gpu = factory.instances[0], committed = f.owner.getDiagnostics().commits;
  const tileSets = gpu.tileSets.length;
  f.state.zoomTransform = { k: 1, x: 5000, y: -5000 };
  const oldRight = old.plan.outputX + old.plan.outputWidth + f.state.zoomTransform.x - old.transform.x;
  assert.ok(oldRight < 0 || old.plan.outputX + f.state.zoomTransform.x - old.transform.x > f.layout.pixelWidth,
    "the accepted frame cannot claim coverage at this new camera");
  const cpuGate = f.owner.prepareSource();
  assert.equal(typeof cpuGate.then, "function");
  await cpuReady(); await cpuGate;
  const gpuGate = f.owner.prepareSource();
  assert.equal(typeof gpuGate.then, "function");
  f.features[0].color = "#abcdef"; f.identity.colorVersion++;
  assert.equal(f.owner.prepareSource(), gpuGate);
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(gpu.tileSets.length, tileSets);
  assert.equal(f.owner.getDiagnostics().commits, committed);
  assert.deepEqual([...gpu.palettes.at(-1).bytes.slice(4, 8)], [171, 205, 239, 255]);
  preparations.at(-1).ready(); await gpuGate;
  assert.equal(f.owner.prepareSource(), false);
  assert.equal(f.owner.getDirectFrame(), old, "unblocking preparation itself still cannot publish");
  assert.ok(f.owner.draw());
  assert.notEqual(f.owner.getDirectFrame(), old);
});

test("GPU capacity rejection uses one diagnosed synchronous fallback without retrying a busy preflight", async t => {
  const { f, preparations, cpuReady } = asyncGpuFixture();
  t.after(() => f.owner.dispose());
  f.owner.prepareSource(); await cpuReady();
  preparations[0].capacityRejected(); await tick();
  const before = f.renders.length;
  f.owner.prepareSource(); f.owner.prepareSource();
  assert.equal(preparations.length, 1);
  assert.equal(f.renders.length, before);
  assert.equal(f.owner.getDiagnostics().gpuPreparation.lastPath, "synchronous-capacity");
  assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().gpuPreparation.capacityFallbacks, 1);
  assert.equal(f.owner.getPendingWorkCount(), 0);
});

test("capacity changing after GPU preparation discards only pending textures and retries once through synchronous publication", async t => {
  const { f, preparations, factory, cpuReady, publish } = asyncGpuFixture({ autoPublish: false });
  t.after(() => f.owner.dispose());
  await publish();
  const old = f.owner.getDirectFrame(), gpu = factory.instances[0], uploads = gpu.tileSets.length;
  f.state.zoomTransform = { k: 2.5, x: 150, y: 175 }; f.owner.prepareSource(); await cpuReady();
  preparations[1].commitError = new RangeError("Political GPU texture budget exceeded.");
  preparations[1].ready(); await tick();
  assert.ok(f.owner.draw().staged);
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(f.owner.getDirectFrame(), old);
  assert.equal(gpu.tileSets.length, uploads);
  assert.equal(preparations[1].cancelled, 1);
  assert.equal(f.owner.getDiagnostics().gpuPreparation.lastPath, "synchronous-capacity");
  f.owner.prepareSource(); assert.equal(preparations.length, 2);
  assert.ok(f.owner.draw().staged);
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.notEqual(f.owner.getDirectFrame(), old);
  assert.equal(f.owner.getDiagnostics().gpuPreparation.capacityFallbacks, 1);
});

for (const setup of ["createGpu", "prepareFrame"]) test(`GPU ${setup} failure during tile-completion preflight stays contained and selects fallback`, async t => {
  const factory = makeGpuFactory({ fail: setup === "createGpu", prepareFrame: setup === "prepareFrame"
    ? () => { throw new Error("synchronous GPU preparation setup failed"); } : null });
  const f = fixture({ directPresentation: true, displayMode: "raster", createGpu: factory.createGpu });
  t.after(() => f.owner.dispose());
  assert.equal(typeof f.owner.prepareSource().then, "function");
  await resolveAll(f);
  assert.match(f.owner.getDiagnostics().failed, /GPU/);
  assert.equal(f.owner.getDiagnostics().displayState, "fallback");
  assert.equal(f.owner.getPendingWorkCount(), 0);
  assert.equal(f.owner.getDiagnostics().gpu, null);
  assert.ok(f.renders.includes("political-id-gpu-preparation-fallback"));
  assert.equal(f.owner.draw(), null);
});

test("rendered coverage survives recolors and same-grid pans, but not geometry or grid changes", async (t) => {
  const f = fixture({ displayMode: "raster" });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f);
  const first = f.owner.draw();
  assert.deepEqual([...first.renderedIds], ["a"]);
  first.renderedIds.clear(); // Consumers cannot corrupt the retained ID list.
  f.features[0].color = "#abcdef"; f.identity.colorVersion++;
  assert.deepEqual([...f.owner.draw().renderedIds], ["a"]);
  f.state.zoomTransform.x += 1;
  assert.deepEqual([...f.owner.draw().renderedIds], ["a"]);
  assert.equal(f.owner.getDiagnostics().renderedCoverageScans, 1);
  assert.equal(f.owner.getDiagnostics().renderedCoverageCacheHits, 2);

  const b = feature("b", f.features[0].bounds);
  f.setFeatures([b]); f.identity.version++;
  f.owner.draw(); await resolveAll(f);
  assert.deepEqual([...f.owner.draw().renderedIds], ["b"]);
  assert.equal(f.owner.getDiagnostics().renderedCoverageScans, 2);

  f.state.zoomTransform.x += 512;
  f.owner.draw(); await resolveAll(f);
  assert.deepEqual([...f.owner.draw().renderedIds], []);
  assert.equal(f.owner.getDiagnostics().renderedCoverageScans, 3);

  // Scene replacement can reuse the same geometry revision counter and grid.
  f.identity.sceneKey = "scene-b"; f.setFeatures([feature("c", { minX: -660, minY: -160, maxX: -640, maxY: -140 })]);
  f.owner.draw(); await resolveAll(f);
  assert.deepEqual([...f.owner.draw().renderedIds], ["c"]);
  assert.equal(f.owner.getDiagnostics().renderedCoverageScans, 4);
});

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
  const f = fixture({ cache: createPoliticalIdRasterCache({ maxBytes: 512 * 512 * 4 + 4 }) });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ...makeTile(f.requests[0].packet, "too-large"),
    codes: new Uint32Array(512 * 512), edgeIds: new Uint32Array(1), edgeWeights: new Float32Array(1) });
  await tick();
  assert.equal(f.cache.getStats().tileCount, 0);
  assert.equal(f.owner.getPendingWorkCount(), 0);
  for (let index = 0; index < 5; index += 1) assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 1);
  assert.equal(f.owner.getDiagnostics().displayState, "fallback");
  assert.equal(f.owner.getDiagnostics().reason, "cpu-budget");
});

test("an oversized view is rejected before production and a smaller view can still accelerate", async t => {
  const f = fixture({ width: 600, height: 100, transform: { x: 0, y: 200, k: 1 },
    cache: createPoliticalIdRasterCache({ maxBytes: 2 * 512 * 512 * 4 }) });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f);
  assert.equal(f.owner.draw(), null);
  assert.equal(f.requests.length, 0);
  assert.equal(f.owner.getDiagnostics().displayState, "fallback");
  assert.equal(f.owner.getDiagnostics().reason, "view-budget");
  const count = f.requests.length;
  f.owner.draw(); await tick(); assert.equal(f.requests.length, count);
  f.layout.pixelWidth = 100; f.state.zoomTransform.x = 200;
  f.owner.draw(); await resolveAll(f);
  assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().displayState, "accelerated");
  assert.ok(f.cache.getStats().cpuBytes <= f.cache.maxBytes);
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

test("pixel-aligned coverage still finishes with the configured exact native pass", async t => {
  const f = fixture({ transform: { x: 200, y: 200, k: 1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const builds = f.requests.length;
  assert.equal(f.owner.getDiagnostics().refinementPending, true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, "precise");
  assert.equal(f.requests.length, builds, "exact refinement does not rebuild valid aligned coverage");
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


for (const change of ["history", "camera"]) test(`post-frame ${change} changes refresh before refining the latest source`, async t => {
  const f = fixture({ transform: { x: 200, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  if (change === "history") f.identity.version++;
  else f.state.zoomTransform.y += 1e-6;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(f.renders.includes("political-id-raster-refinement-refresh"));
  assert.equal(f.owner.getDiagnostics().nativeRefinements, 0);
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, "precise");
});

test('native partial feedback coalesces edits and finishes with a full native frame without tile rebuilds', async t => {
  const f = fixture({ transform: { x: 200.25, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  await new Promise(resolve => setTimeout(resolve, 15));
  f.owner.draw();
  assert.equal(f.owner.hasNativeFrame(), true);
  const builds = f.requests.length;
  f.identity.colorVersion++;
  f.owner.noteNativePartialRepaint();
  f.owner.noteNativePartialRepaint();
  assert.equal(f.owner.hasNativeFrame(), true);
  assert.equal(f.owner.getDiagnostics().refinementPending, true);
  assert.equal(f.owner.getDiagnostics().displayState, 'accelerated');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.renders.filter(reason => reason === 'political-id-raster-partial-refine').length, 1);
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, 'precise');
  assert.equal(f.requests.length, builds);
  f.owner.noteNativePartialRepaint(); f.owner.dispose();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.renders.filter(reason => reason === 'political-id-raster-partial-refine').length, 1);
  assert.equal(f.owner.hasNativeFrame(), false);
});

test('held brush keeps native local feedback and schedules one exact frame after release', async t => {
  const f = fixture({ transform: { x: 200.25, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  await new Promise(resolve => setTimeout(resolve, 15)); f.owner.draw();
  let brushing = true;
  f.h.isBrushActive = () => brushing;
  f.identity.colorVersion++;
  for (let index = 0; index < 3; index++) {
    f.owner.noteNativePartialRepaint();
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.equal(f.owner.hasNativeFrame(), true);
  assert.equal(f.owner.getDiagnostics().refinementPending, false, 'no timer polls a held gesture');
  assert.equal(f.renders.filter(reason => reason === 'political-id-raster-partial-refine').length, 0);
  brushing = false;
  f.owner.finishNativePartialRepaint();
  assert.equal(f.owner.getDiagnostics().refinementPending, true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.renders.filter(reason => reason === 'political-id-raster-partial-refine').length, 1);
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().displayState, 'precise');
  f.owner.finishNativePartialRepaint();
  assert.equal(f.owner.getDiagnostics().refinementPending, false);
});

test('exact edit completion prepares invalidated coverage before leaving and returning to the view', async t => {
  const f = fixture({ transform: { x: 200.25, y: 200, k: 1.1 }, refineAfterMs: 5 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  await new Promise(resolve => setTimeout(resolve, 15)); f.owner.draw();
  const builds = f.requests.length;
  f.features[0].geometry = { type: 'Polygon', coordinates: [] };
  f.identity.version++;
  f.owner.noteNativePartialRepaint();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.owner.draw(), null, 'the exact native frame stays selected');
  assert.equal(f.owner.getPendingWorkCount(), 1, 'the edit reports its replacement tile as pending');
  const readyRenders = f.renders.filter(reason => reason === 'political-id-raster-ready').length;
  await resolveAll(f);
  assert.equal(f.requests.length, builds + 1);
  assert.equal(f.renders.filter(reason => reason === 'political-id-raster-ready').length, readyRenders,
    'preparing geometry must not redraw an already exact, unchanged native frame');
  assert.equal(f.owner.draw(), null);
  const originalX = f.state.zoomTransform.x;
  f.state.zoomTransform.x += 600;
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const prepared = f.requests.length;
  f.state.zoomTransform.x = originalX;
  assert.ok(f.owner.draw());
  assert.equal(f.requests.length, prepared, 'returning to edited coverage has no deferred rebuild');
});

for (const [name, change] of [
  ['palette', f => { f.identity.colorVersion++; }],
  ['camera', f => { f.state.zoomTransform.x++; }],
  ['oversized viewport', f => { f.layout.pixelWidth = 2 ** 20; f.owner.draw(); }],
]) {
  test(`coverage completion still requests a frame after a concurrent ${name} change`, async t => {
    const f = fixture({ transform: { x: 200.25, y: 200, k: 1.1 }, refineAfterMs: 5 });
    t.after(() => f.owner.dispose());
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    await new Promise(resolve => setTimeout(resolve, 15)); f.owner.draw();
    f.features[0].geometry = { type: 'Polygon', coordinates: [] };
    f.identity.version++;
    f.owner.noteNativePartialRepaint();
    await new Promise(resolve => setTimeout(resolve, 15)); f.owner.draw();
    const readyRenders = f.renders.filter(reason => reason === 'political-id-raster-ready').length;
    change(f);
    await resolveAll(f);
    assert.equal(f.owner.getDiagnostics().failed, '');
    assert.equal(f.renders.filter(reason => reason === 'political-id-raster-ready').length, readyRenders + 1);
  });
}

test("persistent coverage stays raster after idle, palette edits and brush release without native refinement", async t => {
  const f = fixture({ displayMode: "raster", refineAfterMs: 0 }); t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const builds = f.owner.getDiagnostics().builds;
  const sequence = ["#aa0000", "#00aa00", "#0000aa", "#00aa00"];
  for (const color of sequence) {
    f.features[0].color = color; f.identity.colorVersion++;
    assert.ok(f.owner.draw());
    f.owner.noteNativePartialRepaint(); f.owner.finishNativePartialRepaint();
    await new Promise(resolve => setTimeout(resolve, 5));
    const d = f.owner.getDiagnostics();
    assert.equal(d.displayState, "accelerated"); assert.equal(d.nativeRefinements, 0);
    assert.equal(d.refinementPending, false); assert.equal(d.builds, builds);
    assert.equal(f.owner.hasNativeFrame(), false);
  }
  assert.equal(f.renders.some(reason => /refine/.test(reason)), false);
});

test("persistent owner keeps geometry cancellation and unavailable-output fallback", async t => {
  const f = fixture({ displayMode: "raster", refineAfterMs: 0 }); t.after(() => f.owner.dispose());
  f.owner.draw(); const old = f.requests[0];
  f.features[0] = { ...f.features[0], geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[0,1],[0,0]]] } };
  f.identity.version++;
  assert.equal(f.owner.draw(), null); assert.equal(old.signal.aborted, true);
  await resolveAll(f); assert.ok(f.owner.draw());
  f.state.zoomTransform.x += 20;
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().nativeRefinements, 0);
  f.owner.loseContextForValidation(); assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().contextLosses, 1);
});


test("resident presentation reuses stable RGBA and accounts its retained surface", async t => {
  const updates = [];
  const f = fixture({ displayMode: "raster", resourceBudget: { update: (...args) => updates.push(args), release() {} } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const before = f.owner.getDiagnostics();
  assert.ok(before.presentationCache.retainedSurfaceBytes > 0);
  assert.ok(f.owner.draw());
  const after = f.owner.getDiagnostics();
  assert.equal(after.presentationCache.reusedFrames, before.presentationCache.reusedFrames + 1);
  assert.equal(after.builds, before.builds);
  assert.equal(after.nativeRefinements, 0);
  assert.ok(updates.at(-1)[1].workerSurfaces >= after.presentationCache.retainedSurfaceBytes);
  assert.ok(after.lastTiming.totalMs >= 0);
  const count = after.presentationCache.fullUpdates;
  f.owner.loseContextForValidation(); assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().presentationCache.fullUpdates, count + 1);
});


test("optional presentation budget falls back to full GPU without disabling valid raster", async t => {
  const f = fixture({ displayMode: "raster", width:3800, height:2200 });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const d = f.owner.getDiagnostics();
  assert.equal(d.displayState, "accelerated");
  assert.equal(d.presentation, "full-gpu");
  assert.equal(d.presentationCache.retainedSurfaceBytes, 0);
  assert.equal(d.reason, "coverage-ready");
  assert.ok(d.gpu.outputSurfaceBytesEstimate < 80*1024*1024);
  assert.equal(d.nativeRefinements,0);
});

test("direct presentation commits complete coverage without a GPU draw or Canvas copy", async t => {
  const updates = [];
  const f = fixture({ displayMode: "raster", directPresentation: true,
    resourceBudget: { update: (_owner, value) => updates.push(value), release() {} } });
  t.after(() => f.owner.dispose());
  f.client.getStats = () => ({ geometryUploads: 2, geometryUploadBytes: 80,
    geometryReuses: 3, residentGeometryBytes: 1234, pathBytes: 456 });
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDirectFrame(), null);
  await resolveAll(f);
  const graphicsStats = f.gpus[0].getStats.bind(f.gpus[0]);
  f.gpus[0].getStats = () => ({ ...graphicsStats(), outputSurfaceBytesEstimate: 999999 });
  assert.ok(f.owner.draw());
  const frame = f.owner.getDirectFrame();
  assert.equal(frame.gpu, f.gpus[0]);
  assert.deepEqual(frame.transform, f.state.zoomTransform);
  assert.deepEqual(frame.layout, f.layout);
  assert.equal(frame.sourceVersion, f.identity.version);
  assert.ok(frame.plan.tiles.length > 0);
  assert.equal(f.gpus[0].draws.length, 0);
  assert.equal(f.blits.length, 0);
  assert.equal(f.gpus[0].palettes.length, 1);
  assert.equal(f.gpus[0].tileSets.length, 1);
  assert.equal(f.owner.getDiagnostics().presentationCache, null);
  assert.equal(f.owner.getDiagnostics().presentation, "direct-gpu");
  assert.equal(f.owner.getDiagnostics().worker.geometryReuses, 3);
  assert.equal(updates.at(-1).workerGeometry, 1234);
  assert.equal(updates.at(-1).projectedPaths, 456);
  assert.equal(updates.at(-1).workerSurfaces, 0);
  f.state.zoomTransform.x++;
  assert.equal(f.owner.getDirectFrame(), frame, "camera motion can transform the committed frame");
  assert.deepEqual(f.owner.getDiagnostics().view, { ...frame.transform, dpr: 1 });
  const previousPaletteRevision = frame.paletteRevision;
  f.identity.colorVersion++;
  assert.equal(f.owner.getDirectFrame(), frame, "color edits retain presentation until draw refreshes its palette");
  assert.ok(f.owner.draw());
  assert.ok(f.owner.getDirectFrame().paletteRevision > previousPaletteRevision);
});

test("direct frames survive geometry preparation and clear on hard invalidation", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const first = f.owner.getDirectFrame();
  f.features[0].geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] };
  f.identity.version++;
  assert.equal(f.owner.getDirectFrame(), first);
  assert.equal(f.owner.draw().retained, true);
  assert.equal(f.owner.getDirectFrame(), first);
  await resolveAll(f); assert.ok(f.owner.draw());
  assert.ok(f.owner.getDirectFrame().epoch > first.epoch);
  f.owner.loseContextForValidation();
  assert.equal(f.owner.getDirectFrame(), null);
  assert.ok(f.owner.draw());
  f.h.isEnabled = () => false;
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDirectFrame(), null);
  f.h.isEnabled = () => true;
  assert.ok(f.owner.draw());
  f.identity.sceneKey = "another-scene";
  assert.equal(f.owner.getDirectFrame(), null);
  assert.equal(f.owner.draw(), null);
  await resolveAll(f); assert.ok(f.owner.draw());
  f.owner.dispose();
  assert.equal(f.owner.getDirectFrame(), null);
});

test("direct camera frame validation uses the cheap scene hook when supplied", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  let current = true, calls = 0;
  f.h.isDirectFrameCompatible = (frame, identity) => {
    calls++; assert.equal(frame.sourceVersion, identity.version); return current;
  };
  f.h.getSourceIdentity = () => { throw new Error("camera must not rebuild source identity"); };
  f.state.zoomTransform.k = 2;
  assert.ok(f.owner.getDirectFrame());
  current = false;
  assert.equal(f.owner.getDirectFrame(), null);
  assert.equal(calls, 2);
});

test("41 direct brush palette previews retain coverage and sync final foreground order once on release", async t => {
  const bounds = { minX: -160, minY: -160, maxX: -140, maxY: -140 };
  const features = [feature("a", bounds), feature("b", bounds)];
  const canonicalColors = { a: "#123456", b: "#654321" };
  const history = [];
  const f = fixture({ displayMode: "raster", directPresentation: true, features,
    resolveColor: item => canonicalColors[item.id] });
  t.after(() => f.owner.dispose());
  f.identity.geometryContentVersion = "geometry-1";
  let brushActive = false, publishes = 0, currentOrder = features;
  f.h.isBrushActive = () => brushActive;
  f.h.getFeatures = () => { publishes++; return currentOrder; };
  f.h.isDirectFrameCurrent = (_frame, raw) => raw.version === f.identity.version
    && raw.colorVersion === f.identity.colorVersion;
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const initial = f.owner.getDiagnostics(), buildCount = f.requests.length;
  brushActive = true;
  for (let i = 1; i <= 41; i++) {
    history.push({ before: canonicalColors.a, after: `#${i.toString(16).padStart(6, "0")}` });
    canonicalColors.a = history.at(-1).after;
    currentOrder = i % 2 ? [features[1], features[0]] : features;
    f.identity.version++;
    f.identity.colorVersion++;
    assert.ok(f.owner.draw());
    assert.ok(f.owner.getDirectFrame(), "preview accepts the latest palette identity");
    assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, true);
    assert.equal(f.owner.queryPoint({ x: -150, y: -150 }).reason, "deferred-foreground-order");
    assert.equal(f.gpus[0].palettes.at(-1).bytes[7], 255);
    assert.equal(f.gpus[0].palettes.at(-1).bytes[6], i, "current brush color reaches GPU palette");
  }
  assert.equal(publishes, 1);
  assert.equal(f.requests.length, buildCount);
  assert.equal(f.owner.getDiagnostics().geometryRevision, initial.geometryRevision);
  const canonicalBeforeRelease = structuredClone({ canonicalColors, history });
  brushActive = false;
  f.owner.finishNativePartialRepaint();
  f.owner.finishNativePartialRepaint();
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-foreground-order").length, 1);
  assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, true, "requesting sync does not pretend it completed");
  assert.equal(f.owner.draw().retained, true);
  assert.equal(publishes, 2);
  assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, false);
  assert.deepEqual(f.requests.at(-1).packet.entries.map(item => item.id), ["b", "a"]);
  await resolveAll(f); assert.ok(f.owner.draw());
  assert.equal(publishes, 2, "async completion must not repeat the final source publish");
  assert.equal(f.requests.length, buildCount + 1);
  assert.ok(f.owner.getDiagnostics().geometryRevision > initial.geometryRevision);
  assert.deepEqual({ canonicalColors, history }, canonicalBeforeRelease, "display preview never writes canonical edits or history");
});

for (const changed of ["geometry", "scene", "coverage", "projection", "layout"]) {
  test(`direct brush ${changed} change publishes immediately instead of deferring`, async t => {
    const f = fixture({ displayMode: "raster", directPresentation: true });
    t.after(() => f.owner.dispose());
    f.identity.geometryContentVersion = "content-1";
    let brush = false, publishes = 0;
    f.h.isBrushActive = () => brush;
    f.h.getFeatures = () => { publishes++; return f.features; };
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    brush = true;
    f.identity.version++;
    f.identity.colorVersion++;
    if (changed === "geometry") {
      f.identity.geometryContentVersion = "content-2";
      f.features[0].geometry = { type: "Polygon", coordinates: [] };
    } else if (changed === "layout") f.layout.offsetX++;
    else f.identity[`${changed}Key`] += "-changed";
    f.owner.draw();
    assert.equal(publishes, 2);
    assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, false);
  });
}

for (const displayMode of ["raster", "hybrid"]) {
  test(`standalone ${displayMode} brush keeps immediate foreground publication`, async t => {
    const f = fixture({ displayMode });
    t.after(() => f.owner.dispose());
    let publishes = 0;
    f.identity.geometryContentVersion = "content-1";
    f.h.isBrushActive = () => true;
    f.h.getFeatures = () => { publishes++; return f.features; };
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    f.identity.version++;
    f.identity.colorVersion++;
    assert.ok(f.owner.draw());
    assert.equal(publishes, 2);
    assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, false);
  });
}

test("a deferred foreground flag survives a failed accurate source publish", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  f.identity.geometryContentVersion = "content-1";
  let brush = false;
  f.h.isBrushActive = () => brush;
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  brush = true; f.identity.version++; f.identity.colorVersion++;
  assert.ok(f.owner.draw());
  brush = false;
  f.h.getFeatures = () => [f.features[0], f.features[0]];
  f.owner.finishNativePartialRepaint();
  assert.equal(f.owner.draw(), null);
  assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, true);
  assert.match(f.owner.getDiagnostics().failed, /Duplicate feature ID/);
  assert.equal(f.owner.getDirectFrame(), null);
});

test("a new stroke consuming a pending release render still requests its own final sync", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  f.identity.geometryContentVersion = "content-1";
  let brush = false;
  f.h.isBrushActive = () => brush;
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  brush = true; f.identity.version++; f.identity.colorVersion++;
  f.owner.draw();
  brush = false; f.owner.finishNativePartialRepaint();
  brush = true; f.identity.version++; f.identity.colorVersion++;
  assert.ok(f.owner.draw());
  brush = false; f.owner.finishNativePartialRepaint(); f.owner.finishNativePartialRepaint();
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-foreground-order").length, 2);
  assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, false);
});

test("direct brush without a separate geometry content identity cannot defer source publication", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  let publishes = 0;
  f.h.isBrushActive = () => true;
  f.h.getFeatures = () => { publishes++; return f.features; };
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  f.identity.version++; f.identity.colorVersion++;
  assert.ok(f.owner.draw());
  assert.equal(publishes, 2);
  assert.equal(f.owner.getDiagnostics().deferredForegroundOrder, false);
});


test("published GPU tiles survive overlapping candidate cancellation and switch only when complete", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const first = f.owner.getDirectFrame(), gpu = f.gpus[0];
  const tiles = gpu.tileSets[0];
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] };
  f.identity.version++;
  assert.equal(f.owner.draw().retained, true);
  const stale = f.requests.at(-1);
  f.features[0].geometry = { type: "Polygon", coordinates: [[[], []]] };
  f.identity.version++;
  assert.equal(f.owner.draw().retained, true);
  assert.equal(stale.signal.aborted, true);
  stale.resolve(makeTile(stale.packet, "stale")); await tick();
  assert.equal(f.owner.getDirectFrame(), first);
  assert.equal(gpu.tileSets.length, 1);
  assert.deepEqual(gpu.tileSets[0], tiles);
  assert.equal(f.owner.queryPoint({ x: -150, y: -150 }).reason, "stale-frame");
  await resolveAll(f, "latest");
  assert.equal(gpu.tileSets.length, 1, "worker completion cannot mutate published GPU resources");
  assert.ok(f.owner.draw());
  assert.notEqual(f.owner.getDirectFrame(), first);
  assert.equal(gpu.tileSets.length, 2);
  assert.ok(gpu.tileSets.at(-1).every(tile => tile.marker !== "stale"));
});

test("retained palette follows edit undo redo while omitted visible IDs stay opaque", async t => {
  const colors = { a: "#123456", b: "#654321" }, history = [];
  const f = fixture({ displayMode: "raster", directPresentation: true,
    features: [feature("a", null), feature("b", null)], resolveColor: (_feature, id) => colors[id] });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const first = f.owner.getDirectFrame(), gpu = f.gpus[0];
  f.setFeatures([f.features[1]]); f.identity.version++;
  for (const color of ["#abcdef", "#123456", "#abcdef"]) {
    colors.a = color; history.push(color); f.identity.colorVersion++;
    const before = structuredClone({ colors, history });
    assert.equal(f.owner.draw().retained, true);
    assert.equal(f.owner.getDirectFrame(), first);
    const expected = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255];
    assert.deepEqual([...gpu.palettes.at(-1).bytes.slice(4, 8)], expected);
    assert.deepEqual({ colors, history }, before);
    assert.equal(gpu.tileSets.length, 1);
  }
  await resolveAll(f); f.owner.draw();
  assert.equal(gpu.palettes.at(-1).bytes[7], 0, "omission takes effect only with complete new geometry");
});

test("a candidate replaces published coverage within the original CPU tile budget", async t => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 2000000 });
  const f = fixture({ displayMode: "raster", directPresentation: true, cache });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  let request = f.requests.at(-1);
  request.resolve({ ...makeTile(request.packet), codes: new Uint32Array(300000) });
  await tick(); f.owner.draw();
  const first = f.owner.getDirectFrame(); assert.ok(first);
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] }; f.identity.version++;
  assert.equal(f.owner.draw().retained, true);
  request = f.requests.at(-1);
  request.resolve({ ...makeTile(request.packet), codes: new Uint32Array(300000) }); await tick();
  assert.ok(f.owner.draw());
  assert.notEqual(f.owner.getDirectFrame(), first);
  assert.equal(cache.getStats().cpuBytes, 1200000);
  assert.equal(f.owner.getDiagnostics().reason, "coverage-ready");
  assert.equal(f.gpus[0].tileSets.length, 2);
});

test("published compatibility rejects DPR and layout changes during preparation", async t => {
  for (const change of [f => f.state.dpr++, f => f.layout.pixelWidth++]) {
    const f = fixture({ displayMode: "raster", directPresentation: true });
    t.after(() => f.owner.dispose());
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    change(f);
    assert.equal(f.owner.getDirectFrame(), null);
  }
});


test("direct candidates stay staged until whole-scene publication and reject stale commits", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f);
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.owner.getDirectFrame(), null);
  assert.equal(f.gpus[0].tileSets.length, 0);
  const sceneIdentity = f.owner.getStagedFrameIdentity();
  assert.equal(typeof sceneIdentity, "string");
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.owner.getStagedFrameIdentity(), sceneIdentity, "equivalent draw wrappers retain exact scene preparation identity");
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.equal(f.owner.getStagedFrameIdentity(), null);
  const first = f.owner.getDirectFrame();
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] }; f.identity.version++;
  assert.equal(f.owner.draw().retained, true);
  await resolveAll(f);
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.owner.getDirectFrame(), first);
  assert.notEqual(f.owner.getStagedFrameIdentity(), sceneIdentity, "geometry/source changes change preparation identity");
  assert.equal(f.gpus[0].tileSets.length, 1, "yielding between render passes keeps published political tiles");
  f.identity.colorVersion++;
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(f.owner.getDirectFrame(), first);
  assert.equal(f.gpus[0].tileSets.length, 1);
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.notEqual(f.owner.getDirectFrame(), first);
  assert.equal(f.gpus[0].tileSets.length, 2);
  assert.equal(f.owner.publishDirectFrame(), false, "a staged candidate is consumed once");
});


test("restoring default color consumes pending foreground only after successful publication", async t => {
  let pending = true, commits = 0, f;
  f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    commitPublishedColorEdit(result) {
      assert.ok(f.owner.getDirectFrame(), "publication precedes consumption");
      assert.ok(result.renderedIds.has("a"));
      assert.equal(result.paintSource, "political-id-raster");
      commits++; pending = false;
    } });
  t.after(() => f.owner.dispose());
  // Removing an override leaves its ID in pending foreground until painted.
  // Clearing that marker removes the ID from the source version's order key.
  f.h.getSourceIdentity = () => ({ ...f.identity, version: pending ? "default:pending-a" : "default:background" });
  f.owner.draw(); await resolveAll(f);
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.owner.getDiagnostics().stagedPending, true);
  assert.equal(pending, true);
  assert.equal(commits, 0);
  assert.equal(f.owner.publishDirectFrame(), true, "pending marker cannot invalidate its own candidate before publication");
  assert.equal(pending, false); assert.equal(commits, 1);
  assert.equal(f.owner.getDiagnostics().stagedPending, false);
  await tick();
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-published-edit").length, 1);
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(commits, 1);
  assert.equal(f.owner.draw().staged, true);
  f.identity.colorVersion++;
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(commits, 1, "rejected candidate never consumes an edit");
  assert.equal(f.owner.getDiagnostics().stagedPending, false);
  assert.equal(f.owner.getDiagnostics().stagedRejectionReason, "stale-candidate");
  assert.equal(f.owner.getDiagnostics().stagedRejections, 1);
});

test("undo foreground consumption requests its next frame after the active render boundary clears", async t => {
  let pending = true, scheduled = 0, f;
  f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    requestRenderEffect: requestRender,
    commitPublishedColorEdit() { pending = false; },
  });
  t.after(() => { f.owner.dispose(); bindRenderBoundary({}); });
  f.h.getSourceIdentity = () => ({ ...f.identity, version: pending ? "undo:pending-brush-ids" : "undo:background" });
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  bindRenderBoundary({ scheduleRender: () => { scheduled++; } });
  requestRender("history-undo");
  assert.equal(scheduled, 1);
  assert.equal(getRenderBoundaryDebugState().requestPending, true);
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.equal(pending, false);
  assert.equal(f.owner.getPendingWorkCount(), 0, "the follow-up must not depend on another worker completion");
  assert.equal(scheduled, 1, "publication has not re-entered the still-active render boundary");
  markRenderBoundaryFlushed();
  await tick();
  assert.equal(scheduled, 2, "post-publication source identity gets its own scheduled render");
  assert.equal(getRenderBoundaryDebugState().lastScheduledReason, "political-id-raster-published-edit");
  assert.equal(getRenderBoundaryDebugState().requestPending, true);
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-published-edit").length, 1);
});

test("queued post-publication identity continuation is suppressed after disposal", async t => {
  let pending = true;
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    commitPublishedColorEdit() { pending = false; } });
  t.after(() => f.owner.dispose());
  f.h.getSourceIdentity = () => ({ ...f.identity, version: pending ? "pending" : "consumed" });
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  assert.equal(f.owner.publishDirectFrame(), true);
  f.owner.dispose(); await tick();
  assert.equal(f.renders.filter(reason => reason === "political-id-raster-published-edit").length, 0);
});


test("wide overview persists through 100 130 250 100 navigation and follows canonical colors", async t => {
  const gpuFactory = makeGpuFactory(), overviewFactory = makeGpuFactory();
  const createGpu = options => {
    const gpu = gpuFactory.createGpu(options);
    gpu.createOverview = ({ tiles, palette, revision }) => {
      const child = overviewFactory.createGpu({ onContextLost() {} });
      child.setPalette(palette, revision); child.setTiles(tiles); return child;
    };
    const dispose = gpu.dispose.bind(gpu);
    gpu.dispose = () => { dispose(); for (const child of overviewFactory.instances) child.dispose(); };
    return gpu;
  };
  const f = fixture({ displayMode: "raster", directPresentation: true, createGpu });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const initial = f.owner.getDirectFrame(), overview = f.owner.getOverviewFrame();
  assert.ok(overview); assert.equal(overview.sourceFrame, initial);
  assert.equal(overview.plan.density, initial.plan.density / 2);
  assert.deepEqual(overview.transform, initial.transform);
  assert.equal(overview.presentationState, "overview");
  for (const scale of [1.3, 2.5, 1]) {
    f.state.zoomTransform.k = scale;
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    assert.equal(f.owner.getOverviewFrame(), overview);
  }
  assert.equal(overviewFactory.instances.length, 1);
  for (const color of ["#abcdef", "#123456", "#abcdef"]) {
    f.features[0].color = color; f.identity.colorVersion++;
    f.owner.draw();
    assert.equal(f.owner.getOverviewFrame(), overview);
    assert.equal(overview.gpu.palettes.at(-1).bytes[4], parseInt(color.slice(1, 3), 16));
  }
  f.state.dpr++;
  assert.equal(f.owner.getOverviewFrame(), null);
  assert.equal(overview.gpu.isAvailable(), false);
});

test("a same-sized translated publication refreshes the scene overview reference even inside the same ID grid", async t => {
  const primary = makeGpuFactory(), reduced = makeGpuFactory();
  const f = fixture({ displayMode: "raster", directPresentation: true, createGpu: options => {
    const gpu = primary.createGpu(options);
    gpu.createOverview = ({ tiles, palette, revision }) => {
      const child = reduced.createGpu({ onContextLost() {} });
      child.setPalette(palette, revision); child.setTiles(tiles); return child;
    };
    const dispose = gpu.dispose.bind(gpu);
    gpu.dispose = () => { dispose(); for (const child of reduced.instances) child.dispose(); };
    return gpu;
  } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const original = f.owner.getDirectFrame(), previous = f.owner.getOverviewFrame();
  f.state.zoomTransform.y -= 17.86018853108027;
  assert.ok(f.owner.draw());
  const translated = f.owner.getOverviewFrame();
  assert.deepEqual(f.owner.getDirectFrame().plan.tiles.map(tile => tile.key), original.plan.tiles.map(tile => tile.key));
  assert.notEqual(translated, previous, "sibling viewport textures need a fresh capture despite identical ID tile bounds");
  assert.deepEqual(translated.transform, f.state.zoomTransform);
  assert.equal(translated.sourceFrame, f.owner.getDirectFrame());
  const count = reduced.instances.length;
  for (const k of [1.3, 2.5, 1]) {
    f.state.zoomTransform.k = k;
    f.owner.draw(); await resolveAll(f); f.owner.draw();
    assert.equal(f.owner.getOverviewFrame(), translated, "narrower zooms cannot displace the complete wide overview");
  }
  assert.equal(reduced.instances.length, count);
});

test("overview reservation rejects an oversized primary without disabling future publication", async t => {
  const factory = makeGpuFactory();
  let admit = true;
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    createGpu: options => { const gpu = factory.createGpu(options); gpu.canSetFrame = () => admit; return gpu; } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw(); f.owner.publishDirectFrame();
  const first = f.owner.getDirectFrame();
  f.owner.draw(); admit = false;
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(f.owner.getDirectFrame(), first);
  assert.equal(f.owner.getDiagnostics().stagedRejectionReason, "gpu-budget");
  assert.equal(f.owner.getDiagnostics().failed, "");
  admit = true; f.owner.draw();
  assert.equal(f.owner.publishDirectFrame(), true);
});

test("direct publication uses one frame preparation and keeps the old frame after a budget rejection", async t => {
  const factory = makeGpuFactory();
  let admit = true, calls = 0;
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    createGpu: options => {
      const gpu = factory.createGpu(options);
      gpu.canSetFrame = () => { throw Error("duplicate GPU preflight"); };
      gpu.setFrame = ({ tiles, palette, revision }) => {
        calls++;
        if (!admit) throw new RangeError("Political GPU texture budget exceeded.");
        gpu.setPalette(palette, revision); gpu.setTiles(tiles);
        return { planningMs: 2, paletteUploadMs: 1, tileBindingMs: 3 };
      };
      return gpu;
    } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.equal(calls, 1);
  const first = f.owner.getDirectFrame();
  assert.equal(f.owner.getDiagnostics().lastTiming.tileBindingMs, 5);
  f.owner.draw(); admit = false;
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(f.owner.getDirectFrame(), first);
  assert.equal(f.owner.getDiagnostics().stagedRejectionReason, "gpu-budget");
  assert.equal(f.owner.getDiagnostics().failed, "");
  admit = true; f.owner.draw();
  assert.equal(f.owner.publishDirectFrame(), true);
  assert.equal(calls, 3);
});


test("published color matching keeps the initial baseline through retained edits and undo", async t => {
  const updates = [];
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    resourceBudget: { update: (_owner, value) => updates.push(value), release() {} } });
  t.after(() => f.owner.dispose());
  assert.equal(f.owner.matchesPublishedColor("a"), false);
  f.owner.draw(); await resolveAll(f); f.owner.draw(); f.owner.publishDirectFrame();
  const initialBytes = updates.at(-1).rasterTiles;
  assert.equal(f.owner.matchesPublishedColor("a"), true);
  assert.equal(f.owner.matchesPublishedColor("missing"), false);
  f.features[0].color = "#abcdef"; f.identity.colorVersion++;
  assert.equal(f.owner.matchesPublishedColor("a"), false);
  assert.equal(f.owner.draw().staged, true);
  assert.equal(f.gpus[0].palettes.at(-1).bytes[4], 0xab, "live retained palette still changes");
  assert.equal(f.owner.matchesPublishedColor("a"), false, "updated live palette is not the published baseline");
  assert.equal(updates.at(-1).rasterTiles, initialBytes + 8, "the diverged baseline buffer is counted once");
  f.features[0].color = "#123456"; f.identity.colorVersion++;
  assert.equal(f.owner.matchesPublishedColor("a"), true, "undo exposes the original complete scene without a patch");
  f.owner.draw();
  assert.equal(f.owner.matchesPublishedColor("a"), true);
  f.h.resolveColor = () => [0x12, 0x34, 0x56, 255];
  assert.equal(f.owner.matchesPublishedColor("a"), true, "array and hex representations share exact bytes");
});

function overviewColorFixture() {
  const gpuFactory = makeGpuFactory(), overviewFactory = makeGpuFactory();
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    createGpu: options => {
      const gpu = gpuFactory.createGpu(options);
      gpu.createOverview = ({ tiles, palette, revision }) => {
        const child = overviewFactory.createGpu({ onContextLost() {} });
        child.setPalette(palette, revision); child.setTiles(tiles); return child;
      };
      const dispose = gpu.dispose.bind(gpu);
      gpu.dispose = () => { dispose(); for (const child of overviewFactory.instances) child.dispose(); };
      return gpu;
    } });
  return f;
}

test("overview colors match their own initial palette after a newer primary publishes", async t => {
  const f = overviewColorFixture();
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw(); f.owner.publishDirectFrame();
  const overview = f.owner.getOverviewFrame();
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
  f.features[0].color = "#abcdef"; f.identity.colorVersion++;
  f.owner.draw(); f.owner.publishDirectFrame();
  assert.equal(f.owner.getOverviewFrame(), overview);
  assert.equal(overview.gpu.palettes.at(-1).bytes[4], 0xab);
  assert.equal(f.owner.matchesPublishedColor("a"), true);
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), false);
  f.features[0].color = "#123456"; f.identity.colorVersion++;
  assert.equal(f.owner.matchesPublishedColor("a"), false);
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
  f.owner.draw();
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
  assert.equal(f.owner.matchesPublishedColor("missing", { overview: true }), false);
});

for (const [reason, invalidate] of [
  ["scene", f => { f.identity.sceneKey = "scene-next"; }],
  ["DPR", f => { f.state.dpr++; }],
  ["layout", f => { f.layout.pixelWidth++; }],
  ["disabled", f => { f.h.isEnabled = () => false; }],
  ["context loss", f => f.owner.loseContextForValidation()],
  ["dispose", f => f.owner.dispose()],
]) {
  test(`published and overview color matching reject ${reason} invalidation`, async t => {
    const f = overviewColorFixture();
    t.after(() => f.owner.dispose());
    f.owner.draw(); await resolveAll(f); f.owner.draw(); f.owner.publishDirectFrame();
    assert.equal(f.owner.matchesPublishedColor("a"), true);
    assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
    invalidate(f);
    assert.equal(f.owner.matchesPublishedColor("a"), false);
    assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), false);
    assert.equal(f.owner.capturePublishedColorBaseline(), false);
    assert.equal(f.owner.capturePublishedColorBaseline({ overview: true }), false);
  });
}


test("entering overview captures its current displayed color once without changing primary or live palettes", async t => {
  const f = overviewColorFixture();
  t.after(() => f.owner.dispose());
  assert.equal(f.owner.capturePublishedColorBaseline(), false);
  assert.equal(f.owner.capturePublishedColorBaseline({ overview: true }), false);
  f.owner.draw(); await resolveAll(f); f.owner.draw(); f.owner.publishDirectFrame();
  const primary = f.owner.getDirectFrame(), overview = f.owner.getOverviewFrame();
  f.features[0].color = "#191919"; f.identity.colorVersion++;
  f.owner.draw(); // Refresh live colors, but leave the primary's original baseline intact.
  assert.equal(f.owner.matchesPublishedColor("a"), false);
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), false);
  const primaryUploads = primary.gpu.palettes.length, overviewUploads = overview.gpu.palettes.length;
  assert.equal(f.owner.capturePublishedColorBaseline({ overview: true }), true);
  assert.equal(primary.gpu.palettes.length, primaryUploads);
  assert.equal(overview.gpu.palettes.length, overviewUploads, "capturing does not upload or mutate live colors");
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
  assert.equal(f.owner.matchesPublishedColor("a"), false, "overview capture cannot reset the primary baseline");
  f.features[0].color = "#646464"; f.identity.colorVersion++;
  f.owner.draw();
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), false);
  f.features[0].color = "#191919"; f.identity.colorVersion++;
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true, "undo matches the overview entry color, not its creation color");
  f.owner.draw();
  assert.equal(f.owner.matchesPublishedColor("a", { overview: true }), true);
  assert.equal(f.owner.matchesPublishedColor("a"), false);
  assert.equal(f.owner.capturePublishedColorBaseline(), true);
  assert.equal(f.owner.matchesPublishedColor("a"), true, "explicit primary capture has the same bounded contract");
});


test("source preflight starts changed-camera tiles without replacing the published GPU frame or requesting a busy repaint", async (t) => {
  const f = fixture({ directPresentation: true, displayMode: "raster" });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const oldFrame = f.owner.getDirectFrame(), gpu = f.gpus[0];
  const acceptedView = f.owner.getDiagnostics().view;
  const gpuCounts = [gpu.palettes.length, gpu.tileSets.length, gpu.draws.length, f.blits.length];
  const previousRequests = f.requests.length, previousRenders = f.renders.length;
  f.state.zoomTransform = { x: 150, y: 175, k: 2.5 };
  const pending = f.owner.prepareSource();
  assert.equal(typeof pending.then, "function");
  assert.equal(f.requests.length, previousRequests + 1, "camera work starts before the labels gate permits drawing");
  for (let repeat = 0; repeat < 3; repeat++) assert.equal(f.owner.prepareSource(), pending);
  assert.equal(f.requests.length, previousRequests + 1, "preflight shares the bounded active producer");
  assert.equal(f.renders.length, previousRenders, "preflight must not unconditionally schedule another repaint");
  assert.equal(f.owner.getDirectFrame(), oldFrame);
  assert.equal(oldFrame.presentationState, "retained");
  assert.deepEqual(f.owner.getDiagnostics().view, acceptedView);
  assert.deepEqual([gpu.palettes.length, gpu.tileSets.length, gpu.draws.length, f.blits.length], [gpuCounts[0] + 1, ...gpuCounts.slice(1)], "only the accepted palette may refresh");
  await resolveAll(f, "preflight-camera");
  assert.equal(f.owner.getDirectFrame(), oldFrame, "worker completion alone cannot publish a frame");
  assert.deepEqual([gpu.palettes.length, gpu.tileSets.length, gpu.draws.length, f.blits.length], [gpuCounts[0] + 1, ...gpuCounts.slice(1)]);
  assert.ok(f.owner.draw());
  assert.notEqual(f.owner.getDirectFrame(), oldFrame);
  assert.deepEqual(f.owner.getDiagnostics().view, { ...f.state.zoomTransform, dpr: 1 });
  const settledRenders = f.renders.length;
  assert.equal(f.owner.prepareSource(), false);
  assert.equal(f.renders.length, settledRenders, "a covered preflight also remains quiet");
});

test("source preflight rejects a superseded camera tile while retaining the old frame through asynchronous source replacement", async (t) => {
  const f = fixture({ directPresentation: true, displayMode: "raster" });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const oldFrame = f.owner.getDirectFrame(), gpu = f.gpus[0];
  const gpuCounts = [gpu.palettes.length, gpu.tileSets.length, gpu.draws.length];
  f.state.zoomTransform = { x: 150, y: 175, k: 2.5 };
  assert.equal(typeof f.owner.prepareSource().then, "function");
  const stale = f.requests.at(-1);
  const gates = [];
  f.h.yieldSourcePreparation = () => new Promise(resolve => gates.push(resolve));
  f.h.prepareFeatures = async () => [...f.features];
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] };
  f.identity.version++;
  assert.equal(typeof f.owner.prepareSource().then, "function", "an accepted frame cannot let the pipeline commit an incomplete candidate");
  assert.equal(stale.signal.aborted, true);
  stale.resolve(makeTile(stale.packet, "superseded-preflight")); await tick();
  assert.ok(f.cache.entries().every(([, tile]) => tile.marker !== "superseded-preflight"));
  assert.equal(f.owner.getDirectFrame(), oldFrame);
  for (let guard = 0; f.owner.isSourcePreparing() && guard < 10; guard++) {
    for (const resume of gates.splice(0)) resume();
    await tick();
  }
  assert.equal(f.owner.isSourcePreparing(), false);
  assert.equal(f.owner.getDiagnostics().sourcePreparation.committed, 1);
  await resolveAll(f, "current-preflight");
  assert.equal(f.owner.getDirectFrame(), oldFrame);
  assert.deepEqual([gpu.palettes.length, gpu.tileSets.length, gpu.draws.length], [gpuCounts[0] + 1, ...gpuCounts.slice(1)]);
  assert.ok(f.owner.draw());
  assert.ok(gpu.tileSets.at(-1).every(tile => tile.marker !== "superseded-preflight"));
});

test("initial asynchronous source preflight returns its preparation promise without allocating a GPU", async (t) => {
  const f = fixture({ directPresentation: true, displayMode: "raster" });
  t.after(() => f.owner.dispose());
  const gates = [];
  f.h.yieldSourcePreparation = () => new Promise(resolve => gates.push(resolve));
  f.h.prepareFeatures = async () => [...f.features];
  const pending = f.owner.prepareSource();
  assert.equal(typeof pending.then, "function");
  assert.equal(f.owner.prepareSource(), pending);
  assert.equal(f.gpus.length, 0);
  assert.equal(f.requests.length, 0);
  for (let guard = 0; f.owner.isSourcePreparing() && guard < 10; guard++) {
    for (const resume of gates.splice(0)) resume();
    await tick();
  }
  assert.equal(f.owner.isSourcePreparing(), false);
  await pending;
  assert.ok(f.requests.length > 0, "the existing async commit hook starts tile preparation");
  assert.equal(f.gpus.length, 0);
});

test("direct source collection runs privately outside draw and discards superseded candidates", async (t) => {
  const f = fixture({ directPresentation: true, displayMode: "raster" });
  t.after(() => f.owner.dispose());
  let collections = 0;
  const gates = [];
  f.h.yieldSourcePreparation = () => new Promise(resolve => gates.push(resolve));
  f.h.prepareFeatures = async ({ signal }) => {
    signal.throwIfAborted(); collections++;
    return [...f.h.getFeatures()];
  };
  assert.equal(f.owner.draw(), null);
  assert.equal(collections, 0, "no filtering can execute on the drawing stack");
  assert.equal(f.owner.getDiagnostics().geometryRevision, 0);
  assert.equal(f.owner.getPendingWorkCount(), 1);
  f.identity.version++;
  f.setFeatures([feature("b", f.features[0].bounds)]);
  f.owner.draw();
  for (const resume of gates.splice(0)) resume();
  await tick();
  assert.equal(collections, 1, "the obsolete first task never collects");
  assert.equal(f.owner.getDiagnostics().geometryRevision, 0, "candidate is still private before commit yield");
  for (const resume of gates.splice(0)) resume();
  await tick();
  assert.equal(f.owner.getDiagnostics().sourcePreparation.committed, 1);
  assert.equal(f.requests[0].packet.entries[0].id, "b");
  await resolveAll(f);
  assert.ok(f.owner.draw());
  assert.equal(f.owner.getPendingWorkCount(), 0);
});

test("retained direct scene stays editable while source preparation waits and dispose cancels it", async (t) => {
  const f = fixture({ directPresentation: true, displayMode: "raster" });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  const oldFrame = f.owner.getDirectFrame();
  const revision = f.owner.getDiagnostics().geometryRevision;
  const gates = [];
  f.h.yieldSourcePreparation = () => new Promise(resolve => gates.push(resolve));
  f.h.prepareFeatures = async () => [...f.features];
  f.identity.version++;
  f.setFeatures([...f.features, feature("b", f.features[0].bounds)]);
  assert.equal(typeof f.owner.prepareSource().then, "function", "navigation retains the scene while candidate publication waits");
  assert.equal(f.owner.getDirectFrame(), oldFrame);
  assert.equal(f.owner.getDiagnostics().geometryRevision, revision);
  f.features[0].color = "#ff0000"; f.identity.colorVersion++;
  assert.equal(f.owner.draw().retained, true);
  assert.deepEqual([...f.gpus[0].palettes.at(-1).bytes.slice(4, 8)], [255, 0, 0, 255]);
  assert.equal(f.owner.getDirectFrame(), oldFrame);
  f.owner.dispose();
  for (const resume of gates.splice(0)) resume();
  await tick();
  assert.equal(f.owner.getDiagnostics().sourcePreparation.committed, 0);
  assert.equal(f.owner.getPendingWorkCount(), 0);
});
