import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

import {
  getTransportCapabilityDefaultOverviewConfig,
  getTransportOverviewDataLayerKeys,
  listTransportOverviewCapabilityFamilyIds,
} from "../js/core/transport_capability_registry.js";
import { createTransportAppearanceController } from "../js/ui/toolbar/transport_appearance_controller.js";

class TestElement {
  constructor() {
    this.checked = false;
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.classList = {
      toggle: () => {},
    };
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({
        target: this,
        ...event,
      });
    }
  }
}

function buildNodes(ids) {
  return Object.fromEntries(ids.map((id) => [id, new TestElement()]));
}

const TRANSPORT_TOGGLE_NODE_IDS = [
  "transportAppearanceMasterToggle",
  "toggleAirports",
  "togglePorts",
  "toggleRail",
  "toggleRoad",
];

const TRANSPORT_DEFAULT_NODE_IDS = [
  "railVisualStrength",
  "railVisualStrengthValue",
  "railOpacity",
  "railOpacityValue",
  "railCoverageReach",
  "railCoverageReachValue",
  "railScope",
  "railImportanceThreshold",
  "roadVisualStrength",
  "roadVisualStrengthValue",
  "roadOpacity",
  "roadOpacityValue",
  "roadCoverageReach",
  "roadCoverageReachValue",
  "roadScope",
  "roadImportanceThreshold",
];

function createHarness(runtimeOverrides = {}) {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const nodes = buildNodes([
    ...TRANSPORT_TOGGLE_NODE_IDS,
    ...TRANSPORT_DEFAULT_NODE_IDS,
  ]);
  const contextLayerLoads = [];
  const dirtyReasons = [];
  const releaseReasons = [];
  globalThis.HTMLElement = TestElement;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.document = {
    getElementById: (id) => nodes[id] || null,
    querySelectorAll: () => [],
  };
  const runtimeState = {
    showTransport: false,
    showAirports: false,
    showPorts: false,
    showRail: false,
    showRoad: false,
    styleConfig: {
      transportOverview: {},
    },
    ...runtimeOverrides,
  };
  registerRuntimeHook(runtimeState, "ensureContextLayerDataFn", (layerRequest, options) => {
    contextLayerLoads.push({ layerRequest, options });
    return Promise.resolve();
  });
  registerRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", (reason) => releaseReasons.push(reason));
  const controller = createTransportAppearanceController({
    runtimeState,
    t: (value) => value,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
    renderDirty: (reason) => dirtyReasons.push(reason),
  });
  return {
    cleanup() {
      globalThis.document = previousDocument;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    },
    contextLayerLoads,
    controller,
    dirtyReasons,
    nodes,
    releaseReasons,
    runtimeState,
  };
}

test("transport appearance master toggle loads enabled family layers from registry metadata", async () => {
  const harness = createHarness({
    showAirports: true,
    showPorts: true,
    showRail: true,
    showRoad: true,
  });
  try {
    harness.controller.bindEvents();
    harness.nodes.transportAppearanceMasterToggle.checked = true;
    harness.nodes.transportAppearanceMasterToggle.dispatch("change");

    assert.equal(harness.runtimeState.showTransport, true);
    assert.deepEqual(harness.releaseReasons, ["transport-master-toggle"]);
    assert.deepEqual(
      harness.contextLayerLoads,
      listTransportOverviewCapabilityFamilyIds().map((familyId) => {
        const layerKeys = getTransportOverviewDataLayerKeys(familyId);
        return {
          layerRequest: layerKeys.length === 1 ? layerKeys[0] : layerKeys,
          options: { reason: "transport-master-toggle", renderNow: true },
        };
      })
    );
    await Promise.resolve();
  } finally {
    harness.cleanup();
  }
});

test("transport appearance renders registry defaults for line families", () => {
  const harness = createHarness({
    showTransport: true,
  });
  try {
    const railDefaults = getTransportCapabilityDefaultOverviewConfig("rail");
    const roadDefaults = getTransportCapabilityDefaultOverviewConfig("road");

    harness.controller.renderTransportAppearanceUi();

    assert.equal(harness.nodes.railVisualStrength.value, String(Math.round(railDefaults.visualStrength * 100)));
    assert.equal(harness.nodes.railOpacity.value, String(Math.round(railDefaults.opacity * 100)));
    assert.equal(harness.nodes.railCoverageReach.value, String(Math.round(railDefaults.coverageReach * 100)));
    assert.equal(harness.nodes.railScope.value, railDefaults.scope);
    assert.equal(harness.nodes.railImportanceThreshold.value, railDefaults.importanceThreshold);
    assert.equal(harness.nodes.roadVisualStrength.value, String(Math.round(roadDefaults.visualStrength * 100)));
    assert.equal(harness.nodes.roadOpacity.value, String(Math.round(roadDefaults.opacity * 100)));
    assert.equal(harness.nodes.roadCoverageReach.value, String(Math.round(roadDefaults.coverageReach * 100)));
    assert.equal(harness.nodes.roadScope.value, roadDefaults.scope);
    assert.equal(harness.nodes.roadImportanceThreshold.value, roadDefaults.importanceThreshold);
  } finally {
    harness.cleanup();
  }
});

test("transport appearance family toggles load registry data layers before dirty render", async () => {
  const cases = [
    {
      nodeId: "toggleAirports",
      showField: "showAirports",
      releaseReason: "toggle-airports",
      layerRequest: "airports",
      dirtyReason: "toggle-airports",
    },
    {
      nodeId: "togglePorts",
      showField: "showPorts",
      releaseReason: "toggle-ports",
      layerRequest: "ports",
      dirtyReason: "toggle-ports",
    },
    {
      nodeId: "toggleRail",
      showField: "showRail",
      releaseReason: "toggle-rail",
      layerRequest: ["railways", "rail_stations_major"],
      dirtyReason: "toggle-rail",
    },
    {
      nodeId: "toggleRoad",
      showField: "showRoad",
      releaseReason: "toggle-road",
      layerRequest: "roads",
      dirtyReason: "toggle-road",
    },
  ];

  for (const testCase of cases) {
    const harness = createHarness();
    try {
      harness.controller.bindEvents();
      harness.nodes[testCase.nodeId].checked = true;
      harness.nodes[testCase.nodeId].dispatch("change");

      assert.equal(harness.runtimeState[testCase.showField], true, testCase.nodeId);
      assert.equal(harness.runtimeState.showTransport, true, testCase.nodeId);
      assert.deepEqual(harness.releaseReasons, [testCase.releaseReason], testCase.nodeId);
      assert.deepEqual(harness.contextLayerLoads, [
        { layerRequest: testCase.layerRequest, options: { reason: "toolbar-toggle", renderNow: true } },
      ], testCase.nodeId);
      assert.deepEqual(harness.dirtyReasons, [testCase.dirtyReason], testCase.nodeId);
      await Promise.resolve();
    } finally {
      harness.cleanup();
    }
  }
});

const fixtureHookNames = ["ensureContextLayerDataFn", "releaseDeferredContextBasePassFn"];
let savedHooks;
beforeEach(() => {
  savedHooks = fixtureHookNames.map((name) => [name, readRegisteredRuntimeHookSource(null, name)]);
});
afterEach(() => {
  for (const [name, hook] of savedHooks) registerRuntimeHook(null, name, hook);
});
