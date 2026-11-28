import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";

function createSourceCountryOwner(state) {
  return createBorderMeshOwner({ state, helpers: {
    getFeatureId: feature => feature.id,
    getFeatureBorderMeshCountryCodeNormalized: feature => feature.properties?.country || "",
    shouldExcludePoliticalInteractionFeature: feature => feature.properties?.excluded,
  } });
}

test("private source country preparation equals synchronous order, classification and exclusions", async () => {
  const features = Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`,
    properties: { country: `C${index % 7}`, __source: index % 3 ? "detail" : "primary", excluded: index % 11 === 0 } }));
  delete features[17]; // Match Array.forEach's sparse-input semantics.
  features[3].properties.__source = "other";
  features[4].properties.country = "";
  const state = { landDataFull: { features }, landData: { features: [{ id: "ignored", properties: { country: "XX" } }] } };
  const owner = createSourceCountryOwner(state);
  const expected = owner.getSourceCountrySets();
  const prepared = await owner.prepareSourceCountrySets();
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.sourceFeatures, features);
  assert.deepEqual([...prepared.sourceCountries.primary], [...expected.primary]);
  assert.deepEqual([...prepared.sourceCountries.detail], [...expected.detail]);
});

test("private source countries prefer nonempty full input and otherwise use the exact land reference", async () => {
  const land = [{ id: "land", properties: { country: "AA" } }];
  const full = [{ id: "full", properties: { country: "BB", __source: "detail" } }];
  const state = { landData: { features: land }, landDataFull: { features: [] } };
  const owner = createSourceCountryOwner(state);
  const fallback = await owner.prepareSourceCountrySets();
  assert.equal(fallback.sourceFeatures, land);
  assert.deepEqual(fallback.sourceCountries, owner.getSourceCountrySets());
});
