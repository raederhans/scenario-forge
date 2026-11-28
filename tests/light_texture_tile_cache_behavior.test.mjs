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
function fixture() {
  const draws = [];
  const cache = createLightTextureTileCache({ createCanvas: (width, height) => {
    const ctx = context(width, height);
    ctx.canvas.getContext = () => ctx;
    return ctx.canvas;
  } });
  const target = context(512, 256);
  const entries = [0, 255, 350].map((x) => ({ x, y: 100, rx: 4, ry: 3 }));
  const render = (key = 'source', variant = '') => cache.render({
    context: target, entries, key, variant,
    drawEntries: (_ctx, candidates) => draws.push({ candidates }),
  });
  return { draws, entries, render };
}

test('overlapping light kernels cross tile edges', () => {
  const f = fixture();
  f.render();
  assert.ok(f.draws.every(({ candidates }) => candidates.includes(f.entries[1])));
  assert.deepEqual(f.draws[1].candidates, [f.entries[1], f.entries[2]]);
});
