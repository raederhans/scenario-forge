import { createPoliticalIdRasterDisplayCache } from "../js/core/renderer/political_id_raster_display_cache.js";
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
    request(packet, { signal } = {}) {
      return new Promise((resolve) => {
        const item = {
          packet, signal, settled: false,
          resolve(tile) { this.settled = true; resolve(tile); },
        };
        requests.push(item);
      });
    },
  };
}

function makeGpuFactory() {
  const instances = [];
  const createGpu = () => {
    const gpu = {
      canvas: { tag: `gpu-${instances.length}` },
      available: true,
      disposed: false,
      palettes: [],
      tileSets: [],
      draws: [],
      isAvailable() { return this.available && !this.disposed; },
      setPalette(bytes, revision) { this.palettes.push({ bytes: bytes.slice(), revision }); },
      setTiles(tiles) { this.tileSets.push([...tiles]); },
      draw(plan) { this.draws.push(plan); },
      getStats() { return {}; },
      dispose() { this.disposed = true; },
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
  resolveColor = item => item.color,
  displayMode = "hybrid",
  directPresentation = false,
  autoPublish = true,
  projection = {},
} = {}) {
  const state = { zoomTransform: { ...transform }, dpr: 1 };
  const identity = { sceneKey: "scene-a", projectionKey: "projection-a", coverageKey: "coverage-a", version: 1, colorVersion: 0 };
  const blits = [];
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
    surface: { getProjection: () => projection, getContext: () => context },
    helpers: h,
    effects: { requestRender() {}, recordMetric() {} },
    client,
    cache,
    createGpu: createGpu || gpuHarness.createGpu,
    displayMode, directPresentation,
    createDisplayCache: () => createPoliticalIdRasterDisplayCache({ createCanvas: (width, height) => ({
      width, height, getContext: () => ({ save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} }),
    }) }),
  });
  return {
    owner: autoPublish && directPresentation ? { ...owner, draw() {
      const result = owner.draw();
      if (result?.staged) assert.equal(owner.publishDirectFrame(), true);
      return result;
    } } : owner, state, identity, features, setFeatures(next) { features = next; },
    requests: client.requests, blits, cache,
    gpus: gpuHarness?.instances || [],
  };
}

async function resolveAll(f, marker = "tile") {
  let index = 0, guard = 0;
  const limit = f.requests.length + 100;
  while (guard++ < limit) {
    await tick();
    if (index < f.requests.length) {
      const request = f.requests[index++];
      if (!request.settled) request.resolve(makeTile(request.packet, marker));
      continue;
    }
    if (f.owner.getPendingWorkCount() === 0) break;
  }
  assert.ok(guard <= limit, "tile worker queue should settle without an unbounded pump");
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
  assert.equal(f.gpus[0].draws.length, 0);
  assert.equal(await resolveAll(f), expected.tiles.length);

  const result = f.owner.draw();
  assert.ok(result);
  assert.equal(f.gpus[0].tileSets.at(-1).length, expected.tiles.length);
  assert.equal(f.gpus[0].draws.length, 1);
  assert.equal(f.blits.length, 1);
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

test("picking reads the published frame and rejects it after geometry changes", async t => {
  const f = fixture({ displayMode: "raster", directPresentation: true,
    features: [feature("stable-a", { minX: -160, minY: -160, maxX: -140, maxY: -140 })] });
  t.after(() => f.owner.dispose());
  f.owner.draw();
  const request = f.requests[0], tile = makeTile(request.packet);
  tile.codes = new Uint32Array(tile.width * tile.height).fill(1);
  request.resolve(tile);
  await tick();
  f.owner.draw();
  assert.deepEqual(f.owner.queryPoint({ x: -150, y: -150 }).ids, ["stable-a"]);
  f.features[0].geometry = { type: "Polygon", coordinates: [[[]]] };
  f.identity.version++;
  assert.equal(f.owner.draw().retained, true);
  assert.equal(f.owner.queryPoint({ x: -150, y: -150 }).reason, "stale-frame");
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

test("failed publication keeps the current direct frame", async t => {
  const factory = makeGpuFactory();
  let admit = true;
  const f = fixture({ displayMode: "raster", directPresentation: true, autoPublish: false,
    createGpu: options => {
      const gpu = factory.createGpu(options);
      gpu.setFrame = ({ tiles, palette, revision }) => {
        if (!admit) throw new RangeError("Political GPU texture budget exceeded.");
        gpu.setPalette(palette, revision); gpu.setTiles(tiles);
        return { planningMs: 2, paletteUploadMs: 1, tileBindingMs: 3 };
      };
      return gpu;
    } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); f.owner.draw();
  assert.equal(f.owner.publishDirectFrame(), true);
  const first = f.owner.getDirectFrame();
  f.owner.draw(); admit = false;
  assert.equal(f.owner.publishDirectFrame(), false);
  assert.equal(f.owner.getDirectFrame(), first);
});
