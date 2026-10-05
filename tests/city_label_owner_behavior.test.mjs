import assert from "node:assert/strict";
import test from "node:test";
import { createCityLabelOwner } from "../js/core/renderer/city_label_owner.js";
import { claimScreenLabelPlacement } from "../js/core/renderer/screen_label_placement.js";

function fixture() {
  const calls = [];
  const fonts = [];
  const measures = [];
  const alphas = [];
  let viewport = { width: 100, height: 100 };
  let context = {
    save() {}, restore() {}, measureText: (text) => { measures.push(text); return { width: 20 }; },
    strokeText() {}, fillText: (...args) => { calls.push(args); alphas.push(context.globalAlpha); },
    set font(value) { fonts.push(value); },
  };
  const owner = createCityLabelOwner({
    getters: { getContext: () => context, getViewportSize: () => viewport },
    helpers: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getCityVisualCapitalState: (entry, config) => entry.isCapital && config?.showCapitalOverlay !== false,
      getCityDisplayLabel: () => "City", formatCityMapLabel: (text) => text,
      getCityLabelMinZoom: () => 0, getCityMarkerSizePx: () => 4,
      getCityLabelRenderStyle: () => ({ usesLightLabel: true, shadowBlurFactor: 0.1, shadowOffsetYFactor: 0.1, strokeWidthFactor: 0.1 }),
    },
  });
  return { owner, calls, fonts, measures, alphas, setViewport: (next) => { viewport = next; }, setContext: (next) => { context = next; } };
}

test("label owner resolves placement collisions in its own stable order", () => {
  const { owner, calls } = fixture();
  const entries = Array.from({ length: 3 }, () => ({ anchor: [50, 50], screenPoint: [50, 50] }));
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: {}, scale: 1 }), 2);
  assert.deepEqual(entries.map((entry) => entry.acceptedLabelPlacement), ["right", "left", undefined]);
  assert.deepEqual(calls, [["City", 57, 50], ["City", 43, 50]]);
  assert.ok(entries.slice(0, 2).every((entry) => entry.labelContrastMode === "light"));
});

test("label placement uses live viewport and divides screen offsets by zoom", () => {
  const { owner, calls, setViewport } = fixture();
  const entry = { anchor: [20, 25], screenPoint: [120, 50] };
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 2 }), 1);
  assert.equal(entry.acceptedLabelPlacement, "left");
  assert.deepEqual(calls[0], ["City", 16.5, 25]);
  setViewport({ width: 200, height: 100 });
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 2 }), 1);
  assert.equal(entry.acceptedLabelPlacement, "right");
  assert.deepEqual(calls[1], ["City", 23.5, 25]);
});

test("label budget counts successful placements and lets later candidates fill vacant slots", () => {
  const { owner, calls, setViewport } = fixture();
  setViewport({ width: 600, height: 200 });
  const entries = [50, 200, 350, 500].map((x) => ({ anchor: [x, 50], screenPoint: [x, 50] }));
  const occupiedBoxes = [{ x: 0, y: 0, w: 100, h: 100 }];
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: {}, scale: 1, occupiedBoxes, labelBudget: 2 }), 2);
  assert.deepEqual(entries.map((entry) => entry.acceptedLabelPlacement), [undefined, "right", "right", undefined]);
  assert.equal(calls.length, 2);
  assert.equal(owner.drawCityLabelsFromEntries([entries[3]], { config: {}, scale: 1, labelBudget: 0 }), 0);
});

test("label fonts distinguish capital, major and smaller cities in screen pixels", () => {
  const { owner, fonts, setViewport } = fixture();
  setViewport({ width: 1000, height: 200 });
  const entries = [
    { cityTier: "major", isCapital: true },
    { cityTier: "major" },
    { cityTier: "regional" },
    { cityTier: "minor" },
  ].map((entry, index) => ({ ...entry, anchor: [50 + index * 100, 50], screenPoint: [100 + index * 200, 100] }));
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: { labelSize: 12 }, scale: 2 }), 4);
  assert.deepEqual(fonts.map((font) => font.split(' "')[0]), ["600 6.5px", "400 6px", "400 5.5px", "400 5.5px"]);
});

