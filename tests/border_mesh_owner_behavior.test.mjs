import test from "node:test";
import assert from "node:assert/strict";

import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";
import { getBorderCountryAssignmentRevision, isAtlantropaCoastlineLandVisible } from "../js/core/renderer/border_mesh_queries.js";

test("border readers preserve field order and short-circuit without mutating borrowed land", () => {
  assert.equal(getBorderCountryAssignmentRevision(Object.freeze({
    activeScenarioId: "scenario", topologyRevision: 2, sovereigntyRevision: 3,
    scenarioShellOverlayRevision: 4, mapSemanticMode: "visual",
  })), "scenario|2|3|4|visual");
  const land = Object.freeze({ properties: Object.freeze({ atl_render_layer: "land" }) });
  assert.equal(isAtlantropaCoastlineLandVisible(Object.freeze({
    showWaterRegions: true, scenarioAtlantropaData: Object.freeze({ features: Object.freeze([land]) }),
  })), true);
  for (const flags of [{ showWaterRegions: false }, { showWaterRegions: true, showScenarioAtlantropa: false }]) {
    assert.equal(isAtlantropaCoastlineLandVisible({ ...flags,
      get scenarioAtlantropaData() { throw new Error("must short-circuit"); },
    }), false);
  }
});

function createTestOwner(state = {}) {
  const perfMetrics = [];
  const invalidations = [];
  const owner = createBorderMeshOwner({
    state,
    helpers: {
      invalidateRenderPasses: (...args) => invalidations.push(args),
      isUsableMesh: (mesh) => !!(mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length > 0),
      nowMs: () => 0,
      recordRenderPerfMetric: (name, duration, details) => perfMetrics.push({ name, duration, details }),
      resolveOwnerBorderCode: (feature, ownershipContext = {}) => ownershipContext.ownershipByFeatureId?.[feature?.id] || "",
      shouldExcludeOwnerBorderEntity: () => false,
    },
  });
  return { owner, invalidations, perfMetrics };
}

test("dynamic mesh publication precedes unresolved-count callbacks and preserves partial commits on throw", (t) => {
  const oldTopojson = globalThis.topojson;
  t.after(() => { globalThis.topojson = oldTopojson; });
  const mesh = { type: "MultiLineString", coordinates: [] };
  globalThis.topojson = { mesh: () => mesh };
  const state = {
    cachedBorders: {}, cachedDynamicOwnerBorders: {}, cachedDynamicBordersHash: "old",
    runtimePoliticalTopology: { objects: { political: { geometries: [{}] } } },
    dynamicBordersDirty: true,
  };
  const failure = new Error("count failed");
  const owner = createBorderMeshOwner({ state, helpers: {
    isDynamicBordersEnabled: () => true,
    resolveOwnerBorderCode: () => {
      assert.equal(state.cachedBorders, null);
      assert.equal(state.cachedDynamicOwnerBorders, mesh);
      assert.equal(state.cachedDynamicBordersHash, "old");
      throw failure;
    },
  } });
  assert.throws(() => owner.rebuildDynamicBorders(), error => error === failure);
  assert.equal(state.cachedDynamicOwnerBorders, mesh);
  assert.equal(state.cachedDynamicBordersHash, "old");
  assert.equal(state.dynamicBordersDirty, true);
});

function createLifecycleOwner() {
  const state = { cachedDetailAdmBorders: [], dynamicBordersEnabled: true };
  const timers = new Map();
  const events = [];
  let nextTimerId = 0;
  let buildState = { signature: "", status: "idle" };
  const owner = createBorderMeshOwner({
    state,
    helpers: {
      isDynamicBordersEnabled: () => state.dynamicBordersEnabled,
      setTimeoutFn: (callback, delay) => {
        timers.set(++nextTimerId, { callback, delay });
        return nextTimerId;
      },
      clearTimeoutFn: (id) => timers.delete(id),
      renderDynamicBorders: () => events.push(["render", state.pendingDynamicBorderTimerId]),
      getDetailAdmMeshBuildState: () => buildState,
      setDetailAdmMeshBuildState: (value) => { buildState = value; },
      syncStaticMeshSnapshot: () => events.push(["snapshot", [...state.cachedDetailAdmBorders], buildState.status]),
      scheduleDeferredHeavyBorderMeshes: () => events.push(["schedule", buildState.signature]),
    },
  });
  return { owner, state, timers, events, getBuildState: () => buildState };
}

