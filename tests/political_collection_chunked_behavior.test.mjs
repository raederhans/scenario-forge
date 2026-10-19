import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";

const originalD3 = globalThis.d3;
test.after(() => { globalThis.d3 = originalD3; });

function fixture(count = 850) {
  let normalized = 0;
  globalThis.d3 = { geoArea: () => { normalized += 1; return 1; } };
  const state = { marker: "untouched" };
  const features = Array.from({ length: count }, (_, id) => ({
    type: "Feature", id: String(id), properties: { id: String(id), country: "AA", tier: "leaf" },
    geometry: { type: "Point", coordinates: [id, 0] },
  }));
  const owner = createPoliticalCollectionOwner({ state,
    constants: { interactiveAggregateTierFilters: { AA: new Set(["aggregate"]) }, highFrequencyCountryDetailWhitelist: new Set(["AA"]) },
    helpers: { getFeatureId: (feature) => feature.id,
      getFeatureCountryCodeNormalized: (feature) => feature.properties.country,
      getDetailTier: (feature) => feature.properties.tier,
      isPoliticalInteractionRenderableFeature: (feature) => feature.properties.interactive !== false },
  });
  const store = createPoliticalGeometryStore();
  const payload = { type: "FeatureCollection", features };
  return { owner, features, state, collection: () => store.compose([payload]), normalized: () => normalized };
}

test("chunked indexed composition yields every 400 features and preserves sync output and sidecar", async () => {
  const f = fixture();
  const collection = f.collection();
  const progress = [];
  const result = await f.owner.composePoliticalFeatureCollectionsChunked(null, collection, null, {
    nowMs: () => 0, yieldControl: async () => { progress.push(f.normalized()); },
  });
  assert.equal(result.status, "prepared");
  assert.deepEqual(progress, [400, 800]);
  assert.equal(result.yieldCount, 2);
  assert.equal(result.maxSliceMs, 0);
  const sync = f.owner.composePoliticalFeatureCollections(null, collection);
  assert.deepEqual(result.collection, sync);
  assert.equal(getPoliticalGeometrySnapshot(result.collection).featureCount, 850);
  assert.deepEqual(getPoliticalGeometrySnapshot(result.collection).changedIds, f.features.map((feature) => feature.id));
  assert.deepEqual(f.state, { marker: "untouched" });
});

test("elapsed budget yields before the feature count limit", async () => {
  const f = fixture(5);
  let time = 0;
  let yields = 0;
  const result = await f.owner.composePoliticalFeatureCollectionsChunked(null, f.collection(), null, {
    nowMs: () => time++, yieldControl: async () => { yields += 1; },
  });
  assert.equal(result.status, "prepared");
  assert.equal(yields, 0, "five 1ms steps stay inside the 6ms budget");
  const larger = fixture(15);
  time = 0;
  const sliced = await larger.owner.composePoliticalFeatureCollectionsChunked(null, larger.collection(), null, {
    nowMs: () => time++, yieldControl: async () => { yields += 1; },
  });
  assert.equal(sliced.yieldCount, 2);
  assert.equal(sliced.maxSliceMs, 6);
});

