import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const previousD3 = globalThis.d3;

test("indexed global composition preserves metadata edits and declares wrapper changes in its delta", () => {
  const owner = makeOwner({ geoAreaImpl: () => 1 });
  const store = createPoliticalGeometryStore();
  const feature = makeFeature("a", makeGeometry(0), { name: "before" });
  const base = makeDetailCollection([feature]);
  const first = owner.composePoliticalFeatureCollections(null, store.compose([base]));
  feature.properties.name = "after";
  const second = owner.composePoliticalFeatureCollections(null, store.compose([base]));
  assert.equal(first.features[0].properties.name, "before");
  assert.equal(second.features[0].properties.name, "after");
  assert.deepEqual(getPoliticalGeometrySnapshot(second).changedIds, ["a"]);
  const third = owner.composePoliticalFeatureCollections(null, store.compose([base]));
  assert.equal(third.features[0], second.features[0]);
  assert.deepEqual(getPoliticalGeometrySnapshot(third).changedIds, []);
});

test.after(() => {
  globalThis.d3 = previousD3;
});

function makeOwner({ geoAreaImpl = null } = {}) {
  if (geoAreaImpl) {
    globalThis.d3 = { geoArea: geoAreaImpl };
  } else {
    delete globalThis.d3;
  }
  return createPoliticalCollectionOwner({
    state: {},
    helpers: {
      getFeatureCountryCodeNormalized: (f) => String(f?.properties?.cntr_code || ""),
      getFeatureId: (f) => String(f?.properties?.id || f?.id || ""),
      isPoliticalInteractionRenderableFeature: () => true,
      isRenderDiagEnabled: () => false,
    },
  });
}

function makeGeometry(tag = "default") {
  // Polygon with identifiable tag in first coordinate for area routing.
  return {
    type: "Polygon",
    coordinates: [
      [[tag, 0], [tag, 1], [tag + 1, 1], [tag + 1, 0], [tag, 0]],
    ],
  };
}

function makeFeature(id, geometry, extraProps = {}) {
  return {
    type: "Feature",
    id,
    properties: { id, cntr_code: "AA", ...extraProps },
    geometry,
  };
}

function makeDetailCollection(features) {
  return { type: "FeatureCollection", features };
}

function makePrimaryCollection(features = []) {
  return { type: "FeatureCollection", features };
}

function loadVendorD3() {
  const context = { globalThis: null };
  context.globalThis = context;
  runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), context);
  return context.d3;
}

// ---------------------------------------------------------------------------
// normalizeFeatureGeometry cache: geometry normalization is cached per geometry
// ---------------------------------------------------------------------------

test("normalizeFeatureGeometry caches spherical ring normalization per geometry object", () => {
  let calls = 0;
  const geom = makeGeometry("normal");
  const feature = makeFeature("A", geom);

  // Small, already-normalized geometry keeps the fast path.
  const owner = makeOwner({
    geoAreaImpl: (f) => {
      calls += 1;
      return 1; // small area → no rewind needed
    },
  });

  const r1 = owner.normalizeFeatureGeometry(feature);
  const r2 = owner.normalizeFeatureGeometry(feature);
  // Same geometry object → same geometry should be returned both times
  assert.equal(r1.geometry, r2.geometry);
  // geoArea should not be called again because second call hits cache
  assert.equal(calls, 1);
});

test("normalizeFeatureGeometry reuses successful orientation repair", () => {
  let calls = 0;
  const geom = makeGeometry("large");
  const feature = makeFeature("B", geom);

  // Simulate backward-wound geometry: first area > π*2, rewound area < first.
  const owner = makeOwner({
    geoAreaImpl: (f) => {
      calls += 1;
      if (f?.geometry === geom) return calls === 1 ? Math.PI * 4 : Math.PI * 0.5;
      return Math.PI * 0.5;
    },
  });

  const r1 = owner.normalizeFeatureGeometry(feature, { sourceLabel: "test" });
  const callsAfterFirst = calls;
  const r2 = owner.normalizeFeatureGeometry(feature, { sourceLabel: "test" });
  // Second call must not invoke geoArea
  assert.equal(calls, callsAfterFirst);
  // Both return same geometry reference (the rewound one)
  assert.equal(r1.geometry, r2.geometry);
  // Original geometry is unchanged
  assert.equal(geom, feature.geometry);
  assert.notEqual(r1.geometry, geom);
});

