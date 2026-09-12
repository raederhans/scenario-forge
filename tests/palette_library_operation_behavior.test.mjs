import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaletteLibraryOperation,
} from "../js/core/palette_library_operation.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import {
  getFeatureIdsForOwnerColorRefresh,
  resolvePaletteLibraryApplyTarget,
} from "../js/core/palette_library_queries.js";
import {
  captureHistoryState,
  clearHistory,
  pushHistoryEntry,
  redoHistory,
  undoHistory,
} from "../js/core/history_manager.js";
import { state as runtimeState } from "../js/core/state.js";
import {
  readRegisteredRuntimeHookSource,
  registerRuntimeHook,
} from "../js/core/state/index.js";
import {
  applyPaletteFeatureColorState,
  applyPaletteOwnerColorState,
  selectPalettePaintColorState,
} from "../js/core/state/actions/palette_library_actions.js";

function captureScopedColorState(state, scope) {
  const captureEntries = (source, keys) => Object.fromEntries(keys.map((key) => [
    key,
    Object.hasOwn(source || {}, key) ? source[key] : null,
  ]));
  if (scope.featureIds) {
    return {
      visualOverrides: captureEntries(state.visualOverrides, scope.featureIds),
      featureOverrides: captureEntries(state.featureOverrides, scope.featureIds),
    };
  }
  return {
    sovereignBaseColors: captureEntries(state.sovereignBaseColors, scope.ownerCodes),
    countryBaseColors: captureEntries(state.countryBaseColors, scope.ownerCodes),
    countryPalette: captureEntries(state.countryPalette, scope.ownerCodes),
  };
}

test("palette facade preserves color container identity and sparse feature traversal", () => {
  const visualOverrides = { retained: "#111111" };
  const featureOverrides = { retained: "#222222" };
  const sovereignBaseColors = {};
  const countryBaseColors = {};
  const state = { visualOverrides, featureOverrides, sovereignBaseColors, countryBaseColors };
  const featureIds = new Array(4);
  featureIds[1] = "first";
  featureIds[3] = "last";
  applyPaletteFeatureColorState(state, featureIds, "#abcdef");
  applyPaletteOwnerColorState(state, "GER", "#fedcba");
  assert.equal(state.visualOverrides, visualOverrides);
  assert.equal(state.featureOverrides, featureOverrides);
  assert.equal(state.sovereignBaseColors, sovereignBaseColors);
  assert.equal(state.countryBaseColors, countryBaseColors);
  assert.deepEqual(visualOverrides, { retained: "#111111", first: "#abcdef", last: "#abcdef" });
  assert.deepEqual(featureOverrides, { retained: "#222222", first: "#abcdef", last: "#abcdef" });
  assert.deepEqual(sovereignBaseColors, { GER: "#fedcba" });
  assert.deepEqual(countryBaseColors, { GER: "#fedcba" });
});

test("palette facade preserves partial commits when a compatibility setter fails", () => {
  const failure = new Error("compatibility write rejected");
  const rejectingMap = () => Object.defineProperty({}, "target", {
    set() { throw failure; },
  });
  const featureState = { visualOverrides: {}, featureOverrides: rejectingMap() };
  assert.throws(() => applyPaletteFeatureColorState(featureState, ["target", "later"], "#abcdef"), (error) => error === failure);
  assert.deepEqual(featureState.visualOverrides, { target: "#abcdef" });
  assert.equal(Object.hasOwn(featureState.featureOverrides, "later"), false);
  const ownerState = { sovereignBaseColors: {}, countryBaseColors: rejectingMap() };
  assert.throws(() => applyPaletteOwnerColorState(ownerState, "target", "#abcdef"), (error) => error === failure);
  assert.deepEqual(ownerState.sovereignBaseColors, { target: "#abcdef" });
  const selectionState = { selectedColor: "#000000", set paintMode(_value) { throw failure; } };
  assert.throws(() => selectPalettePaintColorState(selectionState, "#abcdef"), (error) => error === failure);
  assert.equal(selectionState.selectedColor, "#abcdef");
});

