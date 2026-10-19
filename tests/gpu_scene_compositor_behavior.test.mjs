import test from "node:test";
import assert from "node:assert/strict";
import { createGpuSceneCompositor, gpuAffineMatrix } from "../js/core/renderer/gpu_scene_compositor.js";
import { createPoliticalIdRasterGpu } from "../js/core/renderer/political_id_raster_gpu.js";

function harness() {
  const calls = [], events = new Map();
  let id = 0;
  const canvas = { width: 20, height: 10,
    addEventListener: (name, callback) => events.set(name, [...(events.get(name) || []), callback]),
    removeEventListener: (name, callback) => events.set(name, (events.get(name) || []).filter(value => value !== callback)),
  };
  const gl = new Proxy({ canvas,
    getParameter: () => 4096,
    getProgramParameter: () => true,
    isContextLost: () => false,
    getExtension: () => ({ loseContext: () => calls.push(["loseContext"]) }),
    getUniformLocation: (_program, name) => name,
    getAttribLocation: () => 0,
  }, { get(target, key) {
    if (key in target) return target[key];
    if (key === key.toUpperCase()) return key;
    return (...args) => { calls.push([key, ...args]); return key.startsWith("create") ? { id: ++id } : undefined; };
  } });
  canvas.getContext = () => gl;
  return { canvas, gl, calls, events };
}
const tile = (originX, code = 1) => ({ width: 1, height: 1, originX, originY: -2,
  codes: Uint32Array.of(code), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() });
const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 128);

test("private uploads yield before every pass, preserve visible output and adopt only matching textures", async () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas, maxTextureBytes: 2000 });
  const layers = ["ocean", "physicalBase", "political", "borders", "labels"].map(name => name === "political"
    ? { name, draw: () => h.calls.push(["political"]) }
    : { name, canvas: { width: 5, height: 5 }, revision: 1 });
  scene.render({ width: 20, height: 10, layers });
  const retained = layers.map(layer => layer.canvas ? { name: layer.name, retained: true, revision: 1 } : layer);
  for (const layer of layers) if (layer.canvas) layer.revision = 2;
  const tasks = [];
  h.calls.length = 0;
  const pending = scene.prepareLayers({ layers, yieldControl: () => new Promise(resolve => tasks.push(resolve)) });
  assert.equal(h.calls.length, 0, "first upload must wait for a host-task yield");
  for (let i = 0; i < 3; i++) {
    assert.equal(tasks.length, 1);
    tasks.shift()(); await Promise.resolve();
    assert.equal(h.calls.filter(call => call[0] === "texImage2D").length, i + 1);
    assert.equal(scene.getStats().gpuTextureBytes, 400 + 100 * (i + 1));
  }
  assert.equal(await pending, true);
  assert.deepEqual(h.calls.filter(call => call[0] === "texImage2D").map(call => call.at(-1)),
    [layers[4].canvas, layers[3].canvas, layers[1].canvas]);
  assert.equal(h.calls.some(call => ["clear", "drawArrays", "viewport"].includes(call[0])), false);
  assert.deepEqual([h.canvas.width, h.canvas.height], [20, 10]);
  scene.render({ width: 20, height: 10, layers: retained });
  assert.equal(scene.getStats().privateTextureBytes, 300, "old navigation preserves ready candidate textures");
  h.calls.length = 0;
  scene.render({ width: 20, height: 10, layers });
  assert.equal(h.calls.filter(call => call[0] === "texImage2D").length, 1, "only unprepared ocean uploads synchronously");
  assert.deepEqual(h.calls.filter(call => ["drawArrays", "political"].includes(call[0])).map(call => call[0]),
    ["drawArrays", "drawArrays", "political", "drawArrays", "drawArrays"]);
  assert.equal(scene.getStats().privateTextureBytes, 0);
  assert.equal(scene.getStats().preparedPassCount, 3);
  assert.equal(scene.getStats().preparedBytes, 300);
});

