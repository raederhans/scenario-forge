// Canonical renderer interaction-state mutations.
// Event handling, render scheduling, metrics, and async recovery work stay in composition roots.

import { setSelectedColorState } from "./appearance_selection_actions.js";
import { setScenarioHoverRegionIdsState } from "./scenario_presentation_actions.js";

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[renderer_interaction_actions] target must be an object");
  }
}

function normalizeRecoveryTaskKey(taskKey) {
  return String(taskKey || "interaction-recovery").trim() || "interaction-recovery";
}

export function setZoomGestureStartTransformState(target, transform = null) {
  assertStateTarget(target);
  target.zoomGestureStartTransform = transform;
  return transform;
}

export function setZoomGestureScaleDeltaState(target, scaleDelta) {
  assertStateTarget(target);
  target.zoomGestureScaleDelta = scaleDelta;
  return scaleDelta;
}

export function setPendingZoomTransformState(target, transform = null) {
  assertStateTarget(target);
  target.pendingZoomTransform = transform;
  return transform;
}

export function setZoomRenderScheduledState(target, scheduled) {
  assertStateTarget(target);
  const nextScheduled = Boolean(scheduled);
  target.zoomRenderScheduled = nextScheduled;
  return nextScheduled;
}

export function setZoomGestureEndedAtState(target, endedAt) {
  assertStateTarget(target);
  target.zoomGestureEndedAt = endedAt;
  return endedAt;
}

export function beginInteractionRecoveryTaskState(
  target,
  {
    taskKey = "interaction-recovery",
    startedAt = 0,
    expectedActiveTaskKey = "",
  } = {},
) {
  assertStateTarget(target);
  const activeTaskKey = String(
    target.activeInteractionRecoveryTaskKey || "",
  );
  if (activeTaskKey !== String(expectedActiveTaskKey || "")) {
    return false;
  }
  target.activeInteractionRecoveryTaskKey = normalizeRecoveryTaskKey(taskKey);
  target.activeInteractionRecoveryTaskStartedAt = startedAt;
  return true;
}

export function endInteractionRecoveryTaskState(target, expectedTaskKey) {
  assertStateTarget(target);
  if (
    target.activeInteractionRecoveryTaskKey
    !== normalizeRecoveryTaskKey(expectedTaskKey)
  ) {
    return false;
  }
  target.activeInteractionRecoveryTaskKey = "";
  target.activeInteractionRecoveryTaskStartedAt = 0;
  return true;
}

export function setInteractionInfrastructureStateFields(
  target,
  stage,
  {
    ready = null,
    inFlight = null,
  } = {},
) {
  assertStateTarget(target);
  const normalizedStage = String(stage || "idle").trim() || "idle";
  target.interactionInfrastructureStage = normalizedStage;
  if (ready != null) {
    target.interactionInfrastructureReady = Boolean(ready);
  }
  if (inFlight != null) {
    target.interactionInfrastructureBuildInFlight = Boolean(inFlight);
  }
  return normalizedStage;
}

export function clearClickHoveredIdState(target) {
  assertStateTarget(target);
  target.hoveredId = null;
}

export function setClickHoverOverlayDirtyState(target, dirty) {
  assertStateTarget(target);
  const nextDirty = Boolean(dirty);
  target.hoverOverlayDirty = nextDirty;
  return nextDirty;
}

export function setZoomTransformState(target, transform) {
  assertStateTarget(target);
  target.zoomTransform = transform;
  return transform;
}

export function setHitCanvasDirtyState(target, dirty) {
  assertStateTarget(target);
  const nextDirty = Boolean(dirty);
  target.hitCanvasDirty = nextDirty;
  return nextDirty;
}

export function setHitCanvasBuildScheduledState(target, handle) {
  assertStateTarget(target);
  target.hitCanvasBuildScheduled = handle;
  return handle;
}

export function setHoveredFeatureIdsState(
  target,
  {
    landId = null,
    waterId = null,
    specialId = null,
  } = {},
) {
  assertStateTarget(target);
  target.hoveredId = landId;
  setScenarioHoverRegionIdsState(target, { waterId, specialId });
}

export function setLastMouseMoveTimeState(target, lastMouseMoveTime) {
  assertStateTarget(target);
  target.lastMouseMoveTime = lastMouseMoveTime;
  return lastMouseMoveTime;
}

export function setTooltipPendingState(target, pendingState) {
  assertStateTarget(target);
  target.tooltipPendingState = pendingState;
  return pendingState;
}

export function setTooltipRafHandleState(target, handle) {
  assertStateTarget(target);
  target.tooltipRafHandle = handle;
  return handle;
}

export function setClickSelectedColorState(target, color) {
  assertStateTarget(target);
  return setSelectedColorState(target, color);
}

export function removeClickWaterRegionOverrideState(target, regionId) {
  assertStateTarget(target);
  const normalizedId = String(regionId || "").trim();
  if (!normalizedId || !target.waterRegionOverrides || typeof target.waterRegionOverrides !== "object") return false;
  const nextOverrides = structuredClone(target.waterRegionOverrides);
  const removed = Object.hasOwn(nextOverrides, normalizedId);
  delete nextOverrides[normalizedId];
  target.waterRegionOverrides = nextOverrides;
  return removed;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "waterRegionOverrides")) target.waterRegionOverrides = patch.waterRegionOverrides;
}
