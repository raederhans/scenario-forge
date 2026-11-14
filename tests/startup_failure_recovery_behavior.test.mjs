import { createDeferredPromise } from "./helpers/deferred_promise.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  handleStartupFailure,
} from "../js/bootstrap/startup_failure_recovery.js";
import {
  createPageLifetimeModuleLoader,
  runOptionalStartupTask,
} from "../js/bootstrap/startup_lazy_module_loader.js";

const REQUIRED_HELPER_NAMES = [
  "finalizeReadyState",
  "getBootLanguage",
  "getBootProgressWindow",
  "checkpointBootMetricOnce",
  "finishBootMetric",
  "invalidateAllRenderPasses",
  "rollbackStartupScenarioToBaseMap",
  "runPostScenarioUiReplay",
  "setBootContinueHandler",
  "setBootState",
  "setStartupReadonlyState",
];

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness({
  targetState = {},
  bootLanguage = "en",
  renderDispatcher = null,
  helperOverrides = {},
} = {}) {
  const calls = [];
  const consoleErrors = [];
  const bootStates = [];
  let continueHandler = undefined;
  const dispatcher = renderDispatcher || {
    flush() {
      calls.push("flush");
    },
  };
  const helpers = {
    async finalizeReadyState(receivedDispatcher) {
      calls.push("finalizeReadyState");
      assert.equal(receivedDispatcher, dispatcher);
    },
    getBootLanguage() {
      calls.push("getBootLanguage");
      return bootLanguage;
    },
    getBootProgressWindow(phase) {
      calls.push(`getBootProgressWindow:${phase}`);
      return { min: 27 };
    },
    checkpointBootMetricOnce(metricName) {
      calls.push(`checkpointBootMetricOnce:${metricName}`);
    },
    finishBootMetric(metricName, options) {
      calls.push(`finishBootMetric:${metricName}:${options.failed}`);
    },
    async rollbackStartupScenarioToBaseMap() {
      calls.push("rollbackStartupScenarioToBaseMap");
    },
    invalidateAllRenderPasses(reason) {
      calls.push(`invalidateAllRenderPasses:${reason}`);
    },
    runPostScenarioUiReplay(options) {
      calls.push(`runPostScenarioUiReplay:${options.full}`);
    },
    setBootContinueHandler(handler) {
      calls.push(`setBootContinueHandler:${handler ? "fn" : "null"}`);
      continueHandler = handler;
    },
    setBootState(phase, options = {}) {
      calls.push(`setBootState:${phase}`);
      bootStates.push({ phase, options });
    },
    setStartupReadonlyState(value) {
      calls.push(`setStartupReadonlyState:${value}`);
    },
    ...helperOverrides,
  };

  return {
    bootStates,
    calls,
    consoleApi: {
      error(...args) {
        consoleErrors.push(args);
      },
    },
    consoleErrors,
    getContinueHandler: () => continueHandler,
    helpers,
    renderDispatcher: dispatcher,
    targetState: {
      activeScenarioId: "",
      bootProgress: 0,
      landData: { features: [{ id: "base" }] },
      scenarioApplyInFlight: true,
      ...targetState,
    },
  };
}

function createWriteTrackingTargetState(initialState = {}) {
  const writes = [];
  const state = new Proxy(initialState, {
    set(target, property, value) {
      writes.push({ type: "set", property: String(property), value });
      target[property] = value;
      return true;
    },
    defineProperty(target, property, descriptor) {
      writes.push({ type: "defineProperty", property: String(property), value: descriptor.value });
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      writes.push({ type: "deleteProperty", property: String(property) });
      return Reflect.deleteProperty(target, property);
    },
  });
  return { state, writes };
}

test("handleStartupFailure validates target state and required helpers", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => handleStartupFailure({ targetState: null, helpers: harness.helpers }),
    /requires targetState to be an object/,
  );

  for (const helperName of REQUIRED_HELPER_NAMES) {
    const helpers = { ...harness.helpers };
    delete helpers[helperName];
    await assert.rejects(
      () => handleStartupFailure({ targetState: harness.targetState, helpers }),
      new RegExp(`requires helpers\\.${helperName} to be a function`),
    );
  }
});

