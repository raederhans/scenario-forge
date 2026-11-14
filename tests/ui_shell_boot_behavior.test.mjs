import { createDeferredPromise } from "./helpers/deferred_promise.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  isUiShellDebugMode,
  runUiShellDebugBoot,
} from "../js/bootstrap/ui_shell_boot.js";

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDocumentRef(calls) {
  const classNames = [];
  return {
    classNames,
    body: {
      classList: {
        add(className) {
          calls.push(`bodyClass:${className}`);
          classNames.push(className);
        },
      },
    },
  };
}

function createHarness({
  bootLanguage = "en",
  bootstrapPromise = Promise.resolve(),
  targetState = {},
} = {}) {
  const calls = [];
  const stateTarget = new Proxy(targetState, {
    set(target, property, value) {
      calls.push(`state:${String(property)}:${String(value)}`);
      return Reflect.set(target, property, value);
    },
  });
  const bootStates = [];
  const initMapCalls = [];
  const setMapDataCalls = [];
  const bindingCalls = [];
  const localizationCalls = [];
  const globalScope = {};
  const renderDispatcher = {
    flush() {
      calls.push("renderDispatcher.flush");
    },
  };
  const renderApp = () => {
    calls.push("renderApp");
  };
  const documentRef = createDocumentRef(calls);
  const territoryPreview = { preview: "ui-shell-territory" };
  const helpers = {
    applyUiShellDebugTerritorySeed() {
      calls.push("applyUiShellDebugTerritorySeed");
      return territoryPreview;
    },
    bootstrapDeferredUi(receivedRenderApp) {
      calls.push("bootstrapDeferredUi");
      assert.equal(receivedRenderApp, renderApp);
      return bootstrapPromise;
    },
    checkpointBootMetricOnce(metricName) {
      calls.push(`checkpointBootMetricOnce:${metricName}`);
    },
    completeBootSequenceLogging() {
      calls.push("completeBootSequenceLogging");
    },
    createStartupRenderRuntimeBinding(options) {
      calls.push("createStartupRenderRuntimeBinding");
      bindingCalls.push(options);
      return { renderDispatcher, renderApp };
    },
    ensureDetailTopologyReady() {
      calls.push("ensureDetailTopologyReady");
    },
    async ensureFullLocalizationDataReady(options) {
      calls.push("ensureFullLocalizationDataReady");
      localizationCalls.push(options);
    },
    finishBootMetric(metricName, options = {}) {
      calls.push(`finishBootMetric:${metricName}:${options.mode}`);
    },
    getBootLanguage() {
      calls.push("getBootLanguage");
      return bootLanguage;
    },
    initLongAnimationFrameObserver() {
      calls.push("initLongAnimationFrameObserver");
    },
    initMap(options) {
      calls.push("initMap");
      initMapCalls.push(options);
    },
    revealUiShellDebugTerritoryPanels() {
      calls.push("revealUiShellDebugTerritoryPanels");
    },
    runPostScenarioUiReplay(options) {
      calls.push(`runPostScenarioUiReplay:${options.full}`);
    },
    setBootPreviewVisible(value) {
      calls.push(`setBootPreviewVisible:${value}`);
    },
    setBootState(phase, options = {}) {
      calls.push(`setBootState:${phase}`);
      bootStates.push({ phase, options });
    },
    setMapData(options) {
      calls.push("setMapData");
      setMapDataCalls.push(options);
    },
    startBootMetric(metricName) {
      calls.push(`startBootMetric:${metricName}`);
    },
  };

  return {
    bindingCalls,
    bootStates,
    calls,
    documentRef,
    globalScope,
    helpers,
    initMapCalls,
    localizationCalls,
    renderApp,
    renderDispatcher,
    setMapDataCalls,
    targetState: stateTarget,
    territoryPreview,
  };
}

