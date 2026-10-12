import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterDisplayCache } from "../js/core/renderer/political_id_raster_display_cache.js";

function fixture() {
  const copies = [], clears = [], draws = [];
  const context = { save() {}, restore() {}, setTransform() {},
    clearRect: (...args) => clears.push(args), drawImage: (...args) => copies.push(args) };
  const cache = createPoliticalIdRasterDisplayCache({ createCanvas: (width, height) => ({ width, height, getContext: () => context }) });
  const tiles = Array.from({ length: 4 }, (_, i) => ({ originX: i * 10, originY: 0, width: 10, height: 10 }));
  const dependencies = new Map(tiles.map((tile, i) => [tile, Uint32Array.of(i + 1)]));
  const input = { gpu: { canvas: {}, draw: plan => draws.push(plan) },
    plan: { width: 40, height: 10, originX: 0, originY: 0, density: 1 }, tiles,
    palette: new Uint8Array(24).fill(255), revision: 1, dependencies: tile => dependencies.get(tile) };
  function change(code, value = 99) { input.palette[code * 4] = value; input.revision++; }
  return { cache, input, copies, clears, draws, change, dependencies, context };
}

test("cold display shades once; unchanged palette and grid reuse RGBA without GPU readback", () => {
  const f = fixture(); const first = f.cache.draw(f.input);
  assert.equal(f.cache.draw(f.input), first);
  assert.equal(f.draws.length, 1); assert.equal(f.copies.length, 1);
  assert.equal(f.cache.getStats().reusedFrames, 1);
  assert.equal(f.cache.getStats().retainedSurfaceBytes, 1600);
});

test("a palette edit shades and clears only its contributor region", () => {
  const f = fixture(); f.cache.draw(f.input); f.change(2); f.cache.draw(f.input);
  assert.deepEqual(f.draws.at(-1), { width: 10, height: 10, originX: 10, originY: 0 });
  assert.deepEqual(f.clears.at(-1), [10, 0, 10, 10]);
  assert.equal(f.cache.getStats().partialUpdates, 1);
  assert.equal(f.cache.getStats().lastUpdatedPixels, 100);
  assert.equal(f.cache.getStats().shadedPixels, 500);
});

test("transparent recolor clears old pixels and snapshots in-place palette changes", () => {
  const f = fixture(); f.cache.draw(f.input); f.input.palette[7] = 0; f.input.revision++;
  f.cache.draw(f.input); assert.deepEqual(f.clears.at(-1), [0, 0, 10, 10]);
  assert.equal(f.context.globalAlpha, 1); assert.equal(f.context.globalCompositeOperation, "source-over");
});

test("palette change outside this view does not redraw; later coverage change does", () => {
  const f = fixture(); f.cache.draw(f.input); f.change(5); f.cache.draw(f.input);
  assert.equal(f.draws.length, 1);
  f.input.tiles = [...f.input.tiles]; f.input.tiles[0] = { ...f.input.tiles[0] };
  f.cache.draw(f.input); assert.equal(f.cache.getStats().fullUpdates, 2);
});

test("unknown dependencies conservatively repaint, while sparse changes stay bounded", () => {
  const f = fixture(); f.cache.draw(f.input); f.dependencies.delete(f.input.tiles[2]);
  f.change(2); f.cache.draw(f.input);
  assert.deepEqual(f.draws.at(-1), { width: 20, height: 10, originX: 10, originY: 0 });
});

test("distant contributors and code zero fall back to one full bounded region", () => {
  const f = fixture(); f.cache.draw(f.input); f.change(1); f.change(4); f.cache.draw(f.input);
  assert.equal(f.draws.at(-1).width, 40);
  f.change(0); f.cache.draw(f.input); assert.equal(f.cache.getStats().fullUpdates, 3);
});