function createOperationHarness(state) {
  const events = [];
  const history = [];
  const operation = createPaletteLibraryOperation({
    ...createPaletteLibraryStateAccess(state),
    captureHistoryState(scope) {
      events.push(["capture", structuredClone(scope)]);
      return captureScopedColorState(state, scope);
    },
    pushHistoryEntry(entry) {
      events.push(["history", entry.kind]);
      history.push(entry);
      return true;
    },
    markLegacyColorStateDirty() {
      events.push(["legacy-dirty"]);
    },
    refreshResolvedColorsForFeatures(featureIds, options) {
      events.push(["partial-refresh", [...featureIds], options]);
    },
    refreshColorState(options) {
      events.push(["full-refresh", options]);
    },
    markDirty(reason) {
      events.push(["project-dirty", reason]);
    },
    selectPaintColor(color) {
      selectPalettePaintColorState(state, color);
      events.push(["paint-selected"]);
      state.updatePaintModeUIFn?.();
    },
  });
  assert.equal(Object.isFrozen(operation), true);
  return { apply: operation.applyColor, events, history };
}

test("palette target precedence remains selected feature, hovered feature, then inspector owner", () => {
  const state = {
    landIndex: new Map([["selected", {}], ["hovered", {}]]),
    devSelectedHit: { id: " selected " },
    hoveredId: "hovered",
    selectedInspectorCountryCode: "deu",
  };

  assert.deepEqual(resolvePaletteLibraryApplyTarget(state), {
    type: "feature",
    featureIds: ["selected"],
  });
  state.devSelectedHit = { id: "missing" };
  assert.deepEqual(resolvePaletteLibraryApplyTarget(state), {
    type: "feature",
    featureIds: ["hovered"],
  });
  state.hoveredId = "water";
  assert.deepEqual(resolvePaletteLibraryApplyTarget(state), {
    type: "owner",
    ownerCode: "DEU",
  });
  state.selectedInspectorCountryCode = "";
  assert.equal(resolvePaletteLibraryApplyTarget(state), null);
});

test("owner refresh unions every live ownership index and filters the result through landIndex", () => {
  const state = {
    sovereigntyByFeatureId: {
      sovereign: " deu ",
      duplicate: "DEU",
      foreign: "FRA",
      water: "DEU",
    },
    ownerToFeatureIds: new Map([["DEU", new Set(["owner", "duplicate", "owner-water"])]]),
    countryToFeatureIds: new Map([["DEU", ["country", "duplicate", ""]]]),
    landIndex: new Map([
      ["sovereign", {}],
      ["owner", {}],
      ["country", {}],
      ["duplicate", {}],
    ]),
  };

  assert.deepEqual(
    new Set(getFeatureIdsForOwnerColorRefresh(state, "d.e-u")),
    new Set(["sovereign", "owner", "country", "duplicate"]),
  );
  assert.deepEqual(getFeatureIdsForOwnerColorRefresh(state, ""), []);
});

test("owner refresh reads index replacement and missing-index lifecycle state on every call", () => {
  const state = {
    sovereigntyByFeatureId: null,
    ownerToFeatureIds: null,
    countryToFeatureIds: null,
    landIndex: null,
  };
  assert.deepEqual(getFeatureIdsForOwnerColorRefresh(state, "USA"), []);

  state.ownerToFeatureIds = new Map([["USA", ["old-owner"]]]);
  state.landIndex = new Map([["old-owner", {}]]);
  assert.deepEqual(getFeatureIdsForOwnerColorRefresh(state, "USA"), ["old-owner"]);

  state.ownerToFeatureIds = new Map([["USA", ["new-owner"]]]);
  state.countryToFeatureIds = new Map([["USA", new Set(["new-country"])]]);
  state.landIndex = new Map([["new-owner", {}], ["new-country", {}]]);
  assert.deepEqual(
    new Set(getFeatureIdsForOwnerColorRefresh(state, "USA")),
    new Set(["new-owner", "new-country"]),
  );
});

test("invalid colors and missing targets have no state or service side effects", () => {
  const state = {
    selectedColor: "#123456",
    paintMode: "sovereignty",
    ui: { politicalEditingExpanded: true },
    landIndex: new Map(),
    devSelectedHit: null,
    hoveredId: "",
    selectedInspectorCountryCode: "",
  };
  const { apply, events, history } = createOperationHarness(state);

  assert.deepEqual(apply("not-a-color"), { status: "invalid-color" });
  assert.deepEqual(apply("#abcdef"), { status: "no-target" });
  assert.equal(state.selectedColor, "#123456");
  assert.equal(state.paintMode, "sovereignty");
  assert.equal(state.ui.politicalEditingExpanded, true);
  assert.deepEqual(events, []);
  assert.deepEqual(history, []);
});

