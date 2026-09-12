import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPaletteLibraryGroups,
  createPaletteLibraryPanelController,
  normalizePaletteLibraryGroupingMode,
  resolveAdaptivePaletteLibraryHeight,
  resolvePaletteLibraryEntryRegion,
  selectPalettePaintColor,
} from "../js/ui/toolbar/palette_library_panel.js";
import { state } from "../js/core/state.js";
import { hydrateStartupPaletteState } from "../js/core/state/color_state.js";
import {
  captureScenarioPaletteState,
  commitScenarioPaletteState,
  restoreScenarioPaletteState,
} from "../js/core/state/actions/scenario_palette_actions.js";

function patchPaletteFixture(patch) {
  commitScenarioPaletteState(state, {
    ...captureScenarioPaletteState(state).values,
    ...patch,
  });
}

test("source select replaces startup fallback options when palette catalog arrives without rebuilding unchanged options", () => {
  const paletteSnapshot = captureScenarioPaletteState(state);
  const paletteRegistry = state.paletteRegistry;
  let selected = "";
  let replacements = 0;
  const select = {
    options: [{ value: "TNO (The New Order)", textContent: "TNO (The New Order)" }],
    ownerDocument: { createElement: () => ({ value: "", textContent: "" }) },
    replaceChildren(...options) { this.options = options; replacements += 1; selected = ""; },
    // Match a native select: assigning an absent option clears its value.
    get value() { return selected; },
    set value(value) { selected = this.options.some((option) => option.value === value) ? value : ""; },
  };
  try {
    hydrateStartupPaletteState(state, { paletteRegistry: null });
    patchPaletteFixture({ activePaletteId: "", currentPaletteTheme: "TNO (The New Order)" });
    const controller = createPaletteLibraryPanelController({ themeSelect: select });
    controller.syncPaletteSourceControls();
    assert.equal(select.value, "TNO (The New Order)");
    assert.equal(replacements, 0);
    patchPaletteFixture({ currentPaletteTheme: "Unavailable theme" });
    controller.syncPaletteSourceControls();
    assert.equal(select.value, "TNO (The New Order)");
    hydrateStartupPaletteState(state, { paletteRegistry: { palettes: [
      { palette_id: "tno", display_name: "TNO palette" },
      { palette_id: "hgo", display_name: "HGO palette" },
    ] } });
    patchPaletteFixture({ activePaletteId: "hgo" });
    controller.syncPaletteSourceControls();
    assert.equal(select.value, "hgo");
    assert.deepEqual(select.options.map((option) => option.textContent), ["TNO palette", "HGO palette"]);
    assert.equal(replacements, 1);
    const firstOption = select.options[0];
    patchPaletteFixture({ activePaletteId: "tno" });
    controller.syncPaletteSourceControls();
    assert.equal(select.value, "tno");
    assert.equal(select.options[0], firstOption);
    assert.equal(replacements, 1);
    hydrateStartupPaletteState(state, { paletteRegistry: { palettes: [
      { palette_id: "tno", display_name: "Updated TNO palette" },
      { palette_id: "hgo", display_name: "HGO palette" },
    ] } });
    patchPaletteFixture({ activePaletteId: "tno" });
    controller.syncPaletteSourceControls();
    assert.equal(select.options[0].textContent, "Updated TNO palette");
    assert.equal(select.value, "tno");
    assert.equal(replacements, 2);
  } finally {
    hydrateStartupPaletteState(state, {
      paletteRegistry,
      activePaletteMeta: paletteSnapshot.values.activePaletteMeta,
      activePalettePack: paletteSnapshot.values.activePalettePack,
      activePaletteMap: paletteSnapshot.values.activePaletteMap,
    });
    restoreScenarioPaletteState(state, paletteSnapshot);
  }
});

