import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

const previousD3 = globalThis.d3;

const polygonWithArea = area => [[[area, 0], [area, 0], [area, 0], [area, 0]]];

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

test("fragment camouflage prunes configured small multipolygon components without mutating source", async () => {
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

  assert.equal(interactiveFeature.geometry.coordinates.length, 1);
  assert.equal(fullCollection.features[0].geometry.coordinates.length, 3);
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
