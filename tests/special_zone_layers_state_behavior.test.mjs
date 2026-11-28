import test from "node:test";
import assert from "node:assert/strict";
import { captureScenarioLayerSaveRequestState, createLayerFromPreset, normalizeSpecialZoneLayersState, serializeSpecialZoneLayersState } from "../js/core/special_zone_layers.js";

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

test("成员按剧本全部地块校验：尚未加载的细分地块不会在编辑时被删掉", async () => {
  const { getSpecialZoneValidFeatureIds, normalizeSpecialZoneLayersState } = await import("../js/core/special_zone_layers.js");
  const runtimeState = {
    scenarioBaselineOwnersByFeatureId: { DEA11: "GER", DEB31: "GER" },
    landIndex: new Map([["DE_COARSE", {}]]),
  };
  const valid = getSpecialZoneValidFeatureIds(runtimeState);
  const state = normalizeSpecialZoneLayersState({ layers: [{ id: "a", memberFeatureIds: ["DEA11", "DEB31", "GONE"] }] }, { validFeatureIds: valid });
  assert.deepEqual(state.layers[0].memberFeatureIds, ["DEA11", "DEB31"]);
  assert.ok(valid.has("DE_COARSE"));
  assert.equal(getSpecialZoneValidFeatureIds({}), null);
});
