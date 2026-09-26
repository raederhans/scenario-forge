import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioDisplayRestoreRuntime } from "../js/core/scenario/presentation_display_restore.js";

function makeState() {
  return {
    activeScenarioId: "",
    scenarioDisplaySettingsBeforeActivate: null,
    activeScenarioPerformanceHints: null,
    renderProfile: "auto",
  };
}

const balancedHint = { performance_hints: { render_profile_default: "balanced" } };

test("each explicit URL render profile survives scenario hint and exit", () => {
  for (const profile of ["auto", "balanced", "full"]) {
    const state = makeState();
    const runtime = createScenarioDisplayRestoreRuntime({
      state,
      getSearchParams: () => new URLSearchParams(`render_profile=${profile}`),
    });
    runtime.applyScenarioPerformanceHints(balancedHint);
    assert.equal(state.renderProfile, profile);
    runtime.restoreScenarioDisplaySettingsAfterExit();
    assert.equal(state.renderProfile, profile);
  }
});

test("without an explicit URL profile, scenario hint is temporary", () => {
  const state = makeState();
  const runtime = createScenarioDisplayRestoreRuntime({ state, getSearchParams: () => new URLSearchParams() });
  runtime.applyScenarioPerformanceHints(balancedHint);
  assert.equal(state.renderProfile, "balanced");
  runtime.restoreScenarioDisplaySettingsAfterExit();
  assert.equal(state.renderProfile, "auto");
});

test("invalid URL value does not block a scene default", () => {
  const state = makeState();
  const runtime = createScenarioDisplayRestoreRuntime({
    state,
    getSearchParams: () => new URLSearchParams("render_profile=unknown"),
  });
  runtime.applyScenarioPerformanceHints(balancedHint);
  assert.equal(state.renderProfile, "balanced");
});

test("user profile changes during a scenario survive later hints and exit", () => {
  const state = makeState();
  const runtime = createScenarioDisplayRestoreRuntime({ state, getSearchParams: () => new URLSearchParams() });
  runtime.applyScenarioPerformanceHints(balancedHint);
  state.renderProfile = "full";
  state.activeScenarioId = "first";
  runtime.applyScenarioPerformanceHints({ performance_hints: { render_profile_default: "auto" } });
  assert.equal(state.renderProfile, "full");
  runtime.restoreScenarioDisplaySettingsAfterExit();
  assert.equal(state.renderProfile, "full");
});
