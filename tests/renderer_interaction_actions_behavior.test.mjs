import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MODULE_PATH = "../js/core/state/actions/renderer_interaction_actions.js";
const PRESENTATION_MODULE_PATH = "../js/core/state/actions/scenario_presentation_actions.js";
const ACTIVATION_MODULE_PATH = "../js/core/state/actions/scenario_activation_actions.js";

async function loadActions() {
  try {
    return {
      ...await import(MODULE_PATH),
      ...await import(PRESENTATION_MODULE_PATH),
      ...await import(ACTIVATION_MODULE_PATH),
    };
  } catch (error) {
    assert.fail(`renderer interaction actions must exist: ${error?.message || error}`);
  }
}

test("renderer interaction actions reject invalid targets", async () => {
  const {
    beginInteractionRecoveryTaskState,
    setInteractionInfrastructureStateFields,
    setPendingZoomTransformState,
    setZoomGestureStartTransformState,
  } = await loadActions();

  for (const target of [null, undefined, [], "state"]) {
    assert.throws(() => setZoomGestureStartTransformState(target, null), /target must be an object/);
    assert.throws(() => setPendingZoomTransformState(target, null), /target must be an object/);
    assert.throws(() => beginInteractionRecoveryTaskState(target, {}), /target must be an object/);
    assert.throws(() => setInteractionInfrastructureStateFields(target, "idle"), /target must be an object/);
  }
});

test("zoom transform actions preserve object identity and explicit null", async () => {
  const {
    setZoomTransformState,
    setPendingZoomTransformState,
    setZoomGestureStartTransformState,
  } = await loadActions();
  const target = { sentinel: "preserved" };
  const startTransform = { x: 1, y: 2, k: 3 };
  const pendingTransform = { x: 4, y: 5, k: 6 };

  assert.equal(setZoomTransformState(target, pendingTransform), pendingTransform);
  assert.equal(target.zoomTransform, pendingTransform);
  assert.equal(setZoomTransformState(target, undefined), undefined);
  assert.equal(target.zoomTransform, undefined);

  assert.equal(setZoomGestureStartTransformState(target, startTransform), startTransform);
  assert.equal(target.zoomGestureStartTransform, startTransform);
  assert.equal(setPendingZoomTransformState(target, pendingTransform), pendingTransform);
  assert.equal(target.pendingZoomTransform, pendingTransform);
  assert.equal(setZoomGestureStartTransformState(target, null), null);
  assert.equal(setPendingZoomTransformState(target, null), null);
  assert.equal(target.zoomGestureStartTransform, null);
  assert.equal(target.pendingZoomTransform, null);
  assert.equal(target.sentinel, "preserved");
});

test("zoom scalar actions preserve values or normalize scheduled state", async () => {
  const {
    setZoomGestureEndedAtState,
    setZoomGestureScaleDeltaState,
    setZoomRenderScheduledState,
  } = await loadActions();
  const target = {};

  assert.equal(setZoomGestureScaleDeltaState(target, 1.25), 1.25);
  assert.equal(target.zoomGestureScaleDelta, 1.25);
  assert.equal(setZoomGestureEndedAtState(target, 98.5), 98.5);
  assert.equal(target.zoomGestureEndedAt, 98.5);
  assert.equal(setZoomRenderScheduledState(target, "scheduled"), true);
  assert.equal(target.zoomRenderScheduled, true);
  assert.equal(setZoomRenderScheduledState(target, 0), false);
  assert.equal(target.zoomRenderScheduled, false);
});

