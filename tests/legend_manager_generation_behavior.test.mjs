import test from "node:test";
import assert from "node:assert/strict";

import { LegendManager } from "../js/core/legend_manager.js";
import { state as runtimeState } from "../js/core/state.js";

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

function createLegendState(features, overrides = {}) {
  return {
    currentLanguage: "en",
    colors: {},
    countryBaseColors: {},
    sovereignBaseColors: {},
    sovereigntyByFeatureId: Object.fromEntries(features.map((feature) => [feature.id, feature.properties.ISO_A3])),
    landData: { type: "FeatureCollection", features },
    resolvedDefaultCountryPalette: {
      GER: "#111111",
      RK1: "#222222",
      USA: "#333333",
      JAP: "#444444",
      CHI: "#555555",
      AST: "#666666",
    },
    scenarioCountriesByTag: {
      GER: { tag: "GER", display_name_zh: "大日耳曼国", display_name_en: "Germany" },
      RK1: { tag: "RK1", display_name_zh: "辖区一", parent_owner_tag: "GER", entry_kind: "scenario_subject" },
      USA: { tag: "USA", display_name_zh: "美国" },
      CHI: { tag: "CHI", display_name_zh: "中国", continent_id: "asia" },
      AST: { tag: "AST", display_name: "Australia", display_name_en: "Australia", continent_id: "oceania" },
    },
    ...overrides,
  };
}

test.afterEach(() => {
  runtimeState.currentLanguage = "en";
});

test("direct area generation orders owners by controlled land area", () => {
  const state = createLegendState([
    rectangleFeature("small", "USA", 1, 1),
    rectangleFeature("large", "GER", 4, 4),
  ]);

  const generation = LegendManager.generate(state, {
    mode: "direct-area",
    useModernMajorOrder: false,
  });

  assert.equal(generation.entries[0].code, "GER");
  assert.equal(generation.entries[0].label, "Germany");
});

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

test("generated legend reads displayed owner colors and preserves map colors", () => {
  const state = createLegendState([
    rectangleFeature("germany", "GER", 3, 3),
  ], {
    colors: { germany: "#abcdef" },
    sovereignBaseColors: { GER: "#101010" },
    countryBaseColors: { GER: "#202020" },
  });
  const generation = LegendManager.generate(state, { mode: "direct-area" });
  const owners = LegendManager.applyGeneratedLegend(state, generation);

  assert.deepEqual(owners, ["GER"]);
  assert.equal(generation.entries[0].color, "#abcdef");
  assert.equal(state.sovereignBaseColors.GER, "#101010");
  assert.equal(state.countryBaseColors.GER, "#202020");
  assert.deepEqual(state.legendColorOrder, ["#abcdef"]);
  assert.deepEqual(LegendManager.getUniqueColors(state), ["#abcdef"]);
  assert.equal(state.legendLabels[generation.entries[0].color], "Germany");
});

test("generated legend reads quick swatch objects as colors", () => {
  const state = createLegendState([
    rectangleFeature("germany", "GER", 3, 3),
  ], {
    resolvedDefaultCountryPalette: {},
    paletteQuickSwatches: [{ color: "#abcdef" }],
  });
  const generation = LegendManager.generate(state, { mode: "direct-area" });
  const owners = LegendManager.applyGeneratedLegend(state, generation);

  assert.deepEqual(owners, ["GER"]);
  assert.equal(generation.entries[0].color, "#abcdef");
  assert.deepEqual(state.legendColorOrder, ["#abcdef"]);
  assert.equal(Object.hasOwn(state.sovereignBaseColors, "[object object]"), false);
});

test("fresh legend state does not inherit labels or config from another project", () => {
  const previousProject = createLegendState([]);
  LegendManager.setLabel("#abcdef", "Previous Project", previousProject);
  LegendManager.updateConfig(previousProject, {
    mode: "realm-area",
    continent: "asia",
    useModernMajorOrder: true,
  });

  const freshProject = createLegendState([]);
  LegendManager.ensureLegendState(freshProject);

  assert.deepEqual(freshProject.legendLabels, {});
  assert.deepEqual(freshProject.legendConfig, LegendManager.getDefaultConfig());
  assert.deepEqual(LegendManager.getLabels(), {});
});

test("legend control state supports close collapse and bounded drag position", () => {
  const state = createLegendState([]);

  const moved = LegendManager.updateControlState(state, {
    visible: false,
    collapsed: true,
    xRatio: 2,
    yRatio: -1,
    width: 999,
    height: 20,
    opacity: 2,
  });
  const limits = LegendManager.getControlLimits();

  assert.equal(moved.visible, false);
  assert.equal(moved.collapsed, true);
  assert.equal(moved.xRatio, 1);
  assert.equal(moved.yRatio, 0);
  assert.equal(moved.width, limits.maxWidth);
  assert.equal(moved.height, limits.minHeight);
  assert.equal(moved.opacity, limits.maxOpacity);
  assert.deepEqual(state.legendControl, moved);

  const resized = LegendManager.updateControlState(state, {
    width: 1,
    height: 9999,
    opacity: 0.1,
  });
  assert.equal(resized.width, limits.minWidth);
  assert.equal(resized.height, limits.maxHeight);
  assert.equal(resized.opacity, limits.minOpacity);

  const shown = LegendManager.showControl(state);
  assert.equal(shown.visible, true);
  assert.equal(shown.collapsed, false);
});

test("generated legend labels follow the current map language from geo locales", () => {
  runtimeState.currentLanguage = "zh";
  const state = createLegendState([
    rectangleFeature("australia", "AST", 3, 3, "oceania"),
    rectangleFeature("germany", "GER", 2, 2, "europe"),
  ], {
    currentLanguage: "zh",
    locales: {
      geo: {
        Australia: { en: "Australia", zh: "澳大利亚" },
        Germany: { en: "Germany", zh: "德国" },
      },
    },
  });

  const generation = LegendManager.generate(state, {
    mode: "direct-area",
    useModernMajorOrder: false,
  });

  assert.deepEqual(
    generation.entries.map((entry) => entry.label),
    ["澳大利亚", "大日耳曼国"],
  );
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


test("unique colors reads each feature value once and preserves preferred order", () => {
  let reads = 0;
  const colors = {};
  ["#ff0000", "#00ff00", "#ff0000", "#0000ff"].forEach((value, index) => {
    Object.defineProperty(colors, String(index), { enumerable: true, get() { reads++; return value; } });
  });
  const appState = { colors, legendColorOrder: ["#0000ff"], legendConfig: { maxItems: 15 } };
  assert.deepEqual(LegendManager.getUniqueColors(appState), ["#0000ff", "#ff0000", "#00ff00"]);
  assert.equal(reads, 4);
});
