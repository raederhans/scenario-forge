import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { fragmentCamouflageRules } from "../js/core/country_feature_policies.js";

const previousD3 = globalThis.d3;

function polygonWithArea(area) {
  return [
    [
      [area, 0],
      [area, 0],
      [area, 0],
      [area, 0],
    ],
  ];
}

function createOwner() {
  return createPoliticalCollectionOwner({
    state: {},
    constants: {
      fragmentCamouflageRules: [
        {
          countryCode: "BY",
          featureIds: ["BY_INT_VITEBSK"],
          minComponentAreaSteradians: 0.00000125,
          preserveLargestComponent: true,
        },
      ],
    },
    helpers: {
      getDetailTier: (feature) => String(feature?.properties?.detail_tier || ""),
      getFeatureCountryCodeNormalized: (feature) =>
        String(feature?.properties?.cntr_code || "").trim().toUpperCase(),
      getFeatureId: (feature) => String(feature?.properties?.id || feature?.id || ""),
      isPoliticalInteractionRenderableFeature: () => true,
    },
  });
}

test.after(() => {
  globalThis.d3 = previousD3;
});

test("fragment camouflage prunes configured small multipolygon components without mutating source", () => {
  globalThis.d3 = {
    geoArea: (feature) => Math.abs(Number(feature?.geometry?.coordinates?.[0]?.[0]?.[0]) || 0),
  };
  const feature = {
    id: "BY_INT_VITEBSK",
    type: "Feature",
    properties: {
      id: "BY_INT_VITEBSK",
      cntr_code: "BY",
      detail_tier: "adm2_hybrid",
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        polygonWithArea(0.00001),
        polygonWithArea(0.0000005),
        polygonWithArea(0.0000002),
      ],
    },
  };
  const fullCollection = {
    type: "FeatureCollection",
    features: [feature],
  };

  const owner = createOwner();
  const interactiveCollection = owner.buildInteractiveLandData(fullCollection);
  const interactiveFeature = interactiveCollection.features[0];

  assert.equal(interactiveFeature.properties.id, "BY_INT_VITEBSK");
  assert.equal(interactiveFeature.geometry.coordinates.length, 1);
  assert.equal(interactiveFeature.properties.__visualFragmentCamouflage, true);
  assert.equal(interactiveFeature.properties.__visualFragmentPrunedCount, 2);
  assert.equal(fullCollection.features[0].geometry.coordinates.length, 3);
});

test("fragment camouflage leaves unmatched countries unchanged", () => {
  globalThis.d3 = {
    geoArea: (feature) => Math.abs(Number(feature?.geometry?.coordinates?.[0]?.[0]?.[0]) || 0),
  };
  const feature = {
    id: "UA_INT_EXAMPLE",
    type: "Feature",
    properties: {
      id: "UA_INT_EXAMPLE",
      cntr_code: "UA",
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        polygonWithArea(0.00001),
        polygonWithArea(0.0000002),
      ],
    },
  };
  const owner = createOwner();
  const fullCollection = { type: "FeatureCollection", features: [feature] };

  assert.equal(owner.buildInteractiveLandData(fullCollection), fullCollection);
});

