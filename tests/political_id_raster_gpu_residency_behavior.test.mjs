import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createPoliticalIdRasterGpu } from "../js/core/renderer/political_id_raster_gpu.js";
import { createPoliticalIdRasterCache } from "../js/core/renderer/political_id_raster_cache.js";

function harness() {
  const calls = [];
  let id = 0;
  const canvas = { width: 20, height: 10, addEventListener() {}, removeEventListener() {} };
  const gl = new Proxy({ canvas, getParameter: () => 4096, getProgramParameter: () => true,
    isContextLost: () => false, getExtension: () => null,
    getUniformLocation: (_program, name) => name, getAttribLocation: () => 0,
  }, { get(target, key) {
    if (key in target) return target[key];
    if (key === key.toUpperCase()) return key;
    return (...args) => {
      // Mock GL must not accidentally retain upload buffers under test.
      calls.push([key, ...args.map(value => ArrayBuffer.isView(value) ? value.byteLength : value)]);
      return key.startsWith("create") ? { id: ++id } : undefined;
    };
  } });
  canvas.getContext = () => gl;
  return { gl, canvas, calls };
}
const tile = (originX, code = 1) => ({ originX, originY: 0, width: 1, height: 1,
  codes: Uint32Array.of(code), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() });
const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255);

const hostTick = () => new Promise(resolve => setImmediate(resolve));
function recordFrames(h) {
  const bound = new Map(), pixels = new Map(), frames = [];
  let unit = 0;
  h.gl.TEXTURE0 = 0; h.gl.TEXTURE3 = 3;
  h.gl.activeTexture = value => { unit = value; };
  h.gl.bindTexture = (_target, handle) => bound.set(unit, handle);
  h.gl.texImage2D = (...args) => pixels.set(bound.get(unit), args.at(-1).slice());
  h.gl.texSubImage2D = (...args) => pixels.set(bound.get(unit), args.at(-1).slice());
  h.gl.drawArrays = () => frames.push({ codes: [...pixels.get(bound.get(0))], palette: [...pixels.get(bound.get(3))] });
  return gpu => { frames.length = 0; gpu.drawLayer({ width: 20, height: 10 }); return frames.slice(); };
}

test("private GPU tiles upload one per host task and preserve the published bytes until atomic commit", async () => {
  const h = harness(), read = recordFrames(h), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 200 });
  const old = tile(0), next = [tile(0, 2), tile(3, 1)], nextPalette = Uint8Array.of(...palette, 0, 0, 255, 255);
  gpu.setFrame({ tiles: [old], palette, revision: 1 });
  const accepted = read(gpu), gates = [], charges = [];
  const preparing = gpu.prepareFrame({ tiles: next, palette: nextPalette,
    yieldTask: () => new Promise(resolve => gates.push(resolve)), onProgress: () => charges.push(gpu.getStats().gpuTextureBytes) });
  assert.deepEqual(read(gpu), accepted);
  for (let index = 0; index < next.length; index++) {
    assert.equal(gates.length, 1);
    gates.shift()(); await hostTick();
    assert.equal(gpu.getStats().preparedFrameUploads, index + 1);
    assert.deepEqual(read(gpu), accepted, "neither pending tile uploads nor their palette can enter the old draw");
  }
  const handle = await preparing;
  assert.equal(gpu.getStats().residentTiles, 1);
  assert.equal(gpu.getStats().pendingFrameReady, true);
  assert.ok(gpu.getStats().pendingTextureBytes > 0);
  assert.ok(charges.every(bytes => bytes <= 200));
  handle.commit({ palette: nextPalette, revision: 2 });
  assert.equal(gpu.getStats().pendingTextureBytes, 0);
  assert.equal(gpu.getStats().residentTiles, 2);
  const fresh = harness(), readFresh = recordFrames(fresh), oracle = createPoliticalIdRasterGpu({ gl: fresh.gl });
  oracle.setFrame({ tiles: next, palette: nextPalette, revision: 2 });
  assert.deepEqual(read(gpu), readFresh(oracle), "async publication preserves the synchronous categorical and gutter bytes");
  assert.throws(() => handle.commit({ palette: nextPalette, revision: 2 }), /Stale/);
  gpu.dispose(); oracle.dispose();
});

