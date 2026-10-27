import assert from "node:assert/strict";
import test from "node:test";

const MODULE_PATH = "../js/core/state/actions/renderer_phase_actions.js";

async function loadActions() {
  try {
    return await import(MODULE_PATH);
  } catch (error) {
    assert.fail(`renderer phase actions must exist: ${error?.message || error}`);
  }
}

test("renderer phase actions reject invalid targets", async () => {
  const {
    commitRendererDprStageState,
    setAdaptiveSettleProfileState,
    setPendingDayNightRefreshState,
    setPhaseEnteredAtState,
    setRendererIsInteractingState,
    setRenderPhaseValueState,
    setRenderPhaseTimerIdState,
  } = await loadActions();

  for (const target of [null, undefined, [], "state"]) {
    assert.throws(() => setRenderPhaseTimerIdState(target, null), /target must be an object/);
    assert.throws(() => setRenderPhaseValueState(target, "idle"), /target must be an object/);
    assert.throws(() => setPhaseEnteredAtState(target, 0), /target must be an object/);
    assert.throws(() => setRendererIsInteractingState(target, false), /target must be an object/);
    assert.throws(() => setPendingDayNightRefreshState(target, true), /target must be an object/);
    assert.throws(() => setAdaptiveSettleProfileState(target, null), /target must be an object/);
    assert.throws(() => commitRendererDprStageState(target, {}), /target must be an object/);
  }
});

test("renderer phase timer and settle profile preserve exact identity including null", async () => {
  const {
    setAdaptiveSettleProfileState,
    setRenderPhaseTimerIdState,
  } = await loadActions();
  const target = { sentinel: "preserved" };
  const timerId = { id: "timer" };
  const profile = { delayMs: 120, source: "zoom" };

  assert.equal(setRenderPhaseTimerIdState(target, timerId), timerId);
  assert.equal(target.renderPhaseTimerId, timerId);
  assert.equal(setRenderPhaseTimerIdState(target, null), null);
  assert.equal(target.renderPhaseTimerId, null);
  assert.equal(setAdaptiveSettleProfileState(target, profile), profile);
  assert.equal(target.adaptiveSettleProfile, profile);
  assert.equal(setAdaptiveSettleProfileState(target, null), null);
  assert.equal(target.adaptiveSettleProfile, null);
  assert.equal(target.sentinel, "preserved");
});

test("renderer phase setters own only their production fields", async () => {
  const {
    setPhaseEnteredAtState,
    setRendererIsInteractingState,
    setRenderPhaseValueState,
  } = await loadActions();
  const target = {
    renderPhase: "idle",
    phaseEnteredAt: 1,
    isInteracting: false,
    sentinel: "preserved",
  };

  const phase = { id: "settling" };
  assert.equal(setRenderPhaseValueState(target, phase), phase);
  assert.equal(setPhaseEnteredAtState(target, 42.5), 42.5);
  assert.equal(setRendererIsInteractingState(target, 1), true);
  assert.equal(target.renderPhase, phase);
  assert.equal(target.phaseEnteredAt, 42.5);
  assert.equal(target.isInteracting, true);
  assert.equal(target.sentinel, "preserved");
});

test("pending day-night refresh normalizes to a boolean", async () => {
  const { setPendingDayNightRefreshState } = await loadActions();
  const target = {};

  assert.equal(setPendingDayNightRefreshState(target, "queued"), true);
  assert.equal(target.pendingDayNightRefresh, true);
  assert.equal(setPendingDayNightRefreshState(target, 0), false);
  assert.equal(target.pendingDayNightRefresh, false);
});

test("day-night style config initializes its container and preserves config identity", async () => {
  const { setDayNightStyleConfigState } = await import(
    "../js/core/state/actions/scenario_presentation_actions.js"
  );
  for (const invalidTarget of [null, undefined, [], "state"]) {
    assert.throws(
      () => setDayNightStyleConfigState(invalidTarget, {}),
      /target must be an object/,
    );
  }
  const target = {};
  const config = { enabled: true, mode: "cycle" };

  assert.equal(setDayNightStyleConfigState(target, config), config);
  assert.equal(target.styleConfig.dayNight, config);
});

test("scenario style defaults merge in place and reject invalid patches", async () => {
  const { mergeScenarioStyleDefaultsState } = await import(
    "../js/core/state/actions/scenario_presentation_actions.js"
  );
  for (const invalidTarget of [null, undefined, [], "state"]) {
    assert.throws(
      () => mergeScenarioStyleDefaultsState(invalidTarget, {}),
      /target must be an object/,
    );
  }
  const ocean = {
    fillColor: "#000000",
    opacity: 0.8,
    contourStrength: 0.3,
  };
  const styleConfig = {
    ocean,
    coastlines: "invalid-group",
  };
  const target = {
    styleConfig,
  };

  assert.equal(
    mergeScenarioStyleDefaultsState(target, {
      ocean: {
        fillColor: "#123456",
        preset: "scenario",
        contourStrength: 0.5,
      },
      coastlines: { width: 2 },
    }),
    true,
  );
  assert.equal(target.styleConfig, styleConfig);
  assert.equal(target.styleConfig.ocean, ocean);
  assert.deepEqual(target.styleConfig.ocean, {
    fillColor: "#123456",
    opacity: 0.8,
    preset: "scenario",
    contourStrength: 0.5,
  });
  assert.deepEqual(target.styleConfig.coastlines, { width: 2 });
  assert.throws(
    () => mergeScenarioStyleDefaultsState(target, []),
    /styleOverride must be an object/,
  );
  assert.throws(
    () => mergeScenarioStyleDefaultsState(target, { lakes: {} }),
    /unknown group: lakes/,
  );
  assert.throws(
    () => mergeScenarioStyleDefaultsState(target, { ocean: { unknown: true } }),
    /unknown key: unknown/,
  );
  const beforeRejectedPatch = structuredClone(target);
  assert.throws(
    () => mergeScenarioStyleDefaultsState(target, {
      ocean: { fillColor: "#ffffff" },
      coastlines: { unknown: true },
    }),
    /unknown key: unknown/,
  );
  assert.deepEqual(target, beforeRejectedPatch);
});

test("DPR stage and switch timestamp commit as one exact pair", async () => {
  const { commitRendererDprStageState } = await loadActions();
  const target = {
    dprStage: "idle",
    dprLastStageSwitchAt: 10,
    sentinel: "preserved",
  };

  assert.equal(
    commitRendererDprStageState(target, {
      stage: "interactive",
      switchedAt: 123.75,
    }),
    "interactive",
  );
  assert.equal(target.dprStage, "interactive");
  assert.equal(target.dprLastStageSwitchAt, 123.75);
  assert.equal(target.sentinel, "preserved");
});