test("choosing a palette color switches ownership editing to visual without changing owners", () => {
  const owners = { milan: "ITA" };
  const modeUpdates = [];
  const paintState = {
    selectedColor: "#3c3c3c",
    paintMode: "sovereignty",
    activeSovereignCode: "GER",
    sovereigntyByFeatureId: owners,
    ui: { politicalEditingExpanded: true },
    updatePaintModeUIFn() { assert.equal(this, paintState); modeUpdates.push(this.paintMode); },
  };
  assert.equal(selectPalettePaintColor(paintState, "#00FF00"), true);
  assert.equal(paintState.selectedColor, "#00ff00");
  assert.equal(paintState.paintMode, "visual");
  assert.equal(paintState.ui.politicalEditingExpanded, false);
  assert.equal(paintState.activeSovereignCode, "GER");
  assert.equal(paintState.sovereigntyByFeatureId, owners);
  assert.deepEqual(owners, { milan: "ITA" });
  assert.deepEqual(modeUpdates, ["visual"]);
});

test("an invalid color leaves explicit ownership editing untouched", () => {
  const paintState = { paintMode: "sovereignty", selectedColor: "#123456" };
  assert.equal(selectPalettePaintColor(paintState, "invalid"), false);
  assert.deepEqual(paintState, { paintMode: "sovereignty", selectedColor: "#123456" });
});

const appState = {
  countryGroupMetaByCode: new Map([
    ["US", {
      continentId: "continent_north_america",
      continentLabel: "North America",
      subregionId: "subregion_northern_america",
    }],
    ["TR", {
      continentId: "continent_asia",
      continentLabel: "Asia",
      subregionId: "subregion_western_asia",
    }],
  ]),
  scenarioCountriesByTag: {
    USA: {
      tag: "USA",
      lookup_iso2: "US",
      continent_id: "continent_north_america",
      continent_label: "North America",
      subregion_id: "subregion_northern_america",
    },
  },
};

test("normalizes unknown palette library grouping mode to default", () => {
  assert.equal(normalizePaletteLibraryGroupingMode("region"), "region");
  assert.equal(normalizePaletteLibraryGroupingMode("unknown"), "default");
});

test("default grouping keeps mapped palette entries in Countries", () => {
  const groups = buildPaletteLibraryGroups([
    {
      key: "usa",
      color: "#4f7dbb",
      mapped: true,
      mappedIso2: "US",
    },
  ], [], {
    groupingMode: "default",
    appState,
  });

  assert.deepEqual(groups.map((group) => group.key), ["countries"]);
});

test("continent grouping places mapped palette entries by scenario geography", () => {
  const groups = buildPaletteLibraryGroups([
    {
      key: "usa",
      color: "#4f7dbb",
      mapped: true,
      mappedIso2: "US",
    },
  ], [], {
    groupingMode: "region",
    appState,
  });

  assert.deepEqual(groups.map((group) => group.key), ["region:north_america"]);
});

test("western Asia metadata maps to the existing Middle East palette region", () => {
  const region = resolvePaletteLibraryEntryRegion({
    key: "turkey",
    mapped: true,
    mappedIso2: "TR",
  }, appState);

  assert.equal(region.key, "middle_east");
});

test("imported palette regions still group unmapped HGO-style entries", () => {
  const groups = buildPaletteLibraryGroups([
    {
      key: "hgo-france",
      color: "#3344aa",
      mapped: false,
      paletteRegionKey: "europe",
      paletteRegionLabel: "Europe",
    },
  ], [], {
    groupingMode: "default",
    appState,
  });

  assert.deepEqual(groups.map((group) => group.key), ["region:europe"]);
});

test("adaptive palette library height follows content until the cap", () => {
  assert.equal(resolveAdaptivePaletteLibraryHeight(96, 480), 96);
  assert.equal(resolveAdaptivePaletteLibraryHeight(720, 480), 480);
  assert.equal(resolveAdaptivePaletteLibraryHeight(96, 0), 96);
});