test("live reservations admit partial preparation and stale jobs release all private bytes", async () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas, maxTextureBytes: 300 });
  const layers = ["labels", "borders"].map(name => ({ name, canvas: { width: 5, height: 5 }, revision: 1 }));
  scene.render({ width: 20, height: 10, layers });
  for (const layer of layers) layer.revision++;
  let reserved = 0, yields = 0;
  assert.equal(await scene.prepareLayers({ layers, getReservedTextureBytes: () => reserved,
    yieldControl: async () => { if (++yields === 2) reserved = 100; } }), true);
  assert.equal(scene.getStats().preparedPassCount, 1);
  assert.equal(scene.getStats().gpuTextureBytes, 300);
  reserved = 0;
  const uploads = scene.getStats().textureUploads;
  scene.render({ width: 20, height: 10, layers, reservedTextureBytes: reserved });
  assert.equal(scene.getStats().textureUploads, uploads + 1);
  let current = true; yields = 0;
  for (const layer of layers) layer.revision++;
  assert.equal(await scene.prepareLayers({ layers, isCurrent: () => current,
    yieldControl: async () => { if (++yields === 2) current = false; } }), false);
  assert.equal(scene.getStats().privateTextureBytes, 0);
  assert.equal(scene.getStats().gpuTextureBytes, 200);
  let release;
  const canceled = scene.prepareLayers({ layers, yieldControl: () => new Promise(resolve => { release = resolve; }) });
  scene.cancelPreparedLayers(); release();
  assert.equal(await canceled, false);
  assert.equal(scene.getStats().privateTextureBytes, 0);
});

test("private upload failures propagate and dispose/context loss cancel yielded work", async () => {
  for (const action of ["dispose", "loss", "failure"]) {
    const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas });
    const layers = [{ name: "labels", canvas: { width: 5, height: 5 }, revision: 1 }];
    let release;
    const job = scene.prepareLayers({ layers, yieldControl: () => new Promise(resolve => { release = resolve; }) });
    if (action === "dispose") scene.dispose();
    else if (action === "loss") h.events.get("webglcontextlost")[0]({ preventDefault() {} });
    else h.gl.texImage2D = () => { throw new Error("original upload failure"); };
    release();
    if (action === "failure") await assert.rejects(job, /original upload failure/);
    else assert.equal(await job, false);
    assert.equal(scene.getStats().privateTextureBytes, 0);
  }
});

test("preparation keeps a hard three-pass cap, rejects duplicates and accounts every private allocation/release", async () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas });
  const layers = ["a", "b", "c", "d"].map(name => ({ name, canvas: { width: 5, height: 5 }, revision: 1 }));
  const bytes = [];
  assert.equal(await scene.prepareLayers({ layers, maxPasses: NaN, yieldControl: async () => {},
    onProgress: () => bytes.push(scene.getStats().privateTextureBytes) }), true);
  assert.equal(scene.getStats().preparedPassCount, 3);
  const maxTask = scene.getStats().maxUploadTaskMs;
  scene.cancelPreparedLayers();
  assert.deepEqual(bytes, [100, 200, 300, 0]);
  await scene.prepareLayers({ layers: [], yieldControl: async () => {} });
  assert.equal(scene.getStats().maxUploadTaskMs, maxTask, "empty tail work cannot hide the largest lifetime upload task");
  const before = scene.getStats().textureUploads;
  await assert.rejects(scene.prepareLayers({ layers: [layers[0], layers[0]] }), /unique names/);
  assert.equal(scene.getStats().textureUploads, before);
  assert.equal(scene.getStats().privateTextureBytes, 0);
});

