import test from "node:test";
import assert from "node:assert/strict";
import { queryPoliticalIdRasterCandidates } from "../js/core/renderer/political_id_raster_pick.js";

function makeTile({
  width = 7,
  height = 7,
  originX = -3,
  originY = -3,
  code = 4,
} = {}) {
  return {
    width,
    height,
    originX,
    originY,
    codes: new Uint32Array(width * height).fill(code),
    edgeIds: new Uint32Array(),
    edgeWeights: new Float32Array(),
  };
}

function query(tile, options = {}) {
  const density = options.density ?? 1;
  return queryPoliticalIdRasterCandidates({
    tiles: [{ tile, descriptor: {
      originX: tile.originX,
      originY: tile.originY,
      width: tile.width,
      height: tile.height,
      density,
    } }],
    point: { x: 0.5, y: 0.5 },
    density,
    codeToId: new Map([[4, "feature-4"], [5, "feature-5"], [6, "feature-6"]]),
    ...options,
  });
}

test("same direct code in a complete 3x3 neighborhood is an interior candidate", () => {
  const tile = makeTile();
  const result = query(tile);

  assert.deepEqual(result, {
    kind: "interior",
    ids: ["feature-4"],
    primaryId: "feature-4",
  });
});

test("transparent holes miss", () => {
  const hole = makeTile();
  const center = 3 * hole.width + 3;
  hole.codes[center] = 0;
  assert.equal(query(hole).kind, "missing");
});

test("edge spans resolve contributor codes and never expose the encoded offset as an ID", () => {
  const tile = makeTile();
  const center = 3 * tile.width + 3;
  tile.codes[center] = 0x80000000;
  tile.edgeIds = new Uint32Array([2, 4, 5]);
  tile.edgeWeights = new Float32Array([0, 0.4, 0.6]);

  const result = query(tile);
  assert.equal(result.kind, "edge");
  assert.deepEqual(result.ids, ["feature-4", "feature-5"]);
  assert.equal(result.primaryId, null);
});
