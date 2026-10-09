import test from "node:test";
import assert from "node:assert/strict";
import {
  queryPoliticalIdRasterCandidates,
  resolvePoliticalIdRasterPickCandidate,
} from "../js/core/renderer/political_id_raster_pick.js";

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

test("canonical world density is independent of samples per output pixel", () => {
  assert.equal(query(makeTile(), { density: 0.5, samplesPerPixel: 1.2 }).kind, "interior");
  assert.equal(query(makeTile(), { density: 4, samplesPerPixel: 0.5 }).reason, "coarse-density");
});

test("same direct code in a complete 3x3 neighborhood is an interior candidate", () => {
  const tile = makeTile();
  const result = query(tile);

  assert.deepEqual(result, {
    kind: "interior",
    ids: ["feature-4"],
    primaryId: "feature-4",
  });
});

test("transparent holes miss and tiny regions remain boundary-only candidates", () => {
  const hole = makeTile();
  const center = 3 * hole.width + 3;
  hole.codes[center] = 0;
  assert.equal(query(hole).kind, "missing");

  const tiny = makeTile({ code: 0 });
  for (const y of [2, 3]) {
    for (const x of [2, 3]) tiny.codes[y * tiny.width + x] = 4;
  }
  const result = query(tiny);
  assert.equal(result.kind, "edge");
  assert.deepEqual(result.ids, ["feature-4"]);
  assert.equal(result.primaryId, null);
});

test("direct-code boundaries return all nearby IDs without selecting one", () => {
  const tile = makeTile();
  tile.codes[3 * tile.width + 4] = 5;
  const result = query(tile);

  assert.equal(result.kind, "edge");
  assert.deepEqual(result.ids, ["feature-4", "feature-5"]);
  assert.equal(result.primaryId, null);
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

  tile.codes[center] = 0x80000003;
  assert.equal(query(tile).kind, "invalid");
  assert.equal(query(tile).reason, "invalid-edge-span");
});

test("negative raster coordinates work and tile seams fall back", () => {
  const negativeTile = makeTile({ width: 8, height: 8, originX: -4, originY: -4 });
  const interior = queryPoliticalIdRasterCandidates({
    tiles: [negativeTile],
    point: { x: -0.5, y: -0.5 },
    codeToId: new Map([[4, "feature-4"]]),
    density: 1,
  });
  assert.equal(interior.kind, "interior");

  const left = makeTile({ width: 4, height: 8, originX: -4, originY: -4 });
  const right = makeTile({ width: 4, height: 8, originX: 0, originY: -4 });
  const seam = queryPoliticalIdRasterCandidates({
    tiles: [left, right],
    point: { x: 0, y: -0.5 },
    codeToId: new Map([[4, "feature-4"]]),
    density: 1,
  });
  assert.equal(seam.kind, "missing");
  assert.equal(seam.reason, "tile-seam");
});

test("outside tiles and coarse density fall back", () => {
  const tile = makeTile();
  assert.equal(queryPoliticalIdRasterCandidates({
    tiles: [tile],
    point: { x: 30, y: 30 },
    codeToId: new Map([[4, "feature-4"]]),
    density: 1,
  }).kind, "missing");

  const coarse = query(tile, { density: 0.75 });
  assert.equal(coarse.kind, "missing");
  assert.equal(coarse.reason, "coarse-density");
});

test("missing mappings, malformed spans, and oversized candidate sets are invalid", () => {
  const tile = makeTile();
  const missingMap = queryPoliticalIdRasterCandidates({
    tiles: [tile],
    point: { x: 0.5, y: 0.5 },
    codeToId: new Map(),
    density: 1,
  });
  assert.equal(missingMap.kind, "invalid");
  assert.equal(missingMap.reason, "missing-code-mapping");

  tile.codes[3 * tile.width + 3] = 0x80000000;
  tile.edgeIds = new Uint32Array([2, 4, 5]);
  tile.edgeWeights = new Float32Array([0, 0.5, 0.5]);
  const malformed = query(tile, { maxCandidateCount: 1 });
  assert.equal(malformed.kind, "invalid");
  assert.equal(malformed.reason, "invalid-edge-span");

  const boundary = makeTile();
  boundary.codes[3 * boundary.width + 4] = 5;
  const capped = query(boundary, { maxCandidateCount: 1 });
  assert.equal(capped.kind, "invalid");
  assert.equal(capped.reason, "candidate-limit");
});

test("caller identity validation filters stale candidates without choosing among edge IDs", () => {
  const queryResult = query(makeTile());
  assert.deepEqual(resolvePoliticalIdRasterPickCandidate({
    query: queryResult,
    validateCandidate: (id) => id === "feature-4",
  }), queryResult);

  assert.deepEqual(resolvePoliticalIdRasterPickCandidate({
    query: queryResult,
    validateCandidate: () => false,
  }), {
    kind: "missing",
    ids: [],
    primaryId: null,
    reason: "stale-candidate",
  });

  const edgeQuery = { kind: "edge", ids: ["feature-4", "feature-5"], primaryId: null };
  const filtered = resolvePoliticalIdRasterPickCandidate({
    query: edgeQuery,
    validateCandidate: (id) => id === "feature-5",
  });
  assert.deepEqual(filtered, { kind: "edge", ids: ["feature-5"], primaryId: null });
});