test("same grid pan reuses image; changed origin, density and size invalidate it", () => {
  const f = fixture(); f.cache.draw(f.input);
  f.input.plan.outputX = 4; f.input.plan.scale = 0.9; f.cache.draw(f.input);
  assert.equal(f.draws.length, 1);
  f.input.plan.originX = 1; f.cache.draw(f.input);
  f.input.plan.density = 2; f.cache.draw(f.input);
  f.input.plan.width = 41; const canvas = f.cache.draw(f.input);
  assert.equal(f.draws.length, 4); assert.equal(canvas.width, 41);
});

test("palette namespace size change, reset, and disposal cannot reuse stale frames", () => {
  const f = fixture(); f.cache.draw(f.input);
  f.input.palette = new Uint8Array(28); f.input.revision++; f.cache.draw(f.input);
  assert.equal(f.cache.getStats().fullUpdates, 2);
  f.cache.reset(); assert.equal(f.cache.getStats().retainedSurfaceBytes, 0);
  f.cache.draw(f.input); assert.equal(f.cache.getStats().fullUpdates, 3);
  f.cache.dispose(); f.cache.dispose(); assert.equal(f.cache.getStats().paletteSnapshotBytes, 0);
  assert.throws(() => f.cache.draw(f.input), /disposed/);
});

test("copy failures are not committed as reusable output", () => {
  const f = fixture(); f.cache.draw(f.input); f.change(2);
  f.context.drawImage = () => { throw new Error("copy failed"); };
  assert.throws(() => f.cache.draw(f.input), /copy failed/);
  f.context.drawImage = () => {};
  f.cache.draw(f.input); assert.equal(f.cache.getStats().fullUpdates, 2);
});

test("invalid frames and unavailable 2D surfaces fail closed", () => {
  const f = fixture(); assert.throws(() => f.cache.draw({ ...f.input, palette: new Uint8Array(3) }), /Invalid/);
  const cache = createPoliticalIdRasterDisplayCache({ createCanvas: (width,height) => ({ width,height,getContext: () => null }) });
  assert.throws(() => cache.draw(f.input), /2D surface/);
  assert.equal(cache.getStats().retainedSurfaceBytes, 0);
});


test("profiling preserves the readiness function default state argument", async () => {
  const { settle, summarize } = await import("../tools/profile_political_raster.mjs");
  let disposed = false;
  await settle({ waitForFunction: async (predicate, argument) => {
    assert.equal(typeof predicate, "function");
    assert.equal(argument, undefined, "null overrides the readiness predicate default state");
    return { dispose() { disposed = true; } };
  } });
  assert.equal(disposed, true);
  assert.deepEqual(summarize([4,1,3,2]), {count:4,median:2.5,p95:4,max:4});
  assert.throws(() => summarize([]), /samples/);
});


test("presentation tokens do not retain a tile after the authoritative cache releases it", {skip:typeof globalThis.gc!=="function"}, async () => {
  const context = {save(){},restore(){},setTransform(){},clearRect(){},drawImage(){}};
  const cache = createPoliticalIdRasterDisplayCache({createCanvas:(width,height)=>({width,height,getContext:()=>context})});
  let tile = {originX:0,originY:0,width:10,height:10,codes:new Uint32Array(1024)};
  const reference = new WeakRef(tile);
  cache.draw({gpu:{canvas:{},draw(){}},plan:{width:10,height:10,originX:0,originY:0,density:1},
    tiles:[tile],palette:new Uint8Array(8),revision:1,dependencies:()=>Uint32Array.of(1)});
  tile=null;
  for(let attempt=0;attempt<20;attempt++) {
    await new Promise(resolve=>setImmediate(resolve));
    globalThis.gc();
    if(reference.deref()===undefined)break;
  }
  assert.equal(reference.deref(),undefined,"cached presentation must not own old CPU tile payloads");
  assert.ok(cache.getStats().retainedSurfaceBytes>0,"the RGBA frame remains independently reusable");
  cache.dispose();
});