test("labels avoid a nearby marker and remain clear of their own compact sprite", () => {
  const { owner } = fixture();
  const entry = { anchor: [50, 50], screenPoint: [50, 50] };
  const ownMarker = { x: 47, y: 47, w: 6, h: 6 };
  const nearbyMarker = { x: 66, y: 25, w: 22, h: 48 };
  const occupiedBoxes = [ownMarker, nearbyMarker];
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, occupiedBoxes }), 1);
  assert.equal(entry.acceptedLabelPlacement, "left");
  assert.equal(occupiedBoxes.length, 3);
});

test("capital labels stay close to their actual star footprint at different sizes and zooms", () => {
  for (const markerSizePx of [3, 10, 24]) {
    for (const scale of [1, 2, 4]) {
      const { owner, calls, setViewport } = fixture();
      setViewport({ width: 600, height: 300 });
      const halfSize = Math.ceil(Math.max(1.5, markerSizePx / 2) + 1);
      const entry = { isCapital: true, markerSizePx, anchor: [100, 100], screenPoint: [200, 150] };
      const marker = { x: 200 - halfSize, y: 150 - halfSize, w: halfSize * 2, h: halfSize * 2 };
      const occupiedBoxes = [marker];
      assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale, occupiedBoxes }), 1);
      assert.equal(entry.acceptedLabelPlacement, "right");
      assert.deepEqual(calls[0], ["City", 100 + (halfSize + 4) / scale, 100]);
      assert.equal(occupiedBoxes[1].x - (marker.x + marker.w), 2, "label collision box has a compact clear gap");
    }
  }
});

test("country occupancy changes capital direction without increasing its attachment distance", () => {
  const { owner, calls, setViewport } = fixture();
  setViewport({ width: 500, height: 300 });
  const entry = { isCapital: true, markerSizePx: 10, anchor: [100, 100], screenPoint: [100, 100] };
  const marker = { x: 94, y: 94, w: 12, h: 12 };
  const country = { x: 110, y: 90, w: 80, h: 20 };
  const occupiedBoxes = [marker, country];
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, occupiedBoxes }), 1);
  assert.equal(entry.acceptedLabelPlacement, "left");
  assert.deepEqual(calls[0], ["City", 90, 100]);
  const labelBox = occupiedBoxes[2];
  assert.equal(marker.x - (labelBox.x + labelBox.w), 2);
  assert.equal(owner.drawCityLabelsFromEntries([entry], {
    config: {}, scale: 1, occupiedBoxes: [{ x: 0, y: 0, w: 300, h: 200 }],
  }), 0, "fully blocked near-neighbor candidates never turn into a distant label");
});

test("five settlement ranks have ordered label sizes independently of legacy tier", () => {
  const { owner, fonts, setViewport } = fixture();
  setViewport({ width: 1400, height: 200 });
  const entries = ["metropolis", "large", "medium", "small", "town"].map((settlementRank, index) => ({
    settlementRank, cityTier: "minor", anchor: [50 + index * 100, 50], screenPoint: [100 + index * 220, 100],
  }));
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: { labelSize: 12 }, scale: 2 }), 5);
  assert.deepEqual(fonts.map((font) => font.split(' "')[0]), ["600 6.5px", "400 6px", "400 5.75px", "400 5.5px", "400 5.25px"]);
});

test("label owner skips missing anchors, offscreen labels, and detached context", () => {
  const { owner, calls, setContext } = fixture();
  const entries = [{ screenPoint: [50, 50] }, { anchor: [1000, 1000], screenPoint: [1000, 1000] }];
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: {}, scale: 1 }), 0);
  assert.deepEqual(calls, []);
  setContext(null);
  assert.equal(owner.drawCityLabelsFromEntries([{ anchor: [0, 0], screenPoint: [0, 0] }], { config: {}, scale: 1 }), 0);
});

