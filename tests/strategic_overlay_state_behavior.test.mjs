import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultStrategicOverlayState,
  createDefaultUnitCounterEditorState,
} from "../js/core/state/strategic_overlay_state.js";

test("strategic overlay default state exposes unified editor shapes", () => {
  const defaults = createDefaultStrategicOverlayState();

  assert.equal(defaults.specialZoneEditor.active, false);
  assert.equal(defaults.operationGraphicsEditor.collection, "operationGraphics");
  assert.equal(defaults.operationalLineEditor.kind, "frontline");
  assert.equal(defaults.strategicOverlayUi.activeMode, "idle");
  assert.equal(defaults.unitCounterEditor.presetId, "inf");
  assert.equal(defaults.unitCounterEditor.iconId, "");
  assert.deepEqual(defaults.unitCounterEditor.layoutAnchor, { kind: "feature", key: "", slotIndex: null });
  assert.equal(defaults.unitCounterEditor.attachment, null);
  assert.equal(defaults.unitCounterEditor.returnSelectionId, null);
});

test("unit counter editor factory accepts runtime defaults override", () => {
  const next = createDefaultUnitCounterEditorState({
    renderer: "milstd",
    presetId: "arm",
    organizationPct: 61,
    equipmentPct: 55,
  });

  assert.equal(next.renderer, "milstd");
  assert.equal(next.presetId, "arm");
  assert.equal(next.organizationPct, 61);
  assert.equal(next.equipmentPct, 55);
});
