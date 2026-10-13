import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import {
  captureHistoryState, clearHistory, pushHistoryEntry, canUndoHistory, canRedoHistory, undoHistory, redoHistory,
} from "../js/core/history_manager.js";
import {
  patchLegendState, restoreLegendLabelSnapshotState, setLegendLabelState,
} from "../js/core/state/actions/legend_actions.js";
import { replaceResolvedColorsState } from "../js/core/state/color_state.js";
import {
  commitSpecialZoneLayersState, patchSpecialZoneLegendFieldsState, restoreSpecialZoneLegendSnapshotState,
} from "../js/core/state/actions/special_zone_actions.js";
import { SPECIAL_ZONE_LEGEND_STYLE_KEYS } from "../js/core/legend_csv_schema.js";
import {
  readRegisteredRuntimeHookSource, registerRuntimeHook,
} from "../js/core/state/runtime_hooks.js";

function harness(t) {
  const keys = ["legendLabels", "colors", "sovereigntyByFeatureId", "specialZoneLayers", "specialZonesOverlayDirty",
    "historyPast", "historyFuture", "isDirty", "dirtyRevision", "lastDirtyReason", "activeScenarioId", "scenarioBaselineHash"];
  const original = Object.fromEntries(keys.map(key => [key, state[key]]));
  const hadDocument = Object.hasOwn(globalThis, "document");
  const document = globalThis.document;
  const hookNames = ["refreshColorStateFn", "updateLegendUI", "updateHistoryUIFn", "updateProjectSaveStatusFn"];
  const hooks = new Map(hookNames.map(name => [name, readRegisteredRuntimeHookSource(state, name)]));
  globalThis.document = { getElementById: () => null };
  hooks.forEach((_, name) => registerRuntimeHook(state, name, null));
  clearHistory();
  t.after(() => {
    patchLegendState(state, { legendLabels: original.legendLabels });
    replaceResolvedColorsState(state, original.colors);
    commitSpecialZoneLayersState(state, original.specialZoneLayers, {}, { preserveIdentity: true, markDirty: false });
    for (const key of keys.filter(key => !["legendLabels", "colors", "specialZoneLayers"].includes(key))) state[key] = original[key];
    hooks.forEach((hook, name) => registerRuntimeHook(state, name, hook));
    if (hadDocument) globalThis.document = document;
    else delete globalThis.document;
  });
}

test("legend history captures only requested normalized keys, including deletion sentinels", t => {
  harness(t);
  patchLegendState(state, { legendLabels: { "#aabbcc": "Existing", "#112233": "Unrelated" } });
  assert.deepEqual(captureHistoryState({ legendColors: [" #ABC ", "#AABBCC", "#fff", "red", "__proto__"] }), {
    legendLabels: { "#aabbcc": "Existing", "#ffffff": null },
    legendLabelKeysPresent: JSON.stringify(["#aabbcc"]),
  });
  assert.deepEqual(captureHistoryState(), {});
  assert.deepEqual(captureHistoryState({ legendColors: [] }), {});
  assert.deepEqual(captureHistoryState({ legendColors: ["red", ""] }), {});
});

test("canonical scoped label restoration preserves unrelated keys and ignores invalid colors", () => {
  const originalLabels = { "#aabbcc": "Before", "#223344": "Delete", "#334455": "Also delete",
    "#112233": "  Untouched  ", invalid: "Retained invalid legacy key" };
  const colors = { country: "#112233" };
  const target = { legendLabels: originalLabels, colors };
  const snapshot = Object.assign(Object.create({ "#112233": "Inherited must be ignored" }), {
    "#ABC": "After", "#223344": null, "#334455": undefined, invalid: "Must not overwrite",
  });
  assert.equal(restoreLegendLabelSnapshotState(target, snapshot), true);
  assert.deepEqual(target.legendLabels, { "#aabbcc": "After", "#112233": "  Untouched  ",
    invalid: "Retained invalid legacy key" });
  assert.equal(originalLabels["#aabbcc"], "Before");
  assert.equal(originalLabels["#223344"], "Delete");
  assert.equal(target.colors, colors);
  const restoredLabels = target.legendLabels;
  for (const malformed of [null, [], "invalid", { red: "Ignore" }]) {
    assert.equal(restoreLegendLabelSnapshotState(target, malformed), false);
    assert.equal(target.legendLabels, restoredLabels);
  }
});