test("border debounce replaces stale work and clears the timer before rendering", () => {
  const { owner, state, timers, events } = createLifecycleOwner();
  owner.scheduleDynamicBorderRecompute("first", 150);
  const oldId = state.pendingDynamicBorderTimerId;
  owner.scheduleDynamicBorderRecompute("second", 25);
  assert.equal(timers.has(oldId), false);
  assert.equal(state.dynamicBordersDirtyReason, "second");
  const timer = timers.get(state.pendingDynamicBorderTimerId);
  assert.equal(timer.delay, 25);
  timers.delete(state.pendingDynamicBorderTimerId);
  timer.callback();
  assert.equal(state.dynamicBordersDirty, false);
  assert.deepEqual(events, [["render", null]]);
});

test("transaction cancellation and disabled immediate recompute leave no delayed render", () => {
  const { owner, state, timers, events } = createLifecycleOwner();
  owner.scheduleDynamicBorderRecompute("edit");
  owner.clearPendingDynamicBorderTimer();
  assert.equal(timers.size, 0);
  assert.equal(state.pendingDynamicBorderTimerId, null);
  owner.scheduleDynamicBorderRecompute("next");
  state.dynamicBordersEnabled = false;
  assert.equal(owner.recomputeDynamicBordersNow(), false);
  assert.equal(timers.size, 0);
  assert.equal(state.dynamicBordersDirty, false);
  assert.equal(state.dynamicBordersDirtyReason, "");
  assert.deepEqual(events, []);
});

test("border debounce clears the exact opaque timer handle it published", () => {
  const state = { cachedDetailAdmBorders: [], dynamicBordersEnabled: true };
  const firstHandle = { id: "first" };
  const secondHandle = { id: "second" };
  const handles = [firstHandle, secondHandle];
  const clearedHandles = [];
  const owner = createBorderMeshOwner({
    state,
    helpers: {
      isDynamicBordersEnabled: () => true,
      setTimeoutFn: () => handles.shift(),
      clearTimeoutFn: (handle) => clearedHandles.push(handle),
    },
  });

  owner.scheduleDynamicBorderRecompute("first");
  assert.equal(state.pendingDynamicBorderTimerId, firstHandle);
  owner.scheduleDynamicBorderRecompute("second");
  assert.deepEqual(clearedHandles, [firstHandle]);
  assert.equal(state.pendingDynamicBorderTimerId, secondHandle);
  owner.clearPendingDynamicBorderTimer();
  assert.deepEqual(clearedHandles, [firstHandle, secondHandle]);
  assert.equal(state.pendingDynamicBorderTimerId, null);
});

test("immediate border rebuild can update its cache without requesting a render", () => {
  const { owner, state, timers, events } = createLifecycleOwner();
  owner.scheduleDynamicBorderRecompute("edit");
  assert.equal(owner.recomputeDynamicBordersNow({ renderNow: false }), true);
  assert.equal(timers.size, 0);
  assert.equal(state.dynamicBordersDirty, false);
  assert.deepEqual(events, []);
});

test("detail viewport change retires old meshes in the snapshot before scheduling once", () => {
  const { owner, state, events, getBuildState } = createLifecycleOwner();
  const oldMeshes = [{ coordinates: ["old"] }];
  owner.replaceDetailAdmBorders(oldMeshes);
  assert.equal(state.cachedDetailAdmBorders, oldMeshes);
  const meta = { signature: "viewport-2", detailCountries: ["AAA"] };
  owner.reconcileDetailAdmBorders(meta);
  assert.deepEqual(state.cachedDetailAdmBorders, []);
  assert.deepEqual(events, [["snapshot", [], "building"], ["schedule", "viewport-2"]]);
  owner.reconcileDetailAdmBorders(meta);
  assert.equal(events.length, 2);
  const newMeshes = [{ coordinates: ["new"] }];
  owner.replaceDetailAdmBorders(newMeshes);
  assert.equal(state.cachedDetailAdmBorders, newMeshes);
  owner.reconcileDetailAdmBorders({ signature: "viewport-empty", detailCountries: [] });
  assert.deepEqual(getBuildState(), { signature: "viewport-empty", status: "empty" });
  assert.deepEqual(events.at(-1), ["snapshot", [], "empty"]);
  assert.equal(events.filter(([event]) => event === "schedule").length, 1);
});

