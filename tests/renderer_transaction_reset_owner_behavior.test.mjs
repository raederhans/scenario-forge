import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createRendererTransactionResetOwner } from "../js/core/map_renderer/renderer_transaction_reset_owner.js";

const REFRESH_DEFAULT_ORDER = Object.freeze([
  "clearPendingDynamicBorderTimer",
  "clearRenderPhaseTimer",
  "cancelPendingIndexUiRefresh",
  "cancelPendingSidebarRefresh",
  "setRenderPhaseIdle",
  "resetRenderDiagnostics",
  "clearStagedMapDataTasks",
  "cancelExactAfterSettleRefresh",
  "cancelScheduledHitCanvasBuild",
  "setDeferContextBasePass",
  "setDeferHitCanvasBuild",
  "setDeferExactAfterSettle",
  "resetLayerResolverCache",
  "resetDevInteractionState",
  "resetDevClipboardState",
  "resetPhysicalLandClipPathCache",
]);

const TOPOLOGY_DIRTY_ORDER = Object.freeze([
  "resetExactRefreshOptimizationState",
  "resetVisibleInternalBorderMeshSignature",
  "bumpTopologyRevision",
  "setHitCanvasDirty",
  "resetHitCanvasTopologyRevision",
]);

const TOPOLOGY_CLEAN_ORDER = Object.freeze([
  "resetExactRefreshOptimizationState",
  "resetVisibleInternalBorderMeshSignature",
  "bumpTopologyRevision",
  "resetHitCanvasTopologyRevision",
]);

function createHarness(overrides = {}) {
  const calls = [];
  const hitCanvasCancelResult = overrides.hitCanvasCancelResult ?? {
    reason: "renderer-refresh-reset",
    canceled: true,
  };
  const effects = {};
  for (const name of [
    "clearPendingDynamicBorderTimer",
    "clearRenderPhaseTimer",
    "cancelPendingIndexUiRefresh",
    "cancelPendingSidebarRefresh",
    "cancelScheduledHoverOverlayRender",
    "setRenderPhaseIdle",
    "resetRenderDiagnostics",
    "clearStagedMapDataTasks",
    "cancelExactAfterSettleRefresh",
    "setDeferContextBasePass",
    "setDeferHitCanvasBuild",
    "setDeferExactAfterSettle",
    "resetLayerResolverCache",
    "resetDevInteractionState",
    "resetDevClipboardState",
    "resetPhysicalLandClipPathCache",
    "resetExactRefreshOptimizationState",
    "resetVisibleInternalBorderMeshSignature",
    "bumpTopologyRevision",
    "setHitCanvasDirty",
    "resetHitCanvasTopologyRevision",
  ]) {
    effects[name] = (...args) => {
      calls.push([name, ...args]);
      return overrides[`${name}Result`];
    };
  }
  effects.cancelScheduledHitCanvasBuild = (options) => {
    calls.push(["cancelScheduledHitCanvasBuild", options]);
    return hitCanvasCancelResult;
  };
  effects.cancelSecondarySpatialBuild = () => {
    calls.push(["cancelSecondarySpatialBuild"]);
    return overrides.cancelSecondarySpatialBuildResult ?? true;
  };
  const owner = createRendererTransactionResetOwner({ effects });
  return { calls, owner };
}

function callNames(calls) {
  return calls.map((call) => call[0]);
}

test("resetRendererTransactionState resets refresh before topology", () => {
  const { calls, owner } = createHarness();

  const summary = owner.resetRendererTransactionState({ hitCanvasDirty: true });

  assert.deepEqual(callNames(calls), [...REFRESH_DEFAULT_ORDER, ...TOPOLOGY_DIRTY_ORDER]);
  assert.deepEqual(summary.effectOrder, [...REFRESH_DEFAULT_ORDER, ...TOPOLOGY_DIRTY_ORDER]);
  assert.equal(summary.reason, "renderer-transaction-reset");
  assert.equal(summary.hitCanvasDirty, true);
  assert.equal(summary.topologyChanged, true);
  assert.equal(summary.canceledHitCanvasSchedule, true);
});

test("resetRendererRefreshTransactionState default path preserves reset order", () => {
  const { calls, owner } = createHarness();

  const summary = owner.resetRendererRefreshTransactionState();

  assert.deepEqual(callNames(calls), REFRESH_DEFAULT_ORDER);
  assert.equal(summary.reason, "renderer-refresh-reset");
  assert.equal(summary.canceledSecondarySpatial, false);
  assert.equal(summary.canceledHitCanvasSchedule, true);
});

test("resetRendererRefreshTransactionState optionally cancels hover overlay", () => {
  const { calls, owner } = createHarness();

  const summary = owner.resetRendererRefreshTransactionState({ cancelHoverOverlay: true });

  assert.deepEqual(callNames(calls), [
    "clearPendingDynamicBorderTimer",
    "clearRenderPhaseTimer",
    "cancelPendingIndexUiRefresh",
    "cancelPendingSidebarRefresh",
    "cancelScheduledHoverOverlayRender",
    ...REFRESH_DEFAULT_ORDER.slice(4),
  ]);
  assert.equal(summary.canceledSecondarySpatial, false);
});

test("resetRendererRefreshTransactionState optionally cancels secondary spatial build", () => {
  const { calls, owner } = createHarness();

  const summary = owner.resetRendererRefreshTransactionState({ cancelSecondarySpatialBuild: true });

  assert.deepEqual(callNames(calls), [
    ...REFRESH_DEFAULT_ORDER.slice(0, 9),
    "cancelSecondarySpatialBuild",
    ...REFRESH_DEFAULT_ORDER.slice(9),
  ]);
  assert.equal(summary.canceledSecondarySpatial, true);
});

test("scheduled hit canvas cancellation goes through the P47 cancellation effect", () => {
  const { calls, owner } = createHarness({
    hitCanvasCancelResult: {
      reason: "renderer-refresh-reset",
      canceled: false,
      skipped: true,
    },
  });

  const summary = owner.resetRendererRefreshTransactionState();

  assert.deepEqual(calls[8], [
    "cancelScheduledHitCanvasBuild",
    { reason: "renderer-refresh-reset" },
  ]);
  assert.equal(summary.canceledHitCanvasSchedule, false);
});

test("markRendererTopologyChanged preserves clean topology reset", () => {
  const { calls, owner } = createHarness();

  const summary = owner.markRendererTopologyChanged({ hitCanvasDirty: false });

  assert.deepEqual(callNames(calls), TOPOLOGY_CLEAN_ORDER);
  assert.equal(summary.hitCanvasDirty, false);
  assert.equal(summary.topologyChanged, true);
});

test("markRendererTopologyChanged preserves dirty hit canvas reset", () => {
  const { calls, owner } = createHarness();

  const summary = owner.markRendererTopologyChanged({ hitCanvasDirty: true });

  assert.deepEqual(callNames(calls), TOPOLOGY_DIRTY_ORDER);
  assert.deepEqual(calls[3], ["setHitCanvasDirty", true]);
  assert.equal(summary.hitCanvasDirty, true);
});

test("createRendererTransactionResetOwner fails fast for missing dependencies", () => {
  assert.throws(
    () => createRendererTransactionResetOwner({ effects: {} }),
    /effects\.clearPendingDynamicBorderTimer must be a function/,
  );
});

test("reset summaries are frozen", () => {
  const { owner } = createHarness();

  const summary = owner.resetRendererTransactionState({
    cancelSecondarySpatialBuild: true,
    cancelHoverOverlayRender: true,
    hitCanvasDirty: true,
  });

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});