test("compositor preserves exact layer order, rebinds source-over, and uploads only changed sources", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas });
  const base = { width: 20, height: 10 }, top = { width: 10, height: 5 };
  const frame = { width: 20, height: 10, layers: [
    { name: "base", canvas: base, revision: 1 },
    { name: "political", draw: () => { h.calls.push(["political"]); h.gl.disable(h.gl.BLEND); } },
    { name: "top", canvas: top, revision: "a", transform: { a: 2, d: 2, e: -2, f: 3 }, clip: { x: 1, y: 2, width: 4, height: 5 } },
  ] };
  scene.render(frame);
  assert.deepEqual(h.calls.filter(call => ["drawArrays", "political"].includes(call[0])).map(call => call[0]), ["drawArrays", "political", "drawArrays"]);
  assert.equal(scene.getStats().textureUploads, 2);
  assert.deepEqual(h.calls.find(call => call[0] === "scissor"), ["scissor", 1, 3, 4, 5]);
  assert.deepEqual([...h.calls.filter(call => call[0] === "uniformMatrix3fv").at(-1)[3]], [2, 0, 0, 0, 2, 0, -2, 3, 1]);
  scene.render(frame);
  assert.equal(scene.getStats().textureUploads, 2, "camera redraw retains textures");
  frame.layers[2].revision = "b";
  scene.render(frame);
  assert.equal(scene.getStats().textureUploads, 3);
  top.width = 12;
  scene.render(frame);
  assert.equal(scene.getStats().textureUploads, 4);
  frame.layers[2].canvas = { width: 12, height: 5 };
  scene.render(frame);
  assert.equal(scene.getStats().textureUploads, 5);
  assert.equal(scene.getStats().frames, 5);
  assert.equal(scene.getStats().gpuTextureBytes, 1040);
  assert.ok(h.calls.some(call => call[0] === "pixelStorei" && call[1] === "UNPACK_PREMULTIPLY_ALPHA_WEBGL" && call[2] === true));
  assert.equal(h.calls.some(call => ["getError", "readPixels"].includes(call[0])), false);
});

test("frame budget includes political reservation and rejects before clearing; retired layers release textures", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas, maxTextureBytes: 100 });
  const layer = { name: "a", canvas: { width: 4, height: 4 }, revision: 0 };
  scene.render({ width: 10, height: 10, layers: [layer], reservedTextureBytes: 36 });
  const count = h.calls.length;
  assert.throws(() => scene.render({ width: 10, height: 10, layers: [layer], reservedTextureBytes: 37 }), /budget/);
  assert.equal(h.calls.length, count);
  assert.throws(() => scene.render({ width: 10, height: 10, layers: [layer, layer] }), /unique/);
  scene.render({ width: 10, height: 10, layers: [] });
  assert.equal(scene.getStats().gpuTextureBytes, 0);
  assert.equal(h.calls.filter(call => call[0] === "deleteTexture").length, 1);
  assert.throws(() => gpuAffineMatrix({ a: NaN }), /transform/);
});

test("published textures survive candidate canvas mutation and retain their original dimensions", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas, maxTextureBytes: 800 });
  const source = { width: 20, height: 10 };
  scene.render({ width: 20, height: 10, layers: [{ name: "labels", canvas: source, revision: 1 }] });
  source.width = 4000;
  h.calls.length = 0;
  scene.render({ width: 20, height: 10, layers: [{ name: "labels", retained: true, revision: 1 }] });
  assert.equal(scene.getStats().textureUploads, 1);
  assert.deepEqual(h.calls.find(call => call[0] === "uniform2f" && call[1] === "sourceSize"), ["uniform2f", "sourceSize", 20, 10]);
  assert.equal(scene.getStats().gpuTextureBytes, 800);
  const count = h.calls.length;
  assert.throws(() => scene.render({ width: 20, height: 10, layers: [{ name: "labels", retained: true, revision: 2 }] }), /retained layer/);
  assert.equal(h.calls.length, count, "invalid publication is rejected before touching the visible framebuffer");
});