test("interaction recovery task uses an expected-key ownership fence", async () => {
  const {
    beginInteractionRecoveryTaskState,
    endInteractionRecoveryTaskState,
  } = await loadActions();
  const target = {
    activeInteractionRecoveryTaskKey: "",
    activeInteractionRecoveryTaskStartedAt: 0,
    sentinel: "preserved",
  };

  assert.equal(
    beginInteractionRecoveryTaskState(target, {
      taskKey: " cache-warmup ",
      startedAt: 41,
    }),
    true,
  );
  assert.equal(target.activeInteractionRecoveryTaskKey, "cache-warmup");
  assert.equal(target.activeInteractionRecoveryTaskStartedAt, 41);

  assert.equal(
    beginInteractionRecoveryTaskState(target, {
      taskKey: "other",
      startedAt: 99,
      expectedActiveTaskKey: "",
    }),
    false,
  );
  assert.equal(target.activeInteractionRecoveryTaskKey, "cache-warmup");
  assert.equal(target.activeInteractionRecoveryTaskStartedAt, 41);

  assert.equal(endInteractionRecoveryTaskState(target, "other"), false);
  assert.equal(target.activeInteractionRecoveryTaskKey, "cache-warmup");
  assert.equal(endInteractionRecoveryTaskState(target, " cache-warmup "), true);
  assert.equal(target.activeInteractionRecoveryTaskKey, "");
  assert.equal(target.activeInteractionRecoveryTaskStartedAt, 0);
  assert.equal(target.sentinel, "preserved");
});

test("interaction recovery treats an absent active task key as idle", async () => {
  const { beginInteractionRecoveryTaskState } = await loadActions();
  const target = {};

  assert.equal(
    beginInteractionRecoveryTaskState(target, {
      taskKey: "initial-build",
      startedAt: 7,
    }),
    true,
  );
  assert.equal(target.activeInteractionRecoveryTaskKey, "initial-build");
  assert.equal(target.activeInteractionRecoveryTaskStartedAt, 7);
});

test("interaction infrastructure preserves ready and in-flight fields for null options", async () => {
  const { setInteractionInfrastructureStateFields } = await loadActions();
  const target = {
    interactionInfrastructureStage: "idle",
    interactionInfrastructureReady: true,
    interactionInfrastructureBuildInFlight: true,
    sentinel: "preserved",
  };

  assert.equal(
    setInteractionInfrastructureStateFields(target, " basic-ready ", {
      ready: null,
      inFlight: null,
    }),
    "basic-ready",
  );
  assert.equal(target.interactionInfrastructureReady, true);
  assert.equal(target.interactionInfrastructureBuildInFlight, true);

  assert.equal(
    setInteractionInfrastructureStateFields(target, "", {
      ready: 0,
      inFlight: "building",
    }),
    "idle",
  );
  assert.equal(target.interactionInfrastructureStage, "idle");
  assert.equal(target.interactionInfrastructureReady, false);
  assert.equal(target.interactionInfrastructureBuildInFlight, true);
  assert.equal(target.sentinel, "preserved");
});

test("click selection actions reject invalid targets", async () => {
  const actions = await loadActions();
  const clickActions = [
    ["clearClickHoveredIdState", []],
    ["clearClickScenarioHoverIdsState", []],
    ["setScenarioHoverRegionIdsState", [{}]],
    ["setClickHoverOverlayDirtyState", [true]],
    ["setHoveredFeatureIdsState", [{}]],
    ["setLastMouseMoveTimeState", [0]],
    ["setTooltipPendingState", [null]],
    ["setTooltipRafHandleState", [null]],
    ["setClickSelectedWaterRegionIdState", ["water-1"]],
    ["setClickSelectedSpecialRegionIdState", ["special-1"]],
    ["setClickSelectedColorState", ["#123456"]],
    ["removeClickWaterRegionOverrideState", ["water-1"]],
    ["removeClickCountryColorsState", ["AA"]],
    ["setClickActiveSovereignCodeState", ["AA"]],
    ["setClickCountryColorsState", ["AA", "#123456"]],
  ];
  for (const target of [null, undefined, [], "state"]) {
    for (const [name, args] of clickActions) {
      assert.throws(() => actions[name](target, ...args), /target must be an object/);
    }
  }
});

