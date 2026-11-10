import assert from "node:assert/strict";
import test from "node:test";

const MODULE_PATH = "../js/core/state/actions/renderer_exact_refresh_actions.js";

async function loadActions() {
  try {
    return await import(MODULE_PATH);
  } catch (error) {
    assert.fail(`renderer exact refresh actions must exist: ${error?.message || error}`);
  }
}

function createIdentity(overrides = {}) {
  return Object.freeze({
    scenarioId: "tno",
    selectionVersion: 7,
    topologyRevision: 11,
    dpr: 1.25,
    pixelWidth: 1600,
    pixelHeight: 900,
    colorRevision: 13,
    contextFlagSignature: "context:visible",
    zoomToken: 17,
    transformBucket: "125:2:-1",
    ...overrides,
  });
}

test("controller capture returns a detached normalized snapshot", async () => {
  const {
    beginExactAfterSettleControllerApplyState,
    beginExactAfterSettleControllerScheduleState,
    captureExactAfterSettleControllerState,
  } = await loadActions();
  const target = {};
  const identity = createIdentity();
  const plan = {
    exactTargetPasses: ["political"],
    resolvedProfile: { settleDurationMs: 40 },
    reuseDecision: {
      referenceTransform: { x: 1, y: 2, k: 3 },
      currentTransform: { x: 4, y: 5, k: 6 },
    },
    futurePlannerMetadata: {
      groups: [{ passNames: ["political", "borders"] }],
    },
  };
  const generation = beginExactAfterSettleControllerScheduleState(target, {
    scheduleStartedAt: 10,
    identity,
  });
  beginExactAfterSettleControllerApplyState(target, {
    generation,
    plan,
    applyStartedAt: 20,
    identity,
  });

  const snapshot = captureExactAfterSettleControllerState(target);
  assert.notEqual(snapshot, target.exactAfterSettleController);
  assert.notEqual(snapshot.pendingPlan, target.exactAfterSettleController.pendingPlan);
  assert.notEqual(
    snapshot.pendingPlan.reuseDecision.referenceTransform,
    target.exactAfterSettleController.pendingPlan.reuseDecision.referenceTransform,
  );
  assert.notEqual(
    snapshot.pendingPlan.futurePlannerMetadata.groups[0],
    target.exactAfterSettleController.pendingPlan.futurePlannerMetadata.groups[0],
  );
  snapshot.phase = "caller-mutated";
  snapshot.pendingPlan.reuseDecision.reason = "caller-mutated";
  snapshot.pendingPlan.futurePlannerMetadata.groups[0].passNames.push("labels");
  assert.equal(target.exactAfterSettleController.phase, "applying");
  assert.notEqual(
    target.exactAfterSettleController.pendingPlan.reuseDecision.reason,
    "caller-mutated",
  );
  assert.deepEqual(
    target.exactAfterSettleController.pendingPlan.futurePlannerMetadata.groups[0].passNames,
    ["political", "borders"],
  );
});

test("renderer exact refresh actions reject invalid targets", async () => {
  const actions = await loadActions();
  for (const target of [null, undefined, [], "state"]) {
    assert.throws(
      () => actions.ensureExactAfterSettleControllerState(target),
      /target must be an object/,
    );
    assert.throws(
      () => actions.setDeferExactAfterSettleState(target, true),
      /target must be an object/,
    );
    assert.throws(
      () => actions.setPendingExactPoliticalFastFrameState(target, true),
      /target must be an object/,
    );
    assert.throws(
      () => actions.setExactAfterSettleHandleState(target, null),
      /target must be an object/,
    );
  }
});

test("ensure and reset preserve controller object identity and exact reset semantics", async () => {
  const {
    ensureExactAfterSettleControllerState,
    resetExactAfterSettleControllerState,
  } = await loadActions();
  const controller = { generation: 4, phase: "applying", customField: "drop" };
  const target = { exactAfterSettleController: controller };

  assert.equal(ensureExactAfterSettleControllerState(target), true);
  assert.equal(controller.phase, "applying");
  assert.equal(controller.pendingPlan, null);
  assert.equal(resetExactAfterSettleControllerState(target, {
    reason: "cancel",
    generation: 3,
  }), false);
  assert.equal(controller.phase, "applying");

  assert.equal(resetExactAfterSettleControllerState(target, {
    reason: "cancel",
    generation: 4,
  }), true);
  assert.equal(target.exactAfterSettleController, controller);
  assert.deepEqual(controller, {
    generation: 5,
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
    reason: "cancel",
    customField: "drop",
  });
});