test("real undo and redo restore scoped label values and deletions without touching unrelated state", t => {
  harness(t);
  patchLegendState(state, { legendLabels: { "#aabbcc": "Before", "#223344": "Delete me",
    "#112233": "Unrelated" } });
  replaceResolvedColorsState(state, { countryA: "#aabbcc", countryB: "#112233" });
  state.sovereigntyByFeatureId = Object.freeze({ countryA: "AA", countryB: "BB" });
  const unchangedKeys = ["colors", "visualOverrides", "waterRegionOverrides", "sovereignBaseColors",
    "countryPalette", "sovereigntyByFeatureId", "specialZoneLayers", "legendConfig", "legendControl", "legendColorOrder"];
  const unchanged = Object.fromEntries(unchangedKeys.map(key => [key, state[key]]));
  const unchangedValues = JSON.parse(JSON.stringify(unchanged));
  const options = { legendColors: ["#ABC", "#223344", "#334455"] };
  const before = captureHistoryState(options);
  setLegendLabelState(state, "#aabbcc", "After");
  setLegendLabelState(state, "#223344", "");
  setLegendLabelState(state, "#334455", "Added");
  const after = captureHistoryState(options);
  assert.deepEqual(before, { legendLabels: { "#aabbcc": "Before", "#223344": "Delete me", "#334455": null },
    legendLabelKeysPresent: JSON.stringify(["#aabbcc", "#223344"]) });
  assert.deepEqual(after, { legendLabels: { "#aabbcc": "After", "#223344": null, "#334455": "Added" },
    legendLabelKeysPresent: JSON.stringify(["#aabbcc", "#334455"]) });
  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "legend-csv-import" } }), true);
  // A later unrelated edit must survive both scoped restorations.
  setLegendLabelState(state, "#112233", "Unrelated latest value");
  const revision = state.dirtyRevision;
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.legendLabels, { "#aabbcc": "Before", "#223344": "Delete me",
    "#112233": "Unrelated latest value" });
  assert.equal(state.lastDirtyReason, "legend-history");
  assert.equal(state.dirtyRevision, revision + 1);
  assert.equal(state.isDirty, true);
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.legendLabels, { "#aabbcc": "After", "#334455": "Added",
    "#112233": "Unrelated latest value" });
  assert.equal(state.lastDirtyReason, "legend-history");
  assert.equal(state.dirtyRevision, revision + 2);
  for (const key of unchangedKeys) {
    assert.equal(state[key], unchanged[key], `${key} reference must remain intact`);
    assert.deepEqual(state[key], unchangedValues[key], `${key} contents must remain intact`);
  }
});

test("history without an owned label snapshot leaves labels and legend dirty revision intact", t => {
  harness(t);
  patchLegendState(state, { legendLabels: { "#112233": "Untouched" } });
  const labels = state.legendLabels;
  const revision = state.dirtyRevision;
  assert.equal(pushHistoryEntry({ before: {}, after: { legendLabels: { red: "Invalid" } } }), true);
  assert.equal(undoHistory(), true);
  assert.equal(state.legendLabels, labels);
  assert.equal(state.dirtyRevision, revision);
  assert.equal(redoHistory(), true);
  assert.equal(state.legendLabels, labels);
  assert.equal(state.dirtyRevision, revision);
});