test("feature apply changes both compatibility fields without changing sovereignty and orders side effects once", () => {
  const modeUpdates = [];
  const sovereignty = { target: "ITA" };
  const state = {
    selectedColor: "#111111",
    paintMode: "sovereignty",
    ui: { politicalEditingExpanded: true },
    devSelectedHit: { id: "target" },
    hoveredId: "other",
    selectedInspectorCountryCode: "GER",
    landIndex: new Map([["target", {}], ["other", {}]]),
    sovereigntyByFeatureId: sovereignty,
    visualOverrides: { target: "#222222" },
    featureOverrides: { target: "#222222" },
    updatePaintModeUIFn: () => modeUpdates.push("paint-ui"),
  };
  const { apply, events, history } = createOperationHarness(state);

  const result = apply("#AABBCC");

  assert.deepEqual(result, {
    status: "applied",
    color: "#aabbcc",
    target: { type: "feature", featureIds: ["target"] },
  });
  assert.equal(state.selectedColor, "#aabbcc");
  assert.equal(state.paintMode, "visual");
  assert.equal(state.ui.politicalEditingExpanded, true);
  assert.equal(state.visualOverrides.target, "#aabbcc");
  assert.equal(state.featureOverrides.target, "#aabbcc");
  assert.equal(state.sovereigntyByFeatureId, sovereignty);
  assert.deepEqual(sovereignty, { target: "ITA" });
  assert.deepEqual(modeUpdates, ["paint-ui"]);
  assert.deepEqual(events.map((event) => event[0]), [
    "paint-selected",
    "capture",
    "legacy-dirty",
    "partial-refresh",
    "project-dirty",
    "capture",
    "history",
  ]);
  assert.deepEqual(events[3], ["partial-refresh", ["target"], { renderNow: false }]);
  assert.deepEqual(events[4], ["project-dirty", "palette-library-apply-color"]);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0], {
    kind: "palette-library-apply-color",
    before: {
      visualOverrides: { target: "#222222" },
      featureOverrides: { target: "#222222" },
    },
    after: {
      visualOverrides: { target: "#aabbcc" },
      featureOverrides: { target: "#aabbcc" },
    },
    meta: { affectsSovereignty: false },
  });
});

test("owner apply updates both base-color fields, preserves sovereignty, and partially refreshes the live union", () => {
  const sovereignty = { a: "GER", b: "FRA" };
  const countryPalette = { GER: "legacy-value" };
  const state = {
    selectedInspectorCountryCode: "ger",
    landIndex: new Map([["a", {}], ["c", {}], ["d", {}]]),
    sovereigntyByFeatureId: sovereignty,
    ownerToFeatureIds: new Map([["GER", ["c"]]]),
    countryToFeatureIds: new Map([["GER", new Set(["d"])]]),
    sovereignBaseColors: { GER: "#111111" },
    countryBaseColors: { GER: "#111111" },
    countryPalette,
    ui: {},
  };
  const { apply, events, history } = createOperationHarness(state);

  assert.equal(apply("#336699").status, "applied");
  assert.equal(state.sovereignBaseColors.GER, "#336699");
  assert.equal(state.countryBaseColors.GER, "#336699");
  assert.equal(state.countryPalette, countryPalette);
  assert.deepEqual(countryPalette, { GER: "legacy-value" });
  assert.equal(state.sovereigntyByFeatureId, sovereignty);
  assert.deepEqual(sovereignty, { a: "GER", b: "FRA" });
  assert.deepEqual(new Set(events.find((event) => event[0] === "partial-refresh")[1]), new Set(["a", "c", "d"]));
  assert.equal(events.some((event) => event[0] === "full-refresh"), false);
  assert.equal(events.filter((event) => event[0] === "project-dirty").length, 1);
  assert.equal(events.filter((event) => event[0] === "history").length, 1);
  assert.equal(history[0].kind, "palette-library-apply-owner-color");
  assert.deepEqual(history[0].meta, { affectsSovereignty: false });
});

test("owner apply falls back to one non-rendering full refresh when no land ids are available", () => {
  const state = {
    selectedInspectorCountryCode: "USA",
    landIndex: new Map(),
    sovereigntyByFeatureId: { water: "USA" },
    ownerToFeatureIds: new Map([["USA", ["missing"]]]),
    countryToFeatureIds: new Map(),
    sovereignBaseColors: {},
    countryBaseColors: {},
    ui: {},
  };
  const { apply, events } = createOperationHarness(state);

  assert.equal(apply("#abcdef").status, "applied");
  assert.deepEqual(events.filter((event) => event[0].endsWith("refresh")), [
    ["full-refresh", { renderNow: false }],
  ]);
});

