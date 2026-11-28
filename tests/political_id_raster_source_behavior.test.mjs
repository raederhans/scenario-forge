import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterSource } from "../js/core/renderer/political_id_raster_source.js";
import { buildPoliticalIdRasterTile, referenceColorizePoliticalIdTile } from "../js/core/renderer/political_id_raster_tile.js";

function feature(id, color, bounds, geometry = {}) {
  return { id, color, geometry, bounds };
}

async function stripPixels(snapshot, originX) {
  let translation = 0, bounds, radius;
  const context = {
    setTransform(a, b, c, d, x) { translation = x; },
    clearRect() {},
    fill(path) { bounds = path; radius = 0; },
    stroke() { radius = this.lineWidth / 2; },
    getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const left = x + i % width - translation;
        const overlap = Math.min(left + 1, bounds.maxX + radius) - Math.max(left, bounds.minX - radius);
        data[4 * i + 3] = 255 * Math.max(0, overlap);
      }
      return { data };
    },
  };
  const tile = await buildPoliticalIdRasterTile({ originX, width: 4, height: 1, gutter: 2, strokeWidth: 1,
    entries: snapshot.entries, projection: {}, d3: { geoPath() {} },
    createProjectedPath: entry => entry.bounds, createCanvas: () => ({ getContext: () => context }) });
  return referenceColorizePoliticalIdTile(tile, snapshot.palette);
}

test("incremental paint, repaint and erase match full tile pixels across a stroked boundary", async () => {
  const { source } = harness();
  const a = feature("a", "#ff0000", { minX: 2, maxX: 4, minY: -10, maxY: 10 });
  const b = feature("b", "#0000ff", { minX: 0, maxX: 7, minY: -10, maxY: 10 });
  const original = [b, a], oracle = harness(), orderContext = "scene/geometry/fit/layout";
  const first = source.publish({ collection: { features: original, originalIndices: [2, 10], isUnderlay: f => f === a },
    foregroundIds: [], orderContext });
  const initialEdge = await stripPixels(first, 4);
  oracle.publish([a, b]);
  let version = 0;
  for (const [promoted, color] of [
    [true, "#ff3300"], [true, "#00ff00"], [false, "#ff0000"],
  ]) {
    a.color = color;
    const next = source.updateForeground({ orderContext, foregroundIds: promoted ? ["a"] : [] },
      ["a"], { colorRevision: ++version });
    const full = oracle.publish(promoted ? [b, a] : [a, b], { colorRevision: version });
    for (const x of [0, 4]) assert.deepEqual(await stripPixels(next, x), await stripPixels(full, x));
    const edge = await stripPixels(next, 4);
    if (promoted) assert.notDeepEqual(edge.slice(0, 4), initialEdge.slice(0, 4));
    else assert.deepEqual(edge, initialEdge);
  }
});

function harness() {
  const source = createPoliticalIdRasterSource({
    getId: (item) => item.id,
    getBounds: (item) => item.bounds,
    resolveColor: (item) => item.color,
  });
  const publish = (features, options = {}) => source.publish({
    collection: { type: "FeatureCollection", features },
    colorRevision: options.colorRevision ?? 0,
  });
  return { source, publish };
}

test("geometry replacement is detected when the feature wrapper itself is reused", () => {
  const h = harness();
  const reusedFeature = feature("a", "#010203", { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const before = h.publish([reusedFeature]);
  const previousGeometry = reusedFeature.geometry;
  reusedFeature.geometry = {};
  const after = h.publish([reusedFeature]);
  assert.equal(reusedFeature.geometry === previousGeometry, false);
  assert.equal(after.geometryRevision, before.geometryRevision + 1);
  assert.notEqual(after.entries[0].geometryVersion, before.entries[0].geometryVersion);
  assert.deepEqual(after.changedIds, ["a"]);
  assert.deepEqual(after.dirtyBounds, [{
    id: "a",
    oldBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    newBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    previousCoverageUnknown: false,
  }]);
});

test("an overlap order reversal dirties a moved feature covering the changed overlap", () => {
  const h = harness();
  const a = feature("a", "#010203", { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const b = feature("b", "#040506", { minX: 8, minY: 0, maxX: 20, maxY: 10 });
  h.publish([a, b]);
  const swapped = h.publish([b, a]);
  assert.deepEqual(swapped.entries.map(({ id, drawOrder }) => [id, drawOrder]), [["b", 0], ["a", 1]]);
  assert.equal(swapped.changedIds.length, 1);
  assert.deepEqual(swapped.dirtyBounds.map(({ id }) => id), swapped.changedIds);
  const dirty = swapped.dirtyBounds[0].newBounds;
  assert.equal(dirty.minX <= 8 && dirty.maxX >= 10 && dirty.minY <= 0 && dirty.maxY >= 10, true);
});

test("color edits and undo restore the palette bytes", () => {
  const h = harness();
  const a = feature("a", "#102030", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const b = feature("b", "#405060", { minX: 2, minY: 0, maxX: 3, maxY: 1 });
  h.publish([a, b]);
  a.color = "#a0b0c0";
  const edited = h.source.updateColors(["a"], { colorRevision: 1 });
  assert.deepEqual([...edited.palette.slice(4, 8)], [160, 176, 192, 255]);

  a.color = "#102030";
  const undone = h.source.updateColors(["a"], { colorRevision: 2 });
  assert.deepEqual([...undone.palette.slice(4, 8)], [16, 32, 48, 255]);
});