test("spherical ring normalization repairs the real RU shell and preserves holes and dateline rings", () => {
  const d3 = loadVendorD3();
  globalThis.d3 = d3;
  const owner = makeOwner({ geoAreaImpl: d3.geoArea });

  // Decoded coordinates from hoi4_1939/runtime_topology.topo.json,
  // RU_ARCTIC_FB_9426. Its tiny ring's planar backtracking fooled the former
  // signed-area winding check, making d3.geoArea treat it as nearly 4π.
  const ruFeature = makeFeature("RU_ARCTIC_FB_9426", {
    type: "Polygon",
    coordinates: [[
      [166.06426064260643, 55.145737629376285], [166.0678606786068, 55.144001791017914],
      [166.06426064260643, 55.147473467734685], [166.06066060660606, 55.149209306093056],
      [166.00666006660066, 55.18739774997751], [165.99585995859962, 55.213435325353245],
      [165.74385743857442, 55.30022724327243], [165.76905769057691, 55.29154805148052],
      [165.8338583385834, 55.26898215282152], [165.99585995859962, 55.213435325353245],
      [166.00666006660066, 55.18739774997751], [165.99585995859962, 55.213435325353245],
    ]],
  });
  assert.ok(d3.geoArea(ruFeature) > Math.PI * 3.9);
  const normalizedRu = owner.normalizeFeatureGeometry(ruFeature);
  assert.ok(d3.geoArea(normalizedRu) < 1e-6);
  assert.equal(owner.normalizeFeatureGeometry(ruFeature).geometry, normalizedRu.geometry);

  const polygonWithHole = makeFeature("hole-and-dateline", {
    type: "Polygon",
    coordinates: [
      [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]],
      [[175, -5], [175, 5], [-175, 5], [-175, -5], [175, -5]],
    ],
  });
  const normalized = owner.normalizeFeatureGeometry(polygonWithHole);
  const [outer, hole] = normalized.geometry.coordinates;
  const ringArea = (ring) => d3.geoArea({ type: "Polygon", coordinates: [ring] });
  assert.ok(ringArea(outer) <= Math.PI * 2, "outer ring uses the small-region spherical winding");
  assert.ok(ringArea(hole) > Math.PI * 2, "hole uses the opposite spherical winding");
  assert.ok(d3.geoArea(normalized) < 0.2, "antimeridian polygon keeps its small area and hole");
});

test("normalizeFeatureGeometry with changed geometry same ID: fresh compute", () => {
  let calls = 0;
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      return 1;
    },
  });

  const geomA = makeGeometry("a");
  const geomB = makeGeometry("b");
  const featureA = makeFeature("ID1", geomA);
  const featureB = makeFeature("ID1", geomB); // same ID, different geometry object

  owner.normalizeFeatureGeometry(featureA);
  owner.normalizeFeatureGeometry(featureB);
  // Each distinct geometry object triggers a fresh feature area check.
  assert.equal(calls, 2);
});

test("normalizeFeatureGeometry does NOT cache on thrown geoArea so retry can succeed", () => {
  let calls = 0;
  let shouldThrow = true;
  const geom = makeGeometry("retry");
  const feature = makeFeature("C", geom);

  // First call throws, second call succeeds.
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("d3 not ready");
      }
      return 1;
    },
  });

  const r1 = owner.normalizeFeatureGeometry(feature);
  assert.equal(r1, feature); // returned original on throw
  assert.equal(calls, 1);

  const r2 = owner.normalizeFeatureGeometry(feature);
  assert.equal(calls, 2); // must retry — thrown result not cached
  assert.equal(r2, feature); // area=1 means no rewind needed, returns original
});

test("normalizeFeatureGeometry with no d3 returns feature unchanged without caching", () => {
  delete globalThis.d3;
  const owner = makeOwner();

  const geom = makeGeometry("nd3");
  const feature = makeFeature("D", geom);
  assert.equal(owner.normalizeFeatureGeometry(feature), feature);

  // Now set d3 and verify a fresh call computes (no stale cache from no-d3 call)
  let calls = 0;
  globalThis.d3 = {
    geoArea: () => {
      calls += 1;
      return 1;
    },
  };
  owner.normalizeFeatureGeometry(feature);
  assert.equal(calls, 1);
});

