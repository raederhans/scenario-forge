import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  discoverStateWriterBindingsForSource,
  validateStateActionNonTargetParameterMutations,
} from "../tools/build_state_writer_policy.mjs";

import {
  applyTransportWorkbenchOverviewState,
  commitTransportWorkbenchPointDeltasState,
  commitTransportWorkbenchUiState,
  ensureTransportOverviewStyleConfigState,
  ensureTransportWorkbenchUiState,
  setTransportFamilyVisibilityState,
  setTransportMasterVisibilityState,
} from "../js/core/state/actions/transport_actions.js";

test("transport workbench commits preserve the existing ui root and return detached state", () => {
  const root = { open: false, familyConfigs: { road: { width: 1 } } };
  const target = { transportWorkbenchUi: root };
  const draft = { open: true, activeFamily: "rail", familyConfigs: { rail: { width: 2 } } };

  const committed = commitTransportWorkbenchUiState(target, draft);
  assert.equal(target.transportWorkbenchUi, root);
  assert.notEqual(committed, root);
  assert.deepEqual(committed, root);
  const ensured = ensureTransportWorkbenchUiState(target);
  assert.notEqual(ensured, root);
  assert.deepEqual(ensured, root);
  assert.equal(root.open, true);
  assert.equal(root.activeFamily, "rail");
  draft.familyConfigs.rail.width = 9;
  assert.equal(root.familyConfigs.rail.width, 2);
});

test("transport point delta commit preserves normalized create update delete semantics", () => {
  const draft = {
    byFamily: {
      airport: {
        features: [{ id: "a1", lon: 10, lat: 20, properties: { kind: "civil" } }],
        updated: [{ id: "a2", lon: 30, lat: 40 }],
        deleted: ["a3", "a3"],
        revision: 7,
      },
    },
  };
  const target = {};
  const committed = commitTransportWorkbenchPointDeltasState(target, draft);
  const airport = committed.byFamily.airport;

  assert.equal(committed, target.transportWorkbenchPointDeltas);
  assert.equal(airport.revision, 7);
  assert.deepEqual(airport.deleted, ["a3"]);
  assert.deepEqual(airport.created.map(({ id }) => id), ["a1"]);
  assert.deepEqual(airport.updated.map(({ id }) => id), ["a2"]);
  draft.byFamily.airport.features[0].properties.kind = "military";
  assert.equal(airport.created[0].properties.kind, "civil");
});

test("transport overview and visibility actions publish only renderer-owned state", () => {
  const target = {};

  assert.equal(setTransportMasterVisibilityState(target, 0), false);
  assert.equal(setTransportFamilyVisibilityState(target, "road", 1), true);
  assert.equal(target.showTransport, true);
  assert.equal(target.showRoad, true);
  assert.equal(setTransportFamilyVisibilityState(target, "unknown", true), false);

  const overview = applyTransportWorkbenchOverviewState(target, {
    familyId: "road",
    visualMode: "clarity",
    activePackId: " JAPAN_ROAD ",
    familyConfig: { opacity: 0.33 },
    previewCamera: { scale: 9 },
  });
  assert.equal(ensureTransportOverviewStyleConfigState(target), overview);
  assert.equal(overview.road.opacity, 0.33);
  assert.equal(overview.activePackIdByFamily.road, "japan_road");
  assert.equal(Object.hasOwn(overview, "previewCamera"), false);
});

test("transport actions detach inherited workbench and overview containers", () => {
  const sharedWorkbenchUi = { open: false };
  const sharedOverview = { rail: { opacity: 0.25 } };
  const prototypeState = {
    styleConfig: { transportOverview: sharedOverview },
    transportWorkbenchUi: sharedWorkbenchUi,
  };
  const first = Object.create(prototypeState);
  const second = Object.create(prototypeState);

  commitTransportWorkbenchUiState(first, { open: true });
  applyTransportWorkbenchOverviewState(second, {
    familyId: "rail",
    familyConfig: { opacity: 0.9 },
  });

  assert.equal(Object.hasOwn(first, "transportWorkbenchUi"), true);
  assert.notEqual(first.transportWorkbenchUi, sharedWorkbenchUi);
  assert.equal(sharedWorkbenchUi.open, false);
  assert.equal(Object.hasOwn(second, "styleConfig"), true);
  assert.notEqual(second.styleConfig, prototypeState.styleConfig);
  assert.notEqual(second.styleConfig.transportOverview, sharedOverview);
  assert.equal(second.styleConfig.transportOverview.rail.opacity, 0.9);
  assert.equal(sharedOverview.rail.opacity, 0.25);
});

