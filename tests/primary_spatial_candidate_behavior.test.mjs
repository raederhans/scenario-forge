import assert from "node:assert/strict";
import test from "node:test";
import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";
import { collectSpatialItemsForProjectedRects } from "../js/core/renderer/spatial_query_index.js";

const feature = (id, x = 10, extra = {}) => ({ id, country: "AA", geometry: {},
  bounds: { minX: x, minY: x, maxX: x + 3, maxY: x + 3, area: 9 }, ...extra });
const fields = ["landIndex", "countryToFeatureIds", "idToKey", "keyToId", "projectedBoundsById",
  "spatialItems", "spatialGrid", "spatialGridMeta", "spatialItemsById"];
const snapshot = (state) => Object.fromEntries(fields.map((key) => [key, state[key]]));

function harness(features = [feature("a"), feature("b", 30)], constants = {}) {
  const state = { ...createDefaultSpatialIndexState(), landData: { features }, riversData: { features: [] },
    projectedBoundsById: new Map(), sphericalFeatureDiagnosticsById: new Map(), hitCanvasDirty: false };
  let dimensions = [800, 600], clock = 0, path = {};
  const computed = [], publicReads = [], culls = [];
  const owner = createSpatialIndexRuntimeOwner({ state, constants, getters: { getPathSvg: () => path }, helpers: {
    getLogicalCanvasDimensions: () => dimensions,
    getFeatureId: (f) => f.id || "",
    getFeatureCountryCodeNormalized: (f) => f.country || "",
    getFeatureBorderMeshCountryCodeNormalized: (f) => f.borderCountry || f.country || "",
    shouldExcludePoliticalInteractionFeature: (f) => !!f.excludedInteraction,
    shouldExcludePoliticalVisualFeature: (f) => !!f.excludedVisual,
    shouldSkipFeature: (f) => { culls.push(f); return !!f.skip; },
    computeProjectedFeatureBounds: (f) => { computed.push(f); clock += 0.1; return f.bounds; },
    getProjectedFeatureBounds: (f, { featureId }) => {
      publicReads.push(f);
      if (f.bounds) state.projectedBoundsById.set(featureId, f.bounds);
      else state.projectedBoundsById.delete(featureId);
      return f.bounds;
    },
    nowMs: () => clock,
  } });
  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache: state.projectedBoundsById });
  owner.buildSpatialIndex({ includeSecondary: false });
  state.hitCanvasDirty = false;
  computed.length = 0; publicReads.length = 0; culls.length = 0;
  return { state, owner, computed, publicReads, culls,
    setDimensions: (next) => { dimensions = next; }, setPath: (next) => { path = next; } };
}

test("primary candidate keeps live bounds, maps and hits immutable until atomic adoption", async () => {
  const h = harness();
  const old = snapshot(h.state), keys = new Map(h.state.idToKey);
  const oldGridContents = new Map([...h.state.spatialGrid].map(([id, bucket]) => [id, bucket.slice()]));
  const features = [feature("new", 70), h.state.landData.features[1], h.state.landData.features[0]];
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features,
    incrementalDelta: { changedIds: ["new"], removedIds: [] },
    projectedBoundsCache: h.state.projectedBoundsById, yieldControl: async () => {
      for (const key of fields) assert.equal(h.state[key], old[key], key);
      assert.deepEqual(h.state.spatialGrid, oldGridContents);
      assert.equal(h.state.hitCanvasDirty, false);
      const hits = collectSpatialItemsForProjectedRects({ grid: h.state.spatialGrid, gridMeta: h.state.spatialGridMeta,
        items: h.state.spatialItems, projectedRects: [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }] });
      assert.deepEqual(hits.items.map((item) => item.id), ["a", "b"]);
    } });
  assert.equal(prepared.status, "prepared");
  assert.deepEqual(h.computed.map((f) => f.id), ["new"]);
  assert.equal(h.publicReads.length, 0, "candidate must not use live-publishing bounds lookup");
  assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "published");
  assert.equal(h.state.hitCanvasDirty, true);
  assert.equal(h.state.idToKey.get("a"), keys.get("a"));
  assert.equal(h.state.idToKey.get("b"), keys.get("b"));
  assert.equal(h.state.keyToId.get(h.state.idToKey.get("new")), "new");
  assert.deepEqual(h.state.spatialItems.map((item) => [item.id, item.drawOrder]), [["new", 0], ["b", 1], ["a", 2]]);
  assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "cancelled", "adoption is one-shot");
});

