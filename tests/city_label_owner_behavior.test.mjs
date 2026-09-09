import assert from "node:assert/strict";
import test from "node:test";
import { createCityLabelOwner } from "../js/core/renderer/city_label_owner.js";
import { claimScreenLabelPlacement } from "../js/core/renderer/screen_label_placement.js";

function fixture() {
  const calls = [];
  let viewport = { width: 100, height: 100 };
  let context = {
    save() {}, restore() {}, measureText: () => ({ width: 20 }),
    strokeText() {}, fillText: (...args) => calls.push(args),
  };
  const owner = createCityLabelOwner({
    getters: { getContext: () => context, getViewportSize: () => viewport },
    helpers: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getCityVisualCapitalState: () => false,
      getCityDisplayLabel: () => "City", formatCityMapLabel: (text) => text,
      getCityLabelMinZoom: () => 0, getCityMarkerSizePx: () => 4,
      getCityLabelRenderStyle: () => ({ usesLightLabel: true, shadowBlurFactor: 0.1, shadowOffsetYFactor: 0.1, strokeWidthFactor: 0.1 }),
    },
  });
  return { owner, calls, setViewport: (next) => { viewport = next; }, setContext: (next) => { context = next; } };
}

test("label owner resolves placement collisions in its own stable order", () => {
  const { owner, calls } = fixture();
  const entries = Array.from({ length: 3 }, () => ({ anchor: [50, 50], screenPoint: [50, 50] }));
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: {}, scale: 1 }), 2);
  assert.deepEqual(entries.map((entry) => entry.acceptedLabelPlacement), ["right", "left", undefined]);
  assert.deepEqual(calls, [["City", 58, 50], ["City", 42, 50]]);
  assert.ok(entries.slice(0, 2).every((entry) => entry.labelContrastMode === "light"));
});

test("label placement uses live viewport and divides screen offsets by zoom", () => {
  const { owner, calls, setViewport } = fixture();
  const entry = { anchor: [20, 25], screenPoint: [120, 50] };
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 2 }), 1);
  assert.equal(entry.acceptedLabelPlacement, "left");
  assert.deepEqual(calls[0], ["City", 16, 25]);
  setViewport({ width: 200, height: 100 });
  assert.equal(owner.drawCityLabelsFromEntries([entry], { config: {}, scale: 2 }), 1);
  assert.equal(entry.acceptedLabelPlacement, "right");
  assert.deepEqual(calls[1], ["City", 24, 25]);
});

test("label owner skips missing anchors, offscreen labels, and detached context", () => {
  const { owner, calls, setContext } = fixture();
  const entries = [{ screenPoint: [50, 50] }, { anchor: [1000, 1000], screenPoint: [1000, 1000] }];
  assert.equal(owner.drawCityLabelsFromEntries(entries, { config: {}, scale: 1 }), 0);
  assert.deepEqual(calls, []);
  setContext(null);
  assert.equal(owner.drawCityLabelsFromEntries([{ anchor: [0, 0], screenPoint: [0, 0] }], { config: {}, scale: 1 }), 0);
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