test("special-zone legend snapshots use exact unique current IDs and null for absent fields", t => {
  harness(t);
  commitSpecialZoneLayersState(state, { layers: [
    { id: " zone ", style: { fill: "#112233", customStyle: "Preserved" } },
    { id: "duplicate", name: "First" }, { id: "duplicate", name: "Second" },
  ] }, {}, { preserveIdentity: true, markDirty: false });
  const snapshot = captureHistoryState({ legendSpecialZoneIds: [" zone ", " zone ", "zone", "duplicate", "missing"] });
  assert.deepEqual(Object.keys(snapshot), ["specialZoneLegendFields"]);
  assert.deepEqual(JSON.parse(snapshot.specialZoneLegendFields), { " zone ": { name: null,
    style: Object.fromEntries(SPECIAL_ZONE_LEGEND_STYLE_KEYS.map(key => [key, key === "fill" ? "#112233" : null])),
    presence: { name: false, style: true, styleObject: true, styleKeys: ["fill"] },
  } });
});

test("narrow zone actions ignore unsafe fields, skip absent or duplicate targets, and preserve other layer fields", () => {
  const memberFeatureIds = ["B", "A", "B", "unknown"];
  const metadata = { extension: ["Unchanged"] };
  const layer = { id: "one", name: "Before", style: { fill: "#112233", extension: metadata },
    memberFeatureIds, visible: true, legendVisible: true, extension: metadata };
  const duplicateA = { id: "duplicate", name: "First" };
  const duplicateB = { id: "duplicate", name: "Second" };
  const target = { specialZoneLayers: { layers: [layer, duplicateA, duplicateB], extension: metadata } };
  const patches = Object.assign(Object.create({ oneInherited: { name: "Ignore" } }), {
    one: { name: "After", id: "changed", visible: false, legendVisible: false, memberFeatureIds: [], extension: {},
      style: { fill: "#445566", extension: "Ignore", strokeWidth: {}, revision: 4 } },
    missing: { name: "Do not create" }, duplicate: { name: "Ambiguous" },
  });
  assert.deepEqual(patchSpecialZoneLegendFieldsState(target, patches), ["one"]);
  const after = target.specialZoneLayers.layers[0];
  assert.equal(after.id, "one");
  assert.equal(after.name, "After");
  assert.equal(after.visible, true);
  assert.equal(after.legendVisible, true);
  assert.equal(after.memberFeatureIds, memberFeatureIds);
  assert.equal(after.extension, metadata);
  assert.equal(after.style.extension, metadata);
  assert.equal(after.style.fill, "#445566");
  assert.equal(after.style.revision, 4);
  assert.equal(Object.hasOwn(after.style, "strokeWidth"), false);
  assert.equal(target.specialZoneLayers.layers[1], duplicateA);
  assert.equal(target.specialZoneLayers.layers[2], duplicateB);
  assert.equal(target.specialZoneLayers.extension, metadata);
  assert.deepEqual(restoreSpecialZoneLegendSnapshotState(target, JSON.stringify({ one: { name: null,
    style: { revision: null, stroke: "#aabbcc", extension: null } } })), ["one"]);
  const restored = target.specialZoneLayers.layers[0];
  assert.equal(Object.hasOwn(restored, "name"), false);
  assert.equal(Object.hasOwn(restored.style, "revision"), false);
  assert.equal(restored.style.fill, "#445566");
  assert.equal(restored.style.stroke, "#aabbcc");
  assert.equal(restored.style.extension, metadata);
  const reference = target.specialZoneLayers;
  assert.deepEqual(patchSpecialZoneLegendFieldsState(target, { duplicate: { name: "Skip" }, missing: { name: "Skip" } }), []);
  assert.equal(target.specialZoneLayers, reference);
});

