import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnitCounterDisplayModel,
  DEFAULT_MILSTD_SIDC,
  getUnitCounterEffectiveSidc,
  getNormalizedUnitCounterCombatState,
  getUnitCounterNodeTransform,
  getUnitCounterSlotOffset,
  normalizeUnitCounterStatPercent,
} from "../js/core/renderer/unit_counter_display_model.js";

function createModel(runtimeState = {}) {
  return createUnitCounterDisplayModel({
    runtimeState,
    canonicalCountryCode: (value) => String(value || "").trim().toUpperCase(),
    getScenarioCountryDisplayName: (entry, fallback) => entry?.name || fallback,
    ColorManager: { getPoliticalFallbackColor: () => "#123456" },
    t: (value) => value,
    getOperationalLineById: (id) => runtimeState.operationalLines?.find((line) => line.id === id),
    getLineMidpointFromCoordinates: (points) => points[1],
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
}

test("combat normalization retains clamping, preset defaults, and explicit zero", () => {
  assert.equal(normalizeUnitCounterStatPercent(Infinity, 120), 100);
  assert.equal(normalizeUnitCounterStatPercent(74.8), 75);
  assert.deepEqual(getNormalizedUnitCounterCombatState({
    statsPresetId: " ELITE ", organizationPct: 0, equipmentPct: NaN,
    baseFillColor: " #AbC123 ", statsSource: "MANUAL",
  }), {
    statsPresetId: "elite", organizationPct: 0, equipmentPct: 92,
    baseFillColor: "#abc123", statsSource: "manual",
  });
});

test("card models read replaced country tables and keep counter identity", (t) => {
  mockMilSymbol(t, (sidc, options) => `${sidc}:${options.size}`);
  const state = { scenarioCountriesByTag: { US: { name: "Before", color_hex: "#010101" } } };
  const model = createModel(state);
  const counter = { nationTag: "us", renderer: "milstd", size: "large", label: " Unit " };
  assert.equal(model.getUnitCounterCardModel(counter).nation.name, "Before");
  state.scenarioCountriesByTag = { US: { name: "After", color_hex: "#020202" } };
  const card = model.getUnitCounterCardModel(counter, { stackCount: 3 });
  assert.equal(card.counter, counter);
  assert.equal(card.nation.name, "After");
  assert.equal(card.nation.color, "#020202");
  assert.equal(card.symbolUri, `data:image/svg+xml;charset=utf-8,${DEFAULT_MILSTD_SIDC}%3A24`);
  assert.equal(card.label, "Unit");
  assert.equal(card.stackCount, 3);
});

function mockMilSymbol(t, render) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "ms");
  Object.defineProperty(globalThis, "ms", { configurable: true, writable: true, value: {
    Symbol: class { constructor(sidc, options) { this.asSVG = () => render(sidc, options); } },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "ms", previous) : delete globalThis.ms);
}

test("unit symbols accept full SIDC and aliases with preset and unknown fallbacks", () => {
  const fullSidc = "123456789012345678901234567890";
  assert.equal(getUnitCounterEffectiveSidc({ sidc: ` ${fullSidc} ` }), fullSidc);
  assert.equal(getUnitCounterEffectiveSidc({ symbolCode: " arm " }), "130310001712110000000000000000");
  assert.equal(getUnitCounterEffectiveSidc({ sidc: "unknown", symbolCode: "ARM" }), DEFAULT_MILSTD_SIDC);
  assert.equal(getUnitCounterEffectiveSidc({}), DEFAULT_MILSTD_SIDC);
});

test("military symbol URIs escape SVG and share normalized size cache within each display model", (t) => {
  const calls = [];
  mockMilSymbol(t, (sidc, options) => { calls.push([sidc, options]); return '<svg id="unit">&</svg>'; });
  const model = createModel();
  const first = model.getUnitCounterCardModel({ renderer: "milstd", sidc: "ARM", size: "small" });
  const second = model.getUnitCounterCardModel({ renderer: "milstd", sidc: "arm", size: "large" });
  assert.equal(first.symbolUri, `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg id="unit">&</svg>')}`);
  assert.equal(second.symbolUri, first.symbolUri); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["130310001712110000000000000000", { size: 24, frame: true, colorMode: "Light" }]);
  model.getUnitCounterCardModel({ renderer: "milstd", sidc: "HQ" }); assert.equal(calls.length, 2);
  createModel().getUnitCounterCardModel({ renderer: "milstd", sidc: "ARM" }); assert.equal(calls.length, 3);
});

test("missing symbol library can load later while render failures stay cached", (t) => {
  let attempts = 0;
  mockMilSymbol(t, () => { attempts += 1; throw new Error("invalid symbol"); });
  const library = globalThis.ms; globalThis.ms = undefined;
  const model = createModel(); const counter = { renderer: "milstd", sidc: "INF" };
  assert.equal(model.getUnitCounterCardModel(counter).symbolUri, "");
  globalThis.ms = library;
  assert.equal(model.getUnitCounterCardModel(counter).symbolUri, "");
  assert.equal(model.getUnitCounterCardModel(counter).symbolUri, "");
  assert.equal(attempts, 1);
  model.getUnitCounterCardModel({ renderer: "game", sidc: "ARM" }); assert.equal(attempts, 1);
});

test("render entries group live line attachments and sort without mutating input", () => {
  const state = { operationalLines: [{ id: "line", points: [[0, 0], [4, 6]] }] };
  const a = { id: "a", zIndex: 1, attachment: { lineId: "line" } };
  const b = { id: "b", zIndex: 0, attachment: { lineId: "line" } };
  state.unitCounters = [a, b];
  const model = createModel(state);
  const entries = model.getUnitCounterRenderEntries();
  assert.deepEqual(entries.map((entry) => entry.counter.id), ["b", "a"]);
  assert.deepEqual(state.unitCounters, [a, b]);
  assert.deepEqual(entries[0].anchor.coord, [4, 6]);
  assert.equal(entries[0].stackCount, 2);
  assert.equal(entries[1].slotIndex, 1);
  state.operationalLines = [];
  state.unitCounters = [{ id: "c", attachment: { lineId: "line" }, anchor: { lon: 2, lat: 3 } }];
  assert.deepEqual(model.getUnitCounterRenderEntries()[0].anchor.coord, [2, 3]);
});

test("scale uses current annotation settings and preserves the 600 percent threshold", () => {
  const state = { annotationView: { unitCounterFixedScaleMultiplier: 1 } };
  const model = createModel(state);
  assert.equal(model.getUnitCounterRenderScale({ width: 40 }, 6).hidden, true);
  assert.equal(model.getUnitCounterRenderScale({ width: 40 }, 6.01).hidden, false);
  state.annotationView = { unitCounterFixedScaleMultiplier: 2 };
  assert.equal(model.getUnitCounterRenderScale({ width: 40 }, 10).localScale, 0.1);
  assert.equal(model.getUnitCounterRenderScale({ width: 40 }, 10).effectiveWidth, 40);
});

test("stack slots center partial last rows and transform retains projection order", () => {
  assert.deepEqual(getUnitCounterSlotOffset(4, 5, { width: 100, height: 50 }), [38, 21]);
  assert.equal(getUnitCounterNodeTransform({ projected: [10, 20], slotOffset: [-2, 4], scaleModel: { localScale: 0.5 } }),
    "translate(10,20) scale(0.5) translate(-2,4)");
});