test("an idle detail cache schedules its initial build even when the signature is unchanged", () => {
  const { owner, events, getBuildState } = createLifecycleOwner();
  owner.reconcileDetailAdmBorders({ signature: "", detailCountries: ["AAA"] });
  assert.equal(getBuildState().status, "building");
  assert.deepEqual(events, [["schedule", ""]]);
});

test("refreshScenarioOpeningOwnerBorders reuses mesh pack opening-owner mesh when available", () => {
  const meshPackMesh = {
    type: "MultiLineString",
    coordinates: [[[1, 1], [2, 2]]],
  };
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    runtimePoliticalTopology: null,
    activeScenarioMeshPack: { meshes: { opening_owner_borders: meshPackMesh } },
    scenarioBaselineOwnersByFeatureId: {},
    scenarioAutoShellOwnerByFeatureId: {},
    scenarioShellOverlayRevision: 0,
    scenarioBaselineHash: "baseline-hash",
    cachedScenarioOpeningOwnerBorders: null,
  };

  const { owner } = createTestOwner(state);
  const built = owner.refreshScenarioOpeningOwnerBorders("mesh-pack-ready");

  assert.equal(built, true);
  assert.equal(state.cachedScenarioOpeningOwnerBorders, meshPackMesh);
});

test("refreshScenarioOpeningOwnerBorders falls back to runtime topology when mesh pack is absent", () => {
  const runtimeFallbackMesh = {
    type: "MultiLineString",
    coordinates: [[[3, 3], [4, 4]]],
  };
  const previousTopojson = globalThis.topojson;
  globalThis.topojson = {
    mesh: () => runtimeFallbackMesh,
  };

  try {
    const state = {
      activeScenarioId: "tno_1962",
      scenarioBorderMode: "scenario_owner_only",
        runtimePoliticalTopology: { objects: { political: {} } },
      activeScenarioMeshPack: null,
      scenarioBaselineOwnersByFeatureId: { A: "GER", B: "USA" },
      scenarioAutoShellOwnerByFeatureId: {},
      scenarioShellOverlayRevision: 0,
      scenarioBaselineHash: "baseline-hash",
      cachedScenarioOpeningOwnerBorders: null,
    };

    const { owner } = createTestOwner(state);
    const built = owner.refreshScenarioOpeningOwnerBorders("runtime-fallback");

    assert.equal(built, true);
    assert.equal(state.cachedScenarioOpeningOwnerBorders, runtimeFallbackMesh);
  } finally {
    globalThis.topojson = previousTopojson;
  }
});

test("refreshScenarioOpeningOwnerBorders clears cache when startup state is not ready", () => {
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "canonical",
    runtimePoliticalTopology: { objects: { political: {} } },
    activeScenarioMeshPack: null,
    scenarioBaselineOwnersByFeatureId: {},
    scenarioAutoShellOwnerByFeatureId: {},
    scenarioShellOverlayRevision: 0,
    scenarioBaselineHash: "baseline-hash",
    cachedScenarioOpeningOwnerBorders: {
      type: "MultiLineString",
      coordinates: [[[5, 5], [6, 6]]],
    },
  };

  const { owner } = createTestOwner(state);
  const built = owner.refreshScenarioOpeningOwnerBorders("not-ready");

  assert.equal(built, false);
  assert.equal(state.cachedScenarioOpeningOwnerBorders, null);
});

test("getFrontlineMesh remains disabled after control layer retirement", () => {
  const state = {
    activeScenarioId: "tno_1962",
    annotationView: { frontlineEnabled: true },
    runtimePoliticalTopology: { objects: { political: {} } },
    sovereigntyByFeatureId: { A: "GER", B: "USA" },
    scenarioAutoShellOwnerByFeatureId: {},
    scenarioShellOverlayRevision: 1,
    sovereigntyRevision: 4,
    cachedFrontlineMesh: { type: "MultiLineString", coordinates: [] },
    cachedFrontlineMeshHash: "stale",
  };

  const { owner } = createTestOwner(state);

  assert.deepEqual(owner.getFrontlineOwnershipContext(), {
    ownershipByFeatureId: state.sovereigntyByFeatureId,
    shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
    scenarioActive: true,
    viewMode: "ownership",
  });
  assert.equal(owner.getFrontlineMesh(), null);
  assert.equal(state.cachedFrontlineMesh, null);
  assert.equal(state.cachedFrontlineMeshHash, "");
});