test("pending GPU budget charges the old/new union and capacity rejection leaves the old publication intact", async () => {
  const h = harness(), read = recordFrames(h), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 80 });
  gpu.setFrame({ tiles: [tile(0)], palette, revision: 1 });
  const accepted = read(gpu), before = gpu.getStats();
  const candidate = await gpu.prepareFrame({ tiles: [tile(3, 2)], palette, yieldTask: hostTick });
  assert.equal(candidate, null, "a final frame fitting alone cannot bypass the old+new cap");
  assert.equal(gpu.getStats().gpuTextureBytes, before.gpuTextureBytes);
  assert.equal(gpu.getStats().pendingTextureBytes, 0);
  assert.equal(gpu.getStats().tileUploads, before.tileUploads);
  assert.equal(gpu.getStats().preparedFrameBudgetRejects, 1);
  assert.deepEqual(read(gpu), accepted);
  gpu.setFrame({ tiles: [tile(3)], palette, revision: 1 });
  assert.equal(gpu.getStats().residentTiles, 1, "the unchanged synchronous capacity fallback remains available");
  gpu.dispose();
});

test("a changed shared reservation rejects prepared publication before changing the accepted palette", async () => {
  const h = harness(), read = recordFrames(h); let reserved = 0;
  const gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 200, getReservedTextureBytes: () => reserved });
  gpu.setFrame({ tiles: [tile(0)], palette, revision: 1 });
  const accepted = read(gpu);
  const handle = await gpu.prepareFrame({ tiles: [tile(3)], palette, yieldTask: hostTick });
  reserved = 120;
  const nextPalette = palette.slice(); nextPalette[4] = 100;
  assert.throws(() => handle.commit({ palette: nextPalette, revision: 2 }), /budget/);
  assert.deepEqual(read(gpu), accepted);
  handle.cancel();
  assert.equal(gpu.getStats().pendingTextureBytes, 0);
  assert.ok(gpu.getStats().gpuTextureBytes + reserved <= 200);
  gpu.dispose();
});

test("private GPU cancellation releases only pending resources and late continuations cannot affect a new candidate", async () => {
  const h = harness(), read = recordFrames(h), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 250 });
  gpu.setFrame({ tiles: [tile(0)], palette, revision: 1 });
  const accepted = read(gpu), controller = new AbortController(), gates = [];
  const stale = gpu.prepareFrame({ tiles: [tile(3), tile(6)], palette, signal: controller.signal,
    yieldTask: () => new Promise(resolve => gates.push(resolve)) });
  const rejected = assert.rejects(stale, { name: "AbortError" });
  gates.shift()(); await hostTick();
  assert.ok(gpu.getStats().pendingTextureBytes > 0);
  controller.abort();
  assert.equal(gpu.getStats().pendingTextureBytes, 0);
  assert.deepEqual(read(gpu), accepted);
  const fresh = gpu.prepareFrame({ tiles: [tile(9)], palette, yieldTask: hostTick });
  gates.shift()(); await rejected;
  const handle = await fresh;
  assert.equal(gpu.getStats().pendingFrameReady, true);
  assert.deepEqual(read(gpu), accepted);
  handle.commit({ palette, revision: 1 });
  assert.equal(gpu.getStats().preparedFrameCommits, 1);
  gpu.dispose();
});

