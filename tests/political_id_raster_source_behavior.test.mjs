import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterSource } from "../js/core/renderer/political_id_raster_source.js";

function feature(id, color, bounds, geometry = {}) {
  return { id, color, geometry, bounds };
}

function harness() {
  const reads = [];
  const source = createPoliticalIdRasterSource({
    getId: (item) => item.id,
    getBounds: (item) => item.bounds,
    resolveColor: (item, id) => { reads.push(id); return item.color; },
  });
  const publish = (features, options = {}) => source.publish({
    collection: { type: "FeatureCollection", features },
    sceneKey: options.sceneKey ?? "scene-a",
    projectionKey: options.projectionKey ?? "projection-a",
    coverageKey: options.coverageKey ?? "coverage-a",
    colorRevision: options.colorRevision ?? 0,
  });
  return { source, reads, publish };
}

test("new, removed, and reintroduced IDs use monotonic per-scene codes", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 4, maxY: 4 });
  const b = feature("b", "#445566", { minX: 5, minY: 0, maxX: 9, maxY: 4 });
  const first = h.publish([a, b]);
  assert.deepEqual(first.entries.map(({ id, code }) => [id, code]), [["a", 1], ["b", 2]]);
  assert.deepEqual([...first.palette.slice(0, 12)], [0, 0, 0, 0, 17, 34, 51, 255, 68, 85, 102, 255]);

  const removed = h.publish([b]);
  assert.deepEqual(removed.removedIds, ["a"]);
  assert.deepEqual(removed.changedIds, []);
  assert.deepEqual(removed.dirtyBounds, [
    { id: "a", oldBounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, newBounds: null, previousCoverageUnknown: false },
  ]);
  assert.deepEqual([...removed.palette.slice(4, 8)], [0, 0, 0, 0]);

  const reintroduced = h.publish([a, b]);
  assert.deepEqual(reintroduced.entries.map(({ id, code }) => [id, code]), [["a", 1], ["b", 2]]);
  const added = feature("c", "#778899", { minX: 10, minY: 0, maxX: 14, maxY: 4 });
  const withNew = h.publish([b, added]);
  assert.deepEqual(withNew.entries.map(({ id, code }) => [id, code]), [["b", 2], ["c", 3]]);
});