test("operation-produced feature and owner entries round-trip through the real history harness", (t) => {
  const hookNames = [
    "refreshColorStateFn",
    "updateHistoryUIFn",
    "updateToolUIFn",
    "updateSwatchUIFn",
    "updatePaintModeUIFn",
    "updateToolbarInputsFn",
    "updateActiveSovereignUIFn",
    "refreshCountryInspectorDetailFn",
    "renderCountryListFn",
    "renderWaterRegionListFn",
    "renderSpecialRegionListFn",
    "renderPresetTreeFn",
    "updateLegendUI",
    "updateStrategicOverlayUIFn",
  ];
  const oldHooks = new Map(hookNames.map((name) => [
    name,
    readRegisteredRuntimeHookSource(runtimeState, name),
  ]));
  const refreshes = [];
  hookNames.forEach((name) => registerRuntimeHook(
    runtimeState,
    name,
    name === "refreshColorStateFn" ? (options) => refreshes.push(options) : () => {},
  ));

  const featureId = "palette-history-feature-test";
  const ownerCode = "PALTESTOWNER";
  const featureScope = { featureIds: [featureId] };
  const ownerScope = { ownerCodes: [ownerCode] };
  const originalFeature = captureHistoryState(featureScope);
  const originalOwner = captureHistoryState(ownerScope);
  const restoreScope = (before, scope) => {
    const after = captureHistoryState(scope);
    clearHistory();
    if (pushHistoryEntry({ before, after, meta: { affectsSovereignty: false } })) {
      undoHistory();
    }
    clearHistory();
  };
  t.after(() => {
    restoreScope(originalFeature, featureScope);
    restoreScope(originalOwner, ownerScope);
    oldHooks.forEach((hook, name) => registerRuntimeHook(runtimeState, name, hook));
  });

  const featureState = {
    selectedColor: "#111111",
    paintMode: "visual",
    ui: {},
    devSelectedHit: { id: featureId },
    landIndex: new Map([[featureId, {}]]),
    visualOverrides: { [featureId]: "#101010" },
    featureOverrides: { [featureId]: "#101010" },
  };
  const featureHarness = createOperationHarness(featureState);
  assert.equal(featureHarness.apply("#f0a020").status, "applied");
  const featureEntry = featureHarness.history[0];
  applyPaletteFeatureColorState(runtimeState, [featureId], "#f0a020");
  clearHistory();
  assert.equal(pushHistoryEntry(featureEntry), true);
  assert.equal(undoHistory(), true);
  assert.equal(runtimeState.visualOverrides[featureId], "#101010");
  assert.equal(runtimeState.featureOverrides[featureId], "#101010");
  assert.deepEqual(refreshes.at(-1), {
    renderNow: false,
    featureIds: [featureId],
    inputLabel: "history-undo",
  });
  assert.equal(redoHistory(), true);
  assert.equal(runtimeState.visualOverrides[featureId], "#f0a020");
  assert.equal(runtimeState.featureOverrides[featureId], "#f0a020");
  assert.deepEqual(refreshes.at(-1), {
    renderNow: false,
    featureIds: [featureId],
    inputLabel: "history-redo",
  });

  const ownerState = {
    selectedInspectorCountryCode: ownerCode,
    landIndex: new Map(),
    sovereignBaseColors: { [ownerCode]: "#202020" },
    countryBaseColors: { [ownerCode]: "#202020" },
    countryPalette: {},
    ui: {},
  };
  const ownerHarness = createOperationHarness(ownerState);
  assert.equal(ownerHarness.apply("#306090").status, "applied");
  const ownerEntry = ownerHarness.history[0];
  applyPaletteOwnerColorState(runtimeState, ownerCode, "#306090");
  clearHistory();
  assert.equal(pushHistoryEntry(ownerEntry), true);
  assert.equal(undoHistory(), true);
  assert.equal(runtimeState.sovereignBaseColors[ownerCode], "#202020");
  assert.equal(runtimeState.countryBaseColors[ownerCode], "#202020");
  assert.deepEqual(refreshes.at(-1), { renderNow: false });
  assert.equal(redoHistory(), true);
  assert.equal(runtimeState.sovereignBaseColors[ownerCode], "#306090");
  assert.equal(runtimeState.countryBaseColors[ownerCode], "#306090");
  assert.deepEqual(refreshes.at(-1), { renderNow: false });
});