test("pending GPU geometry reuses exact immutable residents and aborts on context loss or disposal", async () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 100 });
  const accepted = tile(0);
  gpu.setFrame({ tiles: [accepted], palette, revision: 1 });
  const handle = await gpu.prepareFrame({ tiles: [accepted, tile(3)], palette, yieldTask: hostTick });
  assert.equal(handle.stats.uploadedTiles, 1);
  assert.equal(gpu.getStats().gpuTextureBytes, 96, "an identical resident is counted once in the union");
  handle.cancel(); gpu.dispose();
  for (const lose of [false, true]) {
    const platform = harness(); let onLost;
    platform.canvas.addEventListener = (_event, listener) => { onLost = listener; };
    const candidateGpu = createPoliticalIdRasterGpu({ gl: platform.gl });
    const gates = [];
    const candidate = candidateGpu.prepareFrame({ tiles: [tile(0), tile(3)], palette,
      yieldTask: () => new Promise(resolve => gates.push(resolve)) });
    const rejected = assert.rejects(candidate);
    gates.shift()(); await hostTick();
    if (lose) onLost({ preventDefault() {} }); else candidateGpu.dispose();
    assert.equal(candidateGpu.getStats().pendingTextureBytes, 0);
    gates.shift()(); await rejected;
    candidateGpu.dispose();
  }
});

test("complete frame preflights once and preserves published resources on rejected input", () => {
  const makeTiles = () => [tile(0), tile(1)];
  const observe = tiles => {
    const counts = new Map();
    for (const value of tiles) {
      const codes = value.codes;
      Object.defineProperty(value, "codes", { get() {
        counts.set(value, (counts.get(value) || 0) + 1); return codes;
      } });
    }
    return counts;
  };
  const old = harness(), oldGpu = createPoliticalIdRasterGpu({ gl: old.gl });
  const oldTiles = makeTiles(), oldReads = observe(oldTiles), oldUploads = [];
  old.gl.texImage2D = (...args) => oldUploads.push(args.at(-1).slice());
  oldGpu.setPalette(palette, 1); oldGpu.setTiles(oldTiles);
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 160 });
  const tiles = makeTiles(), reads = observe(tiles), uploads = [];
  h.gl.texImage2D = (...args) => uploads.push(args.at(-1).slice());
  const timing = gpu.setFrame({ tiles, palette, revision: 1 });
  assert.ok(Object.values(timing).every(value => Number.isFinite(value) && value >= 0));
  assert.deepEqual([...reads.values()], [...oldReads.values()], "validation must not build a second set of gutters");
  assert.deepEqual(uploads, oldUploads, "single preparation preserves all palette and coverage bytes");
  const before = gpu.getStats(), nextPalette = palette.slice(); nextPalette[4] = 42;
  assert.throws(() => gpu.setFrame({ tiles: [tile(0), tile(10), tile(20), tile(30)], palette: nextPalette, revision: 2 }), /budget/);
  assert.deepEqual(gpu.getStats(), before, "a rejected frame must not recolor or delete the visible publication");
  assert.throws(() => gpu.setFrame({ tiles: [{ ...tile(0), codes: new Uint32Array(0) }], palette: nextPalette, revision: 2 }), /Invalid/);
  assert.deepEqual(gpu.getStats(), before);
  reads.clear();
  gpu.setFrame({ tiles, palette, revision: 1 });
  assert.equal(reads.size, 0, "warm complete-frame replay must not materialize CPU coverage");
  assert.deepEqual(gpu.getStats(), before);
  gpu.dispose(); oldGpu.dispose();
});