test("exact refresh actions detach prototype-owned controller state", async () => {
  const {
    beginExactAfterSettleControllerApplyState,
    beginExactAfterSettleControllerScheduleState,
    ensureExactAfterSettleControllerState,
    isExactAfterSettleControllerActiveState,
    resetExactAfterSettleControllerState,
  } = await loadActions();
  const sharedController = {
    generation: 7,
    phase: "scheduled",
    pendingPlan: { owner: "prototype" },
  };
  const prototypeState = { exactAfterSettleController: sharedController };
  const first = Object.create(prototypeState);
  const second = Object.create(prototypeState);

  assert.equal(ensureExactAfterSettleControllerState(first), true);
  assert.equal(Object.hasOwn(first, "exactAfterSettleController"), true);
  assert.notEqual(first.exactAfterSettleController, sharedController);
  assert.equal(first.exactAfterSettleController.generation, 0);
  assert.equal(first.exactAfterSettleController.phase, "idle");

  assert.equal(resetExactAfterSettleControllerState(second, { reason: "second-reset" }), true);
  assert.equal(Object.hasOwn(second, "exactAfterSettleController"), true);
  assert.notEqual(second.exactAfterSettleController, sharedController);
  assert.equal(second.exactAfterSettleController.generation, 1);
  assert.equal(sharedController.generation, 7);
  assert.equal(sharedController.phase, "scheduled");

  const inheritedFields = Object.create(sharedController);
  const third = { exactAfterSettleController: inheritedFields };
  assert.equal(ensureExactAfterSettleControllerState(third), true);
  assert.equal(Object.hasOwn(inheritedFields, "generation"), true);
  assert.equal(Object.hasOwn(inheritedFields, "phase"), true);
  assert.equal(inheritedFields.generation, 0);
  assert.equal(inheritedFields.phase, "idle");

  const fourth = Object.create(prototypeState);
  assert.equal(isExactAfterSettleControllerActiveState(fourth), false);
  assert.equal(beginExactAfterSettleControllerApplyState(fourth, {
    generation: 7,
    plan: { owner: "fourth" },
    applyStartedAt: 1,
    identity: {},
  }), false);
  assert.equal(Object.hasOwn(fourth, "exactAfterSettleController"), false);

  const nextGeneration = beginExactAfterSettleControllerScheduleState(fourth, {
    scheduleStartedAt: 5,
    identity: {},
  });
  assert.equal(nextGeneration, 1);
  assert.equal(Object.hasOwn(fourth, "exactAfterSettleController"), true);
  assert.notEqual(fourth.exactAfterSettleController, sharedController);
  assert.equal(sharedController.generation, 7);
  assert.equal(sharedController.phase, "scheduled");
});

test("exact refresh initialization bypasses an inherited controller setter", async () => {
  const { ensureExactAfterSettleControllerState } = await loadActions();
  let setterCalls = 0;
  const prototypeState = {};
  Object.defineProperty(prototypeState, "exactAfterSettleController", {
    configurable: true,
    get: () => ({ generation: 9, phase: "scheduled" }),
    set: () => { setterCalls += 1; },
  });
  const target = Object.create(prototypeState);

  assert.equal(ensureExactAfterSettleControllerState(target), true);
  assert.equal(setterCalls, 0);
  assert.equal(Object.hasOwn(target, "exactAfterSettleController"), true);
  assert.equal(target.exactAfterSettleController.generation, 0);
  assert.equal(target.exactAfterSettleController.phase, "idle");
});

test("exact refresh initialization bypasses inherited controller field setters", async () => {
  const { ensureExactAfterSettleControllerState } = await loadActions();
  const setterCalls = { generation: 0, pendingPlan: 0, phase: 0 };
  const controllerPrototype = {};
  Object.defineProperties(controllerPrototype, {
    generation: {
      configurable: true,
      get: () => 9,
      set: () => { setterCalls.generation += 1; },
    },
    pendingPlan: {
      configurable: true,
      get: () => ({ owner: "prototype" }),
      set: () => { setterCalls.pendingPlan += 1; },
    },
    phase: {
      configurable: true,
      get: () => "scheduled",
      set: () => { setterCalls.phase += 1; },
    },
  });
  const controller = Object.create(controllerPrototype);
  const target = { exactAfterSettleController: controller };

  assert.equal(ensureExactAfterSettleControllerState(target), true);
  assert.deepEqual(setterCalls, { generation: 0, pendingPlan: 0, phase: 0 });
  assert.equal(Object.hasOwn(controller, "generation"), true);
  assert.equal(Object.hasOwn(controller, "pendingPlan"), true);
  assert.equal(Object.hasOwn(controller, "phase"), true);
  assert.equal(controller.generation, 0);
  assert.equal(controller.pendingPlan, null);
  assert.equal(controller.phase, "idle");
});