test("paint selection action preserves ownership and leaves panel feedback to the UI callback", () => {
  const owners = { berlin: "GER" };
  const modeUpdates = [];
  const state = {
    selectedColor: "#000000",
    paintMode: "sovereignty",
    activeSovereignCode: "GER",
    sovereigntyByFeatureId: owners,
    ui: { politicalEditingExpanded: true },
    updatePaintModeUIFn: () => modeUpdates.push("paint-ui"),
  };
  selectPalettePaintColorState(state, "#abcdef");
  assert.equal(state.selectedColor, "#abcdef");
  assert.equal(state.paintMode, "visual");
  assert.equal(state.ui.politicalEditingExpanded, true);
  assert.equal(state.activeSovereignCode, "GER");
  assert.equal(state.sovereigntyByFeatureId, owners);
  assert.deepEqual(modeUpdates, []);
});

test("paint selection feedback errors propagate before history or map color writes", () => {
  const failure = new Error("paint feedback failed");
  const state = {
    landIndex: new Map([["selected", {}]]),
    devSelectedHit: { id: "selected" },
    selectedColor: "#123456",
    paintMode: "sovereignty",
    visualOverrides: { selected: "#112233" },
    featureOverrides: { selected: "#112233" },
    updatePaintModeUIFn() { throw failure; },
  };
  const { apply, events, history } = createOperationHarness(state);
  assert.throws(() => apply("#abcdef"), (error) => error === failure);
  assert.equal(state.selectedColor, "#abcdef");
  assert.equal(state.paintMode, "visual");
  assert.deepEqual(state.visualOverrides, { selected: "#112233" });
  assert.deepEqual(state.featureOverrides, { selected: "#112233" });
  assert.deepEqual(events, [["paint-selected"]]);
  assert.deepEqual(history, []);
});

test("palette operation rejects incomplete service assembly before editing state", () => {
  assert.throws(
    () => createPaletteLibraryOperation({
      ...createPaletteLibraryStateAccess({}),
      captureHistoryState: () => ({}),
      pushHistoryEntry: () => true,
      markLegacyColorStateDirty: () => {},
      refreshResolvedColorsForFeatures: () => {},
      refreshColorState: () => {},
      markDirty: () => {},
    }),
    /selectPaintColor must be a function/,
  );
});

test("palette capabilities read replacement indexes and keep writes scoped to color actions", () => {
  const state = {
    hoveredId: "first",
    landIndex: new Map([["first", {}]]),
    ownerToFeatureIds: new Map([["DEU", ["first"]]]),
    visualOverrides: {},
    featureOverrides: {},
    sovereignBaseColors: {},
    countryBaseColors: {},
    countryPalette: Object.freeze({ DEU: "#123456" }),
    sovereigntyByFeatureId: Object.freeze({ first: "DEU" }),
  };
  const access = createPaletteLibraryStateAccess(state);
  assert.equal(Object.isFrozen(access), true);
  assert.deepEqual(Object.keys(access).sort(), [
    "applyFeatureColor", "applyOwnerColor", "getApplyTarget", "getOwnerFeatureIds",
  ]);
  assert.deepEqual(access.getApplyTarget(), { type: "feature", featureIds: ["first"] });
  state.hoveredId = "second";
  state.landIndex = new Map([["second", {}]]);
  state.ownerToFeatureIds = new Map([["DEU", ["second"]]]);
  assert.deepEqual(access.getApplyTarget(), { type: "feature", featureIds: ["second"] });
  assert.deepEqual(access.getOwnerFeatureIds("DEU"), ["second"]);
  access.applyFeatureColor(["second"], "#abcdef");
  access.applyOwnerColor("DEU", "#654321");
  assert.deepEqual(state.visualOverrides, { second: "#abcdef" });
  assert.deepEqual(state.featureOverrides, state.visualOverrides);
  assert.deepEqual(state.sovereignBaseColors, { DEU: "#654321" });
  assert.deepEqual(state.countryBaseColors, state.sovereignBaseColors);
  assert.deepEqual(state.countryPalette, { DEU: "#123456" });
  assert.deepEqual(state.sovereigntyByFeatureId, { first: "DEU" });
});

test("palette operation validates every required state capability at assembly", () => {
  const services = {
    ...createPaletteLibraryStateAccess({}),
    captureHistoryState: () => ({}),
    pushHistoryEntry: () => true,
    markLegacyColorStateDirty: () => {},
    refreshResolvedColorsForFeatures: () => {},
    refreshColorState: () => {},
    markDirty: () => {},
    selectPaintColor: () => {},
  };
  for (const name of ["getApplyTarget", "getOwnerFeatureIds", "applyFeatureColor", "applyOwnerColor"]) {
    assert.throws(() => createPaletteLibraryOperation({ ...services, [name]: null }),
      new RegExp(`${name} must be a function`));
  }
});