// Original pixel-first gutter traversal is the byte-for-byte offset oracle.
function gutterOracle(tile, neighbors) {
  const width = tile.width + 2, height = tile.height + 2, codes = new Uint32Array(width * height);
  const ids = [], weights = [], spans = new Map();
  const originX = tile.originX || 0, originY = tile.originY || 0;
  for (let y = 0; y < tile.height; y++) codes.set(tile.codes.subarray(y * tile.width, (y + 1) * tile.width), (y + 1) * width + 1);
  function copy(x, y) {
    const wx = originX + x - 1, wy = originY + y - 1;
    const neighbor = neighbors.find(other => wx >= (other.originX || 0) && wx < (other.originX || 0) + other.width
      && wy >= (other.originY || 0) && wy < (other.originY || 0) + other.height);
    if (!neighbor) return;
    let code = neighbor.codes[(wy - (neighbor.originY || 0)) * neighbor.width + wx - (neighbor.originX || 0)];
    if (code & 0x80000000) {
      const offset = code & 0x7fffffff;
      let mapped = spans.get(neighbor);
      if (!mapped) { mapped = new Map(); spans.set(neighbor, mapped); }
      if (!mapped.has(offset)) {
        const count = neighbor.edgeIds[offset];
        mapped.set(offset, tile.edgeIds.length + ids.length);
        for (let i = 0; i <= count; i++) { ids.push(neighbor.edgeIds[offset + i]); weights.push(neighbor.edgeWeights[offset + i]); }
      }
      code = (0x80000000 | mapped.get(offset)) >>> 0;
    }
    codes[y * width + x] = code;
  }
  for (let x = 0; x < width; x++) { copy(x, 0); copy(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { copy(0, y); copy(width - 1, y); }
  const edgeIds = new Uint32Array(tile.edgeIds.length + ids.length), edgeWeights = new Float32Array(edgeIds.length);
  edgeIds.set(tile.edgeIds); edgeIds.set(ids, tile.edgeIds.length);
  edgeWeights.set(tile.edgeWeights); edgeWeights.set(weights, tile.edgeWeights.length);
  return { width, height, codes, edgeIds, edgeWeights };
}

test("gutter uploads visit compressed neighbors once and preserve the original overlap and edge bytes", () => {
  const make = (originX, originY, width, height, code) => ({ originX, originY, width, height,
    codes: new Uint32Array(width * height).fill(code), edgeIds: Uint32Array.of(2, 1, 2),
    edgeWeights: Float32Array.of(0, 0.25, 0.75) });
  const center = make(0, 0, 32, 32, 1), top = make(-1, -32, 34, 32, 2), bottom = make(-1, 32, 34, 32, 3);
  const overlap = make(-1, -1, 34, 1, 4), left = make(-1, 0, 1, 32, 4), right = make(32, 0, 1, 32, 5);
  center.codes[0] = 0x80000000;
  top.codes[31 * 34] = 0; // Later overlapping geometry must not fill this hole.
  top.codes[31 * 34 + 4] = top.codes[31 * 34 + 5] = 0x80000000;
  bottom.codes[3] = bottom.codes[4] = 0x80000000;
  left.codes[5] = right.codes[9] = 0x80000000;
  const tiles = [center, top, bottom, overlap, left, right];
  const expected = gutterOracle(center, tiles.slice(1));
  const cache = createPoliticalIdRasterCache({ maxBytes: 7000 });
  assert.ok(top.codes.byteLength + bottom.codes.byteLength > cache.maxBytes,
    "the cache cannot retain both large neighbors uncompressed");
  for (const [index, value] of tiles.entries()) {
    assert.equal(cache.set(String(index), value, { originX: value.originX, originY: value.originY,
      width: value.width, height: value.height, density: 1 }), true);
  }
  assert.equal(cache.getStats().evictions, 0, "this exercises real compression, not evicted external tiles");
  const reads = new Map(tiles.map(value => [value, 0]));
  for (const value of tiles) {
    const getter = Object.getOwnPropertyDescriptor(value, "codes").get;
    assert.equal(typeof getter, "function", "the actual cache owns lazy code materialization");
    Object.defineProperty(value, "codes", { configurable: true, get() {
      reads.set(value, reads.get(value) + 1);
      const codes = getter();
      assert.ok(cache.getStats().cpuBytes <= cache.maxBytes);
      return codes;
    } });
  }
  const h = harness(), uploads = [];
  h.gl.texImage2D = (...args) => uploads.push({ width: args[3], height: args[4], data: args.at(-1).slice() });
  const gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  gpu.setTiles(tiles);
  assert.deepEqual(uploads[0].data, expected.codes);
  assert.deepEqual(uploads[1].data.subarray(0, expected.edgeIds.length), expected.edgeIds);
  assert.deepEqual(new Uint8Array(uploads[2].data.buffer, 0, expected.edgeWeights.byteLength),
    new Uint8Array(expected.edgeWeights.buffer));
  assert.equal(uploads[0].data[0], 0, "zero is a first-neighbor claim, not an unoccupied gutter pixel");
  for (const count of reads.values()) assert.ok(count <= tiles.length + 2,
    `codes access must be bounded by validation plus one interior and one per neighboring tile, got ${count}`);
  assert.equal(cache.getStats().evictions, 0);
  gpu.dispose();
});

test("warm overlapping-neighbor reorder matches a fresh first-coverage upload", () => {
  const center = tile(0), first = tile(-1, 2), second = tile(-1, 3);
  const h = harness(), uploads = [];
  h.gl.texImage2D = (...args) => uploads.push(args.at(-1).slice());
  const gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  gpu.setTiles([center, first, second]);
  assert.equal(uploads[0][3], 2, "the first overlapping neighbor owns the left gutter");
  uploads.length = 0;
  const reordered = [center, second, first];
  assert.equal(gpu.canSetFrame({ tiles: reordered, palette }), true);
  gpu.setTiles(reordered);
  assert.equal(gpu.getStats().tileUploads, 4, "reordering neighbors invalidates the affected resident gutter");
  assert.equal(uploads[0][3], 3);
  const freshHarness = harness(), freshUploads = [];
  freshHarness.gl.texImage2D = (...args) => freshUploads.push(args.at(-1).slice());
  const fresh = createPoliticalIdRasterGpu({ gl: freshHarness.gl });
  fresh.setTiles(reordered);
  for (let index = 0; index < 3; index++) assert.deepEqual(uploads[index], freshUploads[index]);
  gpu.dispose(); fresh.dispose();
});

for (const shared of [true, false]) {
  test(`warm GPU replay does not materialize accepted CPU payloads (${shared ? "shared" : "standalone"})`, () => {
    const h = harness(), gpu = createPoliticalIdRasterGpu(shared ? { gl: h.gl } : { canvas: h.canvas });
    const tiles = [tile(0), tile(1)];
    gpu.setPalette(palette, 1); gpu.setTiles(tiles);
    for (const value of tiles) for (const key of ["codes", "edgeIds", "edgeWeights"]) {
      Object.defineProperty(value, key, { configurable: true, get() { throw new Error(`Unexpected warm ${key} read`); } });
    }
    gpu.setPalette(palette, 2);
    assert.equal(gpu.canSetFrame({ tiles, palette }), true);
    gpu.setTiles(tiles);
    assert.equal(gpu.getStats().tileUploads, 2);
    assert.equal(gpu.drawLayer({ width: 20, height: 10 }), true);
    // Layout changes cannot bypass upload validation through token identity.
    tiles[0].width = 2;
    assert.throws(() => gpu.setTiles(tiles), /Unexpected warm codes read/);
    gpu.dispose();
  });

  test(`GPU token residency preserves identity reuse and replacement (${shared ? "shared" : "standalone"})`, () => {
    const h = harness(), gpu = createPoliticalIdRasterGpu(shared ? { gl: h.gl } : { canvas: h.canvas });
    const left = tile(0), right = tile(1), far = tile(100);
    gpu.setPalette(palette, 1); gpu.setTiles([left, right, far]);
    assert.equal(gpu.getStats().tileUploads, 3);
    gpu.setTiles([left, right, far]);
    assert.equal(gpu.getStats().tileUploads, 3);
    gpu.setTiles([left, tile(1), far]);
    assert.equal(gpu.getStats().tileUploads, shared ? 5 : 4, "only replaced tiles and shared-edge neighbors reupload");
    gpu.drawLayer({ width: 20, height: 10 });
    assert.equal(gpu.getStats().residentTiles, 3);
    gpu.setTiles([far]);
    assert.equal(gpu.getStats().residentTiles, 1);
    gpu.dispose(); assert.equal(gpu.getStats().gpuTextureBytes, 0);
  });
}

test("published GPU textures do not retain CPU tile objects or pixel arrays", () => {
  const source = `
    import assert from 'node:assert/strict';
    import { createPoliticalIdRasterGpu } from ${JSON.stringify(new URL("../js/core/renderer/political_id_raster_gpu.js", import.meta.url).href)};
    const harness = ${harness.toString()};
    const makeTile = ${tile.toString()};
    const gpus = [], refs = [];
    for (const shared of [true, false]) {
      const h = harness();
      const gpu = createPoliticalIdRasterGpu(shared ? { gl: h.gl } : { canvas: h.canvas });
      (() => {
        const tiles = [makeTile(0), makeTile(1)];
        for (const tile of tiles) refs.push(new WeakRef(tile), new WeakRef(tile.codes), new WeakRef(tile.edgeIds), new WeakRef(tile.edgeWeights));
        gpu.setFrame({ tiles, palette: Uint8Array.of(0,0,0,0,255,0,0,255), revision: 1 });
        const overviewTiles = [makeTile(0), makeTile(1)];
        for (const tile of overviewTiles) refs.push(new WeakRef(tile), new WeakRef(tile.codes), new WeakRef(tile.edgeIds), new WeakRef(tile.edgeWeights));
        const overview = gpu.createOverview({ tiles: overviewTiles, palette: Uint8Array.of(0,0,0,0,255,0,0,255), revision: 1 });
        assert.ok(overview);
        gpus.push(overview);
      })();
      gpus.push(gpu);
    }
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
    }
    assert.ok(refs.every(ref => ref.deref() === undefined), 'GPU residency must not root CPU tile payloads');
    for (const gpu of gpus) {
      assert.equal(gpu.getStats().residentTiles, 2);
      assert.equal(gpu.drawLayer({ width: 20, height: 10 }), true, 'texture-only residents still draw after CPU collection');
      gpu.dispose();
    }
  `;
  execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", source], { timeout: 10000, stdio: "pipe" });
});


test("a smaller complete frame can grow its palette within the same texture cap", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 100 });
  const firstPalette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255);
  gpu.setFrame({ tiles: [tile(0), tile(1)], palette: firstPalette, revision: 1 });
  assert.equal(gpu.getStats().gpuTextureBytes, 96);
  const largerPalette = Uint8Array.of(0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255);
  // Old tiles + this palette would exceed 100, but the complete new frame is 60.
  gpu.setFrame({ tiles: [tile(100, 2)], palette: largerPalette, revision: 2 });
  assert.equal(gpu.getStats().gpuTextureBytes, 60);
  assert.equal(gpu.getStats().residentTiles, 1);
  assert.equal(gpu.getStats().paletteUploads, 2);
  assert.equal(gpu.drawLayer({ width: 20, height: 10 }), true);
  gpu.dispose();
});

