import test from "node:test";
import assert from "node:assert/strict";

import {
  captureScenarioHealthState,
  restoreScenarioDataHealthState,
  restoreScenarioHydrationHealthGateState,
  setScenarioDataHealthState,
  setScenarioHydrationHealthGateState,
} from "../js/core/state/actions/scenario_health_actions.js";
import {
  captureActiveScenarioPerformanceHintsState,
  setActiveScenarioPerformanceHintsState,
} from "../js/core/state/actions/scenario_presentation_actions.js";
import {
  normalizeScenarioDataHealthState,
  normalizeScenarioHydrationHealthGateState,
} from "../js/core/state/scenario_runtime_state.js";
import {
  createScenarioDisplayRestoreRuntime,
} from "../js/core/scenario/presentation_display_restore.js";
import { normalizeScenarioPerformanceHints } from "../js/core/scenario/presentation_hint_helpers.js";
import {
  STATE_BUS_EVENTS,
  off,
  subscribeStateBusEvent,
} from "../js/core/state/index.js";

test("health normalization preserves distinct numeric fallback contracts", () => {
  const cases = [
    { value: undefined, count: 0, ratio: 1, minimum: 0.6, overlapCount: 0 },
    { value: null, count: 0, ratio: 0, minimum: 0.6, overlapCount: 0 },
    { value: "", count: 0, ratio: 0, minimum: 0.6, overlapCount: 0 },
    { value: "invalid", count: 0, ratio: 1, minimum: 0.6, overlapCount: 0 },
    { value: NaN, count: 0, ratio: 1, minimum: 0.6, overlapCount: 0 },
    { value: Infinity, count: Infinity, ratio: 1, minimum: Infinity, overlapCount: 0 },
    { value: -Infinity, count: -Infinity, ratio: 1, minimum: -Infinity, overlapCount: 0 },
    { value: "-2.5", count: -2.5, ratio: -2.5, minimum: -2.5, overlapCount: -2.5 },
    { value: false, count: 0, ratio: 0, minimum: 0.6, overlapCount: 0 },
  ];
  for (const { value, count, ratio, minimum, overlapCount } of cases) {
    const healthInput = Object.freeze({
      expectedFeatureCount: value,
      runtimeFeatureCount: value,
      ratio: value,
      minRatio: value,
    });
    const gateInput = Object.freeze({
      checkedAt: 42,
      ownerFeatureOverlapRatio: value,
      ownerFeatureOverlapCount: value,
      ownerFeatureRenderedCount: value,
    });
    const health = normalizeScenarioDataHealthState(healthInput, 0.6);
    const gate = normalizeScenarioHydrationHealthGateState(gateInput);
    assert.deepEqual(
      [health.expectedFeatureCount, health.runtimeFeatureCount, health.ratio, health.minRatio],
      [count, count, ratio, minimum],
      `data health input: ${String(value)}`,
    );
    assert.deepEqual(
      [gate.ownerFeatureOverlapRatio, gate.ownerFeatureOverlapCount, gate.ownerFeatureRenderedCount],
      [ratio, overlapCount, overlapCount],
      `hydration health input: ${String(value)}`,
    );
  }
});

test("health normalization retains defaults and extension fields without changing input", () => {
  for (const input of [undefined, null, false, "invalid", 42]) {
    assert.deepEqual(normalizeScenarioDataHealthState(input), {
      expectedFeatureCount: 0,
      runtimeFeatureCount: 0,
      ratio: 1,
      minRatio: 0.7,
      generatedColorTags: [],
      warning: "",
      severity: "",
    });
  }
  for (const fallback of [undefined, null, 0, NaN, "invalid"]) {
    assert.equal(normalizeScenarioDataHealthState({ minRatio: 0 }, fallback).minRatio, 0.7);
  }
  const extension = Object.freeze({ source: "import" });
  const generatedColorTags = Object.freeze(["AA"]);
  const input = Object.freeze({ generatedColorTags, extension, checkedAt: 42 });
  const health = normalizeScenarioDataHealthState(input);
  const gate = normalizeScenarioHydrationHealthGateState(input);
  assert.equal(health.extension, extension);
  assert.equal(gate.extension, extension);
  health.generatedColorTags.push("BB");
  assert.deepEqual(input.generatedColorTags, ["AA"]);
  assert.deepEqual(normalizeScenarioDataHealthState({ generatedColorTags: "AA" }).generatedColorTags, []);
});

