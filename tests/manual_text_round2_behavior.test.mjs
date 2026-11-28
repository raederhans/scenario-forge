import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { freezeCountryLabels } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { readMapLabelField, syncMapLabelField } from "../js/ui/sidebar/strategic_panel_view.js";

test("logarithmic sizing doubles per slider unit and editable screen pixels track zoom", () => {
  const slider = { dataset: { labelField: "size" }, type: "range" };
  const number = { dataset: slider.dataset, type: "number" };
  syncMapLabelField(slider, { size: 2.25 }, 8);
  slider.value++;
  assert.ok(Math.abs(readMapLabelField(slider, 8) - 4.5) < 1e-12);
  syncMapLabelField(number, { size: 2.25 }, 8);
  assert.equal(number.value, 18);
  number.value = "19";
  assert.equal(readMapLabelField(number, 8), 19 / 8);
});

test("freezing a tilted title preserves its screen center, size and angle", () => {
  state.mapLabels = [];
  state.zoomTransform = { k: 2, x: 10, y: 20 };
  state.width = state.height = 300;
  state.styleConfig.countryLabels = { sizeScale: 1.25 };
  const records = ["A", "B", "C", "D"].map((countryCode, i) => ({
    countryCode, bounds: { x: i === 3 ? 400 : 40, y: 60, w: 20, h: 40 }, fontSizePx: 25, angle: Math.PI / 4,
  }));
  const projection = { invert: point => point.map(v => v / 2) };
  const name = code => code.toLowerCase();
  const id = freezeCountryLabels(records, projection, name, "A");
  const label = state.mapLabels[0];
  assert.deepEqual([id, label.text, label.countryCode, label.lon, label.lat, label.size, label.rotation],
    [label.id, "", "A", 10, 15, 10, 45]);
});