test("isUiShellDebugMode preserves query semantics", () => {
  const trueQueries = [
    "?ui_shell=1",
    "?ui_shell=true",
    "?startup_mode=ui-shell",
    "?ui_shell=%20TRUE%20",
  ];

  for (const search of trueQueries) {
    assert.equal(isUiShellDebugMode({
      globalScope: { URLSearchParams, location: { search } },
    }), true, search);
  }

  assert.equal(isUiShellDebugMode({
    globalScope: { URLSearchParams, location: { search: "" } },
  }), false);
  assert.equal(isUiShellDebugMode({
    globalScope: { location: { search: "?ui_shell=1" } },
  }), false);
});

test("runUiShellDebugBoot starts UI shell and exposes failure recovery state before awaiting UI bootstrap", async () => {
  const deferredUiBootstrap = createDeferredPromise();
  const harness = createHarness({ bootstrapPromise: deferredUiBootstrap.promise });
  const hookCalls = [];
  const resultPromise = runUiShellDebugBoot({
    targetState: harness.targetState,
    documentRef: harness.documentRef,
    globalScope: harness.globalScope,
    helpers: harness.helpers,
    hooks: {
      onRenderDispatcher(renderDispatcher) {
        hookCalls.push(["renderDispatcher", renderDispatcher]);
        harness.calls.push("hook:onRenderDispatcher");
      },
      onStartupUiBootstrapPromise(promise) {
        hookCalls.push(["startupUiBootstrapPromise", promise]);
        harness.calls.push("hook:onStartupUiBootstrapPromise");
      },
    },
  });

  await drainMicrotasks();

  assert.equal(harness.targetState.uiShellDebug, true);
  assert.deepEqual(harness.documentRef.classNames, ["app-ui-shell-debug"]);
  assert.ok(
    harness.calls.indexOf("state:uiShellDebug:true")
      < harness.calls.indexOf("bodyClass:app-ui-shell-debug"),
  );
  assert.deepEqual(hookCalls, [
    ["renderDispatcher", harness.renderDispatcher],
    ["startupUiBootstrapPromise", deferredUiBootstrap.promise],
  ]);
  assert.equal(harness.globalScope.__mapcreatorUiShellDebug, undefined);
  assert.ok(
    harness.calls.indexOf("hook:onStartupUiBootstrapPromise")
      < harness.calls.indexOf("bootstrapDeferredUi") + 2,
  );

  deferredUiBootstrap.resolve();
  const result = await resultPromise;

  assert.equal(result.handled, true);
  assert.equal(result.renderDispatcher, harness.renderDispatcher);
  assert.equal(result.renderApp, harness.renderApp);
  assert.equal(result.startupUiBootstrapPromise, deferredUiBootstrap.promise);
  assert.equal(result.territoryPreview, harness.territoryPreview);
  assert.deepEqual(hookCalls, [
    ["renderDispatcher", harness.renderDispatcher],
    ["startupUiBootstrapPromise", deferredUiBootstrap.promise],
  ]);
});