test("hydration health uses the current time only for empty or invalid timestamps", (t) => {
  const now = t.mock.method(Date, "now", () => 123456);
  for (const checkedAt of [undefined, null, 0, "", NaN, "invalid"]) {
    assert.equal(normalizeScenarioHydrationHealthGateState({ checkedAt }).checkedAt, 123456);
  }
  assert.equal(normalizeScenarioHydrationHealthGateState().checkedAt, 123456);
  assert.equal(now.mock.callCount(), 7);
  for (const [checkedAt, expected] of [["42", 42], [-1, -1], [Infinity, Infinity]]) {
    assert.equal(normalizeScenarioHydrationHealthGateState({ checkedAt }).checkedAt, expected);
  }
  assert.equal(now.mock.callCount(), 7);
});

test("scenario performance hints share one default shape and preserve explicit false", () => {
  const defaults = {
    renderProfileDefault: "",
    dynamicBordersDefault: null,
    parentBordersDefault: null,
    scenarioReliefOverlaysDefault: null,
    scenarioAtlantropaDefault: null,
    waterRegionsDefault: null,
    specialRegionsDefault: null,
  };
  for (const performance_hints of [undefined, null, false, "full", {}, []]) {
    assert.deepEqual(normalizeScenarioPerformanceHints({ performance_hints }), defaults);
  }
  assert.deepEqual(normalizeScenarioPerformanceHints({ performance_hints: {
    render_profile_default: " FULL ", dynamic_borders_default: false,
    parent_borders_default: true, water_regions_default: "false",
    special_regions_default: 0,
  } }), { ...defaults, renderProfileDefault: "full", dynamicBordersDefault: false, parentBordersDefault: true });
});

test("scenario health actions normalize writes through the runtime-state read contract", () => {
  const target = {};
  const generatedColorTags = ["AA"];

  const gate = setScenarioHydrationHealthGateState(target, normalizeScenarioHydrationHealthGateState({
    status: "",
    checkedAt: 42,
    attemptedRetry: 1,
    ownerFeatureOverlapRatio: "0.5",
    ownerFeatureOverlapCount: "4",
    ownerFeatureRenderedCount: "8",
    degradedWaterOverlay: 1,
  }));
  const health = setScenarioDataHealthState(target, normalizeScenarioDataHealthState({
    expectedFeatureCount: "10",
    runtimeFeatureCount: "8",
    ratio: "0.8",
    minRatio: "0.75",
    generatedColorTags,
    warning: 42,
    severity: "warning",
  }, 0.7));

  assert.equal(gate, target.scenarioHydrationHealthGate);
  assert.equal(gate.status, "idle");
  assert.equal(gate.checkedAt, 42);
  assert.equal(gate.attemptedRetry, true);
  assert.equal(gate.ownerFeatureOverlapRatio, 0.5);
  assert.equal(gate.ownerFeatureOverlapCount, 4);
  assert.equal(gate.ownerFeatureRenderedCount, 8);
  assert.equal(gate.degradedWaterOverlay, true);
  assert.equal(health, target.scenarioDataHealth);
  assert.deepEqual(health, {
    expectedFeatureCount: 10,
    runtimeFeatureCount: 8,
    ratio: 0.8,
    minRatio: 0.75,
    generatedColorTags: ["AA"],
    warning: "42",
    severity: "warning",
  });
  assert.notEqual(health.generatedColorTags, generatedColorTags);
});

test("scenario health rollback actions restore exact captured values", () => {
  const target = {};
  const gate = Object.freeze({ status: "captured", checkedAt: 17 });
  const health = Object.freeze({ expectedFeatureCount: 12, custom: true });

  assert.equal(restoreScenarioHydrationHealthGateState(target, gate), gate);
  assert.equal(restoreScenarioDataHealthState(target, health), health);
  assert.equal(target.scenarioHydrationHealthGate, gate);
  assert.equal(target.scenarioDataHealth, health);
});

