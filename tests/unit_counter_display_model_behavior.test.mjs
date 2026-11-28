import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnitCounterDisplayModel,
  DEFAULT_MILSTD_SIDC,
  getUnitCounterEffectiveSidc,
  getUnitCounterSlotOffset,
} from "../js/core/renderer/unit_counter_display_model.js";

function createModel(runtimeState = {}) {
  return createUnitCounterDisplayModel(runtimeState, {
    canonicalCountryCode: (value) => String(value || "").trim().toUpperCase(),
    getScenarioCountryDisplayName: (entry, fallback) => entry?.name || fallback,
    ColorManager: { getPoliticalFallbackColor: () => "#123456" },
    t: (value) => value,
    getOperationalLineById: (id) => runtimeState.operationalLines?.find((line) => line.id === id),
    getLineMidpointFromCoordinates: (points) => points[1],
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
}

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

test("military symbol URIs escape SVG", (t) => {
  mockMilSymbol(t, () => '<svg id="unit">&</svg>');
  const model = createModel();
  const first = model.getUnitCounterCardModel({ renderer: "milstd", sidc: "ARM", size: "small" });
  assert.equal(first.symbolUri, `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg id="unit">&</svg>')}`);
});

test("stack slots center a partial last row", () => {
  assert.deepEqual(getUnitCounterSlotOffset(4, 5, { width: 100, height: 50 }), [38, 21]);
});