test("runUiShellDebugBoot preserves boot states, renderer options, localization, metrics, and debug global", async () => {
  const harness = createHarness();
  await runUiShellDebugBoot({
    targetState: harness.targetState,
    documentRef: harness.documentRef,
    globalScope: harness.globalScope,
    helpers: harness.helpers,
  });

  assert.deepEqual(harness.bootStates, [
    {
      phase: "ui-shell",
      options: {
        message: "Starting the UI debug shell.",
        progress: 55,
        canContinueWithoutScenario: false,
      },
    },
    {
      phase: "ready",
      options: {
        blocking: false,
        progress: 100,
        canContinueWithoutScenario: false,
      },
    },
  ]);
  assert.deepEqual(harness.initMapCalls, [
    {
      suppressRender: true,
      interactionLevel: "full",
      deferInteractionInfrastructure: false,
    },
  ]);
  assert.deepEqual(harness.setMapDataCalls, [
    {
      refitProjection: false,
      resetZoom: false,
      suppressRender: true,
      interactionLevel: "full",
      deferInteractionInfrastructure: false,
    },
  ]);
  assert.deepEqual(harness.bindingCalls, [
    {
      targetState: harness.targetState,
      setBootPreviewVisible: harness.helpers.setBootPreviewVisible,
      ensureDetailTopologyReady: harness.helpers.ensureDetailTopologyReady,
      flushReason: "ui-shell-render-now",
    },
  ]);
  assert.deepEqual(harness.localizationCalls, [
    { reason: "ui-shell-ready", renderNow: false },
  ]);
  assert.deepEqual(harness.globalScope.__mapcreatorUiShellDebug, {
    ready: true,
    skippedStartupData: true,
    skippedScenarioApply: true,
    territoryPreview: harness.territoryPreview,
  });
  assert.ok(
    harness.calls.indexOf("ensureFullLocalizationDataReady")
      < harness.calls.indexOf("renderDispatcher.flush"),
  );
  assert.ok(
    harness.calls.indexOf("renderDispatcher.flush")
      < harness.calls.indexOf("setBootState:ready"),
  );
  assert.ok(harness.calls.includes("finishBootMetric:ui-shell:debug"));
  assert.ok(harness.calls.includes("checkpointBootMetricOnce:ui-shell-ready"));
  assert.ok(harness.calls.includes("completeBootSequenceLogging"));
});

test("runUiShellDebugBoot uses the Chinese UI shell message when boot language is zh", async () => {
  const harness = createHarness({ bootLanguage: "zh" });
  await runUiShellDebugBoot({
    targetState: harness.targetState,
    documentRef: harness.documentRef,
    globalScope: harness.globalScope,
    helpers: harness.helpers,
  });

  assert.equal(harness.bootStates[0].phase, "ui-shell");
  assert.equal(harness.bootStates[0].options.message, "正在启动 UI 调试外壳。");
});

test("runUiShellDebugBoot propagates UI bootstrap rejection after exposing recovery hooks", async () => {
  const uiBootstrapError = new Error("ui bootstrap failed");
  const rejectedPromise = Promise.reject(uiBootstrapError);
  const harness = createHarness({ bootstrapPromise: rejectedPromise });
  const hookCalls = [];

  await assert.rejects(
    () => runUiShellDebugBoot({
      targetState: harness.targetState,
      documentRef: harness.documentRef,
      globalScope: harness.globalScope,
      helpers: harness.helpers,
      hooks: {
        onRenderDispatcher(renderDispatcher) {
          hookCalls.push(["renderDispatcher", renderDispatcher]);
        },
        onStartupUiBootstrapPromise(promise) {
          hookCalls.push(["startupUiBootstrapPromise", promise]);
        },
      },
    }),
    uiBootstrapError,
  );

  assert.equal(harness.targetState.uiShellDebug, true);
  assert.deepEqual(hookCalls, [
    ["renderDispatcher", harness.renderDispatcher],
    ["startupUiBootstrapPromise", rejectedPromise],
  ]);
  assert.equal(harness.globalScope.__mapcreatorUiShellDebug, undefined);
  assert.equal(harness.calls.includes("renderDispatcher.flush"), false);
  assert.equal(harness.calls.includes("setBootState:ready"), false);
});

test("runUiShellDebugBoot validates required helpers and optional hooks", async () => {
  const harness = createHarness();
  const helpers = { ...harness.helpers };
  delete helpers.initMap;

  await assert.rejects(
    () => runUiShellDebugBoot({
      targetState: harness.targetState,
      documentRef: harness.documentRef,
      globalScope: harness.globalScope,
      helpers,
    }),
    /requires helpers\.initMap to be a function/,
  );
  await assert.rejects(
    () => runUiShellDebugBoot({
      targetState: harness.targetState,
      documentRef: harness.documentRef,
      globalScope: harness.globalScope,
      helpers: harness.helpers,
      hooks: { onRenderDispatcher: true },
    }),
    /requires hooks\.onRenderDispatcher to be a function/,
  );
});