test("deferred UI bootstrap rejection is logged and reported", async () => {
  const harness = createHarness();
  const uiBootstrapError = new Error("ui bootstrap failed");
  const result = await handleStartupFailure({
    error: new Error("startup failed"),
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    startupUiBootstrapPromise: Promise.reject(uiBootstrapError),
    startupUiBootstrapAwaited: false,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  assert.equal(result.startupUiBootstrapFailed, false);
  assert.equal(result.deferredUiBootstrapError, null);
  const observation = await result.deferredUiBootstrapObservation;
  assert.deepEqual(observation, { failed: true, error: uiBootstrapError });
  assert.equal(harness.consoleErrors.at(-1)[0], "Deferred UI bootstrap failed during startup:");
  assert.equal(harness.consoleErrors.at(-1)[1], uiBootstrapError);
  assert.equal(harness.targetState.scenarioApplyInFlight, false);
});

test("startup failure recovery publishes the error without waiting for deferred UI", async () => {
  const deferredUiBootstrap = createDeferredPromise();
  const harness = createHarness();

  const result = await handleStartupFailure({
    error: new Error("scenario boot failed"),
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    startupUiBootstrapPromise: deferredUiBootstrap.promise,
    startupUiBootstrapAwaited: false,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  assert.equal(harness.bootStates.at(-1).phase, "error");
  assert.equal(harness.calls.includes("runPostScenarioUiReplay:true"), false);
  assert.ok(result.deferredUiBootstrapObservation);

  deferredUiBootstrap.resolve();
  assert.deepEqual(await result.deferredUiBootstrapObservation, { failed: false, error: null });
  assert.equal(harness.calls.filter((call) => call === "runPostScenarioUiReplay:true").length, 1);
});

test("failure path replays UI, unlocks readonly state, records metrics, and sets error state", async () => {
  const startupError = new Error("startup exploded");
  const harness = createHarness({
    targetState: {
      bootProgress: 42,
      landData: { features: [] },
    },
  });

  const result = await handleStartupFailure({
    error: startupError,
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  assert.equal(result.canContinueWithoutScenario, false);
  assert.equal(harness.getContinueHandler(), null);
  assert.deepEqual(harness.calls, [
    "runPostScenarioUiReplay:true",
    "finishBootMetric:total:true",
    "setStartupReadonlyState:false",
    "setBootContinueHandler:null",
    "setBootState:error",
  ]);
  assert.deepEqual(harness.bootStates[0], {
    phase: "error",
    options: {
      error: "startup exploded",
      canContinueWithoutScenario: false,
      progress: 42,
    },
  });
  assert.equal(harness.consoleErrors[0][0], "Failed to boot application:");
  assert.equal(harness.consoleErrors[0][1], startupError);
  assert.equal(harness.consoleErrors[1][0], "Stack trace:");
});

test("error state falls back to scenario apply progress window", async () => {
  const harness = createHarness({
    targetState: {
      bootProgress: 0,
      landData: { features: [] },
    },
  });

  await handleStartupFailure({
    error: {},
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  assert.deepEqual(harness.bootStates[0], {
    phase: "error",
    options: {
      error: "Failed to load the default startup scenario.",
      canContinueWithoutScenario: false,
      progress: 27,
    },
  });
  assert.ok(harness.calls.includes("getBootProgressWindow:scenario-apply"));
});

test("continue handler preserves rollback, UI bootstrap wait, render, metric, and ready order", async () => {
  const deferredUiBootstrap = createDeferredPromise();
  const harness = createHarness({
    bootLanguage: "zh",
    targetState: {
      activeScenarioId: "tno_1962",
    },
  });
  const startupUiBootstrapPromise = deferredUiBootstrap.promise.then(() => {
    harness.calls.push("startupUiBootstrapPromise");
  });
  await handleStartupFailure({
    error: new Error("startup failed"),
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    startupUiBootstrapPromise,
    startupUiBootstrapAwaited: true,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });
  assert.ok(
    harness.calls.indexOf("setBootContinueHandler:fn") < harness.calls.indexOf("setBootState:error"),
    "continue handler must be registered before the error boot state",
  );
  harness.calls.length = 0;

  const continuePromise = harness.getContinueHandler()();
  await drainMicrotasks();
  assert.deepEqual(harness.calls, ["rollbackStartupScenarioToBaseMap"]);

  deferredUiBootstrap.resolve();
  await continuePromise;

  assert.deepEqual(harness.calls, [
    "rollbackStartupScenarioToBaseMap",
    "startupUiBootstrapPromise",
    "getBootLanguage",
    "setBootState:warmup",
    "invalidateAllRenderPasses:bootstrap-first-frame",
    "flush",
    "checkpointBootMetricOnce:first-visible",
    "checkpointBootMetricOnce:first-visible-base",
    "finalizeReadyState",
  ]);
  assert.deepEqual(harness.bootStates.at(-1), {
    phase: "warmup",
    options: {
      message: "正在以基础地图模式继续。",
      canContinueWithoutScenario: false,
    },
  });
});

test("handleStartupFailure only writes scenarioApplyInFlight on target state", async () => {
  const { state, writes } = createWriteTrackingTargetState({
    activeScenarioId: "",
    bootProgress: 0,
    landData: { features: [{ id: "base" }] },
    scenarioApplyInFlight: true,
  });
  const harness = createHarness({
    targetState: state,
  });

  await handleStartupFailure({
    error: new Error("startup failed"),
    targetState: state,
    renderDispatcher: harness.renderDispatcher,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  assert.deepEqual(writes, [
    { type: "set", property: "scenarioApplyInFlight", value: false },
  ]);
});

test("continue handler skips rejected deferred UI bootstrap promise after async recovery records it", async () => {
  const uiError = new Error("ui failed");
  const harness = createHarness({
    targetState: {
      activeScenarioId: "tno_1962",
    },
  });

  const result = await handleStartupFailure({
    error: new Error("startup failed"),
    targetState: harness.targetState,
    renderDispatcher: harness.renderDispatcher,
    startupUiBootstrapPromise: Promise.reject(uiError),
    startupUiBootstrapAwaited: false,
    helpers: harness.helpers,
    consoleApi: harness.consoleApi,
  });

  const observation = await result.deferredUiBootstrapObservation;
  assert.deepEqual(observation, { failed: true, error: uiError });
  harness.calls.length = 0;
  await harness.getContinueHandler()();

  assert.deepEqual(harness.calls, [
    "rollbackStartupScenarioToBaseMap",
    "getBootLanguage",
    "setBootState:warmup",
    "invalidateAllRenderPasses:bootstrap-first-frame",
    "flush",
    "checkpointBootMetricOnce:first-visible",
    "checkpointBootMetricOnce:first-visible-base",
    "finalizeReadyState",
  ]);
});

test("base-map continuation requires land features and a render flush function", async () => {
  for (const [targetState, renderDispatcher] of [
    [{ landData: { features: [] } }, { flush() {} }],
    [{ landData: { features: [{ id: "base" }] } }, {}],
  ]) {
    const harness = createHarness({ targetState, renderDispatcher });
    const result = await handleStartupFailure({
      error: new Error("startup failed"),
      targetState: harness.targetState,
      renderDispatcher: harness.renderDispatcher,
      helpers: harness.helpers,
      consoleApi: harness.consoleApi,
    });

    assert.equal(result.canContinueWithoutScenario, false);
    assert.equal(harness.getContinueHandler(), null);
    assert.ok(harness.calls.includes("setBootContinueHandler:null"));
  }
});

test("page-lifetime startup module loading is single-flight for concurrent callers", async () => {
  let importCount = 0;
  let factoryCount = 0;
  let resolveModule;
  const modulePromise = new Promise((resolve) => { resolveModule = resolve; });
  const loader = createPageLifetimeModuleLoader({
    importModule: () => {
      importCount += 1;
      return modulePromise;
    },
    createValue: (module) => {
      factoryCount += 1;
      return { module };
    },
  });

  const first = loader.loadValueOnce();
  const second = loader.loadValueOnce();
  resolveModule({ id: "startup-module" });

  const [firstValue, secondValue] = await Promise.all([first, second]);
  assert.equal(importCount, 1);
  assert.equal(factoryCount, 1);
  assert.strictEqual(firstValue, secondValue);
});

test("startup module preload observes one sticky rejection without an unhandled event", async () => {
  const sentinel = new Error("startup module unavailable");
  let importCount = 0;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const loader = createPageLifetimeModuleLoader({
      importModule: async () => {
        importCount += 1;
        throw sentinel;
      },
    });
    loader.preload();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(loader.loadModuleOnce(), (error) => error === sentinel);
    await assert.rejects(loader.loadModuleOnce(), (error) => error === sentinel);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(importCount, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("optional startup work converts an asynchronous rejection into one diagnostic and false", async () => {
  const sentinel = new Error("sample scheduling failed");
  const diagnostics = [];
  const result = await runOptionalStartupTask({
    loadModule: async () => ({ schedule: async () => { throw sentinel; } }),
    run: (module) => module.schedule(),
    onError: (error) => diagnostics.push(error),
  });

  assert.equal(result, false);
  assert.deepEqual(diagnostics, [sentinel]);
});