test("primary and overview share one texture cap and failed candidates preserve both", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl, maxTextureBytes: 160 });
  gpu.setPalette(palette, 1); gpu.setTiles([tile(0)]);
  const overview = gpu.createOverview({ tiles: [tile(0)], palette, revision: 1 });
  assert.ok(overview);
  assert.equal(gpu.getStats().gpuTextureBytes, 104);
  assert.equal(overview.getStats().gpuTextureBytes, 52);
  const larger = [tile(0), tile(100), tile(200)];
  assert.equal(gpu.canSetFrame({ tiles: larger, palette }), false);
  assert.throws(() => gpu.setTiles(larger), /budget/);
  assert.equal(gpu.getStats().residentTiles, 1);
  assert.equal(overview.isAvailable(), true);
  assert.equal(overview.drawLayer({ width: 20, height: 10 }), true);
  gpu.setTiles([tile(100)]);
  assert.equal(gpu.getStats().gpuTextureBytes, 104);
  assert.equal(overview.isAvailable(), true, "a new primary does not delete the overview");
  assert.equal(gpu.createOverview({ tiles: larger, palette, revision: 2 }), null);
  assert.equal(overview.isAvailable(), true, "a rejected wider overview preserves the existing snapshot");
  gpu.dispose(); assert.equal(overview.isAvailable(), false);
  assert.equal(gpu.getStats().gpuTextureBytes, 0);
});
