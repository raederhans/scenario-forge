import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterOverview } from "../js/core/renderer/political_id_raster_overview.js";

test("overview center samples IDs and remaps sparse spans without changing world or output coverage", () => {
  const codes = new Uint32Array(16);
  codes[5] = 7; codes[7] = 0x80000003; codes[13] = 0x80000003; codes[15] = 9;
  const tile = { originX: -4, originY: 8, width: 4, height: 4, codes,
    edgeIds: Uint32Array.of(2, 1, 2, 2, 3, 4), edgeWeights: Float32Array.of(0, .1, .9, 0, .25, .75) };
  const plan = { originX: -4, originY: 8, width: 4, height: 4, density: 2, scale: .75, level: 4,
    outputX: 1, outputY: 2, outputWidth: 3, outputHeight: 3, tiles: [{ ...tile, key: "t", density: 2 }] };
  const result = createPoliticalIdRasterOverview({ tiles: [tile], plan });
  assert.deepEqual([...result.tiles[0].codes], [7, 0x80000000, 0x80000000, 9]);
  assert.deepEqual([...result.tiles[0].edgeIds], [2, 3, 4]);
  assert.deepEqual([...result.tiles[0].edgeWeights], [0, .25, .75]);
  assert.equal(result.plan.originX / result.plan.density, plan.originX / plan.density);
  assert.equal(result.plan.width / result.plan.density, plan.width / plan.density);
  assert.equal(result.plan.scale * result.plan.width, plan.scale * plan.width);
  for (const key of ["outputX", "outputY", "outputWidth", "outputHeight"]) assert.equal(result.plan[key], plan[key]);
  assert.equal(result.factor, 2);
  assert.equal(createPoliticalIdRasterOverview({ tiles: [tile], plan, maxBytes: 1 }), null);
  assert.equal(createPoliticalIdRasterOverview({ tiles: [tile], plan, dpr: 2 }).factor, 4);
});