test("detail composition normalizes large-area geometry before tagging source", () => {
  globalThis.d3 = {
    geoArea: (input) => {
      // Production normalization measures both Features and a standalone
      // Polygon ring, so this mock accepts either geoJSON shape.
      const geometry = input?.geometry || input;
      const coordinates = geometry?.coordinates;
      const firstPolygon = geometry?.type === "MultiPolygon" ? coordinates?.[0] : coordinates;
      const secondPointX = Number(firstPolygon?.[0]?.[1]?.[0]);
      return secondPointX === 1 ? Math.PI * 4 : 1;
    },
  };
  const detailPolygonFeature = {
    id: "AA_DETAIL",
    type: "Feature",
    properties: {
      id: "AA_DETAIL",
      cntr_code: "AA",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  };
  const detailMultiPolygonFeature = {
    id: "BB_DETAIL",
    type: "Feature",
    properties: {
      id: "BB_DETAIL",
      cntr_code: "BB",
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      ],
    },
  };
  const owner = createOwner();
  const result = owner.composePoliticalFeatureCollections(
    { type: "FeatureCollection", features: [] },
    { type: "FeatureCollection", features: [detailPolygonFeature, detailMultiPolygonFeature] }
  );

  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].properties.__source, "detail");
  assert.equal(result.features[1].properties.__source, "detail");
  assert.deepEqual(result.features[0].geometry.coordinates[0][1], [0, 1]);
  assert.deepEqual(result.features[1].geometry.coordinates[0][0][1], [0, 1]);
  assert.deepEqual(detailPolygonFeature.geometry.coordinates[0][1], [1, 0]);
  assert.deepEqual(detailMultiPolygonFeature.geometry.coordinates[0][0][1], [1, 0]);
});

test("fragment camouflage prunes real Belarus runtime components with d3 area", async () => {
  const d3Source = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
  vm.runInThisContext(d3Source);
  const runtimePolitical = JSON.parse(
    await readFile(
      new URL("../data/europe_topology.runtime_political_v1.political.geojson", import.meta.url),
      "utf8"
    )
  );
  const feature = runtimePolitical.features.find((item) =>
    item?.properties?.id === "BY_INT_VITEBSK"
  );
  assert.ok(feature);

  const owner = createOwner();
  const fullCollection = { type: "FeatureCollection", features: [feature] };
  const interactiveCollection = owner.buildInteractiveLandData(fullCollection);
  const interactiveFeature = interactiveCollection.features[0];

  assert.equal(feature.geometry.coordinates.length, 29);
  assert.equal(interactiveFeature.geometry.coordinates.length, 2);
  assert.equal(interactiveFeature.properties.__visualFragmentPrunedCount, 27);
});

test("fragment camouflage policy ids exist and configured real samples are pruned", async () => {
  const d3Source = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
  vm.runInThisContext(d3Source);
  const runtimePolitical = JSON.parse(
    await readFile(
      new URL("../data/europe_topology.runtime_political_v1.political.geojson", import.meta.url),
      "utf8"
    )
  );
  const featuresById = new Map(
    runtimePolitical.features.map((feature) => [
      String(feature?.properties?.id || feature?.id || ""),
      feature,
    ])
  );
  const configuredIds = fragmentCamouflageRules.flatMap((rule) => rule.featureIds || []);

  configuredIds.forEach((featureId) => {
    assert.ok(featuresById.has(featureId), `${featureId} must exist in runtime political data`);
    assert.equal(featuresById.get(featureId).geometry.type, "MultiPolygon");
  });

  const owner = createPoliticalCollectionOwner({
    state: {},
    constants: { fragmentCamouflageRules },
    helpers: {
      getDetailTier: (feature) => String(feature?.properties?.detail_tier || ""),
      getFeatureCountryCodeNormalized: (feature) =>
        String(feature?.properties?.cntr_code || "").trim().toUpperCase(),
      getFeatureId: (feature) => String(feature?.properties?.id || feature?.id || ""),
      isPoliticalInteractionRenderableFeature: () => true,
    },
  });
  const fullCollection = {
    type: "FeatureCollection",
    features: configuredIds.map((featureId) => featuresById.get(featureId)),
  };
  const interactiveCollection = owner.buildInteractiveLandData(fullCollection);
  const prunedCountsById = new Map(
    interactiveCollection.features.map((feature) => [
      String(feature?.properties?.id || feature?.id || ""),
      Number(feature?.properties?.__visualFragmentPrunedCount || 0),
    ])
  );

  assert.equal(interactiveCollection.features.length, configuredIds.length);
  assert.equal(prunedCountsById.get("BY_INT_VITEBSK"), 27);
  assert.equal(prunedCountsById.get("RU_RAY_50074027B24884281398381"), 1);
});