test("mixed label and zone undo/redo preserve unsorted memberships, unknown metadata, colors and ownership", t => {
  harness(t);
  patchLegendState(state, { legendLabels: { "#aabbcc": "Before label", "#112233": "Unrelated label" } });
  replaceResolvedColorsState(state, { countryA: "#aabbcc", countryB: "#112233" });
  state.sovereigntyByFeatureId = Object.freeze({ countryA: "AA", countryB: "BB" });
  const members = ["B", "A", "B", "unknown"];
  const metadata = { extension: ["Unchanged"] };
  const zone = { id: "zone", name: "Before zone", visible: false, legendVisible: true,
    memberFeatureIds: members, extension: metadata,
    style: { fill: "#112233", pattern: "solid", revision: 3, extension: metadata } };
  commitSpecialZoneLayersState(state, { layers: [zone, { id: "other", name: "Unrelated zone", style: {} }],
    storySteps: [{ id: "story", layerIds: ["zone"] }], extension: metadata,
  }, {}, { preserveIdentity: true, markDirty: false });
  const ownership = state.sovereigntyByFeatureId;
  const colors = state.colors;
  const steps = state.specialZoneLayers.storySteps;
  const scope = { legendColors: ["#aabbcc"], legendSpecialZoneIds: ["zone"] };
  const before = captureHistoryState(scope);
  setLegendLabelState(state, "#aabbcc", "After label");
  assert.deepEqual(patchSpecialZoneLegendFieldsState(state, { zone: { name: "After zone",
    style: { fill: "#445566", stroke: "#aabbcc", fillOpacity: 0.7, pattern: "dots", revision: 4 } } }), ["zone"]);
  const after = captureHistoryState(scope);
  assert.deepEqual(Object.keys(before), ["legendLabels", "legendLabelKeysPresent", "specialZoneLegendFields"]);
  assert.equal(Object.hasOwn(before, "specialZoneLayers"), false);
  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "legend-csv-import" } }), true);
  setLegendLabelState(state, "#112233", "Unrelated latest label");
  patchSpecialZoneLegendFieldsState(state, { other: { name: "Unrelated latest zone" } });
  const unrelatedZone = state.specialZoneLayers.layers[1];
  const assertUnchanged = () => {
    const current = state.specialZoneLayers.layers[0];
    assert.equal(current.id, "zone");
    assert.equal(current.memberFeatureIds, members);
    assert.deepEqual(current.memberFeatureIds, ["B", "A", "B", "unknown"]);
    assert.equal(current.visible, false);
    assert.equal(current.legendVisible, true);
    assert.equal(current.extension, metadata);
    assert.equal(current.style.extension, metadata);
    assert.equal(state.specialZoneLayers.extension, metadata);
    assert.equal(state.specialZoneLayers.storySteps, steps);
    assert.equal(state.specialZoneLayers.layers[1], unrelatedZone);
    assert.equal(state.specialZoneLayers.layers[1].name, "Unrelated latest zone");
    assert.equal(state.legendLabels["#112233"], "Unrelated latest label");
    assert.equal(state.colors, colors);
    assert.deepEqual(state.colors, { countryA: "#aabbcc", countryB: "#112233" });
    assert.equal(state.sovereigntyByFeatureId, ownership);
    assert.deepEqual(state.sovereigntyByFeatureId, { countryA: "AA", countryB: "BB" });
    assert.equal(state.lastDirtyReason, "legend-history");
  };
  assert.equal(undoHistory(), true);
  assert.equal(state.legendLabels["#aabbcc"], "Before label");
  assert.equal(state.specialZoneLayers.layers[0].name, "Before zone");
  assert.deepEqual(state.specialZoneLayers.layers[0].style, zone.style);
  assert.equal(Object.hasOwn(state.specialZoneLayers.layers[0].style, "stroke"), false);
  assert.equal(Object.hasOwn(state.specialZoneLayers.layers[0].style, "fillOpacity"), false);
  assertUnchanged();
  assert.equal(redoHistory(), true);
  assert.equal(state.legendLabels["#aabbcc"], "After label");
  assert.equal(state.specialZoneLayers.layers[0].name, "After zone");
  assert.equal(state.specialZoneLayers.layers[0].style.fill, "#445566");
  assert.equal(state.specialZoneLayers.layers[0].style.stroke, "#aabbcc");
  assert.equal(state.specialZoneLayers.layers[0].style.fillOpacity, 0.7);
  assert.equal(state.specialZoneLayers.layers[0].style.pattern, "dots");
  assert.equal(state.specialZoneLayers.layers[0].style.revision, 4);
  assertUnchanged();
});

