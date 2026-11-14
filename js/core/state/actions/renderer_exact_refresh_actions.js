// Canonical exact-after-settle renderer state mutations.
// Scheduling, timers, rendering, metrics, and identity reads stay in composition roots.

const ACTIVE_EXACT_AFTER_SETTLE_PHASES = new Set([
  "scheduled",
  "applying",
  "awaiting-paint",
  "finalizing",
]);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[renderer_exact_refresh_actions] target must be an object");
  }
}

export function createDefaultExactAfterSettleControllerState() {
  return {
    generation: 0,
    phase: "idle",
    startedAt: 0,
    scheduledAt: 0,
    applyStartedAt: 0,
    applyFinishedAt: 0,
    scenarioId: "",
    selectionVersion: 0,
    topologyRevision: 0,
    dpr: 1,
    pixelWidth: 0,
    pixelHeight: 0,
    colorRevision: 0,
    contextFlagSignature: "",
    zoomToken: 0,
    transformBucket: "",
    pendingPlan: null,
    reason: "init",
  };
}

function hasOwnedExactAfterSettleControllerState(target) {
  const descriptor = Object.getOwnPropertyDescriptor(
    target,
    "exactAfterSettleController",
  );
  const controller = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
  return !!controller
    && typeof controller === "object"
    && !Array.isArray(controller);
}

function installExactAfterSettleControllerState(target, controller) {
  const descriptor = Object.getOwnPropertyDescriptor(
    target,
    "exactAfterSettleController",
  );
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    target.exactAfterSettleController = controller;
    return controller;
  }
  Object.defineProperty(target, "exactAfterSettleController", {
    configurable: true,
    enumerable: true,
    value: controller,
    writable: true,
  });
  return controller;
}

function hasOwnExactAfterSettleControllerField(controller, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(controller, fieldName);
  return !!descriptor && Object.hasOwn(descriptor, "value");
}

function createExactAfterSettleControllerFieldDescriptor(value) {
  return {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  };
}

function cloneExactAfterSettleValue(value) {
  if (!value || typeof value !== "object") return value;
  const clone = Array.isArray(value) ? [] : {};
  Object.entries(value).forEach(([key, entry]) => {
    clone[key] = cloneExactAfterSettleValue(entry);
  });
  return clone;
}

function cloneExactAfterSettlePendingPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("[renderer_exact_refresh_actions] plan must be an object");
  }
  return cloneExactAfterSettleValue(plan);
}

export function ensureExactAfterSettleControllerState(target) {
  assertStateTarget(target);
  if (!hasOwnedExactAfterSettleControllerState(target)) {
    installExactAfterSettleControllerState(
      target,
      createDefaultExactAfterSettleControllerState(),
    );
  }
  const controller = target.exactAfterSettleController;
  if (!hasOwnExactAfterSettleControllerField(controller, "generation")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "generation",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "phase")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "phase",
      createExactAfterSettleControllerFieldDescriptor("idle"),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "startedAt")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "startedAt",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "scheduledAt")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "scheduledAt",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "applyStartedAt")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "applyStartedAt",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "applyFinishedAt")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "applyFinishedAt",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "scenarioId")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "scenarioId",
      createExactAfterSettleControllerFieldDescriptor(""),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "selectionVersion")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "selectionVersion",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "topologyRevision")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "topologyRevision",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "dpr")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "dpr",
      createExactAfterSettleControllerFieldDescriptor(1),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "pixelWidth")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "pixelWidth",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "pixelHeight")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "pixelHeight",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "colorRevision")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "colorRevision",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "contextFlagSignature")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "contextFlagSignature",
      createExactAfterSettleControllerFieldDescriptor(""),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "zoomToken")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "zoomToken",
      createExactAfterSettleControllerFieldDescriptor(0),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "transformBucket")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "transformBucket",
      createExactAfterSettleControllerFieldDescriptor(""),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "pendingPlan")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "pendingPlan",
      createExactAfterSettleControllerFieldDescriptor(null),
    );
  }
  if (!hasOwnExactAfterSettleControllerField(controller, "reason")) {
    Object.defineProperty(
      target.exactAfterSettleController,
      "reason",
      createExactAfterSettleControllerFieldDescriptor("init"),
    );
  }
  return true;
}

