import test from "node:test";
import assert from "node:assert/strict";
import { rasterizePopulationDensity, getPopulationViewportDetailTileIds } from "../js/core/renderer/population_heatmap_render_owner.js";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function projection(point) { return point; }
projection.invert = (point) => point;

test("real spatial samples within one country retain different density pixels and missing stays distinct from zero", () => {
  const result = rasterizePopulationDensity({ width: 3, height: 1, matrix: identity, projection,
    sampleDensity: (lon) => [{ status: "ok", density: 0 }, { status: "ok", density: 1000 }, { status: "no_data", density: null }][Math.floor(lon)] });
  assert.equal(result.sampled, 2);
  assert.equal(result.data[3], 255);
  assert.equal(result.data[7], 255);
  assert.equal(result.data[11], 0);
  assert.notDeepEqual([...result.data.slice(0, 3)], [...result.data.slice(4, 7)]);
});

test("inverse projection exterior and non-finite coordinates never paint plausible wrapped globe data", () => {
  const wrapped = () => [90, 90];
  wrapped.invert = () => [0, 0];
  for (const invalid of [wrapped, { invert: () => [Infinity, 0] }, { invert: () => [181, 0] }]) {
    const result = rasterizePopulationDensity({ width: 1, height: 1, matrix: identity, projection: invalid,
      sampleDensity: () => assert.fail("invalid coordinates must not sample") });
    assert.equal(result.data[3], 0);
  }
});

test("detail refinement selection uses projected viewport locations and caps downloads at 32 tiles", () => {
  const tiles = Array.from({ length: 100 }, (_, index) => ({ id: `tile-${index}`,
    bounds: [-1e7 + index * 200000, -1e6, -1e7 + (index + 1) * 200000, 1e6] }));
  const state = { width: 120, height: 60, zoomTransform: { k: 4, x: 0, y: 0 },
    populationRuntime: { data: { raster: { detail_tiles: tiles } } } };
  const ids = getPopulationViewportDetailTileIds(state, { projection });
  assert.ok(ids.length > 0 && ids.length <= 32);
  assert.ok(ids.includes("tile-50"), "real central Mollweide location selects the central source tile");
  state.zoomTransform.k = 1;
  assert.deepEqual(getPopulationViewportDetailTileIds(state, { projection }), []);
  state.zoomTransform.k = 4;
  assert.deepEqual(getPopulationViewportDetailTileIds(state, { projection: { invert: () => [Infinity, 0] } }), []);
});
