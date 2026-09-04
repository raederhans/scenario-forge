import test from "node:test";
import assert from "node:assert/strict";

import { getDefaultTransportWorkbenchPackIdForFamily } from "../js/core/transport_pack_resolver.js";
import { createTransportWorkbenchStateOwner } from "../js/ui/toolbar/transport_workbench_state_owner.js";

function createOwner(initialUi = {}) {
  const runtimeState = { transportWorkbenchUi: initialUi };
  return {
    owner: createTransportWorkbenchStateOwner(runtimeState),
    runtimeState,
  };
}

test("transport workbench state owner preserves the UI object while normalizing shape", () => {
  const existingUi = {
    activeFamily: "road",
    activePackId: "",
    familyConfigs: { road: { roadClass: ["motorway"] } },
    sectionOpen: { road: { data: false } },
    previewCamera: { scale: "2", translateX: "12", translateY: "-4" },
  };
  const { owner, runtimeState } = createOwner(existingUi);

  const normalized = owner.ensureUiState();

  assert.equal(normalized, existingUi);
  assert.equal(runtimeState.transportWorkbenchUi, existingUi);
  assert.equal(normalized.activePackIdByFamily.road, getDefaultTransportWorkbenchPackIdForFamily("road"));
  assert.equal(normalized.previewCamera.scale, 2);
  assert.equal(normalized.previewCamera.translateX, 12);
  assert.equal(normalized.previewCamera.translateY, -4);
  assert.equal(typeof normalized.displayConfigs.port, "object");
  assert.equal(typeof normalized.sectionOpen.road, "object");
});

test("transport workbench state owner initializes through an accessor-free canonical record", () => {
  const getterCalls = { inherited: 0, own: 0 };
  const inheritedPrototype = {};
  Object.defineProperty(inheritedPrototype, "transportWorkbenchUi", {
    configurable: true,
    get: () => {
      getterCalls.inherited += 1;
      return { open: true };
    },
  });
  const inheritedRuntimeState = Object.create(inheritedPrototype);
  const ownRuntimeState = {};
  Object.defineProperty(ownRuntimeState, "transportWorkbenchUi", {
    configurable: true,
    get: () => {
      getterCalls.own += 1;
      return { open: true };
    },
  });

  const inheritedUi = createTransportWorkbenchStateOwner(inheritedRuntimeState).ensureUiState();
  const ownUi = createTransportWorkbenchStateOwner(ownRuntimeState).ensureUiState();

  assert.deepEqual(getterCalls, { inherited: 0, own: 0 });
  assert.equal(Object.hasOwn(inheritedRuntimeState, "transportWorkbenchUi"), true);
  assert.equal(Object.hasOwn(ownRuntimeState, "transportWorkbenchUi"), true);
  assert.equal(inheritedUi.open, false);
  assert.equal(ownUi.open, false);
});

test("transport workbench state owner updates active pack and family-local pack map", () => {
  const { owner, runtimeState } = createOwner({});

  const meta = owner.setActivePackId("germany_road");

  assert.equal(meta.packId, "germany_road");
  assert.equal(runtimeState.transportWorkbenchUi.activeFamily, "road");
  assert.equal(runtimeState.transportWorkbenchUi.activePackId, "germany_road");
  assert.equal(runtimeState.transportWorkbenchUi.activePackIdByFamily.road, "germany_road");
  assert.equal(runtimeState.transportWorkbenchUi.sampleCountry, "Germany");
});

test("transport workbench state owner keeps workbench-only active pack choices", () => {
  const { owner, runtimeState } = createOwner({});

  const meta = owner.setActivePackId("germany_energy_facilities");

  assert.equal(meta.packId, "germany_energy_facilities");
  assert.equal(runtimeState.transportWorkbenchUi.activeFamily, "energy_facilities");
  assert.equal(runtimeState.transportWorkbenchUi.activePackId, "germany_energy_facilities");
  assert.equal(runtimeState.transportWorkbenchUi.activePackIdByFamily.energy_facilities, "germany_energy_facilities");
  owner.ensureUiState();
  assert.equal(runtimeState.transportWorkbenchUi.activePackId, "germany_energy_facilities");
  assert.equal(runtimeState.transportWorkbenchUi.activePackIdByFamily.energy_facilities, "germany_energy_facilities");
});

test("transport workbench state owner restores family-local active pack choices", () => {
  const { owner, runtimeState } = createOwner({
    activeFamily: "road",
    activePackIdByFamily: {
      road: "germany_road",
      rail: "france_rail",
    },
  });
  owner.ensureUiState();

  assert.equal(owner.setActiveFamily("rail"), "rail");
  assert.equal(runtimeState.transportWorkbenchUi.activePackId, "france_rail");
  assert.equal(runtimeState.transportWorkbenchUi.activePackIdByFamily.rail, "france_rail");
  assert.equal(runtimeState.transportWorkbenchUi.sampleCountry, "France");

  assert.equal(owner.setActiveFamily("road"), "road");
  assert.equal(runtimeState.transportWorkbenchUi.activePackId, "germany_road");
  assert.equal(runtimeState.transportWorkbenchUi.activePackIdByFamily.road, "germany_road");
  assert.equal(runtimeState.transportWorkbenchUi.sampleCountry, "Germany");
});

test("transport workbench state owner returns and clears drawer restore flags on close", () => {
  const { owner, runtimeState } = createOwner({});

  owner.prepareOpenState({ restoreLeftDrawer: true, restoreRightDrawer: true });
  owner.setOpenState(true);
  owner.setOpenState(false);
  const restoreState = owner.prepareCloseState();

  assert.deepEqual(restoreState, {
    restoreLeftDrawer: true,
    restoreRightDrawer: true,
  });
  assert.equal(runtimeState.transportWorkbenchUi.open, false);
  assert.equal(runtimeState.transportWorkbenchUi.restoreLeftDrawer, false);
  assert.equal(runtimeState.transportWorkbenchUi.restoreRightDrawer, false);
});

