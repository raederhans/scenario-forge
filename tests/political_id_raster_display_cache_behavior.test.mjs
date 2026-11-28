import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterDisplayCache } from "../js/core/renderer/political_id_raster_display_cache.js";

function fixture() {
  const clears = [], draws = [];
  const context = { save() {}, restore() {}, setTransform() {},
    clearRect: (...args) => clears.push(args), drawImage() {} };
  const cache = createPoliticalIdRasterDisplayCache({ createCanvas: (width, height) => ({ width, height, getContext: () => context }) });
  const tiles = Array.from({ length: 4 }, (_, i) => ({ originX: i * 10, originY: 0, width: 10, height: 10 }));
  const dependencies = new Map(tiles.map((tile, i) => [tile, Uint32Array.of(i + 1)]));
  const input = { gpu: { canvas: {}, draw: plan => draws.push(plan) },
    plan: { width: 40, height: 10, originX: 0, originY: 0, density: 1 }, tiles,
    palette: new Uint8Array(24).fill(255), revision: 1, dependencies: tile => dependencies.get(tile) };
  function change(code, value = 99) { input.palette[code * 4] = value; input.revision++; }
  return { cache, input, clears, draws, change, context };
}

test("a palette edit shades and clears only its contributor region", () => {
  const f = fixture(); f.cache.draw(f.input); f.change(2); f.cache.draw(f.input);
  assert.deepEqual(f.draws.at(-1), { width: 10, height: 10, originX: 10, originY: 0 });
  assert.deepEqual(f.clears.at(-1), [10, 0, 10, 10]);
});

test("transparent recolor clears old pixels and snapshots in-place palette changes", () => {
  const f = fixture(); f.cache.draw(f.input); f.input.palette[7] = 0; f.input.revision++;
  f.cache.draw(f.input); assert.deepEqual(f.clears.at(-1), [0, 0, 10, 10]);
  assert.equal(f.context.globalAlpha, 1); assert.equal(f.context.globalCompositeOperation, "source-over");
});