test("zone history restores raw JSON known values exactly and detaches captured and restored objects", t => {
  harness(t);
  const members = ["B", "A", "B"];
  const metadata = { extension: ["Preserved"] };
  const rawPattern = { legacy: ["Unusual existing value"] };
  commitSpecialZoneLayersState(state, { layers: [{ id: "raw", name: "Raw zone", memberFeatureIds: members,
    extension: metadata, style: { fillOpacity: "0.4", pattern: rawPattern, extension: metadata } }] },
  {}, { preserveIdentity: true, markDirty: false });
  const scope = { legendSpecialZoneIds: ["raw"] };
  const before = captureHistoryState(scope);
  assert.notEqual(JSON.parse(before.specialZoneLegendFields).raw.style.pattern, rawPattern);
  assert.deepEqual(JSON.parse(before.specialZoneLegendFields).raw.style.pattern, rawPattern);
  assert.deepEqual(patchSpecialZoneLegendFieldsState(state, { raw: { style: { fillOpacity: 0.8, pattern: "dots" } } }), ["raw"]);
  const after = captureHistoryState(scope);
  assert.equal(pushHistoryEntry({ before, after }), true);
  assert.equal(undoHistory(), true);
  const restored = state.specialZoneLayers.layers[0];
  assert.equal(restored.style.fillOpacity, "0.4");
  assert.deepEqual(restored.style.pattern, rawPattern);
  assert.notEqual(restored.style.pattern, JSON.parse(before.specialZoneLegendFields).raw.style.pattern);
  assert.equal(restored.memberFeatureIds, members);
  assert.equal(restored.extension, metadata);
  assert.equal(restored.style.extension, metadata);
  restored.style.pattern.legacy.push("Later mutation");
  assert.deepEqual(JSON.parse(before.specialZoneLegendFields).raw.style.pattern, { legacy: ["Unusual existing value"] });
  assert.deepEqual(rawPattern, { legacy: ["Unusual existing value"] });
  assert.equal(redoHistory(), true);
  assert.equal(state.specialZoneLayers.layers[0].style.fillOpacity, 0.8);
  assert.equal(state.specialZoneLayers.layers[0].style.pattern, "dots");
  assert.equal(undoHistory(), true);
  assert.equal(state.specialZoneLayers.layers[0].style.fillOpacity, "0.4");
  assert.deepEqual(state.specialZoneLayers.layers[0].style.pattern, rawPattern);
});

test("an exact __proto__ zone ID has an own safe snapshot entry and real undo/redo applies it", t => {
  harness(t);
  const members = ["B", "A"];
  commitSpecialZoneLayersState(state, { layers: [{ id: "__proto__", name: "Before", memberFeatureIds: members,
    style: { fill: "#112233" } }] }, {}, { preserveIdentity: true, markDirty: false });
  const scope = { legendSpecialZoneIds: ["__proto__"] };
  const before = captureHistoryState(scope);
  assert.equal(Object.getPrototypeOf(JSON.parse(before.specialZoneLegendFields)), Object.prototype);
  assert.equal(Object.hasOwn(JSON.parse(before.specialZoneLegendFields), "__proto__"), true);
  assert.equal(JSON.parse(before.specialZoneLegendFields).__proto__.name, "Before");
  const patches = Object.fromEntries([["__proto__", { name: "After", style: { fill: "#445566" } }]]);
  assert.equal(Object.getPrototypeOf(patches), Object.prototype);
  assert.deepEqual(patchSpecialZoneLegendFieldsState(state, patches), ["__proto__"]);
  const after = captureHistoryState(scope);
  assert.equal(pushHistoryEntry({ before, after }), true);
  assert.equal(undoHistory(), true);
  assert.equal(state.specialZoneLayers.layers[0].id, "__proto__");
  assert.equal(state.specialZoneLayers.layers[0].name, "Before");
  assert.equal(state.specialZoneLayers.layers[0].style.fill, "#112233");
  assert.equal(state.specialZoneLayers.layers[0].memberFeatureIds, members);
  assert.equal(redoHistory(), true);
  assert.equal(state.specialZoneLayers.layers[0].name, "After");
  assert.equal(state.specialZoneLayers.layers[0].style.fill, "#445566");
  assert.equal(Object.hasOwn(Object.prototype, "name"), false);
  assert.equal(Object.hasOwn(Object.prototype, "style"), false);
});