test("geometry replacement, bounds movement and shrink report both dirty bounds", () => {
  const h = harness();
  const initial = feature("a", "#010203", { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const before = h.publish([initial]);
  const replacement = feature("a", "#010203", { minX: 2, minY: 1, maxX: 7, maxY: 8 });
  const after = h.publish([replacement]);
  assert.equal(after.geometryRevision, before.geometryRevision + 1);
  assert.notEqual(after.entries[0].geometryVersion, before.entries[0].geometryVersion);
  assert.deepEqual(after.changedIds, ["a"]);
  assert.deepEqual(after.dirtyBounds, [{
    id: "a",
    oldBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    newBounds: { minX: 2, minY: 1, maxX: 7, maxY: 8 },
    previousCoverageUnknown: false,
  }]);
});

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

test("moving an earlier feature to the end dirties only the moved feature", () => {
  const h = harness();
  const a = feature("a", "#010203", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const b = feature("b", "#040506", { minX: 2, minY: 0, maxX: 3, maxY: 1 });
  const c = feature("c", "#070809", { minX: 4, minY: 0, maxX: 5, maxY: 1 });
  const first = h.publish([a, b, c]);
  const reordered = h.publish([b, c, a]);
  assert.equal(reordered.geometryRevision, first.geometryRevision + 1);
  assert.deepEqual(reordered.entries.map(({ id, drawOrder }) => [id, drawOrder]), [["b", 0], ["c", 1], ["a", 2]]);
  assert.deepEqual(reordered.changedIds, ["a"]);
  assert.deepEqual(reordered.dirtyBounds.map(({ id }) => id), ["a"]);
});

test("middle insertion and removal do not dirty unchanged relative order", () => {
  const h = harness();
  const a = feature("a", "#010203", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const b = feature("b", "#040506", { minX: 2, minY: 0, maxX: 3, maxY: 1 });
  const c = feature("c", "#070809", { minX: 4, minY: 0, maxX: 5, maxY: 1 });
  const inserted = feature("inserted", "#aabbcc", { minX: 6, minY: 0, maxX: 7, maxY: 1 });
  h.publish([a, b, c]);
  const withInsertion = h.publish([a, inserted, b, c]);
  assert.deepEqual(withInsertion.entries.map(({ id, drawOrder }) => [id, drawOrder]), [["a", 0], ["inserted", 1], ["b", 2], ["c", 3]]);
  assert.deepEqual(withInsertion.changedIds, ["inserted"]);
  assert.deepEqual(withInsertion.dirtyBounds.map(({ id }) => id), ["inserted"]);

  const afterRemoval = h.publish([a, b, c]);
  assert.deepEqual(afterRemoval.entries.map(({ id, drawOrder }) => [id, drawOrder]), [["a", 0], ["b", 1], ["c", 2]]);
  assert.deepEqual(afterRemoval.changedIds, []);
  assert.deepEqual(afterRemoval.removedIds, ["inserted"]);
  assert.deepEqual(afterRemoval.dirtyBounds.map(({ id }) => id), ["inserted"]);
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

test("color edits and undo update only palette state and only resolve requested IDs", () => {
  const h = harness();
  const a = feature("a", "#102030", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const b = feature("b", "#405060", { minX: 2, minY: 0, maxX: 3, maxY: 1 });
  const first = h.publish([a, b]);
  const clean = h.publish([a, b]);
  assert.deepEqual(clean.dirtyBounds, []);
  h.reads.length = 0;
  a.color = "#a0b0c0";
  const edited = h.source.updateColors(["a"], { colorRevision: 1 });
  assert.deepEqual(h.reads, ["a"]);
  assert.equal(edited.geometryRevision, first.geometryRevision);
  assert.equal(edited.paletteRevision, first.paletteRevision + 1);
  assert.deepEqual(edited.dirtyBounds, clean.dirtyBounds);
  assert.deepEqual([...edited.palette.slice(4, 8)], [160, 176, 192, 255]);

  h.reads.length = 0;
  a.color = "#102030";
  const undone = h.source.updateColors(["a"], { colorRevision: 2 });
  assert.deepEqual(h.reads, ["a"]);
  assert.equal(undone.geometryRevision, first.geometryRevision);
  assert.equal(undone.paletteRevision, edited.paletteRevision + 1);
  assert.deepEqual(undone.dirtyBounds, clean.dirtyBounds);
  assert.deepEqual([...undone.palette.slice(4, 8)], [16, 32, 48, 255]);
});

test("a color-only publish does not advance geometry revision", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const first = h.publish([a]);
  a.color = "#332211";
  const second = h.publish([a], { colorRevision: 1 });
  assert.equal(second.geometryRevision, first.geometryRevision);
  assert.equal(second.paletteRevision, first.paletteRevision + 1);
  assert.deepEqual(second.changedIds, []);
  assert.deepEqual(second.dirtyBounds, []);
});

test("scene changes reset code namespace and advance mapping revision", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const first = h.publish([a]);
  const next = h.publish([feature("z", "#445566", { minX: 2, minY: 0, maxX: 3, maxY: 1 })], { sceneKey: "scene-b" });
  assert.equal(next.entries[0].code, 1);
  assert.equal(next.mappingRevision, first.mappingRevision + 1);
  assert.equal(next.geometryRevision, first.geometryRevision + 1);
  assert.deepEqual(next.changedIds, ["z"]);
  assert.deepEqual(next.removedIds, ["a"]);
});

test("dirty bounds distinguish unknown previous coverage from a new insertion", () => {
  const h = harness();
  const unknown = feature("unknown", "#112233", null);
  h.publish([unknown]);
  const knownBounds = { minX: 30, minY: 40, maxX: 50, maxY: 60 };
  unknown.bounds = knownBounds;
  const recovered = h.publish([unknown]);
  assert.deepEqual(recovered.dirtyBounds, [{
    id: "unknown", oldBounds: null, newBounds: knownBounds, previousCoverageUnknown: true,
  }]);

  const inserted = h.publish([unknown, feature("new", "#445566", { minX: 70, minY: 80, maxX: 90, maxY: 100 })]);
  assert.deepEqual(inserted.dirtyBounds, [{
    id: "new", oldBounds: null, newBounds: { minX: 70, minY: 80, maxX: 90, maxY: 100 },
    previousCoverageUnknown: false,
  }]);
});

test("projection and coverage changes explicitly invalidate all current geometry", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const first = h.publish([a]);
  const next = h.publish([a], { projectionKey: "projection-b", coverageKey: "coverage-b" });
  assert.equal(next.geometryRevision, first.geometryRevision + 1);
  assert.deepEqual(next.changedIds, ["a"]);
  assert.equal(next.dirtyBounds.length, 1);
});

test("invalid IDs, duplicate IDs, bounds, and colors reject atomically", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const stable = h.publish([a]);
  const original = h.source.getSnapshot();
  const assertUnchanged = () => {
    const current = h.source.getSnapshot();
    assert.equal(current.geometryRevision, original.geometryRevision);
    assert.equal(current.paletteRevision, original.paletteRevision);
    assert.equal(current.mappingRevision, original.mappingRevision);
    assert.deepEqual(current.entries.map(({ id, code }) => [id, code]), [["a", 1]]);
    assert.deepEqual([...current.palette], [...original.palette]);
  };
  assert.throws(() => h.publish([feature("", "#010203", { minX: 0, minY: 0, maxX: 1, maxY: 1 })]), /Missing feature ID/);
  assertUnchanged();
  assert.throws(() => h.publish([a, { ...a }]), /Duplicate feature ID/);
  assertUnchanged();
  assert.throws(() => h.publish([feature("a", "#010203", { minX: 0, minY: 0, maxX: Number.NaN, maxY: 1 })]), /Invalid bounds/);
  assertUnchanged();
  assert.throws(() => h.publish([feature("a", "rgba(1,2,3,0)", { minX: 0, minY: 0, maxX: 1, maxY: 1 })]), /non-opaque color/);
  assertUnchanged();
  assert.throws(() => h.publish([a, feature("c", "transparent", { minX: 2, minY: 0, maxX: 3, maxY: 1 })]), /non-opaque color/);
  assertUnchanged();
  a.color = "rgba(1,2,3,0)";
  assert.throws(() => h.source.updateColors(["a"], { colorRevision: 1 }), /non-opaque color/);
  assertUnchanged();
  assert.equal(stable.entries[0].id, "a");

  a.color = "#112233";
  const accepted = h.publish([a, feature("c", "#445566", { minX: 2, minY: 0, maxX: 3, maxY: 1 })]);
  assert.deepEqual(accepted.entries.map(({ id, code }) => [id, code]), [["a", 1], ["c", 2]]);
});

test("snapshots reuse frozen records across color updates and isolate palettes", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const first = h.publish([a]);
  assert.equal(Object.isFrozen(first.entries), true);
  assert.equal(Object.isFrozen(first.entries[0]), true);
  assert.equal(Object.isFrozen(first.entries[0].bounds), true);
  assert.equal(Object.isFrozen(first.dirtyBounds), true);
  assert.equal(Object.isFrozen(first.dirtyBounds[0]), true);
  assert.equal(Object.isFrozen(first.dirtyBounds[0].newBounds), true);
  assert.equal(Object.isFrozen(first.changedIds), true);
  assert.equal(Object.isFrozen(first.removedIds), true);
  assert.throws(() => { first.entries.push({}); }, TypeError);
  assert.throws(() => { first.entries[0].code = 88; }, TypeError);
  assert.throws(() => { first.entries[0].bounds.minX = 99; }, TypeError);
  assert.throws(() => { first.dirtyBounds[0].newBounds.minX = 99; }, TypeError);
  assert.throws(() => { first.changedIds.push("other"); }, TypeError);
  assert.throws(() => { first.removedIds.push("other"); }, TypeError);

  first.palette[4] = 250;
  assert.equal(h.source.getSnapshot().palette[4], 17);

  a.color = "#445566";
  const second = h.source.updateColors(["a"]);
  assert.equal(second.entries, first.entries, "palette updates reuse the frozen entry array");
  assert.equal(second.dirtyBounds, first.dirtyBounds);
  assert.equal(second.changedIds, first.changedIds);
  assert.equal(second.removedIds, first.removedIds);
  assert.equal(first.palette[4], 250, "old returned palette is caller-owned and remains unchanged");
  assert.deepEqual([...second.palette.slice(4, 8)], [68, 85, 102, 255]);
  second.palette[4] = 250;
  assert.equal(h.source.getSnapshot().palette[4], 68, "mutating a returned palette cannot alter private state");
});

test("frame identity includes source revisions and stable dimensions, DPR, and camera", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  h.publish([a]);
  const view = { width: 800, height: 600, dpr: 2, camera: { x: 1, y: 2, k: 3 } };
  const frame = h.source.captureFrame(view);
  assert.equal(h.source.isFrameCurrent(frame, { camera: { k: 3, y: 2, x: 1 }, dpr: 2, height: 600, width: 800 }), true);
  assert.equal(h.source.isFrameCurrent(frame, { ...view, dpr: 1 }), false);
  a.color = "#445566";
  h.source.updateColors(["a"]);
  assert.equal(h.source.isFrameCurrent(frame, view), false);
  const colorFrame = h.source.captureFrame(view);
  h.publish([feature("a", "#445566", { minX: 0, minY: 0, maxX: 1, maxY: 1 })]);
  assert.equal(h.source.isFrameCurrent(colorFrame, view), false);
});

test("dispose clears the derived snapshot and closes the source", () => {
  const h = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  h.publish([a]);
  const frame = h.source.captureFrame({ width: 10, height: 10, dpr: 1, camera: { x: 0, y: 0, k: 1 } });
  h.source.dispose();
  h.source.dispose();
  assert.equal(h.source.getSnapshot(), null);
  assert.equal(h.source.isFrameCurrent(frame, { width: 10, height: 10, dpr: 1, camera: { x: 0, y: 0, k: 1 } }), false);
  assert.throws(() => h.publish([a]), /disposed/);
});
