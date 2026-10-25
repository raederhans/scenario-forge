import assert from "node:assert/strict";
import test from "node:test";

import { createDeferredDetailPromotionOwner } from "../js/bootstrap/deferred_detail_promotion.js";
import {
  commitStartupReadonlyStateFields,
  setBootStateFields,
} from "../js/core/state/actions/boot_actions.js";
import { state as rendererState } from "../js/core/state.js";

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("forced readonly unlock schedules a ready sample exactly once when UI is ready", async () => {
  const runtimeFixture = {
    activeScenarioId: "tno_1962",
    bootPhase: "detail-promotion",
    detailDeferred: false,
    detailPromotionCompleted: false,
    detailPromotionInFlight: false,
    renderProfile: "balanced",
    startupReadonly: true,
    startupReadonlyUnlockInFlight: false,
    uiHydrationStatus: "ready",
  };
  let timerCallback = null;
  let sampleScheduleCount = 0;
  const bootPhases = [];
  const owner = createDeferredDetailPromotionOwner({
    runtimeState: runtimeFixture,
    helpers: {
      buildInteractionInfrastructureAfterStartup: async (options) => {
        assert.deepEqual(options, {
          chunked: true,
          buildHitCanvas: false,
          mode: "basic",
        });
        return true;
      },
      hasStartupReadonlyUnlockScheduled: () => false,
      scheduleStartupReadonlyUnlockTimer: (callback, delayMs) => {
        assert.equal(delayMs, 0);
        timerCallback = callback;
      },
      setBootState: (phase) => {
        setBootStateFields(runtimeFixture, { phase });
        bootPhases.push(phase);
      },
      setStartupReadonlyState: (active, options = {}) => {
        commitStartupReadonlyStateFields(runtimeFixture, {
          active,
          reason: options.reason,
          unlockInFlight: options.unlockInFlight,
          since: options.since,
        });
      },
      tryScheduleStartupSampleProjectDeeplink: () => {
        assert.equal(runtimeFixture.bootPhase, "ready");
        assert.equal(runtimeFixture.uiHydrationStatus, "ready");
        sampleScheduleCount += 1;
        return sampleScheduleCount === 1;
      },
    },
  });

  owner.scheduleStartupReadonlyUnlock({}, {
    delayMs: 0,
    attempt: 1,
    maxAttempts: 1,
  });
  assert.equal(typeof timerCallback, "function");

  timerCallback();
  await drainMicrotasks();

  assert.deepEqual(bootPhases, ["interaction-infra", "ready"]);
  assert.equal(runtimeFixture.startupReadonly, false);
  assert.equal(sampleScheduleCount, 1);
});

function detailPromotionFixture() {
  const h = { yields: 0, gate: null, refreshes: 0 };
  h.state = { activeScenarioId: "tno_1962", sceneGeneration: 1, topologyBundleMode: "single",
    detailDeferred: true, detailPromotionCompleted: false, detailPromotionInFlight: false };
  h.detail = { type: "Topology", objects: { political: { type: "GeometryCollection", geometries: [] } }, arcs: [] };
  h.owner = createDeferredDetailPromotionOwner({ runtimeState: h.state, helpers: {
    loadDetailBundle: async () => ({ topologyDetail: h.detail, topologyBundleMode: "composite", detailSourceUsed: "na_v2" }),
    yieldToInput: () => { h.yields++; h.gate = Promise.withResolvers(); return h.gate.promise; },
  } });
  return h;
}

test("detail promotion yields to input between loading the bundle and applying it", async () => {
  const h = detailPromotionFixture();
  const promotion = h.owner.ensureDetailTopologyReady({ applyMapData: false, flushPendingFocusRefresh: false });
  while (!h.gate) await drainMicrotasks();
  assert.equal(h.yields, 1);
  assert.equal(h.state.topologyDetail, undefined, "nothing is applied before the yield returns");
  h.gate.resolve();
  assert.equal(await promotion, true);
  assert.equal(h.state.topologyDetail, h.detail);
  assert.equal(h.state.detailPromotionCompleted, true);
  assert.equal(h.state.detailPromotionInFlight, false);
});

test("a scene change during the yield discards the loaded detail bundle", async t => {
  const h = detailPromotionFixture();
  // Read-only startup keeps the stale request from scheduling its own retry.
  h.state.startupReadonly = true;
  // The refresh scope reads the renderer's live scene.
  const previousGeneration = rendererState.sceneGeneration;
  t.after(() => { rendererState.sceneGeneration = previousGeneration; });
  const promotion = h.owner.ensureDetailTopologyReady({ applyMapData: false, flushPendingFocusRefresh: false });
  while (!h.gate) await drainMicrotasks();
  rendererState.sceneGeneration = (Number(previousGeneration) || 0) + 1;
  h.gate.resolve();
  assert.equal(await promotion, false);
  assert.equal(h.state.topologyDetail, undefined);
  assert.equal(h.state.detailPromotionCompleted, false);
  assert.equal(h.state.detailPromotionInFlight, false);
});
