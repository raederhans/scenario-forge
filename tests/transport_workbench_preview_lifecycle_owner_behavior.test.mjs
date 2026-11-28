import test from "node:test";
import assert from "node:assert/strict";
import { createTransportWorkbenchPreviewLifecycleOwner } from "../js/ui/transport_workbench/transport_workbench_preview_lifecycle_owner.js";
import { createTransportWorkbenchEffectivePointPack } from "../js/ui/transport_workbench/transport_workbench_point_preview_runtime.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("point preview runtime builds created updated deleted overlay model", () => {
  const definition = { familyId: "airport", selectionType: "airport" };
  const sourcePack = {
    mode: "preview",
    variantId: "domestic",
    features: [{
      id: "a1", name: "Old Airport", lon: 1, lat: 2,
      properties: { id: "a1", name: "Old Airport", airport_type: "domestic" },
    }, {
      id: "a2", name: "Removed Airport", lon: 3, lat: 4,
      properties: { id: "a2", name: "Removed Airport" },
    }],
    featureById: new Map(),
  };
  const config = {
    editOverlay: {
      updated: [{ id: "a1", name: "Updated Airport", lon: 5, lat: 6 }],
      deleted: ["a2"],
      created: [{ id: "a3", name: "New Airport", lon: 7, lat: 8 }],
    },
  };
  const projectFeature = (rawFeature) => ({
    id: rawFeature.id, name: rawFeature.properties.name, properties: rawFeature.properties,
  });

  const pack = createTransportWorkbenchEffectivePointPack(sourcePack, config, definition, { projectFeature });

  assert.deepEqual(pack.features.map((feature) => feature.id), ["a1", "a3"]);
  assert.equal(pack.featureById.has("a2"), false);
  assert.equal(pack.featureById.get("a1").name, "Updated Airport");
});

test("preview lifecycle owner aborts stale generation when family switches during preparation", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const renderCalls = [];
  const inspectorCalls = [];
  let resolveRoadCarrier = null;
  let resolveRailCarrier = null;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: () => new Promise((resolve) => {
      if (runtimeState.transportWorkbenchUi.activeFamily === "road") {
        resolveRoadCarrier = resolve;
      } else {
        resolveRailCarrier = resolve;
      }
    }),
    prepareFamilyPreview: async () => true,
    renderFamilyPreview: async (familyId, config) => {
      renderCalls.push({ familyId, config });
      return null;
    },
    renderInspector: (family) => {
      inspectorCalls.push(family.id);
    },
    runtimeFamilyIds: ["road", "rail"],
  });

  const roadPromise = owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  });
  await flushMicrotasks();

  runtimeState.transportWorkbenchUi.activeFamily = "rail";
  const railPromise = owner.refreshPreview({
    isOpen: true,
    family: { id: "rail" },
    config: { activePackId: "rail_pack" },
  });
  await flushMicrotasks();

  resolveRoadCarrier({});
  await roadPromise;

  assert.deepEqual(renderCalls, []);
  assert.deepEqual(inspectorCalls, []);

  resolveRailCarrier({});
  await railPromise;

  assert.deepEqual(renderCalls, [{ familyId: "rail", config: { activePackId: "rail_pack" } }]);
  assert.deepEqual(inspectorCalls, ["rail"]);
});
