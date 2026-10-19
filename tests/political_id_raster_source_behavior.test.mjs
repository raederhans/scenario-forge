import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalIdRasterSource, collectPoliticalRasterDisplayFeatures, collectPoliticalRasterDisplayFeaturesAsync } from "../js/core/renderer/political_id_raster_source.js";

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

const preparationInput = (features, options = {}) => ({ collection: { features }, sceneKey: "scene-a",
  projectionKey: "projection-a", coverageKey: "coverage-a", colorRevision: 0, ...options });
const cooperative = { nowMs: () => 0, workBatch: 2, yieldControl: () => Promise.resolve() };

test("private asynchronous preparation matches synchronous publish across mapping, LIS, palette and scene transitions", async () => {
  const h = harness(), oracle = harness();
  const a = feature("a", "#112233", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const b = feature("b", "#445566", null), c = feature("c", "#778899", a.bounds), d = feature("d", "#aabbcc", a.bounds);
  const cases = [[[a, b, c], {}], [[c, a, b], {}], [[a, c], {}], [[a, d, b, c], {}],
    [[a, b], { sceneKey: "scene-b" }], [[a, b], { sceneKey: "scene-b", projectionKey: "projection-b", colorRevision: 2 }]];
  for (const [features, options] of cases) {
    const before = h.source.getSnapshot();
    const expected = oracle.publish(features, options);
    const candidate = await h.source.prepare(preparationInput(features, options), { ...cooperative,
      yieldControl: () => { assert.deepEqual(h.source.getSnapshot(), before); return Promise.resolve(); } });
    assert.deepEqual(Object.keys(candidate), []);
    assert.equal(Object.isFrozen(candidate), true);
    assert.deepEqual(h.source.getSnapshot(), before);
    const snapshot = h.source.commitPrepared(candidate);
    assert.deepEqual(snapshot, expected);
    snapshot.palette[4] = 0;
    assert.deepEqual(h.source.getSnapshot().palette, expected.palette, "commit returns an isolated precomputed public palette");
  }
});

test("cancelling every preparation phase preserves all published state and consumes neither codes nor geometry versions", async () => {
  const phases = ["validation", "mapping-copy", "mapping", "entries", "lis-index", "lis-common", "lis-scan", "lis-kept",
    "lis-moved", "dirty-bounds", "removed", "palette", "palette-compare", "dirty-freeze", "public-palette"];
  for (const phase of phases) {
    const h = harness(), oracle = harness(), controller = new AbortController();
    const a = feature("a", "#112233", null), b = feature("b", "#445566", null), c = feature("c", "#778899", null);
    h.publish([a, b, c]); oracle.publish([a, b, c]);
    const before = h.source.getSnapshot();
    const next = [c, b, { ...a, geometry: {} }];
    if (phase !== "palette-compare") next.push(feature("cancelled", "#aabbcc", null));
    let cancelled = false;
    await assert.rejects(h.source.prepare(preparationInput(next), { ...cooperative, workBatch: 1, signal: controller.signal,
      yieldControl: ({ phase: current }) => {
        assert.deepEqual(h.source.getSnapshot(), before);
        if (current === phase) { cancelled = true; controller.abort(); }
        return Promise.resolve();
      } }), { name: "AbortError" }, phase);
    assert.equal(cancelled, true, phase);
    assert.deepEqual(h.source.getSnapshot(), before, phase);
    const accepted = [a, b, c, feature("accepted", "#010203", null)];
    assert.deepEqual(h.publish(accepted), oracle.publish(accepted), phase);
    const candidate = await h.source.prepare(preparationInput(accepted), cooperative);
    assert.deepEqual(h.source.commitPrepared(candidate), oracle.publish(accepted), "a fresh preparation can succeed after cancellation");
  }
});

test("invalid asynchronous inputs do not mutate or invalidate a valid prepared candidate", async () => {
  const h = harness(); const a = feature("a", "#112233", null);
  h.publish([a]); const before = h.source.getSnapshot();
  const accepted = [a, feature("accepted", "#445566", null)];
  const candidate = await h.source.prepare(preparationInput(accepted), cooperative);
  for (const invalid of [[a, { ...a }], [a, feature("", "#112233", null)],
    [a, feature("bad", "transparent", null)], [a, feature("bad", "#112233", { minX: 1, minY: 0, maxX: 0, maxY: 1 })], [null]]) {
    await assert.rejects(h.source.prepare(preparationInput(invalid), cooperative), TypeError);
    assert.deepEqual(h.source.getSnapshot(), before);
  }
  const snapshot = h.source.commitPrepared(candidate);
  assert.deepEqual(snapshot.entries.map(({ id, code, geometryVersion }) => [id, code, geometryVersion]), [["a", 1, 1], ["accepted", 2, 2]]);
});

test("color updates during preparation or before commit fence stale palettes including no-op updates", async () => {
  for (const during of [true, false]) {
    const h = harness(); const a = feature("a", "#112233", null); h.publish([a]);
    let latest, updated = false;
    const options = { ...cooperative, workBatch: 1, yieldControl: () => {
      if (during && !updated) { updated = true; a.color = "#aabbcc"; latest = h.source.updateColors(["a"], { colorRevision: 1 }); }
      return Promise.resolve();
    } };
    if (during) await assert.rejects(h.source.prepare(preparationInput([a]), options), { name: "AbortError" });
    else {
      const candidate = await h.source.prepare(preparationInput([a]), options);
      a.color = "#aabbcc"; latest = h.source.updateColors(["a"], { colorRevision: 1 });
      assert.throws(() => h.source.commitPrepared(candidate), { name: "AbortError" });
    }
    assert.deepEqual(h.source.getSnapshot(), latest);
    const noopCandidate = await h.source.prepare(preparationInput([a], { colorRevision: 1 }), cooperative);
    h.source.updateColors([]);
    assert.throws(() => h.source.commitPrepared(noopCandidate), { name: "AbortError" });
    const fresh = await h.source.prepare(preparationInput([a], { colorRevision: 1 }), cooperative);
    assert.deepEqual([...h.source.commitPrepared(fresh).palette.slice(4, 8)], [170, 187, 204, 255]);
  }
});

test("new publications, competing candidates, signal cancellation and dispose reject obsolete commits", async () => {
  const h = harness(); const a = feature("a", "#112233", null); h.publish([a]);
  const old = await h.source.prepare(preparationInput([a]), cooperative);
  const latest = h.publish([feature("scene-b", "#445566", null)], { sceneKey: "scene-b" });
  assert.throws(() => h.source.commitPrepared(old), { name: "AbortError" });
  assert.deepEqual(h.source.getSnapshot(), latest);
  const input = preparationInput([a], { sceneKey: "scene-b" });
  const first = await h.source.prepare(input, cooperative), second = await h.source.prepare(input, cooperative);
  h.source.commitPrepared(first);
  assert.throws(() => h.source.commitPrepared(second), { name: "AbortError" });
  assert.throws(() => h.source.commitPrepared(first), { name: "AbortError" });
  assert.throws(() => harness().source.commitPrepared(second), /Unknown prepared/);
  const controller = new AbortController();
  const cancelled = await h.source.prepare(input, { ...cooperative, signal: controller.signal }); controller.abort();
  assert.throws(() => h.source.commitPrepared(cancelled), { name: "AbortError" });
  const disposedCandidate = await h.source.prepare(input, cooperative);
  h.source.dispose();
  assert.throws(() => h.source.commitPrepared(disposedCandidate), { name: "AbortError" });
  assert.equal(h.source.getSnapshot(), null);
  await assert.rejects(h.source.prepare(input, cooperative), /disposed/);
});

test("source mutation and disposal during a yielded preparation abort without publishing its partial result", async () => {
  for (const dispose of [false, true]) {
    const h = harness(); const a = feature("a", "#112233", null); h.publish([a]);
    let changed = false, expected;
    await assert.rejects(h.source.prepare(preparationInput([a]), { ...cooperative, workBatch: 1, yieldControl: () => {
      if (!changed) {
        changed = true;
        if (dispose) { h.source.dispose(); expected = null; }
        else expected = h.publish([feature("replacement", "#445566", null)]);
      }
      return Promise.resolve();
    } }), { name: "AbortError" });
    assert.deepEqual(h.source.getSnapshot(), expected);
  }
});

test("large source preparation yields through all bulk work, honors private bounds and leaves commit with no callbacks", async t => {
  let defaultBounds = 0, boundsReads = 0, colorReads = 0, idReads = 0;
  const source = createPoliticalIdRasterSource({ getId: f => { idReads++; return f.id; },
    getBounds: f => { defaultBounds++; return f.bounds; }, resolveColor: f => { colorReads++; return f.color; } });
  const items = Array.from({ length: 5000 }, (_, index) => feature(`id-${index}`, "#112233", null));
  source.publish(preparationInput(items));
  const before = source.getSnapshot(), phases = new Set(); let yields = 0;
  const candidate = await source.prepare(preparationInput([...items].reverse()), { ...cooperative, workBatch: 64,
    getBounds: () => { boundsReads++; return { minX: 1, minY: 2, maxX: 3, maxY: 4 }; },
    yieldControl: ({ phase }) => {
      yields++; phases.add(phase); assert.equal(source.getSnapshot().entries, before.entries); return Promise.resolve();
    } });
  assert.ok(yields > 100);
  // This fixture's public palette is only 20 KiB. Its per-copy cancellation
  // checkpoint is covered above; it need not exhaust another host-task batch.
  for (const phase of ["validation", "mapping-copy", "mapping", "entries", "lis-index", "lis-common", "lis-scan",
    "lis-moved", "dirty-bounds", "removed", "palette", "palette-compare", "dirty-freeze"]) assert.ok(phases.has(phase), phase);
  const readsBeforeCommit = [defaultBounds, boundsReads, colorReads, idReads];
  const startedAt = performance.now(); const snapshot = source.commitPrepared(candidate); const commitMs = performance.now() - startedAt;
  assert.deepEqual([defaultBounds, boundsReads, colorReads, idReads], readsBeforeCommit);
  assert.equal(defaultBounds, items.length); assert.equal(boundsReads, items.length);
  assert.deepEqual(snapshot.entries[0].bounds, { minX: 1, minY: 2, maxX: 3, maxY: 4 });
  let clock = 0, timeYields = 0;
  await source.prepare(preparationInput(items), { workBatch: 1e9, timeBudgetMs: 4, nowMs: () => clock++,
    yieldControl: () => { timeYields++; return Promise.resolve(); } });
  assert.ok(timeYields > 0, "the time budget yields independently of the batch limit");
  const newItems = Array.from({ length: 5000 }, (_, index) => feature(`new-${index}`, "#445566", null));
  const newCandidate = await source.prepare(preparationInput(newItems), cooperative);
  const newStartedAt = performance.now(); source.commitPrepared(newCandidate); const newGeometryCommitMs = performance.now() - newStartedAt;
  t.diagnostic(`5000-feature commit existing geometry ${commitMs.toFixed(3)}ms; 5000 new WeakMap registrations ${newGeometryCommitMs.toFixed(3)}ms (diagnostic, no timing assertion)`);
});

test("asynchronous complete-display collection preserves order, references and authenticated pruning", async () => {
  const polygon = x => [[[x, 0], [x, 1], [x + 1, 1], [x, 0]]];
  const full = { id: "pruned", geometry: { type: "MultiPolygon", coordinates: [polygon(0), polygon(10)] } };
  const fine = { ...full, properties: { __visualFragmentCamouflage: true, __visualFragmentPrunedCount: 1 },
    geometry: { type: "MultiPolygon", coordinates: [structuredClone(full.geometry.coordinates[0])] } };
  const support = feature("support", "#112233", null), extra = feature("extra", "#445566", null);
  const input = { fullCollection: [support, full], interactiveCollection: [extra, fine], getId: f => f.id };
  const expected = collectPoliticalRasterDisplayFeatures(input), phases = new Set();
  const actual = await collectPoliticalRasterDisplayFeaturesAsync(input, { ...cooperative, workBatch: 1,
    yieldControl: ({ phase }) => { phases.add(phase); return Promise.resolve(); } });
  assert.deepEqual(actual, expected); actual.forEach((value, index) => assert.equal(value, expected[index]));
  assert.deepEqual([...phases], ["display-interactive", "display-full", "display-result"]);
  assert.equal(actual[2].geometry, full.geometry);
  assert.equal(fine.geometry.coordinates.length, 1);
});

test("asynchronous display collection cancels every bulk phase, rejects invalid identity and remains reusable", async () => {
  const a = feature("a", "#112233", null), support = feature("support", "#445566", null);
  const input = { fullCollection: [support, a], interactiveCollection: [a], getId: f => f.id };
  for (const phase of ["display-interactive", "display-full", "display-result"]) {
    const controller = new AbortController();
    await assert.rejects(collectPoliticalRasterDisplayFeaturesAsync(input, { ...cooperative, workBatch: 1, signal: controller.signal,
      yieldControl: ({ phase: current }) => { if (current === phase) controller.abort(); return Promise.resolve(); } }), { name: "AbortError" });
  }
  for (const invalid of [{ ...input, fullCollection: [a, a] }, { ...input, interactiveCollection: [a, a] },
    { ...input, interactiveCollection: [{ geometry: {} }] },
    { ...input, fullCollection: [{ ...a, geometry: { type: "Point", coordinates: [1, 1] } }] }]) {
    await assert.rejects(collectPoliticalRasterDisplayFeaturesAsync(invalid, cooperative), TypeError);
  }
  const many = Array.from({ length: 3000 }, (_, index) => feature(`display-${index}`, "#112233", null)); let yields = 0;
  const result = await collectPoliticalRasterDisplayFeaturesAsync({ interactiveCollection: many, getId: f => f.id },
    { ...cooperative, workBatch: 64, yieldControl: () => { yields++; return Promise.resolve(); } });
  assert.ok(yields > 100); assert.deepEqual(result, many); result.forEach((value, index) => assert.equal(value, many[index]));
});

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

test("complete display includes support coverage without copying geometry or changing the interactive collection", () => {
  const support = { id: "support", geometry: {}, properties: { interactive: false } };
  const fine = { id: "fine", geometry: {}, properties: {} };
  const interactiveCollection = Object.freeze({ features: Object.freeze([fine]) });
  const fullCollection = Object.freeze({ features: Object.freeze([fine, support]) });
  const result = collectPoliticalRasterDisplayFeatures({ fullCollection, interactiveCollection, getId: f => f.id });
  assert.deepEqual(result, [support, fine]);
  assert.equal(result[0], support); assert.equal(result[1].geometry, fine.geometry);
  assert.deepEqual(interactiveCollection.features, [fine]);
  assert.equal(support.properties.interactive, false);
});

test("complete display refuses duplicate or conflicting identity instead of dropping background coverage", () => {
  const fine = { id: "a", geometry: { type: "Point", coordinates: [0,0] } };
  const collect = full => collectPoliticalRasterDisplayFeatures({ fullCollection: { features: full }, interactiveCollection: { features: [fine] }, getId: f => f.id });
  assert.throws(() => collect([fine,fine]), /Duplicate full/);
  assert.throws(() => collect([{ id: "a", geometry: { type: "Point", coordinates: [1,0] } }]), /Conflicting display geometry/);
  assert.throws(() => collect([{ geometry: {} }]), /stable feature IDs/);
  assert.deepEqual(collectPoliticalRasterDisplayFeatures({ interactiveCollection: { features: [fine] }, getId: f => f.id }), [fine]);
});

test("replacing geometry inside unchanged bounds invalidates coverage while pure palette edits do not", () => {
  const h = harness(); const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const a = feature("a", "#010203", bounds, { type: "Polygon", coordinates: [[[0,0],[10,0],[0,10],[0,0]]] });
  const before = h.publish([a]);
  const b = { ...a, geometry: { type: "Polygon", coordinates: [[[0,0],[10,0],[5,5],[0,10],[0,0]]] } };
  const after = h.publish([b]);
  assert.equal(after.geometryRevision, before.geometryRevision + 1);
  assert.deepEqual(after.changedIds, ["a"]);
  b.color = "#445566";
  const colored = h.source.updateColors(["a"]);
  assert.equal(colored.geometryRevision, after.geometryRevision);
  assert.equal(colored.paletteRevision, after.paletteRevision + 1);
});


test("full and interactive wrappers with equal immutable geometry share canonical display identity", () => {
  const geometry = { type: "Polygon", coordinates: [[[0,0],[2,0],[1,2],[0,0]]] };
  const full = { id: "a", geometry };
  const fine = { id: "a", geometry: structuredClone(geometry), properties: { role: "interactive" } };
  const collect = () => collectPoliticalRasterDisplayFeatures({ fullCollection: { features: [full] }, interactiveCollection: { features: [fine] }, getId: f=>f.id });
  assert.deepEqual(collect(), [fine]);
  assert.deepEqual(collect(), [fine]);
  fine.geometry = { type: "Polygon", coordinates: [[[0,0],[2,0],[1,1],[0,0]]] };
  assert.throws(collect, /Conflicting display geometry/, "same bounds or ID must not admit changed coverage");
});


test("complete coverage preserves authenticated fragment-pruned background without changing interactive geometry", () => {
  const polygon = x => [[[x,0],[x,1],[x+1,1],[x,0]]];
  const full = { type:"Feature", properties:{id:"pruned"}, geometry:{type:"MultiPolygon",coordinates:[polygon(0),polygon(10)]} };
  const fine = { ...full, properties:{...full.properties,__visualFragmentCamouflage:true,__visualFragmentPrunedCount:1},
    geometry:{type:"MultiPolygon",coordinates:[structuredClone(full.geometry.coordinates[0])]} };
  const collect = () => collectPoliticalRasterDisplayFeatures({fullCollection:[full],interactiveCollection:[fine],getId:f=>f.properties.id});
  const result = collect();
  assert.equal(result[0].properties.id,"pruned");
  assert.equal(result[0].geometry,full.geometry);
  assert.equal(fine.geometry.coordinates.length,1,"interactive geometry remains unchanged");
  assert.equal(result[0],collect()[0],"derived wrapper is reused for immutable sources");
  fine.properties = {...fine.properties,__visualFragmentPrunedCount:2};
  assert.throws(collect,/Conflicting display geometry/);
  fine.properties = {...fine.properties,__visualFragmentPrunedCount:1,__visualFragmentCamouflage:false};
  assert.throws(collect,/Conflicting display geometry/);
  fine.properties = {...fine.properties,__visualFragmentCamouflage:true};
  fine.geometry = {type:"MultiPolygon",coordinates:[polygon(99)]};
  assert.throws(collect,/Conflicting display geometry/,"a forged pruning label cannot admit another shape");
});