test("exact refresh initialization replaces own accessors with isolated data state", async () => {
  const { ensureExactAfterSettleControllerState } = await loadActions();
  const sharedController = { generation: 5, phase: "scheduled", pendingPlan: null };
  function createAccessorTarget() {
    const target = {};
    Object.defineProperty(target, "exactAfterSettleController", {
      configurable: true,
      enumerable: true,
      get: () => sharedController,
    });
    return target;
  }
  const first = createAccessorTarget();
  const second = createAccessorTarget();

  assert.equal(ensureExactAfterSettleControllerState(first), true);
  assert.equal(ensureExactAfterSettleControllerState(second), true);
  const firstDescriptor = Object.getOwnPropertyDescriptor(
    first,
    "exactAfterSettleController",
  );
  const secondDescriptor = Object.getOwnPropertyDescriptor(
    second,
    "exactAfterSettleController",
  );
  assert.equal(Object.hasOwn(firstDescriptor, "value"), true);
  assert.equal(Object.hasOwn(secondDescriptor, "value"), true);
  assert.notEqual(first.exactAfterSettleController, sharedController);
  assert.notEqual(second.exactAfterSettleController, sharedController);
  assert.notEqual(first.exactAfterSettleController, second.exactAfterSettleController);
});

test("exact refresh initialization preserves a writable own controller descriptor", async () => {
  const { ensureExactAfterSettleControllerState } = await loadActions();
  const target = {};
  Object.defineProperty(target, "exactAfterSettleController", {
    configurable: false,
    enumerable: false,
    value: null,
    writable: true,
  });

  assert.equal(ensureExactAfterSettleControllerState(target), true);
  assert.equal(typeof target.exactAfterSettleController, "object");
  const descriptor = Object.getOwnPropertyDescriptor(
    target,
    "exactAfterSettleController",
  );
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
});

test("scheduled state resets stale fields, advances generation, and copies frozen identity values", async () => {
  const { beginExactAfterSettleControllerScheduleState } = await loadActions();
  const controller = {
    generation: 8,
    pendingPlan: { stale: true },
    applyFinishedAt: 99,
    customField: "drop",
  };
  const target = { exactAfterSettleController: controller };
  const identity = createIdentity();

  assert.equal(
    beginExactAfterSettleControllerScheduleState(target, {
      scheduleStartedAt: 41.5,
      identity,
    }),
    9,
  );
  assert.equal(target.exactAfterSettleController, controller);
  assert.equal(controller.generation, 9);
  assert.equal(controller.phase, "scheduled");
  assert.equal(controller.startedAt, 41.5);
  assert.equal(controller.scheduledAt, 41.5);
  assert.equal(controller.applyStartedAt, 0);
  assert.equal(controller.pendingPlan, null);
  assert.equal(controller.reason, "scheduled");
  assert.equal(controller.scenarioId, identity.scenarioId);
  assert.equal(controller.selectionVersion, identity.selectionVersion);
  assert.equal(controller.dpr, identity.dpr);
  assert.equal(controller.transformBucket, identity.transformBucket);
  assert.equal(Object.hasOwn(controller, "customField"), true);
  assert.equal(identity.scenarioId, "tno");
});