test("bounded overview textures stay resident across primary frames and count toward the shared budget", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas, maxTextureBytes: 1200 });
  h.canvas.ownerDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) };
  const source = { width: 20, height: 10 }, layers = [{ name: "labels", canvas: source, revision: 1 }];
  scene.render({ width: 20, height: 10, layers });
  const retained = scene.captureRetainedLayers(layers, { maxBytes: 200, maxEdge: 10 });
  assert.deepEqual(retained, [{ name: "overview:labels", sourceName: "labels", revision: 1, scaleX: 2, scaleY: 2 }]);
  assert.equal(scene.getStats().gpuTextureBytes, 1000);
  scene.render({ width: 20, height: 10, layers });
  assert.equal(scene.getStats().gpuTextureBytes, 1000, "ordinary publication does not retire overview");
  scene.render({ width: 20, height: 10, layers: [{ name: "overview:labels", revision: 1, retained: true }], preserveLayers: true });
  assert.equal(scene.getStats().gpuTextureBytes, 1000, "overview presentation does not evict the current primary textures");
  assert.throws(() => scene.render({ width: 20, height: 10, layers, reservedTextureBytes: 201 }), /budget/);
  scene.releaseRetainedLayers(["overview:labels"]);
  assert.equal(scene.getStats().gpuTextureBytes, 800);
});

test("shared political draws do not clear, resize, copy, or dispose the shared context", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  gpu.setPalette(palette, 1);
  gpu.setTiles([tile(-1)]);
  h.calls.length = 0;
  assert.equal(gpu.drawLayer({ width: 200, height: 100, transform: { a: 1.5, d: 1.5, e: 7, f: 9 } }), true);
  assert.deepEqual([h.canvas.width, h.canvas.height], [20, 10]);
  assert.equal(h.calls.some(call => ["clear", "drawImage", "readPixels", "getError"].includes(call[0])), false);
  assert.deepEqual([...h.calls.find(call => call[0] === "uniformMatrix3fv")[3]], [1.5, 0, 0, 0, 1.5, 0, 7, 9, 1]);
  assert.ok(h.calls.some(call => call[0] === "uniform1i" && call[1] === "smoothColors" && call[2] === 1));
  gpu.dispose();
  assert.equal(h.calls.some(call => call[0] === "loseContext"), false);
  assert.deepEqual([h.canvas.width, h.canvas.height], [20, 10]);
});

test("shared upload gutters remap neighbor coverage and only invalidate affected neighbors", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ gl: h.gl });
  const left = tile(-1), right = { ...tile(0, 0x80000000), edgeIds: Uint32Array.of(1, 2), edgeWeights: Float32Array.of(0, 0.25) };
  const far = tile(100, 2);
  gpu.setPalette(palette, 1);
  h.calls.length = 0;
  gpu.setTiles([left, right, far]);
  const uploads = h.calls.filter(call => call[0] === "texImage2D");
  const leftCodes = uploads[0].at(-1), leftEdges = uploads[1].at(-1), leftWeights = uploads[2].at(-1);
  assert.deepEqual([...leftCodes], [0, 0, 0, 0, 1, 0x80000000, 0, 0, 0]);
  assert.deepEqual([...leftEdges], [1, 2]);
  assert.deepEqual([...leftWeights], [0, 0.25]);
  assert.deepEqual([...uploads[3].at(-1)], [0, 0, 0, 1, 0x80000000, 0, 0, 0, 0]);
  gpu.setTiles([left, right, far]);
  assert.equal(gpu.getStats().tileUploads, 3);
  gpu.setTiles([left, far]);
  assert.equal(gpu.getStats().tileUploads, 4, "far tile is unchanged while left loses its neighbor");
  const finalCodes = h.calls.filter(call => call[0] === "texImage2D").at(-3).at(-1);
  assert.deepEqual([...finalCodes], [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(gpu.getStats().gpuTextureBytes, 12 + 2 * (36 + 8));
});

