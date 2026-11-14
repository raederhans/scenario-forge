import assert from "node:assert/strict";
import test from "node:test";

import {
  createRendererStartupTransactionOwner,
} from "../js/core/renderer/renderer_startup_transaction_owner.js";

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