test("scenario health and performance read models capture exact rollback values", () => {
  const gate = Object.freeze({ status: "captured" });
  const health = Object.freeze({ severity: "warning" });
  const hints = Object.freeze({ renderProfileDefault: "performance" });
  const target = {
    scenarioHydrationHealthGate: gate,
    scenarioDataHealth: health,
    activeScenarioPerformanceHints: hints,
  };

  const healthSnapshot = captureScenarioHealthState(target);
  const hintSnapshot = captureActiveScenarioPerformanceHintsState(target);
  assert.equal(Object.isFrozen(healthSnapshot), true);
  assert.equal(Object.isFrozen(hintSnapshot), true);
  assert.equal(Object.isFrozen(healthSnapshot.values), true);
  assert.equal(Object.isFrozen(hintSnapshot.values), true);
  assert.equal(healthSnapshot.values.scenarioHydrationHealthGate, gate);
  assert.equal(healthSnapshot.values.scenarioDataHealth, health);
  assert.equal(hintSnapshot.values.activeScenarioPerformanceHints, hints);
});

test("presentation hint action publishes the exact value", () => {
  const target = {};
  const hints = Object.freeze({ renderProfileDefault: "performance" });

  assert.equal(setActiveScenarioPerformanceHintsState(target, hints), hints);
  assert.equal(target.activeScenarioPerformanceHints, hints);
  assert.equal(setActiveScenarioPerformanceHintsState(target, null), null);
  assert.equal(target.activeScenarioPerformanceHints, null);
});

test("scenario health and presentation actions reject invalid targets before mutation", () => {
  for (const target of [null, [], "state"]) {
    assert.throws(
      () => captureScenarioHealthState(target),
      /target must be an object/,
    );
    assert.throws(
      () => setScenarioHydrationHealthGateState(target, {}),
      /target must be an object/,
    );
    assert.throws(
      () => restoreScenarioHydrationHealthGateState(target, {}),
      /target must be an object/,
    );
    assert.throws(
      () => setScenarioDataHealthState(target, {}),
      /target must be an object/,
    );
    assert.throws(
      () => restoreScenarioDataHealthState(target, {}),
      /target must be an object/,
    );
    assert.throws(
      () => captureActiveScenarioPerformanceHintsState(target),
      /target must be an object/,
    );
    assert.throws(
      () => setActiveScenarioPerformanceHintsState(target, null),
      /target must be an object/,
    );
  }
});

test("performance hints are committed before the five presentation UI events", () => {
  const targetState = {
    activeScenarioId: "",
    scenarioDisplaySettingsBeforeActivate: null,
    activeScenarioPerformanceHints: null,
    renderProfile: "auto",
    dynamicBordersEnabled: true,
    parentBordersVisible: true,
    showWaterRegions: true,
    showScenarioSpecialRegions: true,
    showScenarioAtlantropa: true,
    showScenarioReliefOverlays: true,
    showStrategicResourceMarkers: false,
    strategicChoroplethMetric: "",
  };
  const events = [
    STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION,
    STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION,
    STATE_BUS_EVENTS.UPDATE_SCENARIO_RELIEF_OVERLAY,
    STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS,
    STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS,
  ];
  const observed = [];
  const listeners = events.map((eventName) => {
    const listener = subscribeStateBusEvent(eventName, () => {
      observed.push([eventName, targetState.activeScenarioPerformanceHints]);
    });
    return [eventName, listener];
  });
  try {
    const runtime = createScenarioDisplayRestoreRuntime({ state: targetState });
    runtime.applyScenarioPerformanceHints({
      performance_hints: { render_profile_default: "performance" },
    });
    assert.deepEqual(observed.map(([eventName]) => eventName), events);
    assert.equal(
      observed.every(([, hints]) => hints === targetState.activeScenarioPerformanceHints),
      true,
    );
    assert.notEqual(targetState.activeScenarioPerformanceHints, null);

    observed.length = 0;
    runtime.restoreScenarioDisplaySettingsAfterExit();
    assert.deepEqual(observed.map(([eventName]) => eventName), events);
    assert.equal(observed.every(([, hints]) => hints === null), true);
  } finally {
    listeners.forEach(([eventName, listener]) => off(eventName, listener));
  }
});
