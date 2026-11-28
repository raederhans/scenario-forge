import test from "node:test";
import assert from "node:assert/strict";
import { createPaletteLibraryPanelController } from "../js/ui/toolbar/palette_library_panel.js";
import { state } from "../js/core/state.js";
import { captureScenarioPaletteState, restoreScenarioPaletteState } from "../js/core/state/actions/scenario_palette_actions.js";

function sourceFixture(t) {
  const snapshot = captureScenarioPaletteState(state);
  const extra = Object.fromEntries(["paletteRegistry", "palettePackCacheById", "paletteMapCacheById", "countryPalette"]
    .map(key => [key, state[key]]));
  const originalD3 = globalThis.d3;
  t.after(() => {
    restoreScenarioPaletteState(state, snapshot);
    Object.assign(state, extra);
    if (originalD3 === undefined) delete globalThis.d3;
    else globalThis.d3 = originalD3;
  });
  state.paletteRegistry = { palettes: ["original", "first"].map(id => ({
    palette_id: id, display_name: id, palette_url: `${id}/pack`, map_url: `${id}/map`,
  })) };
  state.activePaletteId = "original";
  state.palettePackCacheById = {};
  state.paletteMapCacheById = {};
  state.countryPalette = { ...state.countryPalette };
  const pending = new Map();
  globalThis.d3 = { json: url => new Promise(resolve => pending.set(url, resolve)) };
  const complete = id => {
    pending.get(`${id}/map`)({ mapped: {} });
    pending.get(`${id}/pack`)({ entries: {}, quick_tags: [] });
  };
  return { controller: createPaletteLibraryPanelController(), complete };
}

test("choosing the current palette cancels an in-flight source change", async t => {
  const { controller, complete } = sourceFixture(t);
  const first = controller.handlePaletteSourceChange("first");
  await controller.handlePaletteSourceChange("original");
  complete("first");
  await first;
  assert.equal(state.activePaletteId, "original");
});
