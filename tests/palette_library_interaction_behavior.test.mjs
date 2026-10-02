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
  state.paletteRegistry = { palettes: ["original", "first", "last"].map(id => ({
    palette_id: id, display_name: id, palette_url: `${id}/pack`, map_url: `${id}/map`,
  })) };
  state.activePaletteId = "original";
  state.palettePackCacheById = {};
  state.paletteMapCacheById = {};
  state.countryPalette = { ...state.countryPalette };
  const pending = new Map();
  globalThis.d3 = { json: url => new Promise((resolve, reject) => pending.set(url, { resolve, reject })) };
  const complete = (id, fail = false) => {
    pending.get(`${id}/map`).resolve({ mapped: {} });
    if (fail) pending.get(`${id}/pack`).reject(new Error("late failed request"));
    else pending.get(`${id}/pack`).resolve({ entries: {}, quick_tags: [] });
  };
  return { controller: createPaletteLibraryPanelController(), complete };
}

for (const lateFailure of [false, true]) {
  test(`latest palette source wins over older ${lateFailure ? "failed" : "successful"} request`, async t => {
    const { controller, complete } = sourceFixture(t);
    const first = controller.handlePaletteSourceChange("first");
    const last = controller.handlePaletteSourceChange("last");
    complete("last");
    await last;
    assert.equal(state.activePaletteId, "last");
    complete("first", lateFailure);
    await first;
    assert.equal(state.activePaletteId, "last");
    assert.equal(state.currentPaletteTheme, "last");
  });
}

test("choosing the current palette cancels an in-flight source change", async t => {
  const { controller, complete } = sourceFixture(t);
  const first = controller.handlePaletteSourceChange("first");
  await controller.handlePaletteSourceChange("original");
  complete("first");
  await first;
  assert.equal(state.activePaletteId, "original");
});

test("Enter applies a focused color variant exactly once, like a normal row", t => {
  const originalDocument = globalThis.document;
  const previous = { selectedColor: state.selectedColor, paintMode: state.paintMode, ui: state.ui };
  state.ui = { ...state.ui };
  t.after(() => {
    Object.assign(state, previous);
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const handlers = {};
  const rows = ["palette-library-variant-btn", "palette-library-row"].map((className, index) => ({
    dataset: { paletteRowKey: `color-${index}`, color: index ? "#112233" : "#abcdef" },
    classList: { toggle() {} },
    closest(selector) { return selector.split(",").map(value => value.trim()).includes(`.${className}`) ? this : null; },
  }));
  const applied = [];
  const list = {
    dataset: {},
    addEventListener(name, handler) { handlers[name] = handler; },
    querySelectorAll() { return rows; },
  };
  createPaletteLibraryPanelController({
    paletteLibraryList: list,
    applyPaletteLibraryColor: color => applied.push(color),
  }).bindEvents();
  let prevented = 0;
  for (const row of rows) {
    globalThis.document = { activeElement: row };
    handlers.keydown({ key: "Enter", preventDefault() { prevented++; } });
  }
  assert.deepEqual(applied, ["#abcdef", "#112233"]);
  assert.equal(prevented, 2, "suppress the native button click after keyboard apply");
  assert.equal(state.selectedColor, "#112233");
});