export function captureExactAfterSettleControllerState(target) {
  assertStateTarget(target);
  const controller = Object.hasOwn(target, "exactAfterSettleController")
    ? target.exactAfterSettleController
    : null;
  const pendingPlan = controller?.pendingPlan;
  return {
    generation: Number(controller?.generation || 0),
    phase: String(controller?.phase || "idle"),
    startedAt: Number(controller?.startedAt || 0),
    scheduledAt: Number(controller?.scheduledAt || 0),
    applyStartedAt: Number(controller?.applyStartedAt || 0),
    applyFinishedAt: Number(controller?.applyFinishedAt || 0),
    scenarioId: String(controller?.scenarioId || ""),
    selectionVersion: Number(controller?.selectionVersion || 0),
    topologyRevision: Number(controller?.topologyRevision || 0),
    dpr: Number(controller?.dpr || 1),
    pixelWidth: Number(controller?.pixelWidth || 0),
    pixelHeight: Number(controller?.pixelHeight || 0),
    colorRevision: Number(controller?.colorRevision || 0),
    contextFlagSignature: String(controller?.contextFlagSignature || ""),
    zoomToken: Number(controller?.zoomToken || 0),
    transformBucket: String(controller?.transformBucket || ""),
    pendingPlan: pendingPlan && typeof pendingPlan === "object"
      ? cloneExactAfterSettlePendingPlan(pendingPlan)
      : null,
    reason: String(controller?.reason || "init"),
  };
}

export function resetExactAfterSettleControllerState(
  target,
  { reason = "reset", generation = null } = {},
) {
  assertStateTarget(target);
  ensureExactAfterSettleControllerState(target);
  if (
    generation !== null
    && Number(target.exactAfterSettleController.generation || 0) !== Number(generation || 0)
  ) return false;
  const nextGeneration = Number(target.exactAfterSettleController.generation || 0) + 1;
  target.exactAfterSettleController.generation = nextGeneration;
  target.exactAfterSettleController.phase = "idle";
  target.exactAfterSettleController.startedAt = 0;
  target.exactAfterSettleController.scheduledAt = 0;
  target.exactAfterSettleController.applyStartedAt = 0;
  target.exactAfterSettleController.applyFinishedAt = 0;
  target.exactAfterSettleController.scenarioId = "";
  target.exactAfterSettleController.selectionVersion = 0;
  target.exactAfterSettleController.topologyRevision = 0;
  target.exactAfterSettleController.dpr = 1;
  target.exactAfterSettleController.pixelWidth = 0;
  target.exactAfterSettleController.pixelHeight = 0;
  target.exactAfterSettleController.colorRevision = 0;
  target.exactAfterSettleController.contextFlagSignature = "";
  target.exactAfterSettleController.zoomToken = 0;
  target.exactAfterSettleController.transformBucket = "";
  target.exactAfterSettleController.pendingPlan = null;
  target.exactAfterSettleController.reason = String(reason || "reset");
  return true;
}

export function isExactAfterSettleGenerationCurrentState(
  target,
  generation,
  phase = "",
) {
  assertStateTarget(target);
  const controller = hasOwnedExactAfterSettleControllerState(target)
    ? target.exactAfterSettleController
    : null;
  return Boolean(controller)
    && Number(controller.generation || 0) === Number(generation || 0)
    && (!phase || String(controller.phase || "") === phase);
}

export function isExactAfterSettleControllerActiveState(target) {
  assertStateTarget(target);
  const controller = hasOwnedExactAfterSettleControllerState(target)
    ? target.exactAfterSettleController
    : null;
  const phase = String(controller?.phase || "idle");
  return ACTIVE_EXACT_AFTER_SETTLE_PHASES.has(phase);
}

export function refreshExactAfterSettleControllerIdentityState(
  target,
  identity = {},
) {
  assertStateTarget(target);
  ensureExactAfterSettleControllerState(target);
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new TypeError("[renderer_exact_refresh_actions] identity must be an object");
  }
  target.exactAfterSettleController.scenarioId = identity.scenarioId;
  target.exactAfterSettleController.selectionVersion = identity.selectionVersion;
  target.exactAfterSettleController.topologyRevision = identity.topologyRevision;
  target.exactAfterSettleController.dpr = identity.dpr;
  target.exactAfterSettleController.pixelWidth = identity.pixelWidth;
  target.exactAfterSettleController.pixelHeight = identity.pixelHeight;
  target.exactAfterSettleController.colorRevision = identity.colorRevision;
  target.exactAfterSettleController.contextFlagSignature = identity.contextFlagSignature;
  target.exactAfterSettleController.zoomToken = identity.zoomToken;
  target.exactAfterSettleController.transformBucket = identity.transformBucket;
  return true;
}