test("trial layout records placements without painting and clears stale results on every attempt", () => {
  const { owner, calls, setContext } = fixture();
  const entry = { anchor: [50, 50], screenPoint: [50, 50], labelContrastMode: "light" };
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, layoutOnly: true }), 1);
  assert.equal(entry.acceptedLabelPlacement, "right");
  assert.equal(entry.labelContrastMode, undefined);
  assert.deepEqual(calls, []);
  owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, labelBudget: 0 });
  assert.equal(entry.acceptedLabelPlacement, undefined, "budget skips clear previous placement");
  owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, layoutOnly: true });
  owner.drawCityLabelsFromEntries([entry], {
    config: {}, scale: 1, occupiedBoxes: [{ x: -100, y: -100, w: 400, h: 400 }],
  });
  assert.equal(entry.acceptedLabelPlacement, undefined, "collisions clear previous placement");
  entry.acceptedLabelPlacement = "right";
  setContext(null);
  owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1 });
  assert.equal(entry.acceptedLabelPlacement, undefined, "detached context clears previous placement");
});

test("final layout preserves trial directions when hidden marker space is released", () => {
  const { owner, calls, setViewport } = fixture();
  setViewport({ width: 400, height: 200 });
  const entries = [50, 75].map((x) => ({ anchor: [x, 50], screenPoint: [x, 50] }));
  const hiddenMarkerBox = { x: 63, y: 42, w: 5, h: 16 };
  assert.equal(owner.drawCityLabelsFromEntries(entries, {
    config: {}, scale: 1, occupiedBoxes: [hiddenMarkerBox], layoutOnly: true,
  }), 2);
  assert.deepEqual(entries.map((entry) => entry.acceptedLabelPlacement), ["left", "right"]);
  assert.equal(owner.drawCityLabelsFromEntries(entries, {
    config: {}, scale: 1, occupiedBoxes: [], reusePlacement: true,
  }), 2);
  assert.deepEqual(entries.map((entry) => entry.acceptedLabelPlacement), ["left", "right"]);
  assert.deepEqual(calls, [["City", 43, 50], ["City", 82, 50]]);
});

test("city labels share screen occupancy with facility boxes without retaining prior draws", () => {
  const { owner } = fixture();
  const occupiedBoxes = [];
  const entry = { anchor: [50, 50], screenPoint: [50, 50] };
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, occupiedBoxes }), 1);
  const cityBox = occupiedBoxes[0];
  const overlapping = { box: { x: cityBox.x, y: cityBox.y, width: cityBox.w, height: cityBox.h } };
  const alternate = { box: { x: 0, y: 0, width: 10, height: 10 } };
  assert.equal(claimScreenLabelPlacement([overlapping, alternate], occupiedBoxes), alternate);
  assert.equal(occupiedBoxes.length, 2);
  assert.equal(claimScreenLabelPlacement([overlapping], []), overlapping);
  const blocked = [{ x: -100, y: -100, width: 400, height: 400 }];
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 1, occupiedBoxes: blocked }), 0);
});

test("hidden and near-transparent ordinary names consume neither measurement, occupancy nor label budget", () => {
  for (const labelOpacity of [0, 0.01, 0.049]) {
    const { owner, calls, measures, alphas } = fixture();
    const ordinary = { anchor: [50, 50], screenPoint: [50, 50], acceptedLabelPlacement: "right" };
    const capital = { anchor: [50, 50], screenPoint: [50, 50], isCapital: true };
    const occupiedBoxes = [];
    assert.equal(owner.drawCityLabelsFromEntries([ordinary, capital], {
      config: {}, scale: 1, occupiedBoxes, labelBudget: 1, labelOpacity, capitalLabelOpacity: 0.5,
    }), 1);
    assert.equal(measures.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(occupiedBoxes.length, 1);
    assert.equal(ordinary.acceptedLabelPlacement, undefined);
    assert.equal(capital.acceptedLabelPlacement, "right");
    assert.deepEqual(alphas, [0.5]);
  }
});

test("capital label opacity follows the capital overlay switch and preserves visible ordinary opacity", () => {
  const { owner, alphas, measures } = fixture();
  const capital = { anchor: [50, 50], screenPoint: [50, 50], isCapital: true };
  assert.equal(owner.drawCityLabelsFromEntries([capital], {
    config: { showCapitalOverlay: false }, scale: 1, labelOpacity: 0, capitalLabelOpacity: 0.5,
  }), 0);
  assert.equal(measures.length, 0);
  assert.equal(owner.drawCityLabelsFromEntries([capital], {
    config: { showCapitalOverlay: false }, scale: 1, labelOpacity: 0.7, capitalLabelOpacity: 0.5,
  }), 1);
  assert.deepEqual(alphas, [0.7]);
});
