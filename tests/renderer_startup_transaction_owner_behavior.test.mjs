import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  createRendererStartupTransactionOwner,
} from "../js/core/renderer/renderer_startup_transaction_owner.js";
import { createSetMapDataTransactionOwner } from "../js/core/map_renderer/set_map_data_transaction_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const EFFECT_ORDER = Object.freeze([
  "resetLayerResolverCache",
  "resetPhysicalLandClipPathCache",
  "resetExactRefreshOptimizationState",
  "bumpTopologyRevision",
  "resetHitCanvasTopologyRevision",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "setRenderPassPerfOverlayEnabled",
  "ensureLayerDataFromTopology",
  "rebuildPoliticalLandCollections",
  "applyRendererSurfaceBridgeState",
  "ensureSovereigntyState",
  "normalizeColorStateForRender",
  "setDebugMode",
  "resetRenderDiagnostics",
  "clearRenderPhaseTimer",
  "resetRenderPhaseState",
  "resetTooltipState",
  "cancelScheduledHoverOverlayRender",
  "markAllOverlaysDirty",
  "clearStagedMapDataTasks",
  "cancelExactAfterSettleRefresh",
  "cancelPendingIndexUiRefresh",
  "resetDeferredRenderFlags",
  "resetProjectedBoundsCacheState",
  "invalidateAllRenderPasses",
  "syncDayNightClockTimerBridge",
]);

function createHarness() {
  const calls = [];
  const payloads = [];
  const getterCalls = [];
  const effects = {};
  for (const name of EFFECT_ORDER) {
    effects[name] = (...args) => {
      calls.push(name);
      payloads.push({ name, args });
    };
  }
  const getters = {
    isPerfOverlayEnabled: () => {
      getterCalls.push("isPerfOverlayEnabled");
      return true;
    },
  };
  const owner = createRendererStartupTransactionOwner({ effects, getters });
  return { calls, effects, getterCalls, getters, owner, payloads };
}

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

