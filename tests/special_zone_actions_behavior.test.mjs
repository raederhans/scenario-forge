import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  commitSpecialZoneLayersState,
  ensureManualSpecialZonesState,
  ensureSpecialZoneEditorState,
  activateSpecialZoneMembershipToolState,
  exitSpecialZoneMembershipToolState,
  mutateSpecialZoneLayersStateAction,
  patchSpecialZoneEditorState,
  restoreSpecialZoneSnapshotState,
  setSpecialZoneMembershipBrushModeState,
  setSpecialZonePresetCategoryOpenState,
  setSpecialZonePresetCategoryState,
  setSpecialZonesVisibilityState,
  setSpecialZonesOverlayDirtyState,
  registerSpecialZonesWorkbenchRuntimeHooks,
} from "../js/core/state/actions/special_zone_actions.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

test("special zone editor compatibility preserves valid legacy fields and fills missing fields", () => {
  const vertices = [[1, 2]];
  const target = {
    specialZoneEditor: {
      active: true,
      vertices,
      zoneType: "buffer",
      label: "Legacy",
      counter: "bad",
    },
  };

  const editor = ensureSpecialZoneEditorState(target);

  assert.equal(editor, target.specialZoneEditor);
  assert.equal(editor.active, true);
  assert.equal(editor.vertices, vertices);
  assert.equal(editor.zoneType, "buffer");
  assert.equal(editor.label, "Legacy");
  assert.equal(editor.counter, 1);
  assert.equal(editor.selectedId, null);
});

test("special zone editor ensure preserves legacy object identity and absent active property", () => {
  const editor = {};
  const target = { specialZoneEditor: editor };

  const result = ensureSpecialZoneEditorState(target);

  assert.equal(result, editor);
  assert.equal(Object.hasOwn(result, "active"), false);
  assert.deepEqual(result.vertices, []);
  assert.equal(result.zoneType, "custom");
  assert.equal(result.selectedId, null);
});

test("special zone editor patch preserves absent fields and normalizes explicit values", () => {
  const target = { specialZoneEditor: { active: true, vertices: [[1, 2]], zoneType: "buffer", label: "A", selectedId: "x", counter: 3 } };

  patchSpecialZoneEditorState(target, { zoneType: "", label: 42, selectedId: "  ", counter: 0 });

  assert.equal(target.specialZoneEditor.active, true);
  assert.deepEqual(target.specialZoneEditor.vertices, [[1, 2]]);
  assert.equal(target.specialZoneEditor.zoneType, "custom");
  assert.equal(target.specialZoneEditor.label, "42");
  assert.equal(target.specialZoneEditor.selectedId, null);
  assert.equal(target.specialZoneEditor.counter, 1);
  assert.throws(
    () => patchSpecialZoneEditorState(target, { unknown: true }),
    /unknown specialZoneEditor field: unknown/,
  );
});

test("special zone editor rejects unknown accessor keys without evaluating them", () => {
  let getterCalls = 0;
  const patch = {};
  Object.defineProperty(patch, "unknown", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });

  assert.throws(
    () => patchSpecialZoneEditorState({}, patch),
    /unknown specialZoneEditor field: unknown/,
  );
  assert.equal(getterCalls, 0);
});

test("special zone layer commit uses canonical normalization and owns dirty state", () => {
  const target = { specialZonesOverlayDirty: false };
  const next = commitSpecialZoneLayersState(target, {
    layers: [
      { id: "zone", style: { fill: "#ABC" }, memberFeatureIds: ["b", "a", "a"] },
      { id: "zone", memberFeatureIds: [] },
    ],
    activeLayerId: "zone",
  });

  assert.equal(next, target.specialZoneLayers);
  assert.equal(next.layers.length, 1);
  assert.equal(next.layers[0].style.fill, "#aabbcc");
  assert.deepEqual(next.layers[0].memberFeatureIds, ["a", "b"]);
  assert.equal(target.specialZonesOverlayDirty, true);

  target.specialZonesOverlayDirty = false;
  commitSpecialZoneLayersState(target, next, {}, { markDirty: false });
  assert.equal(target.specialZonesOverlayDirty, false);
});

test("special zone layer mutation action normalizes, mutates, and commits inside the action", () => {
  const target = {
    specialZoneLayers: {
      layers: [{ id: "zone", memberFeatureIds: ["b", "a"] }],
      activeLayerId: "zone",
    },
    specialZonesOverlayDirty: false,
  };

  const next = mutateSpecialZoneLayersStateAction(target, {
    action: "addMembers",
    layerId: "zone",
    featureIds: ["c", "a"],
  });

  assert.equal(next, target.specialZoneLayers);
  assert.deepEqual(next.layers[0].memberFeatureIds, ["a", "b", "c"]);
  assert.equal(target.specialZonesOverlayDirty, true);
});

