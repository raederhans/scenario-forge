import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightTextureTileCache } from '../js/core/renderer/light_texture_tile_cache.js';

function context(width, height) {
  const saved = [];
  return {
    canvas: { width, height }, matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    getTransform() { return { ...this.matrix }; },
    setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; },
    save() { saved.push({ ...this.matrix }); },
    restore() { this.matrix = saved.pop(); },
    drawImage() {},
  };
}
function fixture(maxBytes) {
  const created = [];
  const draws = [];
  const cache = createLightTextureTileCache({ maxBytes, createCanvas: (width, height) => {
    const ctx = context(width, height);
    ctx.canvas.getContext = () => ctx;
    created.push(ctx.canvas);
    return ctx.canvas;
  } });
  const target = context(512, 256);
  const entries = [0, 255, 350].map((x) => ({ x, y: 100, rx: 4, ry: 3 }));
  const render = (key = 'source', variant = '') => cache.render({
    context: target, entries, key, variant,
    drawEntries: (ctx, candidates) => draws.push({ matrix: ctx.getTransform(), candidates }),
  });
  return { cache, created, draws, target, entries, render };
}

test('pan reuses world tiles and only paints the exposed strip; overlapping kernels cross tile edges', () => {
  const f = fixture();
  assert.deepEqual([f.render().hits, f.draws.length], [0, 2]);
  assert.ok(f.draws.every(({ candidates }) => candidates.includes(f.entries[1])));
  assert.deepEqual(f.draws[1].candidates, [f.entries[1], f.entries[2]]);
  f.target.matrix.e = -256;
  const shifted = f.render();
  assert.equal(shifted.hits, 1);
  assert.equal(shifted.misses, 1);
  f.target.matrix.e = 0;
  assert.equal(f.render().hits, 2);
});

test('exact zoom, fractional phase and exposure variant coexist without rescaling cached images', () => {
  const f = fixture();
  f.render();
  f.target.matrix.a = f.target.matrix.d = 2;
  assert.equal(f.render('source', 'zoom-exposure').misses, 2);
  f.target.matrix.a = f.target.matrix.d = 1;
  assert.equal(f.render().hits, 2);
  f.target.matrix.e = 0.5;
  assert.equal(f.render().misses, 2);
  f.target.matrix.e = 0;
  assert.equal(f.render().hits, 2);
});

test('bounded LRU recycles canvases and invalidates style/source changes', () => {
  const bytes = 258 * 258 * 4;
  const f = fixture(bytes * 2);
  f.render();
  f.target.matrix.e = -256;
  assert.equal(f.render().bytes, bytes * 2);
  assert.equal(f.created.length, 2);
  f.target.matrix.e = -512;
  assert.equal(f.render().bytes, bytes * 2);
  assert.equal(f.created.length, 2);
  const old = [...f.created];
  assert.equal(f.render('new-intensity').misses, 2);
  assert.ok(old.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test('geometry replacement invalidates indexed candidates and tiles; unsupported affine transforms fall back', () => {
  const f = fixture();
  f.render();
  let candidates;
  const replacement = [{ x: 20, y: 20, rx: 2, ry: 2 }];
  const stats = f.cache.render({ context: f.target, entries: replacement, key: 'source', drawEntries: (_, value) => { candidates = value; } });
  assert.equal(stats.misses, 2);
  assert.ok(!candidates.includes(f.entries[1]));
  f.target.matrix.c = 0.1;
  assert.equal(f.render(), null);
});

test('cold views draw once and copy interior tiles, while an empty exposed strip never triggers a bulk repaint', () => {
  const f = fixture();
  f.entries.forEach((entry) => { entry.y = 400; });
  f.target.canvas.width = 1536;
  f.target.canvas.height = 768;
  let bulk = 0;
  const render = () => f.cache.render({ context: f.target, entries: f.entries, key: 'source',
    drawEntries: (_, candidates) => f.draws.push(candidates),
    drawViewport: () => { bulk++; },
  });
  assert.equal(render().bulk, true);
  assert.equal(bulk, 1);
  f.target.matrix.e = -20;
  const pan = render();
  assert.ok(pan.hits > 0);
  assert.ok(pan.misses > 0);
  assert.equal(bulk, 1);
});
