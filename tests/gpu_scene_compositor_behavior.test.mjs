import test from "node:test";
import assert from "node:assert/strict";
import { createGpuSceneCompositor } from "../js/core/renderer/gpu_scene_compositor.js";
import { createPoliticalIdRasterGpu } from "../js/core/renderer/political_id_raster_gpu.js";

function harness() {
  const uploads = [];
  const canvas = { width: 20, height: 10, addEventListener() {}, removeEventListener() {} };
  const gl = new Proxy({ canvas,
    texImage2D: (...args) => uploads.push(args.at(-1)),
    getParameter: () => 4096,
    getProgramParameter: () => true,
    isContextLost: () => false,
    getUniformLocation: (_program, name) => name,
    getAttribLocation: () => 0,
  }, { get(target, key) {
    if (key in target) return target[key];
    if (key === key.toUpperCase()) return key;
    return () => key.startsWith("create") ? {} : undefined;
  } });
  canvas.getContext = () => gl;
  return { canvas, gl, uploads };
}
const tile = (originX, code = 1) => ({ width: 1, height: 1, originX, originY: -2,
  codes: Uint32Array.of(code), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() });
const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 128);

test("upload gutters encode adjacent tile pixels and weights", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  const left = tile(-1), right = { ...tile(0, 0x80000000), edgeIds: Uint32Array.of(1, 2), edgeWeights: Float32Array.of(0, 0.25) };
  gpu.setPalette(palette, 1);
  h.uploads.length = 0;
  gpu.setTiles([left, right]);
  const uploads = h.uploads;
  const leftCodes = uploads[0], leftEdges = uploads[1], leftWeights = uploads[2];
  assert.deepEqual([...leftCodes], [0, 0, 0, 0, 1, 0x80000000, 0, 0, 0]);
  assert.deepEqual([...leftEdges], [1, 2]);
  assert.deepEqual([...leftWeights], [0, 0.25]);
  assert.deepEqual([...uploads[3]], [0, 0, 0, 1, 0x80000000, 0, 0, 0, 0]);
});

test("gutter corners carry diagonal pixels", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas });
  const gpu = createPoliticalIdRasterGpu({ gl: scene.gl });
  const tiles = [tile(0, 1), tile(1, 2), { ...tile(0, 3), originY: -1 }, { ...tile(1, 4), originY: -1 }];
  gpu.setPalette(new Uint8Array(20).fill(255), 1);
  h.uploads.length = 0;
  gpu.setTiles(tiles);
  const uploads = h.uploads;
  assert.deepEqual([...uploads[0]], [0, 0, 0, 0, 1, 2, 0, 3, 4]);
  assert.deepEqual([...uploads[9]], [1, 2, 0, 3, 4, 0, 0, 0, 0]);
});