test("special zone membership tools store string tools and retain runtime hook identity", () => {
  const renderWorkbench = () => {};
  const renderCurrentTarget = () => {};
  const target = {
    currentTool: { toString: () => "select" },
    brushModeEnabled: true,
    specialZoneEditor: { active: true, vertices: [], zoneType: "custom", label: "", selectedId: null, counter: 1 },
  };

  assert.equal(activateSpecialZoneMembershipToolState(target, "brush"), "brush");
  assert.equal(target.specialZonePreviousTool, "select");
  assert.equal(target.currentTool, "special-zone-membership");
  assert.equal(target.brushModeEnabled, false);
  assert.equal(exitSpecialZoneMembershipToolState(target), "select");
  assert.equal(target.currentTool, "select");

  registerSpecialZonesWorkbenchRuntimeHooks(target, { renderWorkbench, renderCurrentTarget });
  assert.equal(target.updateSpecialZonesWorkbenchUIFn, renderWorkbench);
  assert.equal(target.updateSpecialZonesWorkbenchCurrentTargetUIFn, renderCurrentTarget);
});

test("special zone snapshot restore preserves absent properties and normalizes present properties", () => {
  const originalLayers = { version: 1, layers: [], activeLayerId: "", storySteps: [], activeStoryStepId: "", topologyFingerprint: "", diagnostics: [] };
  const target = {
    specialZoneLayers: originalLayers,
    specialZoneMembershipBrushMode: "remove",
    specialZonesOverlayDirty: false,
  };

  const emptyResult = restoreSpecialZoneSnapshotState(target, {});
  assert.deepEqual(emptyResult.updatedKeys, []);
  assert.equal(target.specialZoneLayers, originalLayers);
  assert.equal(target.specialZoneMembershipBrushMode, "remove");
  assert.equal(target.specialZonesOverlayDirty, false);

  const result = restoreSpecialZoneSnapshotState(target, {
    specialZoneLayers: { layers: [{ id: "zone", memberFeatureIds: [] }] },
    specialZoneMembershipBrushMode: "invalid",
  });
  assert.deepEqual(result.updatedKeys, ["specialZoneLayers", "specialZoneMembershipBrushMode"]);
  assert.equal(target.specialZoneLayers.layers[0].id, "zone");
  assert.equal(target.specialZoneMembershipBrushMode, "add");
  assert.equal(target.specialZonesOverlayDirty, true);
});

test("special zone snapshot restore detaches editor vertices from history snapshots", () => {
  const snapshot = {
    specialZoneEditor: {
      active: true,
      vertices: [[1, 2], [3, 4]],
      zoneType: "custom",
      label: "History",
      selectedId: "zone-1",
      counter: 2,
    },
  };
  const target = {};

  restoreSpecialZoneSnapshotState(target, snapshot);

  assert.notEqual(target.specialZoneEditor, snapshot.specialZoneEditor);
  assert.notEqual(target.specialZoneEditor.vertices, snapshot.specialZoneEditor.vertices);
  assert.notEqual(target.specialZoneEditor.vertices[0], snapshot.specialZoneEditor.vertices[0]);
  target.specialZoneEditor.vertices[0][0] = 99;
  snapshot.specialZoneEditor.vertices[1][0] = 77;
  assert.deepEqual(snapshot.specialZoneEditor.vertices[0], [1, 2]);
  assert.deepEqual(target.specialZoneEditor.vertices[1], [3, 4]);
});

test("special zone finite setters normalize brush mode and boolean dirty state", () => {
  const target = {};
  assert.equal(setSpecialZoneMembershipBrushModeState(target, " remove "), "remove");
  assert.equal(setSpecialZoneMembershipBrushModeState(target, "unknown"), "add");
  assert.equal(setSpecialZonePresetCategoryState(target, " conflict "), "conflict");
  assert.deepEqual(setSpecialZonePresetCategoryOpenState(target, " conflict ", true), ["conflict"]);
  assert.deepEqual(setSpecialZonePresetCategoryOpenState(target, "other", true), ["conflict", "other"]);
  assert.deepEqual(setSpecialZonePresetCategoryOpenState(target, "conflict", false), ["other"]);
  assert.equal(setSpecialZonesVisibilityState(target, 1), true);
  assert.equal(setSpecialZonesOverlayDirtyState(target, 0), false);
  assert.throws(() => setSpecialZonesOverlayDirtyState([], true), /target must be an object/);
});

test("special zone visibility delegates to the canonical UI visibility action", () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "js/core/state/actions/special_zone_actions.js"),
    "utf8",
  );
  assert.match(source, /commitUiVisibilityState\(target, \{ showSpecialZones: nextVisible \}\)/);
  assert.doesNotMatch(source, /target\.showSpecialZones\s*=/);
});

test("manual special zone compatibility state is repaired through one action boundary", () => {
  const target = { manualSpecialZones: { type: "FeatureCollection", features: "bad" } };
  const repaired = ensureManualSpecialZonesState(target);
  assert.equal(repaired, target.manualSpecialZones);
  assert.deepEqual(repaired, { type: "FeatureCollection", features: [] });

  const existing = { type: "FeatureCollection", features: [{ id: "zone" }] };
  target.manualSpecialZones = existing;
  assert.equal(ensureManualSpecialZonesState(target), existing);
});