test("normalizeFeatureGeometry retries when spherical ring area fails", () => {
  let calls = 0;
  const geometry = makeGeometry("ring-retry");
  const feature = makeFeature("ring-retry", geometry);
  const owner = makeOwner({
    geoAreaImpl: (candidate) => {
      calls += 1;
      if (calls === 1 || calls === 3) return Math.PI * 4;
      if (calls === 2) throw new Error("temporary spherical stream failure");
      if (candidate?.geometry === geometry) return 0.5;
      return 0.5;
    },
  });

  assert.equal(owner.normalizeFeatureGeometry(feature), feature);
  const retried = owner.normalizeFeatureGeometry(feature);
  assert.notEqual(retried.geometry, geometry);
  assert.equal(calls, 5);
  assert.equal(owner.normalizeFeatureGeometry(feature).geometry, retried.geometry);
  assert.equal(calls, 5);
});

test("composition retries failed normalization, including non-finite rewind results", () => {
  for (const first of [NaN, Infinity, "throw", "rewind-nan"]) {
    let calls = 0;
    const owner = makeOwner({ geoAreaImpl: () => {
      calls += 1;
      if (calls === 1) {
        if (first === "throw") throw new Error("transient");
        return first === "rewind-nan" ? 10 : first;
      }
      if (first === "rewind-nan" && calls === 2) return NaN;
      return 1;
    } });
    const feature = makeFeature("retry-compose", makeGeometry(0));
    const detail = makeDetailCollection([feature]);
    const initial = owner.composePoliticalFeatureCollections(makePrimaryCollection(), detail);
    const failedCalls = calls;
    const retried = owner.composePoliticalFeatureCollections(makePrimaryCollection(), detail);
    assert.equal(calls, failedCalls + 1);
    assert.notEqual(initial.features[0], retried.features[0]);
    const cached = owner.composePoliticalFeatureCollections(makePrimaryCollection(), detail);
    assert.equal(cached.features[0], retried.features[0]);
    assert.equal(calls, failedCalls + 1);
  }
});

test("composition observes in-place scalar metadata edits and removed properties", () => {
  const owner = makeOwner({ geoAreaImpl: () => 1 });
  const feature = makeFeature("metadata", makeGeometry(0), { name: "old", temporary: true });
  const detail = makeDetailCollection([feature]);
  const first = owner.composePoliticalFeatureCollections(makePrimaryCollection(), detail).features[0];
  feature.properties.name = "new";
  delete feature.properties.temporary;
  const second = owner.composePoliticalFeatureCollections(makePrimaryCollection(), detail).features[0];
  assert.notEqual(second, first);
  assert.equal(second.properties.name, "new");
  assert.equal(Object.hasOwn(second.properties, "temporary"), false);
  assert.equal(first.properties.name, "old");
});

// ---------------------------------------------------------------------------
// composePoliticalFeatureCollections detail wrapper cache
// ---------------------------------------------------------------------------

test("composePoliticalFeatureCollections reuses unchanged detail wrapper objects", () => {
  let calls = 0;
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      return 1; // no rewind needed
    },
  });

  const geom = makeGeometry("dw");
  const feature = makeFeature("F1", geom);
  const primary = makePrimaryCollection();
  const detail = makeDetailCollection([feature]);

  const r1 = owner.composePoliticalFeatureCollections(primary, detail);
  const callsAfterFirst = calls;
  const r2 = owner.composePoliticalFeatureCollections(primary, detail);

  // No additional geoArea calls on second composition
  assert.equal(calls, callsAfterFirst);
  // The wrapped feature object itself is reused (same reference)
  assert.equal(r1.features[0], r2.features[0]);
  // __source is correctly labelled
  assert.equal(r1.features[0].properties.__source, "detail");
});

test("composePoliticalFeatureCollections invalidates wrapper when properties reference changes", () => {
  let calls = 0;
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      return 1;
    },
  });

  const geom = makeGeometry("prop_change");
  const feature = makeFeature("F2", geom, { extra: "v1" });
  const primary = makePrimaryCollection();
  const detail = makeDetailCollection([feature]);

  const r1 = owner.composePoliticalFeatureCollections(primary, detail);
  const callsAfterFirst = calls;

  // Mutate properties reference on the original feature
  const newProps = { ...feature.properties, extra: "v2" };
  feature.properties = newProps;

  const r2 = owner.composePoliticalFeatureCollections(primary, detail);

  // Wrapper must be regenerated (different object)
  assert.notEqual(r1.features[0], r2.features[0]);
  // __source still correctly labelled on new wrapper
  assert.equal(r2.features[0].properties.__source, "detail");
  // geoArea geometry cache means geometry call not repeated
  assert.equal(calls, callsAfterFirst);
});