test("transport workbench state owner removes stale compare state before config updates", () => {
  const { owner } = createOwner({
    activeFamily: "road",
    compareHeld: true,
    familyConfigs: { road: { roadClass: ["motorway"] } },
  });
  const uiState = owner.ensureUiState();

  assert.equal(Object.hasOwn(uiState, "compareHeld"), false);
  assert.equal(owner.updateFamilyConfig("road", "roadClass", true, { appendValue: "trunk" }), true);

  assert.deepEqual(owner.getWorkingConfig("road").roadClass, ["motorway", "trunk"]);
});

test("transport workbench state owner limits display config writes to density families", () => {
  const { owner } = createOwner({});
  owner.ensureUiState();

  assert.equal(owner.updateDisplayConfig("road", () => {}), false);
  assert.equal(owner.updateDisplayConfig("port", (draft) => {
    draft.labels.budget = 12;
  }), true);

  assert.equal(owner.getDisplayConfig("port").labels.budget, 12);
});

test("transport workbench state owner stores point deltas outside workbench UI", () => {
  const runtimeState = { transportWorkbenchUi: { activePackIdByFamily: { airport: "usa_airport" } } };
  const owner = createTransportWorkbenchStateOwner(runtimeState);

  const created = owner.addEditOverlayPoint("airport", {
    id: "airport_edit_test",
    name: "Test Airfield",
    lon: "-77.0365",
    lat: "38.8977",
  });

  assert.equal(created.id, "airport_edit_test");
  assert.equal(created.packId, "usa_airport");
  assert.equal(runtimeState.transportWorkbenchUi.editOverlay, undefined);
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.airport.created.length, 1);
  assert.equal(owner.getEditOverlay("airport").features[0].properties.source, "user_overlay");

  assert.equal(owner.removeEditOverlayPoint("airport", "airport_edit_test"), true);
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.airport.created.length, 0);
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.airport.revision, 2);
});

test("transport workbench state owner records point update and source delete deltas", () => {
  const runtimeState = { transportWorkbenchUi: { activePackIdByFamily: { port: "uk_port" } } };
  const owner = createTransportWorkbenchStateOwner(runtimeState);

  assert.equal(owner.addEditOverlayPoint("port", { id: "bad_port", lon: 181, lat: 51 }), null);
  const updated = owner.updateEditOverlayPoint("port", "source_port_1", {
    name: "Edited Port",
    lon: "-4.21",
    lat: "55.86",
    properties: { manager_type_code: "2" },
  });

  assert.equal(updated.id, "source_port_1");
  assert.equal(updated.packId, "uk_port");
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.port.updated.length, 1);
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.port.updated[0].properties.manager_type_code, "2");
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.port.updated[0].properties.source, undefined);
  const refreshedUpdate = owner.updateEditOverlayPoint("port", "source_port_1", {
    name: "Edited Port",
    lon: "-4.22",
    lat: "55.87",
  });
  assert.equal(refreshedUpdate.properties.manager_type_code, "2");
  assert.equal(owner.deleteEditOverlayPoint("port", "source_port_1"), true);
  assert.deepEqual(runtimeState.transportWorkbenchPointDeltas.byFamily.port.updated, []);
  assert.deepEqual(runtimeState.transportWorkbenchPointDeltas.byFamily.port.deleted, ["source_port_1"]);
});

test("transport workbench state owner supports point delta families beyond airport and port", () => {
  const runtimeState = {
    transportWorkbenchUi: {
      activePackIdByFamily: {
        energy_facilities: "germany_energy_facilities",
      },
    },
  };
  const owner = createTransportWorkbenchStateOwner(runtimeState);

  const created = owner.addEditOverlayPoint("energy_facilities", {
    id: "energy_edit_1",
    name: "Project Plant",
    lon: "13.4",
    lat: "52.5",
  });
  const updated = owner.updateEditOverlayPoint("energy_facilities", "energy_source_1", {
    name: "Edited Plant",
    lon: "13.5",
    lat: "52.6",
    properties: { category: "power" },
  });

  assert.equal(created.packId, "germany_energy_facilities");
  assert.equal(updated.packId, "germany_energy_facilities");
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.energy_facilities.created.length, 1);
  assert.equal(owner.updateEditOverlayPoint("energy_facilities", "energy_edit_1", {
    name: "Moved Plant",
    lon: "13.41",
    lat: "52.51",
  }).properties.source, "user_overlay");
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.energy_facilities.updated.length, 1);
  assert.equal(runtimeState.transportWorkbenchPointDeltas.byFamily.energy_facilities.updated[0].properties.category, "power");
  assert.equal(owner.deleteEditOverlayPoint("energy_facilities", "energy_source_1"), true);
  assert.deepEqual(runtimeState.transportWorkbenchPointDeltas.byFamily.energy_facilities.updated, []);
  assert.deepEqual(runtimeState.transportWorkbenchPointDeltas.byFamily.energy_facilities.deleted, ["energy_source_1"]);
});

test("transport workbench state owner moves layer order without duplicating families", () => {
  const { owner } = createOwner({
    layerOrder: ["road", "rail", "airport", "port"],
  });
  owner.ensureUiState();

  assert.equal(owner.moveLayerOrder("port", "road"), true);

  const order = owner.ensureUiState().layerOrder;
  assert.equal(order[0], "port");
  assert.equal(new Set(order).size, order.length);
});
