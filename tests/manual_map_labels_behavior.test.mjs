import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { clearHistory, undoHistory, redoHistory } from "../js/core/history_manager.js";
import { placeMapLabel, updateMapLabel, commitMapLabelMove, deleteMapLabel } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";
import { drawManualMapLabels } from "../js/core/renderer/manual_map_label_render_owner.js";

test("placed labels keep independent reversible history and avoid imported ids", () => {
  clearHistory();
  state.mapLabelEditor.counter = 1;
  state.mapLabels = [normalizeMapLabel({ lon: 1, lat: 1, text: "Old" }, "map_label_8")];
  state.zoomTransform = { x: 0, y: 0, k: 3 };
  const snapshots = [state.mapLabels];
  const id = placeMapLabel({ lon: 2, lat: 4, countryCode: "ger" });
  assert.equal(id, "map_label_9");
  assert.equal(state.mapLabels[1].size, state.mapLabels[0].size);
  snapshots.push(state.mapLabels);
  assert.equal(updateMapLabel(id, { text: "New" }), true);
  snapshots.push(state.mapLabels);
  assert.equal(commitMapLabelMove(id, 12, -40), true);
  snapshots.push(state.mapLabels);
  assert.equal(deleteMapLabel(id), true);
  snapshots.push(state.mapLabels);
  assert.equal(new Set(snapshots).size, 5);
  assert.deepEqual(state.historyPast.map(entry => entry.kind),
    ["place-map-label", "edit-map-label", "move-map-label", "delete-map-label"]);
  for (const expected of snapshots.slice(0, -1).reverse()) {
    assert.equal(undoHistory(), true);
    assert.deepEqual(state.mapLabels, expected);
  }
  for (const expected of snapshots.slice(1)) {
    assert.equal(redoHistory(), true);
    assert.deepEqual(state.mapLabels, expected);
  }
});

test("manual lettering rotates multiline text and reserves each painted line", () => {
  const paints = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate(angle) { assert.equal(angle, Math.PI / 2); },
    globalAlpha: 1, measureText: text => ({ width: text.length * 10 }),
    fillText(text) { paints.push(["fill", text, this.font]); },
    strokeText(text) { paints.push(["stroke", text, this.font]); },
  };
  const label = normalizeMapLabel({ text: "测试\nMap", lon: 4, lat: 5, size: 12, rotation: 90 }, "map_label_1");
  const occupiedBoxes = [];
  const draw = k => drawManualMapLabels({ state: { mapLabels: [label] }, ctx,
    requestChineseTextGlyphs: titles => assert.deepEqual(titles, ["测试\nMap"]),
    projection: point => point, k, occupiedBoxes });
  assert.equal(draw(0.5).size, 0);
  assert.deepEqual(paints, []);
  assert.equal(draw(8).size, 1);
  assert.deepEqual(paints.map(([type, text]) => [type, text]), [
    ["stroke", "测试"], ["fill", "测试"], ["stroke", "Map"], ["fill", "Map"],
  ]);
  assert.match(paints[0][2], /400 12px "Map Noto Serif SC"/);
  assert.equal(ctx.letterSpacing, "1.44px");
  assert.equal(occupiedBoxes.length, 2);
  assert.ok(occupiedBoxes[0].x > occupiedBoxes[1].x);
  assert.ok(occupiedBoxes[1].h > occupiedBoxes[1].w);
});