test("candidate products match full rebuild with exclusions, river bounds, globals and missing bounds", async () => {
  const h = harness();
  const features = [feature("b", 80, { country: "BB" }), feature("visual-only", 100, { excludedInteraction: true }),
    feature("hidden", 120, { excludedVisual: true }), feature("skip", 140, { skip: true }),
    feature("missing", 160, { bounds: null }), feature("world", 0, {
      bounds: { minX: -100, minY: -100, maxX: 1000, maxY: 1000, area: 1210000 } })];
  const river = feature("river", 150);
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features, riverFeatures: [river] });
  assert.equal(prepared.status, "prepared");
  const full = harness(features);
  full.state.riversData.features = [river];
  full.owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache: full.state.projectedBoundsById });
  full.owner.buildSpatialIndex({ includeSecondary: false });
  h.owner.adoptPrimarySpatialCandidate(prepared.candidate);
  for (const key of fields) assert.deepEqual(h.state[key], full.state[key], key);
});

test("changed geometry removal and country membership update through a private incremental candidate", async () => {
  const a = feature("a"), removed = feature("removed", 20), b = feature("b", 40);
  const h = harness([a, removed, b]);
  const next = feature("b", 90, { country: "CC" });
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features: [a, next],
    incrementalDelta: { changedIds: ["b"], removedIds: ["removed"] } });
  assert.deepEqual(h.computed, [next]);
  assert.deepEqual(h.culls, [next]);
  assert.equal(prepared.reusedItems, 1);
  assert.equal(prepared.candidate.spatialItems[0], h.state.spatialItems[0]);
  h.owner.adoptPrimarySpatialCandidate(prepared.candidate);
  assert.deepEqual([...h.state.countryToFeatureIds], [["AA", ["a"]], ["CC", ["b"]]]);
  assert.equal(h.state.projectedBoundsById.has("removed"), false);
  assert.equal(h.state.keyToId.has(2), false);
  assert.equal(h.state.projectedBoundsById.get("b"), next.bounds);
});

for (const mutation of ["caller", "layout", "path", "feature", "geometry", "properties", "state-map"]) {
  test(`primary candidate cancels during ${mutation} supersession without publishing`, async () => {
    const h = harness();
    const features = Array.from({ length: 1000 }, (_, i) => feature(`new-${i}`, i % 500));
    let current = true, yields = 0;
    const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features, isCurrent: () => current,
      yieldControl: async () => {
        if (++yields !== 2) return;
        if (mutation === "caller") current = false;
        if (mutation === "layout") h.setDimensions([900, 600]);
        if (mutation === "path") h.setPath({});
        if (mutation === "feature") features[0] = { ...features[0] };
        if (mutation === "geometry") features[0].geometry = {};
        if (mutation === "properties") features[0].properties = { owner: "new" };
        if (mutation === "state-map") h.state.landIndex = new Map(h.state.landIndex);
      } });
    assert.equal(prepared.status, "cancelled");
    assert.equal(h.state.landIndex.has("new-0"), false);
    assert.equal(h.state.projectedBoundsById.has("new-0"), false);
    assert.equal(h.state.hitCanvasDirty, false);
  });
}

