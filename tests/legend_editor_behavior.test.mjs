import assert from "node:assert/strict";
import test from "node:test";
import { LegendManager } from "../js/core/legend_manager.js";
import { filterLegendEditorEntries } from "../js/core/legend_state_normalizers.js";

const colorAt = index => "#" + index.toString(16).padStart(6, "0");

test("editor ranks every color by painted area independently of overlay order and limit", () => {
  const colors = {};
  const landIndex = new Map();
  for (let i = 1; i <= 35; i++) {
    const id = "land-" + i;
    colors[id] = colorAt(i);
    landIndex.set(id, { geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [i, 1], [i, 0], [0, 0]]] } });
  }
  const state = { colors, landIndex, legendColorOrder: [colorAt(2), colorAt(1)] };
  const ranked = Object.values(colors).reverse();
  assert.deepEqual(LegendManager.getEditorEntries(state).map(entry => entry.color), ranked);
  assert.deepEqual(LegendManager.getUniqueColors(state), [colorAt(2), colorAt(1), ...Object.values(colors).slice(2, 15)]);
  LegendManager.updateConfig(state, { maxItems: 1 });
  assert.deepEqual(LegendManager.getUniqueColors(state), [colorAt(2)]);
  assert.equal(LegendManager.getEditorEntries(state).length, 35);
});

test("without areas the editor ranks by feature count before taking 200 colors", () => {
  const colors = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ["f" + i, colorAt(i)]));
  colors.extra = colorAt(200);
  const entries = LegendManager.getEditorEntries({ colors });
  assert.equal(entries.length, 200);
  assert.equal(entries[0].color, colorAt(200));
  assert.ok(!entries.some(entry => entry.color === colorAt(199)));
});

test("editor resolves painted scenario identities, filters by either name and saves the country label", () => {
  const shared = "#112233";
  const state = {
    activeScenarioId: "editor",
    colors: { annexed: shared, retained: shared, other: shared, custom: "#abcdef" },
    scenarioBaselineOwnersByFeatureId: { annexed: "CCC", retained: "BBB", other: "BBB", custom: "BBB" },
    sovereignBaseColors: { AA: shared, AAA: shared, BBB: shared, CCC: "#887766" },
    scenarioCountriesByTag: { AAA: { display_name_en: "Alpha" }, BBB: { display_name_en: "Beta" }, CCC: {} },
    legendLabels: { [shared]: "Northern alliance" },
  };
  const entries = LegendManager.getEditorEntries(state);
  const [country, custom] = entries;
  assert.deepEqual(country, { color: shared, countryName: "Beta" });
  assert.equal(custom.countryName, "");
  for (const query of [" Alliance ", "ETA"]) {
    assert.deepEqual(filterLegendEditorEntries(entries, state.legendLabels, query), [country]);
  }
  assert.deepEqual(filterLegendEditorEntries(entries, state.legendLabels, "unmatched"), []);
  LegendManager.setLabel(country.color, country.countryName, state);
  assert.equal(state.legendLabels[shared], "Beta");
  state.colors = { annexed: shared };
  assert.equal(LegendManager.getEditorEntries(state)[0].countryName, "Alpha");
});