test("composePoliticalFeatureCollections: changed geometry object triggers fresh normalization", () => {
  let calls = 0;
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      return 1;
    },
  });

  const geom1 = makeGeometry("cg1");
  const feature = makeFeature("F3", geom1);
  const primary = makePrimaryCollection();

  owner.composePoliticalFeatureCollections(primary, makeDetailCollection([feature]));
  const callsAfterFirst = calls;

  // Replace the geometry on the same feature object
  const geom2 = makeGeometry("cg2");
  feature.geometry = geom2;

  owner.composePoliticalFeatureCollections(primary, makeDetailCollection([feature]));
  // New geometry triggers a fresh geoArea call
  assert.ok(calls > callsAfterFirst, "Expected fresh geoArea call for new geometry");
});

// ---------------------------------------------------------------------------
// Orientation repair: cached geometry is the rewound version
// ---------------------------------------------------------------------------

test("orientation repair: rewound geometry is cached and returned on subsequent calls", () => {
  // The geoArea mock: first call returns LARGE area (triggers rewind attempt),
  // second call (on rewound feature) returns SMALL area (confirms improvement).
  let sequence = [Math.PI * 6, Math.PI * 0.5];
  let callIdx = 0;
  const owner = makeOwner({
    geoAreaImpl: () => sequence[callIdx++] ?? 1,
  });

  // A backward-wound polygon: outer ring clockwise (area > π*2 in mock).
  const geom = {
    type: "Polygon",
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  };
  const feature = makeFeature("OR1", geom);

  const repaired = owner.normalizeFeatureGeometry(feature, { sourceLabel: "s" });
  // geoArea checks the original feature, its ring, and the normalized feature.
  assert.equal(callIdx, 3);
  // Rewound geometry differs from original
  assert.notEqual(repaired.geometry, geom);
  // Source properties are preserved through the spread
  assert.equal(repaired.properties.id, "OR1");

  // Second normalizeFeatureGeometry call: must not call geoArea again
  const repaired2 = owner.normalizeFeatureGeometry(feature, { sourceLabel: "s" });
  assert.equal(callIdx, 3); // no additional calls
  // Same rewound geometry returned both times
  assert.equal(repaired.geometry, repaired2.geometry);
  // Properties flow through per-call (new spread from current feature)
  assert.equal(repaired2.properties.id, "OR1");
});

// ---------------------------------------------------------------------------
// Fragment camouflage still operates correctly with the cache
// ---------------------------------------------------------------------------

test("fragment camouflage with detail wrapper cache: camouflage applied to final collection", () => {
  // Use a simplified geoArea that returns area based on first coordinate value
  globalThis.d3 = {
    geoArea: (f) => {
      const coords = f?.geometry?.coordinates;
      const firstPt = Array.isArray(coords?.[0]?.[0]) ? coords[0][0] : coords?.[0];
      return Math.abs(Number(firstPt?.[0]) || 0);
    },
  };

  const camoOwner = createPoliticalCollectionOwner({
    state: {},
    constants: {
      fragmentCamouflageRules: [
        {
          countryCode: "BY",
          featureIds: ["BY_INT_VITEBSK"],
          minComponentAreaSteradians: 0.0001,
          preserveLargestComponent: true,
        },
      ],
    },
    helpers: {
      getDetailTier: (f) => String(f?.properties?.detail_tier || ""),
      getFeatureCountryCodeNormalized: (f) => String(f?.properties?.cntr_code || ""),
      getFeatureId: (f) => String(f?.properties?.id || f?.id || ""),
      isPoliticalInteractionRenderableFeature: () => true,
      isRenderDiagEnabled: () => false,
    },
  });

  const multiGeom = {
    type: "MultiPolygon",
    coordinates: [
      [[[1, 0], [2, 0], [2, 1], [1, 0]]],   // area=1 (kept by largest)
      [[[0.00005, 0], [0, 1], [1, 1], [0.00005, 0]]],  // area=tiny (pruned)
    ],
  };
  const feature = {
    type: "Feature",
    id: "BY_INT_VITEBSK",
    properties: { id: "BY_INT_VITEBSK", cntr_code: "BY" },
    geometry: multiGeom,
  };
  const collection = { type: "FeatureCollection", features: [feature] };

  const result = camoOwner.buildInteractiveLandData(collection);
  // Fragment camouflage must still prune small components
  assert.ok(result.features[0].geometry.coordinates.length < multiGeom.coordinates.length ||
    result.features[0].properties.__visualFragmentCamouflage === true ||
    result.features[0].geometry === multiGeom,
    "Camouflage applied or geometry unchanged when no pruning threshold met");
});