test("CSV import undo and redo require matching nonempty scenario and baseline scope without popping blocked entries", t => {
  harness(t);
  state.activeScenarioId = "scenario-a";
  state.scenarioBaselineHash = "baseline-a";
  patchLegendState(state, { legendLabels: { "#112233": "Before label" } });
  commitSpecialZoneLayersState(state, { layers: [{ id: "shared-zone", name: "Before zone", style: {} }] },
    {}, { preserveIdentity: true, markDirty: false });
  const scope = { legendColors: ["#112233"], legendSpecialZoneIds: ["shared-zone"] };
  const before = captureHistoryState(scope);
  setLegendLabelState(state, "#112233", "After label");
  patchSpecialZoneLegendFieldsState(state, { "shared-zone": { name: "After zone" } });
  const after = captureHistoryState(scope);
  assert.equal(pushHistoryEntry({ kind: "legend-csv-import", before, after,
    meta: { scenarioId: "scenario-a", scenarioBaselineHash: "baseline-a" } }), true);
  assert.equal(canUndoHistory(), true);
  const assertBlocked = direction => {
    const past = state.historyPast;
    const future = state.historyFuture;
    const pastEntries = [...past];
    const futureEntries = [...future];
    const labels = state.legendLabels;
    const zones = state.specialZoneLayers;
    const revision = state.dirtyRevision;
    assert.equal(direction === "undo" ? canUndoHistory() : canRedoHistory(), false);
    assert.equal(direction === "undo" ? undoHistory() : redoHistory(), false);
    assert.equal(state.historyPast, past);
    assert.equal(state.historyFuture, future);
    assert.deepEqual(state.historyPast, pastEntries);
    assert.deepEqual(state.historyFuture, futureEntries);
    assert.equal(state.legendLabels, labels);
    assert.equal(state.specialZoneLayers, zones);
    assert.equal(state.dirtyRevision, revision);
  };
  state.activeScenarioId = "scenario-b";
  assertBlocked("undo");
  state.activeScenarioId = "scenario-a";
  state.scenarioBaselineHash = "baseline-b";
  assertBlocked("undo");
  state.scenarioBaselineHash = "baseline-a";
  assert.equal(canUndoHistory(), true);
  assert.equal(undoHistory(), true);
  assert.equal(state.legendLabels["#112233"], "Before label");
  assert.equal(state.specialZoneLayers.layers[0].name, "Before zone");
  assert.equal(canRedoHistory(), true);
  state.activeScenarioId = "scenario-b";
  assertBlocked("redo");
  state.activeScenarioId = "scenario-a";
  state.scenarioBaselineHash = "baseline-b";
  assertBlocked("redo");
  state.scenarioBaselineHash = "baseline-a";
  assert.equal(redoHistory(), true);
  assert.equal(state.legendLabels["#112233"], "After label");
  assert.equal(state.specialZoneLayers.layers[0].name, "After zone");
});

test("CSV history missing scope stays blocked while unrelated history retains existing behavior", t => {
  harness(t);
  const before = { legendLabels: { "#112233": "Before" } };
  const after = { legendLabels: { "#112233": "After" } };
  state.activeScenarioId = "scenario-a";
  state.scenarioBaselineHash = "baseline-a";
  for (const meta of [undefined, {}, { scenarioId: "", scenarioBaselineHash: "baseline-a" },
    { scenarioId: "scenario-a", scenarioBaselineHash: "" }]) {
    clearHistory();
    assert.equal(pushHistoryEntry({ kind: "legend-csv-import", before, after, meta }), true);
    const entry = state.historyPast.at(-1);
    assert.equal(canUndoHistory(), false);
    assert.equal(undoHistory(), false);
    assert.equal(state.historyPast.at(-1), entry);
    assert.equal(state.historyFuture.length, 0);
  }
  clearHistory();
  state.activeScenarioId = "different-scenario";
  state.scenarioBaselineHash = "different-baseline";
  assert.equal(pushHistoryEntry({ kind: "legend-edit", before, after }), true);
  assert.equal(canUndoHistory(), true);
  assert.equal(undoHistory(), true);
  assert.equal(state.legendLabels["#112233"], "Before");
  assert.equal(canRedoHistory(), true);
  assert.equal(redoHistory(), true);
  assert.equal(state.legendLabels["#112233"], "After");
});

