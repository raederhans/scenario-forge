import test from "node:test";
import assert from "node:assert/strict";

import {
  SPECIAL_ZONE_PRESETS,
  buildSpecialZoneRenderFeatures,
  captureScenarioLayerSaveRequestState,
  createEmptySpecialZoneLayersState,
  createLayerFromPreset,
  getSpecialZoneLayerMemberSetOperationIds,
  getSpecialZoneStoryPreviewSteps,
  mutateSpecialZoneLayersState,
  normalizeSpecialZoneLayersState,
  parseSpecialZoneMemberImportText,
  resolveSpecialZoneTopologyFingerprint,
  serializeSpecialZoneLayersState,
  updateSpecialZoneLayerMembership,
} from "../js/core/special_zone_layers.js";

import {
  commitSpecialZoneLayersState,
  mutateSpecialZoneLayersStateAction,
} from "../js/core/state/actions/special_zone_actions.js";
import { createSpecialZoneLayersRenderOwner } from "../js/core/renderer/special_zone_layers_render_owner.js";

test("special zone layer defaults and preset registry are stable", () => {
  const state = createEmptySpecialZoneLayersState({ topologyFingerprint: "topo-a" });
  assert.equal(state.version, 1);
  assert.equal(state.topologyFingerprint, "topo-a");
  assert.equal(state.activeLayerId, "");
  assert.equal(state.layers.length, 0);
  assert.deepEqual(state.storySteps, []);
  assert.equal(state.activeStoryStepId, "");
  assert.equal(SPECIAL_ZONE_PRESETS.length, 7);
  const layer = createLayerFromPreset("custom", { id: "legend-default" });
  assert.equal(layer.legendVisible, true);
});

test("canonical layer actions preserve dirty state and diagnostic entry identity", () => {
  const initialLayers = createEmptySpecialZoneLayersState();
  const diagnostic = { code: "runtime-diagnostic" };
  initialLayers.diagnostics = [diagnostic];

  for (const initialDirty of [false, true]) {
    const target = {
      specialZoneLayers: initialLayers,
      specialZonesOverlayDirty: initialDirty,
    };
    const committed = commitSpecialZoneLayersState(target, initialLayers, {
      topologyFingerprint: "runtime-topology",
    }, { markDirty: false });
    assert.equal(target.specialZonesOverlayDirty, initialDirty);
    assert.equal(committed, target.specialZoneLayers);
    assert.equal(committed.topologyFingerprint, "runtime-topology");
    assert.equal(committed.diagnostics[0], diagnostic);
  }

  const mutatedTarget = {
    specialZoneLayers: initialLayers,
    specialZonesOverlayDirty: false,
  };
  const mutationResult = mutateSpecialZoneLayersStateAction(mutatedTarget, {
    action: "addLayer",
    layer: createLayerFromPreset("custom", { id: "dirty-layer" }),
  });
  assert.equal(mutationResult, mutatedTarget.specialZoneLayers);
  assert.equal(mutatedTarget.specialZonesOverlayDirty, true);
});

test("renderer normalizes layer input without writing runtime state", () => {
  const originalLayers = {
    layers: [createLayerFromPreset("custom", { id: "render-layer", memberFeatureIds: ["land-a"] })],
    activeLayerId: "render-layer",
    diagnostics: [{ code: "render-diagnostic" }],
  };
  const runtimeState = {
    specialZoneLayers: originalLayers,
    landIndex: new Map([["land-a", {
      type: "Feature",
      properties: { id: "land-a" },
      geometry: { type: "Polygon", coordinates: [] },
    }]]),
  };
  const owner = createSpecialZoneLayersRenderOwner({ state: runtimeState });

  const collection = owner.getEffectiveSpecialZonesFeatureCollection();

  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties.sourceFeatureId, "land-a");
  assert.equal(runtimeState.specialZoneLayers, originalLayers);
  assert.equal(runtimeState.specialZoneLayers.diagnostics[0].code, "render-diagnostic");
});