test("startup defers only duplicate border derivation until the following setMapData", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const initMapSource = rendererSource.slice(
    rendererSource.indexOf("function initMap({"),
    rendererSource.indexOf("function markRendererTopologyChanged(")
  );
  const mainSource = readRepoFile("js", "main.js");
  assert.match(mainSource, /initMap\(\{[\s\S]*?deferStaticMeshesUntilSetMapData: true,[\s\S]*?\}\);\s*setMapData\(\{/);

  function runStartup(deferStaticMeshesUntilSetMapData) {
    const calls = [];
    const record = (name) => () => { calls.push(name); };
    const canvas = { style: {} };
    const surfaceHost = {
      getMapContainer: () => ({}),
      getContext: () => ({}),
      getHitContext: () => ({}),
      getMapCanvas: () => canvas,
      getPoliticalPatchCanvas: () => null,
      getInteractionOverlayCanvas: () => null,
    };
    const context = {
      globalThis: { d3: {} }, document: { getElementById: () => null }, console,
      runtimeState: {}, rendererSurfaceHost: surfaceHost, debugMode: "PROD",
      getRendererSurfaceLifecycleOwner: () => ({
        resolveDomHandles: record("resolveDomHandles"),
        ensureHitCanvasHandle: record("ensureHitCanvasHandle"),
        acquireCanvasContexts: record("acquireCanvasContexts"),
      }),
      getRendererProjectionPathOwner: () => ({ initializeProjectionPaths: record("initializeProjectionPaths") }),
      getRendererStartupTransactionOwner: () => ({ runInitMapResetTransaction: record("resetInitMap") }),
      applyFacilityInfoCardState: record("applyFacilityInfoCardState"),
      ensureHybridLayers: record("ensureHybridLayers"),
      refreshColorState() {}, recomputeDynamicBordersNow() {}, resolveSpecialZoneParentGroupTargetIds() {},
      registerRuntimeHook(target, name, callback) {
        assert.equal(target, null);
        assert.equal(name, "resolveSpecialZoneParentGroupTargetIdsFn");
        assert.equal(callback, context.resolveSpecialZoneParentGroupTargetIds);
        calls.push("registerRuntimeHook");
      },
      syncFacilityInfoCardVisibility() {},
      buildRuntimePoliticalMeta: record("buildRuntimePoliticalMeta"),
      setCanvasSize: record("setCanvasSize"),
      buildIndex: record("buildIndex"),
      setInteractionInfrastructureState: record("setInteractionInfrastructureState"),
      rebuildStaticMeshes: record("rebuildStaticMeshes"),
      invalidateBorderCache: record("invalidateBorderCache"),
      updateDynamicBorderStatusUI: record("updateDynamicBorderStatusUI"),
      fitProjection: record("fitProjection"),
      initZoom: record("initZoom"),
      bindEvents: record("bindEvents"),
      getViewportGeoBounds() {},
      render: record("render"),
    };
    const initMap = vm.runInNewContext(`(${initMapSource})`, context);
    initMap({ suppressRender: true, interactionLevel: "readonly-startup", deferStaticMeshesUntilSetMapData });
    const transaction = createSetMapDataTransactionOwner({
      getters: { nowMs: () => 0, getActiveScenarioId: () => "", getLandFeatureCount: () => 1, getRenderProfile: () => "auto" },
      effects: new Proxy({}, { get: (_, name) => record(name) }),
    });
    transaction.runSetMapDataTransaction({ suppressRender: true, interactionLevel: "readonly-startup" });
    return calls;
  }

  const defaultCalls = runStartup(false);
  const deferredCalls = runStartup(true);
  const count = (calls, name) => calls.filter((call) => call === name).length;
  for (const name of ["rebuildStaticMeshes", "invalidateBorderCache", "updateDynamicBorderStatusUI"]) {
    assert.equal(count(defaultCalls, name), 2, `default path retains both ${name} calls`);
    assert.equal(count(deferredCalls, name), 1, `startup path performs ${name} in setMapData`);
    assert.ok(deferredCalls.indexOf(name) > deferredCalls.indexOf("resetRendererTransactionState"));
  }
  assert.equal(count(deferredCalls, "fitProjection"), 2);
  assert.equal(count(deferredCalls, "initZoom"), 1);
  assert.equal(count(deferredCalls, "registerRuntimeHook"), 1);
  assert.ok(deferredCalls.indexOf("fitProjection") < deferredCalls.indexOf("initZoom"));
  assert.ok(deferredCalls.indexOf("initZoom") < deferredCalls.lastIndexOf("fitProjection"));
});

test("runInitMapResetTransaction runs effects in exact initMap order", () => {
  const { calls, owner } = createHarness();

  owner.runInitMapResetTransaction({ debugMode: "PROD" });

  assert.deepEqual(calls, EFFECT_ORDER);
});

test("topology and hit-canvas revision effects are called in order", () => {
  const { calls, owner } = createHarness();

  owner.runInitMapResetTransaction({ debugMode: "GEOMETRY" });

  assert.ok(calls.indexOf("bumpTopologyRevision") >= 0);
  assert.ok(calls.indexOf("resetHitCanvasTopologyRevision") >= 0);
  assert.ok(calls.indexOf("bumpTopologyRevision") < calls.indexOf("resetHitCanvasTopologyRevision"));
});

test("surface bridge state effect is between political rebuild and reference initialization", () => {
  const { calls, owner } = createHarness();

  owner.runInitMapResetTransaction({ debugMode: "PROD" });

  assert.ok(calls.indexOf("rebuildPoliticalLandCollections") < calls.indexOf("applyRendererSurfaceBridgeState"));
  assert.ok(calls.indexOf("applyRendererSurfaceBridgeState") < calls.indexOf("ensureSovereigntyState"));
});

test("cancel and reset effects preserve startup transaction order", () => {
  const { calls, owner } = createHarness();

  owner.runInitMapResetTransaction({ debugMode: "PROD" });

  assert.deepEqual(calls.slice(calls.indexOf("cancelScheduledHoverOverlayRender")), [
    "cancelScheduledHoverOverlayRender",
    "markAllOverlaysDirty",
    "clearStagedMapDataTasks",
    "cancelExactAfterSettleRefresh",
    "cancelPendingIndexUiRefresh",
    "resetDeferredRenderFlags",
    "resetProjectedBoundsCacheState",
    "invalidateAllRenderPasses",
    "syncDayNightClockTimerBridge",
  ]);
});

test("owner forwards exact effect payloads", () => {
  const { owner, payloads, getterCalls } = createHarness();

  owner.runInitMapResetTransaction({ debugMode: "ID_HASH" });

  assert.deepEqual(getterCalls, ["isPerfOverlayEnabled"]);
  assert.deepEqual(payloads.find((entry) => entry.name === "clearPendingPoliticalColorEdit")?.args, [
    {
      force: true,
      resetReason: "init-map",
      paintSource: "init-map",
    },
  ]);
  assert.deepEqual(payloads.find((entry) => entry.name === "clearLastGoodFrame")?.args, ["init-map"]);
  assert.deepEqual(payloads.find((entry) => entry.name === "invalidateInteractionComposite")?.args, ["init-map"]);
  assert.deepEqual(payloads.find((entry) => entry.name === "resetFirstVisibleFramePainted")?.args, ["init-map"]);
  assert.deepEqual(payloads.find((entry) => entry.name === "setRenderPassPerfOverlayEnabled")?.args, [true]);
  assert.deepEqual(payloads.find((entry) => entry.name === "setDebugMode")?.args, ["ID_HASH"]);
  assert.deepEqual(payloads.find((entry) => entry.name === "invalidateAllRenderPasses")?.args, ["init-map"]);
});

test("missing required effects and getters fail fast", () => {
  for (const missingName of EFFECT_ORDER) {
    const { effects, getters } = createHarness();
    delete effects[missingName];

    assert.throws(
      () => createRendererStartupTransactionOwner({ effects, getters }),
      new RegExp(`renderer startup transaction owner requires effects\\.${missingName}`),
    );
  }

  const { effects, getters } = createHarness();
  delete getters.isPerfOverlayEnabled;
  assert.throws(
    () => createRendererStartupTransactionOwner({ effects, getters }),
    /renderer startup transaction owner requires getters\.isPerfOverlayEnabled/,
  );
});

test("owner source stays import-safe and avoids forbidden renderer semantics", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_startup_transaction_owner.js");

  for (const tokenParts of [
    ["map_", "renderer.js"],
    ["runtime", "State"],
    ["draw", "Canvas"],
    ["renderPass", "ToCache"],
    ["build", "HitCanvas"],
    ["set", "MapData"],
    ["scenario", " refresh"],
    ["scenario", " chunk"],
    ["exactAfter", "Settle"],
    ["strategicOverlay", "Runtime"],
    ["init", "Zoom"],
    ["bind", "Events"],
    ["public", " facade"],
  ]) {
    assertExcludes(
      ownerSource,
      tokenParts.join(""),
      "startup transaction owner must avoid forbidden semantic token",
    );
  }
  for (const token of ["summary", "effectOrder"]) {
    assertExcludes(ownerSource, token, "startup transaction owner must not retain trace bookkeeping");
  }
});