test("applying, plan replacement, awaiting-paint, and finalizing isolate pending plan state", async () => {
  const {
    beginExactAfterSettleControllerApplyState,
    beginExactAfterSettleControllerFinalizeState,
    beginExactAfterSettleControllerScheduleState,
    completeExactAfterSettleControllerApplyState,
    replaceExactAfterSettlePendingPlanState,
  } = await loadActions();
  const target = {};
  const identity = createIdentity();
  const referenceTransform = { x: 10, y: 20, k: 2 };
  const currentTransform = { x: 12, y: 23, k: 2.5 };
  const plan = Object.freeze({
    id: "exact-plan",
    exactTargetPasses: Object.freeze(["political"]),
    deferredExactTargetPasses: Object.freeze(["contextBase"]),
    reuseDecision: Object.freeze({
      enabled: true,
      referenceTransform,
      currentTransform,
    }),
  });
  const generation = beginExactAfterSettleControllerScheduleState(target, {
    scheduleStartedAt: 10,
    identity,
  });
  const controller = target.exactAfterSettleController;

  assert.equal(beginExactAfterSettleControllerApplyState(target, {
    generation: generation + 1,
    plan,
    applyStartedAt: 20,
    identity,
  }), false);
  assert.equal(controller.phase, "scheduled");

  assert.equal(beginExactAfterSettleControllerApplyState(target, {
    generation,
    plan,
    applyStartedAt: 20,
    identity,
  }), true);
  assert.equal(controller.phase, "applying");
  assert.notEqual(controller.pendingPlan, plan);
  assert.deepEqual(controller.pendingPlan, plan);
  assert.notEqual(controller.pendingPlan.exactTargetPasses, plan.exactTargetPasses);
  assert.notEqual(controller.pendingPlan.reuseDecision, plan.reuseDecision);
  assert.notEqual(
    controller.pendingPlan.reuseDecision.referenceTransform,
    referenceTransform,
  );
  assert.notEqual(
    controller.pendingPlan.reuseDecision.currentTransform,
    currentTransform,
  );
  referenceTransform.x = 99;
  currentTransform.k = 9;
  assert.equal(controller.pendingPlan.reuseDecision.referenceTransform.x, 10);
  assert.equal(controller.pendingPlan.reuseDecision.currentTransform.k, 2.5);
  assert.equal(controller.applyStartedAt, 20);
  assert.equal(controller.reason, "applying");

  const appliedPlan = {
    ...plan,
    controllerGeneration: generation,
    exactTargetPasses: ["political", "borders"],
  };
  assert.equal(replaceExactAfterSettlePendingPlanState(target, {
    generation: generation + 1,
    plan: appliedPlan,
  }), false);
  assert.equal(replaceExactAfterSettlePendingPlanState(target, {
    generation,
    plan: appliedPlan,
  }), true);
  assert.notEqual(controller.pendingPlan, appliedPlan);
  assert.deepEqual(controller.pendingPlan, appliedPlan);
  appliedPlan.exactTargetPasses.push("labels");
  assert.deepEqual(
    controller.pendingPlan.exactTargetPasses,
    ["political", "borders"],
  );

  assert.equal(completeExactAfterSettleControllerApplyState(target, {
    generation,
    applyFinishedAt: 30,
  }), true);
  assert.equal(controller.phase, "awaiting-paint");
  assert.notEqual(controller.pendingPlan, appliedPlan);
  assert.deepEqual(controller.pendingPlan.exactTargetPasses, ["political", "borders"]);
  assert.equal(controller.applyFinishedAt, 30);
  assert.equal(controller.reason, "awaiting-paint");

  assert.equal(beginExactAfterSettleControllerFinalizeState(target, generation), true);
  assert.equal(controller.phase, "finalizing");
  assert.deepEqual(controller.pendingPlan.exactTargetPasses, ["political", "borders"]);
  assert.equal(controller.reason, "finalizing");
  assert.equal(beginExactAfterSettleControllerFinalizeState(target, generation), false);
});

test("identity refresh copies exact values without retaining or mutating the frozen source", async () => {
  const {
    ensureExactAfterSettleControllerState,
    refreshExactAfterSettleControllerIdentityState,
  } = await loadActions();
  const target = {};
  const identity = createIdentity({ dpr: 0.75, pixelWidth: 0 });
  assert.equal(ensureExactAfterSettleControllerState(target), true);
  const controller = target.exactAfterSettleController;

  assert.equal(refreshExactAfterSettleControllerIdentityState(target, identity), true);
  for (const [key, value] of Object.entries(identity)) {
    assert.equal(controller[key], value);
  }
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.hasOwn(controller, "identity"), false);
});

test("active and generation reads match scheduled through finalizing controller semantics", async () => {
  const {
    isExactAfterSettleControllerActiveState,
    isExactAfterSettleGenerationCurrentState,
  } = await loadActions();
  const target = { exactAfterSettleController: { generation: 3, phase: "idle" } };

  assert.equal(isExactAfterSettleControllerActiveState(target), false);
  for (const phase of ["scheduled", "applying", "awaiting-paint", "finalizing"]) {
    target.exactAfterSettleController.phase = phase;
    assert.equal(isExactAfterSettleControllerActiveState(target), true);
    assert.equal(isExactAfterSettleGenerationCurrentState(target, 3, phase), true);
  }
  assert.equal(isExactAfterSettleGenerationCurrentState(target, 4, "finalizing"), false);
  assert.equal(isExactAfterSettleGenerationCurrentState(target, 3, "scheduled"), false);
});

test("flags normalize to booleans and handle state preserves exact references including null", async () => {
  const {
    setDeferExactAfterSettleState,
    setExactAfterSettleHandleState,
    setPendingExactPoliticalFastFrameState,
  } = await loadActions();
  const target = {
    deferExactAfterSettle: false,
    pendingExactPoliticalFastFrame: true,
  };
  const handle = Object.freeze({ type: "timeout", id: { timer: 1 } });

  assert.equal(setDeferExactAfterSettleState(target, "queued"), true);
  assert.equal(target.deferExactAfterSettle, true);
  assert.equal(target.pendingExactPoliticalFastFrame, true);
  assert.equal(setPendingExactPoliticalFastFrameState(target, 0), false);
  assert.equal(target.pendingExactPoliticalFastFrame, false);
  assert.equal(target.deferExactAfterSettle, true);

  assert.equal(setExactAfterSettleHandleState(target, handle), handle);
  assert.equal(target.exactAfterSettleHandle, handle);
  assert.equal(setExactAfterSettleHandleState(target, null), null);
  assert.equal(target.exactAfterSettleHandle, null);
  assert.equal(Object.isFrozen(handle), true);
});