test("metadata edits absent from source changedIds survive cancellation and retry", async () => {
  const f = fixture();
  f.owner.composePoliticalFeatureCollections(null, f.collection());
  f.features[0].properties.name = "edited in place";
  f.features[0].label = "top level edit";
  const source = f.collection();
  assert.deepEqual(getPoliticalGeometrySnapshot(source).changedIds, []);
  let current = true;
  const cancelled = await f.owner.composePoliticalFeatureCollectionsChunked(null, source, null, {
    nowMs: () => 0, isCurrent: () => current, yieldControl: async () => { current = false; },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.collection, null);
  const retried = await f.owner.composePoliticalFeatureCollectionsChunked(null, source, null, {
    nowMs: () => 0, yieldControl: async () => {},
  });
  assert.equal(retried.collection.features[0].properties.name, "edited in place");
  assert.equal(retried.collection.features[0].label, "top level edit");
  assert.deepEqual(getPoliticalGeometrySnapshot(retried.collection).changedIds, ["0"]);
  const stable = f.owner.composePoliticalFeatureCollections(null, f.collection());
  assert.equal(stable.features[0], retried.collection.features[0]);
  assert.deepEqual(getPoliticalGeometrySnapshot(stable).changedIds, []);
});

test("cancelled before start does no normalization and legacy fallback matches sync", async () => {
  const f = fixture(3);
  const result = await f.owner.composePoliticalFeatureCollectionsChunked(null, f.collection(), null, { isCurrent: () => false });
  assert.equal(result.status, "cancelled");
  assert.equal(f.normalized(), 0);
  const legacy = { type: "FeatureCollection", features: f.features };
  const prepared = await f.owner.composePoliticalFeatureCollectionsChunked(null, legacy);
  assert.deepEqual(prepared.collection, f.owner.composePoliticalFeatureCollections(null, legacy));
});

test("prepared view shares coverage with full input and filters country aggregates only with an interactive leaf", async () => {
  const f = fixture(850);
  for (const feature of f.features) feature.properties.__source = "detail";
  f.features[0].properties.tier = "aggregate";
  f.features[1].properties.interactive = false;
  f.features[2].properties.country = "BB";
  f.features[2].properties.tier = "aggregate";
  const full = { type: "FeatureCollection", globalCoverage: true, features: f.features };
  let yields = 0;
  const prepared = await f.owner.preparePoliticalCollectionViewChunked(full, {
    nowMs: () => 0, yieldControl: async () => { yields += 1; },
  });
  assert.equal(prepared.status, "prepared");
  assert.ok(yields >= 4);
  assert.deepEqual(prepared.interactiveCollection, f.owner.buildInteractiveLandData(full));
  assert.deepEqual(prepared.coverage, f.owner.collectCountryCoverageStats(full.features));
  assert.equal(prepared.interactiveCollection.features.length, 848);
  assert.equal(prepared.interactiveCollection.features.includes(f.features[2]), true);
  assert.equal(prepared.coverage.totalFeatures, 850);
  let current = true;
  const cancelled = await f.owner.preparePoliticalCollectionViewChunked(full, {
    nowMs: () => 0, isCurrent: () => current, yieldControl: async () => { current = false; },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.interactiveCollection, null);
  assert.equal(cancelled.coverage, null);
});

test("prepared view retains collection identity when filtering and camouflage make no changes", async () => {
  const f = fixture(1);
  const full = { type: "FeatureCollection", features: f.features };
  const prepared = await f.owner.preparePoliticalCollectionViewChunked(full);
  assert.equal(prepared.interactiveCollection, full);
  assert.equal(f.owner.buildInteractiveLandData(full), full);
});

test("nonindexed composition yields during normalization rather than after the whole detail map", async () => {
  const f = fixture(850), progress = [];
  const source = { type: "FeatureCollection", globalCoverage: true, features: f.features };
  const result = await f.owner.composePoliticalFeatureCollectionsChunked(null, source, null, {
    nowMs: () => 0, yieldControl: async () => { progress.push(f.normalized()); },
  });
  assert.equal(result.status, "prepared");
  assert.deepEqual(progress.slice(0, 2), [400, 800]);
  assert.ok(result.yieldCount >= 6, "normalization, country indexing and ordered output each yield");
  assert.deepEqual(result.collection, f.owner.composePoliticalFeatureCollections(null, source));
  assert.deepEqual(result.collection.features.map(feature => feature.id), f.features.map(feature => feature.id));
  assert.equal(getPoliticalGeometrySnapshot(result.collection), null, "legacy input keeps the nonindexed contract");
  assert.deepEqual(f.state, { marker: "untouched" });
});

test("cancelled nonindexed normalization retries failed geometry and observes metadata edits", async () => {
  const f = fixture(850);
  let calls = 0, fail = true, current = true;
  globalThis.d3 = { geoArea: feature => {
    calls++;
    if (fail && feature === f.features[0]) throw new Error("transient normalization failure");
    return 1;
  } };
  const source = { type: "FeatureCollection", features: f.features };
  const cancelled = await f.owner.composePoliticalFeatureCollectionsChunked(null, source, null, {
    nowMs: () => 0, isCurrent: () => current, yieldControl: async () => { current = false; },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.collection, null);
  assert.equal(calls, 400, "cancellation stops before normalizing the remaining source");
  fail = false;
  f.features[0].properties.name = "retry failed geometry";
  f.features[1].properties.name = "replace cached metadata";
  const retried = await f.owner.composePoliticalFeatureCollectionsChunked(null, source, null, {
    nowMs: () => 0, yieldControl: async () => {},
  });
  assert.equal(retried.status, "prepared");
  assert.equal(calls, 851, "retry recomputes the failed feature and uncached remainder only");
  assert.equal(retried.collection.features[0].properties.name, "retry failed geometry");
  assert.equal(retried.collection.features[1].properties.name, "replace cached metadata");
  assert.deepEqual(retried.collection, f.owner.composePoliticalFeatureCollections(null, source));
  assert.equal(calls, 851);
});

test("nonindexed country indexing, primary promotion and override passes yield without changing order", async () => {
  const f = fixture(850);
  let detailReads = 0, primaryReads = 0, overrideNormalizations = 0;
  globalThis.d3 = { geoArea: feature => { if (feature.id?.startsWith("override-")) overrideNormalizations++; return 1; } };
  const owner = createPoliticalCollectionOwner({ state: f.state,
    constants: { highFrequencyCountryDetailWhitelist: new Set(["AA"]) },
    helpers: { getFeatureId: feature => feature.id,
      getFeatureCountryCodeNormalized: feature => {
        if (feature.id.startsWith("primary-")) primaryReads++; else detailReads++;
        return feature.properties.country;
      } },
  });
  const primary = { features: f.features.map(feature => ({ ...feature, id: `primary-${feature.id}` })) };
  const detail = { features: f.features };
  const overrides = { features: f.features.map(feature => ({ ...feature, id: `override-${feature.id}`,
    geometry: structuredClone(feature.geometry),
    properties: { ...feature.properties, replace_ids: feature.id === "0" ? ["0", "primary-0"] : [] } })) };
  const progress = [];
  const prepared = await owner.composePoliticalFeatureCollectionsChunked(primary, detail, overrides, {
    nowMs: () => 0, yieldControl: async () => { progress.push({ detailReads, primaryReads, overrideNormalizations }); },
  });
  assert.equal(prepared.status, "prepared");
  assert.ok(progress.some(step => step.detailReads > 0 && step.detailReads < 850));
  assert.ok(progress.some(step => step.primaryReads > 0 && step.primaryReads < 850));
  assert.ok(progress.some(step => step.overrideNormalizations > 0 && step.overrideNormalizations < 850));
  assert.deepEqual(prepared.collection, owner.composePoliticalFeatureCollections(primary, detail, overrides));
  const ids = prepared.collection.features.map(feature => feature.id);
  assert.deepEqual(ids.slice(0, 3), ["1", "2", "3"]);
  assert.equal(ids.includes("0"), false); assert.equal(ids.includes("primary-0"), false);
  assert.deepEqual(ids.slice(-3), ["override-847", "override-848", "override-849"]);
  assert.equal(prepared.collection.features.find(feature => feature.id === "primary-1").properties.__coveragePromoted, true);
  assert.equal(prepared.collection.features.at(-1).properties.__source, "ru_override");
});

test("primary-only override composition yields while building and emitting the base order", async () => {
  const f = fixture(850), progress = [];
  const primary = { features: f.features };
  const overrides = { features: [{ ...f.features[0], id: "override", properties: { replace_ids: ["0"] } }] };
  const prepared = await f.owner.composePoliticalFeatureCollectionsChunked(primary, null, overrides, {
    nowMs: () => 0, yieldControl: async () => { progress.push(f.normalized()); },
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(progress[0], 0, "base indexing yields before the first override normalization");
  assert.ok(prepared.yieldCount >= 4);
  assert.deepEqual(prepared.collection, f.owner.composePoliticalFeatureCollections(primary, null, overrides));
  assert.equal(prepared.collection.features[0].id, "1");
  assert.equal(prepared.collection.features.at(-1).id, "override");
});