test("normalizes schema, diagnostics, legacy drops, and sorted member arrays", () => {
  const normalized = normalizeSpecialZoneLayersState({
    topologyFingerprint: "old-topo",
    manualSpecialZones: { type: "FeatureCollection", features: [] },
    layers: [
      {
        id: "layer-a",
        name: "Layer A",
        source: "scenario",
        legendVisible: false,
        style: { fill: "#ABC", pattern: "dots" },
        memberFeatureIds: ["b", "", "a", "missing", "a"],
      },
      { id: "layer-a", memberFeatureIds: ["b"] },
    ],
    activeLayerId: "layer-a",
  }, {
    topologyFingerprint: "new-topo",
    validFeatureIds: new Set(["a", "b"]),
  });

  assert.equal(normalized.topologyFingerprint, "new-topo");
  assert.equal(normalized.layers.length, 1);
  assert.deepEqual(normalized.layers[0].memberFeatureIds, ["a", "b"]);
  assert.equal(normalized.layers[0].legendVisible, false);
  assert.equal(normalized.layers[0].style.fill, "#aabbcc");
  assert.ok(normalized.diagnostics.some((entry) => entry.code === "topology_fingerprint_mismatch"));
  assert.ok(normalized.diagnostics.some((entry) => entry.code === "legacy_special_zone_fields_dropped"));
  assert.ok(normalized.diagnostics.some((entry) => entry.code === "invalid_feature_id" && entry.featureId === "missing"));
  assert.ok(normalized.diagnostics.some((entry) => entry.code === "duplicate_layer_id_dropped"));
  const normalizedAgain = normalizeSpecialZoneLayersState(normalized, { topologyFingerprint: "new-topo" });
  assert.equal(
    normalizedAgain.diagnostics.filter((entry) => entry.code === "topology_fingerprint_mismatch").length,
    1
  );
});

test("topology fingerprint resolves from active scenario runtime state", () => {
  assert.equal(resolveSpecialZoneTopologyFingerprint({ scenarioBaselineHash: "baseline-a" }), "baseline-a");
  assert.equal(
    resolveSpecialZoneTopologyFingerprint({
      activeScenarioManifest: { source: { runtime_topology_sha256: "runtime-sha" } },
    }),
    "runtime-sha"
  );
});

test("mutations cover CRUD, reorder, style, and membership operations", () => {
  let state = createEmptySpecialZoneLayersState();
  const first = createLayerFromPreset("disputed", { id: "a", memberFeatureIds: ["1"] });
  const second = createLayerFromPreset("wasteland", { id: "b", memberFeatureIds: ["2"] });

  state = mutateSpecialZoneLayersState(state, { action: "addLayer", layer: first });
  state = mutateSpecialZoneLayersState(state, { action: "addLayer", layer: second });
  assert.equal(state.activeLayerId, "b");

  state = mutateSpecialZoneLayersState(state, { action: "setActiveLayer", layerId: "a" });
  assert.equal(state.activeLayerId, "a");

  state = mutateSpecialZoneLayersState(state, { action: "addMembers", layerId: "a", featureIds: ["3", "2"] });
  assert.deepEqual(state.layers.find((layer) => layer.id === "a").memberFeatureIds, ["1", "2", "3"]);

  state = mutateSpecialZoneLayersState(state, { action: "toggleMembers", layerId: "a", featureIds: ["2", "4"] });
  assert.deepEqual(state.layers.find((layer) => layer.id === "a").memberFeatureIds, ["1", "3", "4"]);

  state = mutateSpecialZoneLayersState(state, { action: "replaceMembers", layerId: "a", featureIds: ["9", "8"] });
  assert.deepEqual(state.layers.find((layer) => layer.id === "a").memberFeatureIds, ["8", "9"]);

  state = mutateSpecialZoneLayersState(state, { action: "applyMemberSetOperation", layerId: "a", sourceLayerId: "b", operation: "union" });
  assert.deepEqual(state.layers.find((layer) => layer.id === "a").memberFeatureIds, ["2", "8", "9"]);

  state = mutateSpecialZoneLayersState(state, { action: "updateLayer", layerId: "a", patch: { name: "Renamed", style: { fill: "#112233", revision: 5 } } });
  assert.equal(state.layers.find((layer) => layer.id === "a").name, "Renamed");
  assert.equal(state.layers.find((layer) => layer.id === "a").style.revision, 5);

  state = mutateSpecialZoneLayersState(state, { action: "duplicateLayer", layerId: "a", newLayerId: "a-copy" });
  assert.ok(state.layers.some((layer) => layer.id === "a-copy"));

  state = mutateSpecialZoneLayersState(state, { action: "reorderLayers", layerIds: ["a-copy", "b", "a"] });
  assert.deepEqual(state.layers.map((layer) => layer.id), ["a-copy", "b", "a"]);

  state = mutateSpecialZoneLayersState(state, { action: "deleteLayer", layerId: "b" });
  assert.deepEqual(state.layers.map((layer) => layer.id), ["a-copy", "a"]);
});

