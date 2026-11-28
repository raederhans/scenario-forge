import assert from "node:assert/strict";
import test from "node:test";
import { createCityLabelOwner } from "../js/core/renderer/city_label_owner.js";

function fixture(getPaintBounds = () => null) {
  const calls = [];
  let viewport = { width: 100, height: 100 };
  const context = {
    save() {}, restore() {}, measureText: () => ({ width: 20 }),
    strokeText() {}, fillText: (...args) => calls.push(args),
  };
  const owner = createCityLabelOwner({
    getters: { getContext: () => context, getViewportSize: () => viewport, getPaintBounds },
    helpers: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getCityVisualCapitalState: (entry, config) => entry.isCapital && config?.showCapitalOverlay !== false,
      getCityDisplayLabel: () => "City", formatCityMapLabel: (text) => text,
      getCityLabelMinZoom: () => 0, getCityMarkerSizePx: () => 4,
      getCityLabelRenderStyle: () => ({ usesLightLabel: true, shadowBlurFactor: 0.1, shadowOffsetYFactor: 0.1, strokeWidthFactor: 0.1 }),
    },
  });
  return { owner, calls, setViewport: next => { viewport = next; } };
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