export function beginExactAfterSettleControllerScheduleState(
  target,
  { scheduleStartedAt, identity } = {},
) {
  assertStateTarget(target);
  ensureExactAfterSettleControllerState(target);
  const nextGeneration = Number(target.exactAfterSettleController.generation || 0) + 1;
  target.exactAfterSettleController.generation = nextGeneration;
  target.exactAfterSettleController.phase = "scheduled";
  target.exactAfterSettleController.startedAt = scheduleStartedAt;
  target.exactAfterSettleController.scheduledAt = scheduleStartedAt;
  target.exactAfterSettleController.applyStartedAt = 0;
  target.exactAfterSettleController.applyFinishedAt = 0;
  target.exactAfterSettleController.pendingPlan = null;
  target.exactAfterSettleController.reason = "scheduled";
  target.exactAfterSettleController.scenarioId = identity?.scenarioId;
  target.exactAfterSettleController.selectionVersion = identity?.selectionVersion;
  target.exactAfterSettleController.topologyRevision = identity?.topologyRevision;
  target.exactAfterSettleController.dpr = identity?.dpr;
  target.exactAfterSettleController.pixelWidth = identity?.pixelWidth;
  target.exactAfterSettleController.pixelHeight = identity?.pixelHeight;
  target.exactAfterSettleController.colorRevision = identity?.colorRevision;
  target.exactAfterSettleController.contextFlagSignature = identity?.contextFlagSignature;
  target.exactAfterSettleController.zoomToken = identity?.zoomToken;
  target.exactAfterSettleController.transformBucket = identity?.transformBucket;
  return nextGeneration;
}

export function beginExactAfterSettleControllerApplyState(
  target,
  {
    generation,
    plan,
    applyStartedAt,
    identity,
  } = {},
) {
  assertStateTarget(target);
  if (
    !hasOwnedExactAfterSettleControllerState(target)
    || Number(target.exactAfterSettleController.generation || 0) !== Number(generation || 0)
    || String(target.exactAfterSettleController.phase || "") !== "scheduled"
  ) return false;
  target.exactAfterSettleController.phase = "applying";
  target.exactAfterSettleController.pendingPlan =
    cloneExactAfterSettlePendingPlan(plan);
  target.exactAfterSettleController.applyStartedAt = applyStartedAt;
  target.exactAfterSettleController.reason = "applying";
  target.exactAfterSettleController.scenarioId = identity?.scenarioId;
  target.exactAfterSettleController.selectionVersion = identity?.selectionVersion;
  target.exactAfterSettleController.topologyRevision = identity?.topologyRevision;
  target.exactAfterSettleController.dpr = identity?.dpr;
  target.exactAfterSettleController.pixelWidth = identity?.pixelWidth;
  target.exactAfterSettleController.pixelHeight = identity?.pixelHeight;
  target.exactAfterSettleController.colorRevision = identity?.colorRevision;
  target.exactAfterSettleController.contextFlagSignature = identity?.contextFlagSignature;
  target.exactAfterSettleController.zoomToken = identity?.zoomToken;
  target.exactAfterSettleController.transformBucket = identity?.transformBucket;
  return true;
}

export function replaceExactAfterSettlePendingPlanState(
  target,
  { generation, plan } = {},
) {
  assertStateTarget(target);
  if (
    !hasOwnedExactAfterSettleControllerState(target)
    || Number(target.exactAfterSettleController.generation || 0) !== Number(generation || 0)
    || String(target.exactAfterSettleController.phase || "") !== "applying"
  ) return false;
  target.exactAfterSettleController.pendingPlan =
    cloneExactAfterSettlePendingPlan(plan);
  return true;
}

export function completeExactAfterSettleControllerApplyState(
  target,
  { generation, applyFinishedAt } = {},
) {
  assertStateTarget(target);
  if (
    !hasOwnedExactAfterSettleControllerState(target)
    || Number(target.exactAfterSettleController.generation || 0) !== Number(generation || 0)
    || String(target.exactAfterSettleController.phase || "") !== "applying"
  ) return false;
  target.exactAfterSettleController.phase = "awaiting-paint";
  target.exactAfterSettleController.applyFinishedAt = applyFinishedAt;
  target.exactAfterSettleController.reason = "awaiting-paint";
  return true;
}

export function beginExactAfterSettleControllerFinalizeState(target, generation) {
  assertStateTarget(target);
  if (
    !hasOwnedExactAfterSettleControllerState(target)
    || Number(target.exactAfterSettleController.generation || 0) !== Number(generation || 0)
    || String(target.exactAfterSettleController.phase || "") !== "awaiting-paint"
  ) return false;
  target.exactAfterSettleController.phase = "finalizing";
  target.exactAfterSettleController.reason = "finalizing";
  return true;
}

export function setDeferExactAfterSettleState(target, deferred) {
  assertStateTarget(target);
  const nextDeferred = Boolean(deferred);
  target.deferExactAfterSettle = nextDeferred;
  return nextDeferred;
}

export function setPendingExactPoliticalFastFrameState(target, pending) {
  assertStateTarget(target);
  const nextPending = Boolean(pending);
  target.pendingExactPoliticalFastFrame = nextPending;
  return nextPending;
}

export function setExactAfterSettleHandleState(target, handle = null) {
  assertStateTarget(target);
  target.exactAfterSettleHandle = handle;
  return handle;
}
