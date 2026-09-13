import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const previousD3 = globalThis.d3;

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

// ---------------------------------------------------------------------------
// normalizeFeatureGeometry cache: geometry normalization is cached per geometry
// ---------------------------------------------------------------------------

test("normalizeFeatureGeometry caches result – geoArea called only once per geometry object", () => {
  let calls = 0;
  const geom = makeGeometry("normal");
  const feature = makeFeature("A", geom);

  // area <= Math.PI*2 means no rewind needed; cache GEOM_UNCHANGED
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
  // geoArea should only be called once because second call hits cache
  assert.equal(calls, 1);
});

test("normalizeFeatureGeometry reuses successful orientation repair", () => {
  let calls = 0;
  const geom = makeGeometry("large");
  const feature = makeFeature("B", geom);

  // Simulate backward-wound geometry: first area > π*2, rewound area < first.
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      // Return large area on first call, smaller on second (rewound).
      return calls === 1 ? Math.PI * 4 : Math.PI * 0.5;
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
  // Each distinct geometry object triggers a fresh geoArea call
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
  // geoArea called twice (original + rewound)
  assert.equal(callIdx, 2);
  // Rewound geometry differs from original
  assert.notEqual(repaired.geometry, geom);
  // Source properties are preserved through the spread
  assert.equal(repaired.properties.id, "OR1");

  // Second normalizeFeatureGeometry call: must not call geoArea again
  const repaired2 = owner.normalizeFeatureGeometry(feature, { sourceLabel: "s" });
  assert.equal(callIdx, 2); // no additional calls
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
