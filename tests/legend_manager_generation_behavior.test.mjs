import test from "node:test";
import assert from "node:assert/strict";
import { LegendManager } from "../js/core/legend_manager.js";

function rectangleFeature(id, owner, width, height, continent = "europe") {
  return {
    type: "Feature",
    id,
    properties: {
      id,
      ISO_A3: owner,
      continent_id: continent,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
        [0, 0],
      ]],
    },
  };
}

function createLegendState(features) {
  return {
    currentLanguage: "en",
    colors: {},
    sovereignBaseColors: {},
    sovereigntyByFeatureId: Object.fromEntries(features.map((feature) => [feature.id, feature.properties.ISO_A3])),
    landData: { type: "FeatureCollection", features },
    resolvedDefaultCountryPalette: {
      GER: "#111111",
      RK1: "#222222",
      USA: "#333333",
      CHI: "#555555",
    },
    scenarioCountriesByTag: {
      GER: { tag: "GER", display_name_zh: "大日耳曼国", display_name_en: "Germany" },
      RK1: { tag: "RK1", display_name_zh: "辖区一", parent_owner_tag: "GER", entry_kind: "scenario_subject" },
      USA: { tag: "USA", display_name_zh: "美国" },
      CHI: { tag: "CHI", display_name_zh: "中国", continent_id: "asia" },
    },
  };
}

test("realm area generation folds subject land into the parent owner", () => {
  const state = createLegendState([
    rectangleFeature("subject", "RK1", 5, 5),
    rectangleFeature("parent", "GER", 1, 1),
    rectangleFeature("other", "USA", 2, 2),
  ]);

  const generation = LegendManager.generate(state, {
    mode: "realm-area",
    useModernMajorOrder: false,
  });

  assert.equal(generation.entries[0].code, "GER");
  assert.deepEqual(new Set(generation.entries[0].ownerCodes), new Set(["GER", "RK1"]));
});

test("continent mode filters candidates before area sorting", () => {
  const state = createLegendState([
    rectangleFeature("europe", "GER", 9, 9, "europe"),
    rectangleFeature("asia", "CHI", 1, 1, "asia"),
  ]);

  const generation = LegendManager.generate(state, {
    mode: "continent-area",
    continent: "asia",
  });

  assert.equal(generation.entries.length, 1);
  assert.equal(generation.entries[0].code, "CHI");
});