test("batch import helpers and set operations keep member ids stable", () => {
  assert.deepEqual(parseSpecialZoneMemberImportText(" b, a\na;;b   c "), ["a", "b", "c"]);
  assert.deepEqual(getSpecialZoneLayerMemberSetOperationIds(["a", "b"], ["b", "c"], "union"), ["a", "b", "c"]);
  assert.deepEqual(getSpecialZoneLayerMemberSetOperationIds(["a", "b"], ["b", "c"], "subtract"), ["a"]);
  assert.deepEqual(getSpecialZoneLayerMemberSetOperationIds(["a"], ["a"], "subtract"), []);
  assert.deepEqual(getSpecialZoneLayerMemberSetOperationIds(["a", "b"], ["b", "c"], "intersect"), ["b"]);
  assert.deepEqual(getSpecialZoneLayerMemberSetOperationIds(["a"], ["b"], "intersect"), []);
});

test("story steps normalize and preview from explicit or visible layers", () => {
  let state = createEmptySpecialZoneLayersState();
  state = mutateSpecialZoneLayersState(state, {
    action: "addLayer",
    layer: createLayerFromPreset("custom", { id: "layer-a", name: "Layer A", memberFeatureIds: ["a"] }),
  });
  state = mutateSpecialZoneLayersState(state, {
    action: "addLayer",
    layer: createLayerFromPreset("buffer", { id: "layer-b", name: "Layer B", memberFeatureIds: ["b"] }),
  });
  assert.deepEqual(getSpecialZoneStoryPreviewSteps(state).map((step) => step.title), ["Layer A", "Layer B"]);

  state = mutateSpecialZoneLayersState(state, {
    action: "setStorySteps",
    storySteps: [
      { id: "intro", title: "Intro", layerIds: ["layer-b", "missing"], focusFeatureId: "b" },
    ],
    activeStoryStepId: "intro",
  });
  assert.equal(state.activeStoryStepId, "intro");
  assert.deepEqual(state.storySteps[0].layerIds, ["layer-b"]);
  assert.deepEqual(serializeSpecialZoneLayersState(state).storySteps[0].layerIds, ["layer-b"]);
  const preview = getSpecialZoneStoryPreviewSteps(state);
  assert.equal(preview[0].title, "Intro");
  assert.equal(preview[0].layers[0].id, "layer-b");
});

test("serialization and render feature bridge preserve canonical ids", () => {
  let state = createEmptySpecialZoneLayersState();
  state = mutateSpecialZoneLayersState(state, {
    action: "addLayer",
    layer: createLayerFromPreset("neutral", { id: "neutral", memberFeatureIds: ["2", "1"], legendVisible: false }),
  });
  state = updateSpecialZoneLayerMembership(state, "neutral", "3", "add");
  const serialized = serializeSpecialZoneLayersState(state);
  assert.deepEqual(serialized.layers[0].memberFeatureIds, ["1", "2", "3"]);
  assert.equal(serialized.layers[0].legendVisible, false);

  const featureById = new Map([
    ["1", { type: "Feature", properties: { id: "1" }, geometry: { type: "Polygon", coordinates: [] } }],
    ["3", { type: "Feature", properties: { id: "3" }, geometry: { type: "Polygon", coordinates: [] } }],
  ]);
  const rendered = buildSpecialZoneRenderFeatures(serialized, featureById);
  assert.equal(rendered.features.length, 2);
  assert.deepEqual(rendered.features.map((feature) => feature.properties.sourceFeatureId), ["1", "3"]);
  assert.equal(rendered.features[0].properties.__specialZoneLayerId, "neutral");

  const hiddenMapLayer = serializeSpecialZoneLayersState(mutateSpecialZoneLayersState(serialized, {
    action: "updateLayer",
    layerId: "neutral",
    patch: { visible: false, legendVisible: true },
  }));
  assert.equal(buildSpecialZoneRenderFeatures(hiddenMapLayer, featureById).features.length, 0);
});

