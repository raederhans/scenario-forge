import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

const previousD3 = globalThis.d3;

test.after(() => {
  globalThis.d3 = previousD3;
});

function makeOwner({ geoAreaImpl }) {
  globalThis.d3 = { geoArea: geoAreaImpl };
  return createPoliticalCollectionOwner({ state: {}, helpers: { getFeatureId: feature => feature.id } });
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

function loadVendorD3() {
  const context = { globalThis: null };
  context.globalThis = context;
  runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), context);
  return context.d3;
}

test("spherical ring normalization repairs the real RU shell and preserves holes and dateline rings", () => {
  const d3 = loadVendorD3();
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

test("normalizeFeatureGeometry retries when spherical ring area fails", () => {
  let calls = 0;
  const geometry = makeGeometry("ring-retry");
  const feature = makeFeature("ring-retry", geometry);
  const owner = makeOwner({
    geoAreaImpl: () => {
      calls += 1;
      if (calls === 1 || calls === 3) return Math.PI * 4;
      if (calls === 2) throw new Error("temporary spherical stream failure");
      return 0.5;
    },
  });

  assert.equal(owner.normalizeFeatureGeometry(feature), feature);
  const retried = owner.normalizeFeatureGeometry(feature);
  assert.notEqual(retried.geometry, geometry);
  assert.equal(owner.normalizeFeatureGeometry(feature).geometry, retried.geometry);
});