test("transport actions bypass inherited container and visibility setters", () => {
  const setterCalls = { showTransport: 0, styleConfig: 0 };
  const prototypeState = {};
  Object.defineProperties(prototypeState, {
    showTransport: {
      configurable: true,
      get: () => false,
      set: () => { setterCalls.showTransport += 1; },
    },
    styleConfig: {
      configurable: true,
      get: () => ({ transportOverview: { rail: { opacity: 0.25 } } }),
      set: () => { setterCalls.styleConfig += 1; },
    },
  });
  const target = Object.create(prototypeState);

  applyTransportWorkbenchOverviewState(target, {
    familyId: "rail",
    familyConfig: { opacity: 0.75 },
  });

  assert.deepEqual(setterCalls, { showTransport: 0, styleConfig: 0 });
  assert.equal(Object.hasOwn(target, "showTransport"), true);
  assert.equal(Object.hasOwn(target, "styleConfig"), true);
  assert.equal(target.showTransport, true);
  assert.equal(target.styleConfig.transportOverview.rail.opacity, 0.75);
});

test("transport overview delegation preserves style descriptors and return identity", () => {
  const currentOverview = { rail: { opacity: 0.4 } };
  const styleConfig = {};
  Object.defineProperty(styleConfig, "transportOverview", {
    configurable: false,
    enumerable: false,
    value: currentOverview,
    writable: true,
  });
  const target = {};
  Object.defineProperty(target, "styleConfig", {
    configurable: false,
    enumerable: false,
    value: styleConfig,
    writable: true,
  });

  assert.equal(ensureTransportOverviewStyleConfigState(target), currentOverview);
  const overview = applyTransportWorkbenchOverviewState(target, {
    familyId: "rail",
    familyConfig: { opacity: 0.8 },
  });

  assert.equal(overview, target.styleConfig.transportOverview);
  assert.equal(overview.rail.opacity, 0.8);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(target, "styleConfig"),
    { configurable: false, enumerable: false, value: styleConfig, writable: true },
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(styleConfig, "transportOverview"),
    { configurable: false, enumerable: false, value: overview, writable: true },
  );
});

test("transport workbench initialization bypasses state accessors", () => {
  const getterCalls = { inherited: 0, own: 0 };
  const prototypeState = {};
  Object.defineProperty(prototypeState, "transportWorkbenchUi", {
    configurable: true,
    get: () => {
      getterCalls.inherited += 1;
      return { open: true };
    },
  });
  const inheritedTarget = Object.create(prototypeState);
  const ownTarget = {};
  Object.defineProperty(ownTarget, "transportWorkbenchUi", {
    configurable: true,
    get: () => {
      getterCalls.own += 1;
      return { open: true };
    },
  });

  const inheritedUi = ensureTransportWorkbenchUiState(inheritedTarget);
  const ownUi = ensureTransportWorkbenchUiState(ownTarget);

  assert.deepEqual(getterCalls, { inherited: 0, own: 0 });
  assert.equal(Object.hasOwn(inheritedTarget, "transportWorkbenchUi"), true);
  assert.equal(Object.hasOwn(ownTarget, "transportWorkbenchUi"), true);
  assert.equal(inheritedUi.open, false);
  assert.equal(ownUi.open, false);
});

test("transport actions keep non-target parameters read-only", async () => {
  const modulePath = "js/core/state/actions/transport_actions.js";
  const source = await readFile(new URL(`../${modulePath}`, import.meta.url), "utf8");
  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(modulePath, source),
    [],
  );
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    {
      scanAllParameters: true,
      enforceCurrentContracts: true,
      includeInventories: true,
      derivedAliasTaintMode: "strict",
    },
  );
  assert.deepEqual(
    bindingInventories.flatMap(({ binding, findings }) => (
      binding.kind === "function-parameter" && binding.parameterIndex === 0
        ? findings.filter(({ dynamic, unsupported }) => dynamic || unsupported)
        : []
    )),
    [],
  );
});
