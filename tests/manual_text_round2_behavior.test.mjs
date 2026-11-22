import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { undoHistory } from "../js/core/history_manager.js";
import { normalizeMapLabel, replacesCountryLabel } from "../js/core/state/strategic_overlay_state.js";
import { drawManualMapLabels } from "../js/core/renderer/manual_map_label_render_owner.js";
import { placeMapLabel, updateMapLabel, freezeCountryLabels, applyMapLabelStyleToPreset } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { readMapLabelField, syncMapLabelField } from "../js/ui/sidebar/strategic_panel_view.js";

test("bound notes retain their color source and replace a title only by name or explicit choice", () => {
  for (const [text, replaceCountryName, expected] of [
    ["", null, true], ["GERMANY", null, true], ["Ruhr", null, false], ["Ruhr", true, true], ["", false, false],
  ]) {
    const label = normalizeMapLabel({ lon: 0, lat: 0, countryCode: "ger", text, replaceCountryName }, "a");
    assert.equal(label.countryCode, "GER");
    assert.equal(replacesCountryLabel(label, "Germany"), expected);
  }
});

function paint(raw, k = 1) {
  const label = normalizeMapLabel({ size: 20, lon: 0, lat: 0, countryCode: "ITA", ...raw }, "a");
  const painted = [];
  const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, strokeText() {},
    measureText: () => ({ width: 10 }),
    fillText(text) { painted.push({ text, font: this.font, color: this.fillStyle, alpha: this.globalAlpha }); },
  };
  drawManualMapLabels({ state: { mapLabels: [label], styleConfig: { countryLabels: { sizeScale: 1.3, opacity: 0.6, uppercase: false } } },
    ctx, projection: point => point, k, getCountryName: () => "Italy", occupiedBoxes: [],
    getCountryLabelColors: () => ({ fill: "#112233", stroke: "#fff" }) });
  return painted[0];
}

test("country titles inherit global style and notes retain exact case with independent overrides", () => {
  const title = paint({});
  assert.equal(title.text, "Italy");
  assert.match(title.font, /500 26px/);
  assert.equal(title.alpha, 0.82 * 0.6);
  const note = paint({ text: "Mare Nostrum", italic: true, weight: 600, color: "#123456", opacity: 0.3 });
  assert.equal(note.text, "Mare Nostrum");
  assert.match(note.font, /italic 600 20px/);
  assert.equal(note.color, "#123456");
  assert.equal(note.alpha, 0.82 * 0.3);
  assert.equal(paint({ text: "Roma", uppercase: true }).text, "ROMA");
  assert.equal(paint({ opacity: 0 }), undefined);
});

test("oversized lettering fades out from 120 to 200 screen pixels", () => {
  const note = { text: "Title" };
  assert.equal(paint(note, 6).alpha, 0.82);
  assert.equal(paint(note, 8).alpha, 0.41);
  assert.equal(paint(note, 10), undefined);
});

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

test("placement copies selected styling only and batch styling is one reversible edit", () => {
  state.mapLabels = [];
  state.zoomTransform = { k: 2, x: 0, y: 0 };
  const first = placeMapLabel({ countryCode: "ITA", lon: 0, lat: 0, text: "One" });
  updateMapLabel(first, { preset: "sea", rotation: 12, opacity: 0.5 });
  const other = placeMapLabel({ lon: 1, lat: 2, text: "Two" });
  updateMapLabel(other, { preset: "region" });
  state.mapLabelEditor.selectedId = first;
  const next = placeMapLabel({ lon: 2, lat: 3 });
  const copy = state.mapLabels[2];
  assert.deepEqual([copy.text, copy.countryCode, copy.rotation, copy.italic, copy.color, copy.preset, copy.opacity],
    ["", "", 12, true, "#325d85", "sea", 0.5]);
  updateMapLabel(next, { weight: 600, size: 15 });
  const before = state.mapLabels;
  assert.equal(applyMapLabelStyleToPreset(next), true);
  assert.deepEqual(state.mapLabels[0], { ...before[0], weight: 600, size: 15 });
  assert.deepEqual(state.mapLabels[1], before[1]);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.mapLabels, before);
});

test("freezing a tilted title preserves its screen center, size and angle, and batch freeze skips duplicates", () => {
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
  assert.equal(freezeCountryLabels(records, projection, name), 2);
  assert.equal(freezeCountryLabels(records, projection, name), false);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.mapLabels, [label]);
});