test("serialization detaches diagnostic entries from the input state", () => {
  const fixtureState = createEmptySpecialZoneLayersState();
  fixtureState.diagnostics.push({ code: "detached", detail: "input" });

  const serialized = serializeSpecialZoneLayersState(fixtureState);
  assert.notEqual(serialized.diagnostics[0], fixtureState.diagnostics[0]);

  serialized.diagnostics[0].detail = "serialized";
  assert.equal(fixtureState.diagnostics[0].detail, "input");

  fixtureState.diagnostics[0].detail = "mutated-input";
  assert.equal(serialized.diagnostics[0].detail, "serialized");
});

test("scenario layer save capture detaches the queued request from runtime state", () => {
  const saveSource = {
    activeScenarioId: " tno_1962 ",
    currentScenarioApplyRequestId: 7,
    activeScenarioManifest: {
      special_zone_layers_url: "data/scenarios/tno_1962/special_zone_layers.json",
      source: { runtime_topology_sha256: "topology-a" },
    },
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", {
        id: "layer-a",
        memberFeatureIds: ["b", "a"],
      })],
      activeLayerId: "layer-a",
      diagnostics: [{ code: "fixture", detail: "runtime" }],
    },
  };

  const request = captureScenarioLayerSaveRequestState(saveSource, 12);

  assert.equal(request.scenarioId, "tno_1962");
  assert.equal(request.saveRequestId, 12);
  assert.deepEqual(request.loadContext, {
    scenarioId: "tno_1962",
    scenarioApplyRequestId: 7,
    declaresLayerAsset: true,
  });
  assert.deepEqual(request.requestedState.layers[0].memberFeatureIds, ["a", "b"]);
  assert.equal(request.requestedState.topologyFingerprint, "topology-a");

  request.requestedState.layers[0].memberFeatureIds.push("captured-only");
  request.requestedState.diagnostics[0].detail = "captured";
  assert.deepEqual(saveSource.specialZoneLayers.layers[0].memberFeatureIds, ["a", "b"]);
  assert.equal(saveSource.specialZoneLayers.diagnostics[0].detail, "runtime");

  saveSource.specialZoneLayers.layers[0].name = "runtime-only";
  saveSource.specialZoneLayers.diagnostics[0].detail = "mutated-runtime";
  assert.notEqual(request.requestedState.layers[0].name, "runtime-only");
  assert.equal(request.requestedState.diagnostics[0].detail, "captured");
});

test("style preset updates preserve members and replace mode keeps one explicit set", () => {
  let state = createEmptySpecialZoneLayersState();
  state = mutateSpecialZoneLayersState(state, {
    action: "addLayer",
    layer: createLayerFromPreset("custom", { id: "active", memberFeatureIds: ["2", "1"] }),
  });

  const disputed = SPECIAL_ZONE_PRESETS.find((preset) => preset.id === "claim");
  state = mutateSpecialZoneLayersState(state, {
    action: "updateLayer",
    layerId: "active",
    patch: {
      presetId: "custom",
      category: "custom",
      style: { fill: "#112233", revision: 10 },
    },
  });

  let layer = state.layers.find((entry) => entry.id === "active");
  assert.equal(layer.presetId, "custom");
  assert.equal(layer.category, "custom");
  assert.deepEqual(layer.memberFeatureIds, ["1", "2"]);

  state = mutateSpecialZoneLayersState(state, {
    action: "updateLayer",
    layerId: "active",
    patch: {
      presetId: disputed.id,
      category: disputed.category,
      style: { ...disputed.style, revision: 9 },
    },
  });

  layer = state.layers.find((entry) => entry.id === "active");
  assert.equal(layer.presetId, "claim");
  assert.equal(layer.style.fill, disputed.style.fill);
  assert.deepEqual(layer.memberFeatureIds, ["1", "2"]);

  state = updateSpecialZoneLayerMembership(state, "active", "9", "replace");
  layer = state.layers.find((entry) => entry.id === "active");
  assert.deepEqual(layer.memberFeatureIds, ["9"]);

  state = updateSpecialZoneLayerMembership(state, "active", [], "replace");
  layer = state.layers.find((entry) => entry.id === "active");
  assert.deepEqual(layer.memberFeatureIds, []);
});


