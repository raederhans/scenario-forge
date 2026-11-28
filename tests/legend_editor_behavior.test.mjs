import assert from "node:assert/strict";
import test from "node:test";
import { LegendManager } from "../js/core/legend_manager.js";

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
});

test("without areas the editor ranks by feature count before taking 200 colors", () => {
  const colors = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ["f" + i, colorAt(i)]));
  colors.extra = colorAt(200);
  const entries = LegendManager.getEditorEntries({ colors });
  assert.equal(entries.length, 200);
  assert.equal(entries[0].color, colorAt(200));
  assert.ok(!entries.some(entry => entry.color === colorAt(199)));
});
