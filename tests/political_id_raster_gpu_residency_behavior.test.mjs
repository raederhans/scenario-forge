import test from "node:test";
import assert from "node:assert/strict";

import { createPoliticalIdRasterGpu } from "../js/core/renderer/political_id_raster_gpu.js";

function harness() {
  let id = 0;
  const canvas = { width: 20, height: 10, addEventListener() {}, removeEventListener() {} };
  const gl = new Proxy({ canvas, getParameter: () => 4096, getProgramParameter: () => true,
    isContextLost: () => false, getExtension: () => null,
    getUniformLocation: (_program, name) => name, getAttribLocation: () => 0,
  }, { get(target, key) {
    if (key in target) return target[key];
    if (key === key.toUpperCase()) return key;
    return () => key.startsWith("create") ? { id: ++id } : undefined;
  } });
  canvas.getContext = () => gl;
  return { gl };
}
const tile = (originX, code = 1) => ({ originX, originY: 0, width: 1, height: 1,
  codes: Uint32Array.of(code), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() });
const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255);

const hostTick = () => new Promise(resolve => setImmediate(resolve));

test("failed single tile upload preserves drawing", async t => {
  const h = harness(), read = recordFrames(h), gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  t.after(() => gpu.dispose());
  gpu.setFrame({ tiles: [tile(0)], palette, revision: 1 });
  const before = read(gpu);
  h.gl.texImage2D = () => { throw new Error("upload failed"); };
  await assert.rejects(gpu.prepareTile({ tile: tile(3), palette, yieldTask: hostTick }), /upload failed/);
  assert.deepEqual(read(gpu), before);
});

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

test("complete frame uploads match separate palette and tile uploads", () => {
  const makeTiles = () => [tile(0), tile(1)];
  const old = harness(), oldGpu = createPoliticalIdRasterGpu({ gl: old.gl });
  const oldTiles = makeTiles(), oldUploads = [];
  old.gl.texImage2D = (...args) => oldUploads.push(args.at(-1).slice());
  oldGpu.setPalette(palette, 1); oldGpu.setTiles(oldTiles);
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  const tiles = makeTiles(), uploads = [];
  h.gl.texImage2D = (...args) => uploads.push(args.at(-1).slice());
  gpu.setFrame({ tiles, palette, revision: 1 });
  assert.deepEqual(uploads, oldUploads, "single preparation preserves all palette and coverage bytes");
  gpu.dispose(); oldGpu.dispose();
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
  assert.equal(uploads[0][3], 3);
  const freshHarness = harness(), freshUploads = [];
  freshHarness.gl.texImage2D = (...args) => freshUploads.push(args.at(-1).slice());
  const fresh = createPoliticalIdRasterGpu({ gl: freshHarness.gl });
  fresh.setTiles(reordered);
  for (let index = 0; index < 3; index++) assert.deepEqual(uploads[index], freshUploads[index]);
  gpu.dispose(); fresh.dispose();
});
