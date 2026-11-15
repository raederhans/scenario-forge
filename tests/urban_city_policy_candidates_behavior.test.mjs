import test from "node:test";
import assert from "node:assert/strict";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";

function fixture(compare = cityPolicy.compareCityRevealEntries) {
  const state = { width: 400, height: 300, cityLayerRevision: 0,
    sovereigntyByFeatureId: { us: "USA", fr: "FRA", other: "OTHER" },
    scenarioCountriesByTag: {}, urbanData: null };
  const collection = { features: Array.from({ length: 6400 }, (_, index) => ({
    id: `city-${index}`,
    geometry: { type: "Point", coordinates: [(index % 80) * 32 - 1280, Math.floor(index / 80) * 32 - 1280] },
    properties: { city_id: `city-${index}`, __city_host_feature_id: ["us", "fr", "other"][index % 3],
      __city_population: (index % 17) * 100000, __city_base_tier: ["major", "regional", "minor"][index % 3],
      __city_is_capital: index % 19 === 0 },
  })) };
  let anchors = 0;
  let shift = 0;
  const screenPoint = (anchor, transform) => [anchor[0] * transform.k + transform.x, anchor[1] * transform.k + transform.y];
  const owner = createUrbanCityPolicyOwner({ state, caches: { urbanFeatureIndexCache: {} }, helpers: {
    ...cityPolicy,
    compareCityRevealEntries: compare,
    defaultCityCountryClassRank: 2, defaultCityCountryTierRank: 2,
    getCityAnchor: feature => { anchors++; return [feature.geometry.coordinates[0] + shift, feature.geometry.coordinates[1]]; },
    getCityFeatureKey: feature => feature.id,
    getCityInterpolatedRevealBucket: (entry, scale) => cityPolicy.getCityRevealBucket(entry, cityPolicy.getCityRevealPhase(scale).id),
    getCityScreenPoint: screenPoint,
    getCityViewportCenterDistanceNorm: entry => Math.hypot(entry.screenPoint[0] - state.width / 2, entry.screenPoint[1] - state.height / 2),
    isCityAnchorInViewport: (anchor, { transform, padding }) => {
      const [x, y] = screenPoint(anchor, transform);
      return x >= -padding && x <= state.width + padding && y >= -padding && y <= state.height + padding;
    },
  } });
  return { state, collection, owner, anchors: () => anchors, moveProjection: () => { shift += 500; } };
}

const config = { showLabels: true, labelMinZoom: 1.45 };
function assertSamePlan(indexed, full) {
  const { visitedCandidateCount: indexedCount, ...indexedOutput } = indexed;
  const { visitedCandidateCount: fullCount, ...fullOutput } = full;
  assert.deepEqual(indexedOutput, fullOutput);
  assert.ok(indexedCount < fullCount / 4, `${indexedCount} candidates of ${fullCount}`);
}

test("projected grid preserves full-scan results across viewports, quotas and stable ties", () => {
  for (const compare of [cityPolicy.compareCityRevealEntries, () => 0]) {
    const f = fixture(compare);
    const projection = {};
    for (const transform of [
      { x: 0, y: 0, k: 1.9 }, { x: 139, y: -241, k: 1.9 },
      { x: -800, y: 700, k: 3 }, { x: 48, y: 48, k: 8 },
      { x: 100000, y: 100000, k: 1 },
    ]) {
      const before = f.anchors();
      const indexed = f.owner.buildCityRevealPlan(f.collection, transform.k, transform, config, { projection });
      const visits = f.anchors() - before;
      assert.equal(visits, indexed.visitedCandidateCount + (before === 0 ? f.collection.features.length : 0));
      const full = f.owner.buildCityRevealPlan(f.collection, transform.k, transform, config);
      assertSamePlan(indexed, full);
      if (transform.x === 0) assert.ok(indexed.markerEntries.length > 0);
    }
  }
});

test("grid rebuilds on data revision, feature replacement and projection generation", () => {
  const f = fixture();
  let projection = {};
  const transform = { x: 0, y: 0, k: 3 };
  const build = () => f.owner.buildCityRevealPlan(f.collection, 3, transform, config, { projection });
  build();
  for (const change of [
    () => { f.moveProjection(); markProjectionGeometryChanged(projection); },
    () => { f.collection.features[0].geometry.coordinates = [0, 0]; f.state.cityLayerRevision++; },
    () => { f.collection.features = [...f.collection.features]; },
    () => { projection = {}; },
  ]) {
    change();
    const before = f.anchors();
    const indexed = build();
    assert.equal(f.anchors() - before, f.collection.features.length + indexed.visitedCandidateCount);
    assertSamePlan(indexed, f.owner.buildCityRevealPlan(f.collection, 3, transform, config));
  }
});

test("cooperative grid preparation preserves results and cancellation leaves no partial index", async () => {
  const f = fixture();
  const projection = {};
  const transform = { x: 0, y: 0, k: 3 };
  let yields = 0;
  const cancelled = await f.owner.prepareCityRevealPlan(f.collection, 3, transform, config, {
    projection, workBatch: 64, nowMs: () => 0,
    yieldControl: async () => { yields++; }, isCurrent: () => yields < 3,
  });
  assert.equal(cancelled, null);
  const before = f.anchors();
  const prepared = await f.owner.prepareCityRevealPlan(f.collection, 3, transform, config, {
    projection, workBatch: 64, nowMs: () => 0, yieldControl: async () => {},
  });
  assert.equal(f.anchors() - before, f.collection.features.length + prepared.visitedCandidateCount);
  assertSamePlan(prepared, f.owner.buildCityRevealPlan(f.collection, 3, transform, config));
});