test("click selection actions preserve normalization deletion and canonical color writes", async () => {
  const {
    clearClickHoveredIdState,
    clearClickScenarioHoverIdsState,
    removeClickCountryColorsState,
    removeClickWaterRegionOverrideState,
    setClickActiveSovereignCodeState,
    setClickCountryColorsState,
    setClickHoverOverlayDirtyState,
    setClickSelectedColorState,
    setClickSelectedSpecialRegionIdState,
    setClickSelectedWaterRegionIdState,
  } = await loadActions();
  const selectedColor = { css: "#123456" };
  const target = {
    hoveredId: "land-1",
    hoveredSpecialRegionId: "special-1",
    hoveredWaterRegionId: "water-1",
    sovereignBaseColors: { AA: "#aaaaaa", BB: "#bbbbbb" },
    waterRegionOverrides: { "water-1": "#111111", "water-2": "#222222" },
  };

  clearClickHoveredIdState(target);
  clearClickScenarioHoverIdsState(target);
  assert.deepEqual(
    [target.hoveredId, target.hoveredWaterRegionId, target.hoveredSpecialRegionId],
    [null, null, null],
  );
  assert.equal(setClickHoverOverlayDirtyState(target, "dirty"), true);
  assert.equal(setClickSelectedWaterRegionIdState(target, " water-2 "), "water-2");
  assert.equal(setClickSelectedSpecialRegionIdState(target, null), "");
  assert.equal(setClickSelectedColorState(target, selectedColor), selectedColor);
  assert.equal(target.selectedColor, selectedColor);
  assert.equal(removeClickWaterRegionOverrideState(target, " water-1 "), true);
  assert.deepEqual(target.waterRegionOverrides, { "water-2": "#222222" });
  assert.equal(removeClickCountryColorsState(target, " AA "), true);
  assert.deepEqual(target.sovereignBaseColors, { BB: "#bbbbbb" });
  assert.equal(setClickActiveSovereignCodeState(target, " CC "), "CC");
  assert.equal(setClickCountryColorsState(target, " DD ", "#dddddd"), true);
  assert.equal(target.sovereignBaseColors.DD, "#dddddd");
  assert.equal(removeClickWaterRegionOverrideState(target, ""), false);
  assert.equal(removeClickCountryColorsState(target, ""), false);
  assert.equal(removeClickCountryColorsState(target, "MISSING"), false);
  assert.equal(Object.hasOwn(target, "countryBaseColors"), false);
  assert.equal(setClickCountryColorsState(target, "", "#000000"), false);
});

test("hover lifecycle actions preserve grouped IDs prepared payloads and frame handles", async () => {
  const {
    setHoveredFeatureIdsState,
    setLastMouseMoveTimeState,
    setScenarioHoverRegionIdsState,
    setTooltipPendingState,
    setTooltipRafHandleState,
  } = await loadActions();
  const target = { sentinel: "preserved" };
  const pendingState = { visible: true, text: "prepared" };

  setHoveredFeatureIdsState(target, {
    landId: "land-1",
    waterId: "water-1",
    specialId: "special-1",
  });
  assert.deepEqual(
    [target.hoveredId, target.hoveredWaterRegionId, target.hoveredSpecialRegionId],
    ["land-1", "water-1", "special-1"],
  );
  setScenarioHoverRegionIdsState(target, {
    waterId: "water-2",
    specialId: "special-2",
  });
  assert.deepEqual(
    [target.hoveredId, target.hoveredWaterRegionId, target.hoveredSpecialRegionId],
    ["land-1", "water-2", "special-2"],
  );
  setHoveredFeatureIdsState(target);
  assert.deepEqual(
    [target.hoveredId, target.hoveredWaterRegionId, target.hoveredSpecialRegionId],
    [null, null, null],
  );

  assert.equal(setLastMouseMoveTimeState(target, 17.5), 17.5);
  assert.equal(target.lastMouseMoveTime, 17.5);
  assert.equal(setTooltipPendingState(target, pendingState), pendingState);
  assert.equal(target.tooltipPendingState, pendingState);
  for (const handle of [0, null, undefined]) {
    assert.equal(setTooltipRafHandleState(target, handle), handle);
    assert.equal(target.tooltipRafHandle, handle);
  }
  assert.equal(target.sentinel, "preserved");
});

test("click selected color delegates to the canonical appearance selection action", async () => {
  const source = await readFile(new URL(MODULE_PATH, import.meta.url), "utf8");
  assert.match(source, /import \{ setSelectedColorState \} from "\.\/appearance_selection_actions\.js";/);
  assert.match(source, /return setSelectedColorState\(target, color\);/);
  assert.doesNotMatch(source, /target\.selectedColor\s*=/);
});
