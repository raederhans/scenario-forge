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

test("dynamic border rebuild invalidates only when its revision hash changes", () => {
  const state = {
    cachedBorders: {}, cachedDynamicBordersHash: "old",
    sovereigntyRevision: 1, activeScenarioId: "scenario", scenarioShellOverlayRevision: 2,
    dynamicBordersDirty: true,
    get runtimePoliticalTopology() { throw new Error("must not build a mesh"); },
  };
  const invalidations = [];
  const metrics = [];
  let enabled = true;
  let updates = 0;
  const owner = createBorderMeshOwner({ state, helpers: {
    isDynamicBordersEnabled: () => enabled,
    updateDynamicBorderStatusUI: () => updates++,
    invalidateRenderPasses: (...args) => invalidations.push(args),
    recordRenderPerfMetric: (name, duration, details) => metrics.push({ name, details }),
  } });
  assert.equal(owner.rebuildDynamicBorders(), true);
  assert.equal(state.cachedBorders, null);
  assert.equal(state.dynamicBordersDirty, false);
  assert.deepEqual(invalidations, [["borders", "dynamic-borders"]]);
  const firstHash = state.cachedDynamicBordersHash;
  assert.equal(owner.rebuildDynamicBorders(), true);
  assert.equal(state.cachedDynamicBordersHash, firstHash);
  assert.equal(invalidations.length, 1);
  assert.deepEqual(metrics.at(-1), {
    name: "rebuildDynamicBorders", details: { enabled: true, cacheHit: true },
  });
  for (const key of ["sovereigntyRevision", "scenarioShellOverlayRevision", "activeScenarioId"]) {
    const previousHash = state.cachedDynamicBordersHash;
    state[key] = key === "activeScenarioId" ? "" : state[key] + 1;
    assert.equal(owner.rebuildDynamicBorders(), true);
    assert.notEqual(state.cachedDynamicBordersHash, previousHash);
  }
  assert.equal(invalidations.length, 4);
  enabled = false;
  state.cachedBorders = {};
  assert.equal(owner.rebuildDynamicBorders(), false);
  assert.equal(state.cachedBorders, null);
  assert.equal(state.cachedDynamicBordersHash, null);
  assert.equal(state.dynamicBordersDirty, false);
  assert.equal(state.dynamicBordersDirtyReason, "");
  assert.equal(invalidations.length, 4);
  assert.equal(updates, 6);
  assert.deepEqual(metrics.at(-1), {
    name: "rebuildDynamicBorders", details: { enabled: false },
  });
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

test("opening owner refresh reports readiness and invalidates without building meshes", (t) => {
  const previousTopojson = globalThis.topojson;
  t.after(() => { globalThis.topojson = previousTopojson; });
  globalThis.topojson = { mesh: () => { throw new Error("must not build a mesh"); } };
  const state = {
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    activeScenarioMeshPack: { meshes: { opening_owner_borders: { coordinates: [[[1, 1], [2, 2]]] } } },
  };
  const { owner, invalidations, perfMetrics } = createTestOwner(state);
  assert.equal(owner.refreshScenarioOpeningOwnerBorders("mesh-pack-ready"), true);
  state.activeScenarioMeshPack = null;
  state.runtimePoliticalTopology = { objects: { political: {} } };
  state.scenarioBaselineOwnersByFeatureId = { A: "GER" };
  assert.equal(owner.refreshScenarioOpeningOwnerBorders("runtime-ready"), true);
  state.scenarioBaselineOwnersByFeatureId = {};
  assert.equal(owner.refreshScenarioOpeningOwnerBorders(), false);
  state.scenarioBaselineOwnersByFeatureId = { A: "GER" };
  state.scenarioBorderMode = "canonical";
  assert.equal(owner.refreshScenarioOpeningOwnerBorders("not-ready"), false);
  state.scenarioBorderMode = "scenario_owner_only";
  state.activeScenarioId = "";
  assert.equal(owner.refreshScenarioOpeningOwnerBorders("cleared"), false);
  assert.deepEqual(invalidations, [
    ["borders", "mesh-pack-ready"], ["borders", "runtime-ready"],
    ["borders", "scenario-opening-borders"], ["borders", "not-ready"], ["borders", "cleared"],
  ]);
  assert.deepEqual(perfMetrics.map(metric => metric.details), [
    { enabled: true }, { enabled: true }, { enabled: false }, { enabled: false }, { enabled: false },
  ]);
});

function createSourceCountryOwner(state, { onCountry = () => {}, excluded = feature => feature.properties?.excluded } = {}) {
  return createBorderMeshOwner({ state, helpers: {
    getFeatureId: feature => feature.id,
    getFeatureBorderMeshCountryCodeNormalized: feature => { onCountry(feature); return feature.properties?.country || ""; },
    shouldExcludePoliticalInteractionFeature: excluded,
  } });
}

test("private source country preparation equals synchronous order, classification and exclusions", async () => {
  const features = Array.from({ length: 1025 }, (_, index) => ({ id: `id-${index}`,
    properties: { country: `C${index % 7}`, __source: index % 3 ? "detail" : "primary", excluded: index % 11 === 0 } }));
  delete features[17]; // Match Array.forEach's sparse-input semantics.
  features[3].properties.__source = "other";
  features[4].properties.country = "";
  const state = { landDataFull: { features }, landData: { features: [{ id: "ignored", properties: { country: "XX" } }] } };
  const visits = [], owner = createSourceCountryOwner(state, { onCountry: feature => visits.push(feature.id) });
  const expected = owner.getSourceCountrySets(), syncVisits = visits.splice(0);
  let ticks = 0, yields = 0;
  const prepared = await owner.prepareSourceCountrySets({
    nowMs: () => ticks++ * 4, yieldControl: async () => { yields++; },
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.sourceFeatures, features);
  assert.deepEqual([...prepared.sourceCountries.primary], [...expected.primary]);
  assert.deepEqual([...prepared.sourceCountries.detail], [...expected.detail]);
  assert.deepEqual(visits, syncVisits);
  assert.equal(yields, 2);
  assert.equal(prepared.yieldCount, yields);
  assert.equal(prepared.maxSliceMs, 4);
});

test("private source countries prefer nonempty full input and otherwise use the exact land reference", async () => {
  const land = [{ id: "land", properties: { country: "AA" } }];
  const full = [{ id: "full", properties: { country: "BB", __source: "detail" } }];
  const state = { landData: { features: land }, landDataFull: { features: [] } };
  const owner = createSourceCountryOwner(state);
  const fallback = await owner.prepareSourceCountrySets();
  assert.equal(fallback.sourceFeatures, land);
  assert.deepEqual(fallback.sourceCountries, owner.getSourceCountrySets());
  const candidate = await owner.prepareSourceCountrySets({ fullCollection: { features: full } });
  assert.equal(candidate.sourceFeatures, full);
  assert.deepEqual([...candidate.sourceCountries.detail], ["BB"]);
  assert.equal(state.landDataFull.features.length, 0, "preparation must not publish source inputs");
  const empty = await owner.prepareSourceCountrySets({ fullCollection: null, landCollection: null });
  assert.equal(empty.sourceFeatures.length, 0);
  assert.equal(empty.sourceCountries.primary.size + empty.sourceCountries.detail.size, 0);
});

test("source policy changes while yielded cancel without exposing partial country Sets and allow retry", async () => {
  const features = Array.from({ length: 1024 }, (_, index) => ({ id: String(index), properties: { country: "AA" } }));
  const state = { landDataFull: { features } };
  let policyRevision = 0, visits = 0, time = 0;
  const owner = createSourceCountryOwner(state, {
    onCountry: () => { visits++; }, excluded: () => policyRevision > 0,
  });
  const stale = await owner.prepareSourceCountrySets({ isCurrent: () => policyRevision === 0,
    nowMs: () => time += 4, yieldControl: async () => { policyRevision++; } });
  assert.equal(stale.status, "cancelled");
  assert.equal(stale.sourceCountries, null);
  assert.equal(stale.sourceFeatures, features);
  assert.equal(stale.yieldCount, 1);
  assert.equal(visits, 512, "no helper resumes after a failed current-policy fence");
  const retry = await owner.prepareSourceCountrySets({ nowMs: () => 0 });
  assert.equal(retry.status, "prepared");
  assert.deepEqual(retry.sourceCountries, owner.getSourceCountrySets());
  assert.equal(retry.sourceCountries.primary.size, 0);
});

test("source country preparation cancels before helpers and propagates preparation failures", async () => {
  const state = { landDataFull: { features: Array.from({ length: 512 }, (_, index) => ({ id: String(index) })) } };
  let visits = 0;
  const owner = createSourceCountryOwner(state, { onCountry: () => { visits++; } });
  assert.equal((await owner.prepareSourceCountrySets({ isCurrent: () => false })).status, "cancelled");
  assert.equal(visits, 0);
  const failure = new Error("yield failed");
  let ticks = 0;
  await assert.rejects(owner.prepareSourceCountrySets({ nowMs: () => ticks++ * 4,
    yieldControl: async () => { throw failure; } }), error => error === failure);
});