test("political budget fails before upload and standalone draw remains compatible", () => {
  const h = harness(), gpu = createPoliticalIdRasterGpu({ canvas: h.canvas, maxTextureBytes: 32 });
  gpu.setPalette(palette, 1);
  gpu.setTiles([tile(0)]);
  const count = h.calls.length;
  assert.throws(() => gpu.setTiles([tile(0), tile(2)]), /budget/);
  assert.equal(h.calls.length, count);
  let copied = 0;
  gpu.draw({ width: 4, height: 3, originX: 5, originY: 6, context: { drawImage: () => copied++ } });
  assert.equal(copied, 1);
  assert.deepEqual([h.canvas.width, h.canvas.height], [4, 3]);
  assert.ok(h.calls.some(call => call[0] === "uniform1i" && call[1] === "smoothColors" && call[2] === 0));
  gpu.dispose();
  assert.equal(h.calls.filter(call => call[0] === "loseContext").length, 1);
});

test("gutter corners carry diagonal pixels and mixed Canvas/political layers keep independent uploads", () => {
  const h = harness(), scene = createGpuSceneCompositor({ canvas: h.canvas });
  const gpu = createPoliticalIdRasterGpu({ gl: scene.gl });
  const tiles = [tile(0, 1), tile(1, 2), { ...tile(0, 3), originY: -1 }, { ...tile(1, 4), originY: -1 }];
  gpu.setPalette(new Uint8Array(20).fill(255), 1);
  h.calls.length = 0;
  gpu.setTiles(tiles);
  const uploads = h.calls.filter(call => call[0] === "texImage2D");
  assert.deepEqual([...uploads[0].at(-1)], [0, 0, 0, 0, 1, 2, 0, 3, 4]);
  assert.deepEqual([...uploads[9].at(-1)], [1, 2, 0, 3, 4, 0, 0, 0, 0]);
  const layers = [
    { name: "ocean", canvas: { width: 20, height: 10 }, revision: 1 },
    { name: "political", draw: frame => gpu.drawLayer({ ...frame, transform: { e: 1, f: 3 } }) },
    { name: "labels", canvas: { width: 20, height: 10 }, revision: 1 },
  ];
  scene.render({ width: 20, height: 10, layers, reservedTextureBytes: gpu.getStats().gpuTextureBytes });
  gpu.setPalette(new Uint8Array(20).fill(128), 2);
  scene.render({ width: 20, height: 10, layers, reservedTextureBytes: gpu.getStats().gpuTextureBytes });
  assert.equal(scene.getStats().textureUploads, 2);
  assert.equal(gpu.getStats().tileUploads, 4);
  assert.equal(gpu.getStats().paletteUploads, 2);
  assert.equal(h.calls.filter(call => call[0] === "clear").length, 2, "only the scene clears each frame");
  const update = h.calls.findIndex(call => call[0] === "texSubImage2D");
  assert.deepEqual(h.calls.slice(update - 2, update), [
    ["pixelStorei", "UNPACK_PREMULTIPLY_ALPHA_WEBGL", false],
    ["pixelStorei", "UNPACK_FLIP_Y_WEBGL", false],
  ]);
});

test("context loss prevents drawing and cleanup is idempotent", () => {
  const h = harness();
  let notified = 0;
  const scene = createGpuSceneCompositor({ canvas: h.canvas, onContextLost: () => notified++ });
  const gpu = createPoliticalIdRasterGpu({ gl: scene.gl, onContextLost: () => notified++ });
  for (const callback of h.events.get("webglcontextlost")) callback({ preventDefault() {} });
  assert.equal(notified, 2);
  assert.equal(scene.isAvailable(), false);
  assert.equal(gpu.isAvailable(), false);
  assert.throws(() => scene.render({ width: 10, height: 10 }), /unavailable/);
  assert.throws(() => gpu.drawLayer({ width: 10, height: 10 }), /unavailable/);
  scene.dispose(); scene.dispose(); gpu.dispose(); gpu.dispose();
  assert.equal(h.calls.some(call => call[0] === "loseContext"), false);
});