test("name-only zone undo and redo preserve explicit nulls and exact container and name presence", t => {
  harness(t);
  const members = ["B", "A", "B"];
  const metadata = { extension: ["Preserved"] };
  const originalLayers = [
    { id: "own-nulls", name: null, style: { stroke: null, fillOpacity: null, extra: "keep" },
      memberFeatureIds: members, extension: metadata },
    { id: "absent-style", name: "Before", memberFeatureIds: members, extension: metadata },
    { id: "null-style", name: null, style: null, memberFeatureIds: members, extension: metadata },
    { id: "empty-style", style: {}, memberFeatureIds: members, extension: metadata },
    { id: "raw-name", name: { legacy: ["Raw name"] }, style: {}, memberFeatureIds: members, extension: metadata },
  ];
  commitSpecialZoneLayersState(state, { layers: originalLayers }, {}, { preserveIdentity: true, markDirty: false });
  const scope = { legendSpecialZoneIds: originalLayers.map(layer => layer.id) };
  const before = captureHistoryState(scope);
  assert.deepEqual(JSON.parse(before.specialZoneLegendFields)["own-nulls"].presence,
    { name: true, style: true, styleObject: true, styleKeys: ["stroke", "fillOpacity"] });
  assert.deepEqual(JSON.parse(before.specialZoneLegendFields)["absent-style"].presence,
    { name: true, style: false, styleObject: false, styleKeys: [] });
  assert.deepEqual(JSON.parse(before.specialZoneLegendFields)["null-style"].presence,
    { name: true, style: true, styleObject: false, styleKeys: [] });
  assert.equal(JSON.parse(before.specialZoneLegendFields)["null-style"].styleContainerValue, null);
  assert.equal(Object.hasOwn(JSON.parse(before.specialZoneLegendFields)["absent-style"], "styleContainerValue"), false);
  assert.equal(JSON.parse(before.specialZoneLegendFields)["empty-style"].presence.name, false);
  const patches = Object.fromEntries(originalLayers.map(layer => [layer.id, { name: `After ${layer.id}` }]));
  assert.deepEqual(patchSpecialZoneLegendFieldsState(state, patches), scope.legendSpecialZoneIds);
  const after = captureHistoryState(scope);
  assert.equal(pushHistoryEntry({ before, after }), true);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.specialZoneLayers.layers, originalLayers);
  const restored = new Map(state.specialZoneLayers.layers.map(layer => [layer.id, layer]));
  assert.equal(Object.hasOwn(restored.get("own-nulls"), "name"), true);
  assert.equal(restored.get("own-nulls").name, null);
  assert.equal(Object.hasOwn(restored.get("own-nulls").style, "stroke"), true);
  assert.equal(restored.get("own-nulls").style.stroke, null);
  assert.equal(Object.hasOwn(restored.get("own-nulls").style, "fillOpacity"), true);
  assert.equal(restored.get("own-nulls").style.fillOpacity, null);
  assert.equal(restored.get("own-nulls").style.extra, "keep");
  assert.equal(Object.hasOwn(restored.get("absent-style"), "style"), false);
  assert.equal(Object.hasOwn(restored.get("null-style"), "style"), true);
  assert.equal(restored.get("null-style").style, null);
  assert.deepEqual(restored.get("empty-style").style, {});
  assert.equal(Object.hasOwn(restored.get("empty-style"), "name"), false);
  assert.deepEqual(restored.get("raw-name").name, { legacy: ["Raw name"] });
  assert.notEqual(restored.get("raw-name").name, JSON.parse(before.specialZoneLegendFields)["raw-name"].name);
  for (const layer of restored.values()) {
    assert.equal(layer.memberFeatureIds, members);
    assert.equal(layer.extension, metadata);
  }
  assert.equal(redoHistory(), true);
  for (const layer of state.specialZoneLayers.layers) {
    assert.equal(layer.name, `After ${layer.id}`);
    assert.equal(layer.memberFeatureIds, members);
    assert.equal(layer.extension, metadata);
  }
  assert.equal(Object.hasOwn(state.specialZoneLayers.layers[1], "style"), false);
  assert.equal(state.specialZoneLayers.layers[2].style, null);
  assert.equal(state.specialZoneLayers.layers[0].style.stroke, null);
});

