import test from "node:test";
import assert from "node:assert/strict";
import { createCountryFillPaletteOwner } from "../js/core/renderer/country_fill_palette_owner.js";

function harness() {
  const state = { colorRevision: 0, activeScenarioId: "tno" };
  const features = [
    { id: "a", country: "AA", color: "red" },
    { id: "b", country: "AA", color: "blue" },
    { id: "c", country: "AA", color: "blue" },
    { id: "d", country: "BB", color: "green" },
  ];
  const owner = createCountryFillPaletteOwner({
    state, getFeatures: () => features,
    getFeatureId: (feature) => feature.id,
    resolveCountryCode: (feature) => feature.country,
    isExcluded: (feature) => feature.excluded,
    resolveColor: feature => feature.color,
  });
  return {
    owner, features,
    edit: (ids) => { state.colorRevision += 1; owner.notifyColorsChanged(ids); },
  };
}

test("initial build selects the dominant color of each country", () => {
  const h = harness();
  assert.deepEqual([...h.owner.getDominantFillColorMap()], [["AA", "blue"], ["BB", "green"]]);
});

test("the first feature breaks a tie between country colors", () => {
  const h = harness(); h.owner.getDominantFillColorMap();
  h.features[2].color = null; h.edit(["c"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "red");
});