test("render projection copies layer metadata while retaining land geometry", () => {
  const layer = createLayerFromPreset("custom", { id: "copy-proof", memberFeatureIds: ["a"] });
  const layerState = { layers: [layer], diagnostics: [{ code: "preserved" }] };
  const freezeTree = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeTree);
      Object.freeze(value);
    }
    return value;
  };
  freezeTree(layerState);
  const geometry = { type: "Polygon", coordinates: [] };
  const nestedProperty = { label: "borrowed" };
  const index = new Map([["a", { type: "Feature", geometry, properties: { nestedProperty } }]]);
  const projected = buildSpecialZoneRenderFeatures(layerState, index).features[0];
  assert.equal(projected.geometry, geometry);
  assert.equal(projected.properties.nestedProperty, nestedProperty);
  assert.notEqual(projected.properties.__specialZoneLayerStyle, layer.style);
  projected.properties.__specialZoneLayerStyle.fill = "#000000";
  assert.notEqual(layer.style.fill, "#000000");
  assert.equal(layerState.diagnostics[0].code, "preserved");
});


test("legacy presets normalize to canonical categories while retaining stored styles", () => {
  const groups = {
    demilitarized: ["buffer", "neutral", "frontier", "demilitarized"],
    claim: ["disputed"], occupation: ["occupied", "military"],
    lease: ["protectorate", "administrative"], economic: ["special_economic", "industrial", "resource"],
    restricted: ["exclusion", "wasteland"], custom: ["autonomous", "cultural", "maritime", "custom"],
  };
  for (const [category, ids] of Object.entries(groups)) {
    for (const presetId of ids) {
      const layer = normalizeSpecialZoneLayersState({ layers: [{ id: presetId, presetId, category: "political", style: { pattern: "crossHatch", fill: "#123456" }, memberFeatureIds: ["b", "a"] }] }).layers[0];
      assert.equal(layer.category, category);
      assert.equal(layer.presetId, category);
      assert.equal(layer.style.pattern, "crossHatch");
      assert.equal(layer.style.fill, "#123456");
    }
  }
});

test("new patterns and styles survive serialization with members and source", () => {
  for (const pattern of ["fineHatch", "dashHatch", "bandStripes", "dotGrid", "fineHorizontal", "openGrid"]) {
    const layer = createLayerFromPreset("occupation", { id: pattern, source: "scenario", memberFeatureIds: ["b", "a"], style: { pattern, fillOpacity: 0, patternOpacity: 0.5 } });
    const state = normalizeSpecialZoneLayersState({ layers: [layer] });
    const restored = normalizeSpecialZoneLayersState(JSON.parse(JSON.stringify(serializeSpecialZoneLayersState(state))));
    assert.deepEqual(restored.layers, state.layers);
    assert.equal(restored.layers[0].style.pattern, pattern);
    assert.deepEqual(restored.layers[0].memberFeatureIds, ["a", "b"]);
    assert.equal(restored.layers[0].style.fillOpacity, 0);
  }
});

test("纹理小样拒绝会破坏内联 SVG 的颜色值，图层可带中文显示名", async () => {
  const { createSpecialZonePatternPreviewStyle, getSpecialZoneLayerDisplayName, normalizeSpecialZoneLayersState } = await import("../js/core/special_zone_layers.js");
  const preview = createSpecialZonePatternPreviewStyle({ fill: '"/><script>', stroke: "orange", pattern: "fineHatch" });
  assert.ok(!decodeURIComponent(preview.backgroundImage).includes("<script>"));
  assert.equal(preview.borderColor, "orange");
  const state = normalizeSpecialZoneLayersState({ layers: [{ id: "a", name: "Rhineland DMZ", nameZh: "莱茵兰非军事区", presetId: "demilitarized", memberFeatureIds: [] }] });
  assert.equal(getSpecialZoneLayerDisplayName(state.layers[0], "zh"), "莱茵兰非军事区");
  assert.equal(getSpecialZoneLayerDisplayName(state.layers[0], "en"), "Rhineland DMZ");
});