test("scoped zone rollback restores absent/null containers after style updates and retains later unknown metadata", t => {
  harness(t);
  commitSpecialZoneLayersState(state, { layers: [{ id: "absent" }, { id: "null", style: null }] },
    {}, { preserveIdentity: true, markDirty: false });
  const scope = { legendSpecialZoneIds: ["absent", "null"] };
  const before = captureHistoryState(scope);
  patchSpecialZoneLegendFieldsState(state, { absent: { style: { stroke: "#112233" } },
    null: { style: { fill: "#445566" } } });
  assert.equal(pushHistoryEntry({ before, after: captureHistoryState(scope) }), true);
  assert.equal(undoHistory(), true);
  assert.equal(Object.hasOwn(state.specialZoneLayers.layers[0], "style"), false);
  assert.equal(Object.hasOwn(state.specialZoneLayers.layers[1], "style"), true);
  assert.equal(state.specialZoneLayers.layers[1].style, null);
  assert.equal(redoHistory(), true);
  const laterMetadata = { extension: ["Keep new unknown data"] };
  state.specialZoneLayers.layers[0].style.extra = laterMetadata;
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.specialZoneLayers.layers[0].style, { extra: laterMetadata });
  assert.equal(state.specialZoneLayers.layers[0].style.extra, laterMetadata);
  assert.equal(state.specialZoneLayers.layers[1].style, null);
});

test("scoped label undo restores an own null exactly while deleting originally absent labels", t => {
  harness(t);
  patchLegendState(state, { legendLabels: { "#112233": null, "#aabbcc": "Unrelated" } });
  const colors = state.colors;
  const ownership = state.sovereigntyByFeatureId;
  const scope = { legendColors: ["#112233", "#445566"] };
  const before = captureHistoryState(scope);
  assert.deepEqual(before, { legendLabels: { "#112233": null, "#445566": null },
    legendLabelKeysPresent: JSON.stringify(["#112233"]) });
  setLegendLabelState(state, "#112233", "Updated");
  setLegendLabelState(state, "#445566", "Added");
  const after = captureHistoryState(scope);
  assert.deepEqual(JSON.parse(after.legendLabelKeysPresent), ["#112233", "#445566"]);
  assert.equal(pushHistoryEntry({ before, after }), true);
  assert.equal(undoHistory(), true);
  assert.equal(Object.hasOwn(state.legendLabels, "#112233"), true);
  assert.equal(state.legendLabels["#112233"], null);
  assert.equal(Object.hasOwn(state.legendLabels, "#445566"), false);
  assert.equal(state.legendLabels["#aabbcc"], "Unrelated");
  assert.equal(state.colors, colors);
  assert.equal(state.sovereigntyByFeatureId, ownership);
  assert.equal(redoHistory(), true);
  assert.equal(state.legendLabels["#112233"], "Updated");
  assert.equal(state.legendLabels["#445566"], "Added");
  assert.equal(state.legendLabels["#aabbcc"], "Unrelated");
  assert.equal(state.colors, colors);
  assert.equal(state.sovereigntyByFeatureId, ownership);
  // Existing manual helper calls keep the legacy null-delete convention.
  const target = { legendLabels: { "#112233": "Legacy" } };
  assert.equal(restoreLegendLabelSnapshotState(target, { "#112233": null }), true);
  assert.equal(Object.hasOwn(target.legendLabels, "#112233"), false);
});