for (const method of ["buildIndex", "rebuildRuntimePrimaryIndex", "reconcileRuntimePrimaryIndex",
  "buildSpatialIndex", "buildIndexChunked", "buildSpatialIndexChunked", "resetSecondarySpatialIndexState"]) {
  test(`${method} invalidates an already prepared primary candidate`, async () => {
    const h = harness();
    const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features: [feature("new")] });
    assert.equal(prepared.status, "prepared");
    await h.owner[method]({ includeSecondary: false });
    const afterSync = snapshot(h.state);
    assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "cancelled");
    for (const key of fields) assert.equal(h.state[key], afterSync[key]);
  });
}

test("newer preparation owns adoption and picking key exhaustion compacts privately", async () => {
  const h = harness();
  h.state.idToKey.set("a", 0xffffff); h.state.keyToId.set(0xffffff, "a");
  const old = await h.owner.preparePrimarySpatialCandidateChunked({ features: [feature("old")] });
  const next = await h.owner.preparePrimarySpatialCandidateChunked({ features: [h.state.landData.features[0], feature("new")],
    incrementalDelta: { changedIds: ["new"], removedIds: ["b"] } });
  assert.equal(next.compactedKeys, true);
  assert.equal(h.state.idToKey.get("a"), 0xffffff);
  assert.equal(h.owner.adoptPrimarySpatialCandidate(old.candidate).status, "cancelled");
  assert.equal(h.owner.adoptPrimarySpatialCandidate(next.candidate).status, "published");
  assert.deepEqual([...h.state.idToKey], [["a", 1], ["new", 2]]);
});

test("publication rechecks caller identity, layout and ownership after preparation has completed", async () => {
  for (const mutation of ["caller", "layout", "length", "foreign-owner"]) {
    const h = harness();
    let current = true;
    const features = [feature("new")];
    const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features, isCurrent: () => current });
    assert.equal(prepared.status, "prepared");
    if (mutation === "caller") current = false;
    if (mutation === "layout") h.setDimensions([900, 600]);
    if (mutation === "length") features.push(feature("late"));
    const target = mutation === "foreign-owner" ? harness() : h;
    const before = snapshot(target.state);
    assert.equal(target.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "cancelled", mutation);
    for (const key of fields) assert.equal(target.state[key], before[key]);
  }
});

test("primary candidate current check is read-only and cannot consume or revive publication ownership", async () => {
  const h = harness();
  const old = snapshot(h.state);
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(undefined), false);
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent({}), false);
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features: [feature("new")] });
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(prepared.candidate), true);
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(prepared.candidate), true);
  for (const key of fields) assert.equal(h.state[key], old[key]);
  assert.equal(h.state.hitCanvasDirty, false);
  assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "published");
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(prepared.candidate), false);
  const next = await h.owner.preparePrimarySpatialCandidateChunked({ features: [] });
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(next.candidate), true);
  h.owner.buildIndex();
  assert.equal(h.owner.isPrimarySpatialCandidateCurrent(next.candidate), false);
});

test("primary preparation slices bounds work and grid cells, including empty publication", async () => {
  const h = harness([], { hitGridTargetCols: 100, hitGridMinCellPx: 1, hitGridMaxCellPx: 10, hitMaxCellsPerItem: 10000 });
  const features = Array.from({ length: 1200 }, (_, i) => feature(`f${i}`, i % 500));
  features[0].bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600, area: 480000 };
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features });
  assert.equal(prepared.status, "prepared");
  assert.ok(prepared.yieldCount > 35);
  assert.ok(prepared.maxSliceMs < 6.2);
  assert.equal(prepared.candidate.spatialGrid.size, 7500);
  h.owner.adoptPrimarySpatialCandidate(prepared.candidate);
  const empty = await h.owner.preparePrimarySpatialCandidateChunked({ features: [] });
  assert.equal(h.owner.adoptPrimarySpatialCandidate(empty.candidate).status, "published");
  assert.equal(h.state.landIndex.size, 0);
  assert.equal(h.state.spatialItems.length, 0);
  assert.equal(h.state.spatialGrid.size, 0);
  assert.equal(h.state.projectedBoundsById.size, 0);
});
