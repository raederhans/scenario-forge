import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

import {
  createAppearanceRiversOwner,
  normalizeRiversStyleConfig,
} from "../js/ui/toolbar/appearance_rivers_owner.js";

class TestElement {
  constructor() {
    this.checked = false;
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
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

function createTestDocument(nodeMap) {
  return {
    getElementById: (id) => nodeMap[id] || null,
  };
}

function buildNodes(ids) {
  return Object.fromEntries(ids.map((id) => [id, new TestElement()]));
}

const RIVERS_NODE_IDS = [
  "toggleRivers",
  "riversColor",
  "riversOpacity",
  "riversWidth",
  "riversOutlineColor",
  "riversOutlineWidth",
  "riversDashStyle",
  "riversOpacityValue",
  "riversWidthValue",
  "riversOutlineWidthValue",
];

function createHarness(runtimeOverrides = {}) {
  const nodes = buildNodes(RIVERS_NODE_IDS);
  const dirtyReasons = [];
  const contextLayerLoads = [];
  const runtimeState = {
    showRivers: true,
    styleConfig: {
      rivers: {
        color: "#3B82F6",
        opacity: 0.44,
        width: 1.25,
        outlineColor: "#E2EFFF",
        outlineWidth: 0.75,
        dashStyle: "dashed",
      },
    },
    ...runtimeOverrides,
  };
  registerRuntimeHook(runtimeState, "ensureContextLayerDataFn", (layer, options) => {
    contextLayerLoads.push({ layer, options });
    return Promise.resolve();
  });
  const owner = createAppearanceRiversOwner({
    runtimeState,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
    renderDirty: (reason) => dirtyReasons.push(reason),
    documentRef: createTestDocument(nodes),
  });
  return { contextLayerLoads, dirtyReasons, nodes, owner, runtimeState };
}

test("rivers owner normalizes imported style config", () => {
  const normalized = normalizeRiversStyleConfig({
    color: "#ABCDEF",
    opacity: 3,
    width: 0,
    outlineColor: "#FEDCBA",
    outlineWidth: -1,
    dashStyle: "",
  }, {
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
  });

  assert.deepEqual(normalized, {
    color: "#abcdef",
    opacity: 1,
    width: 0.2,
    outlineColor: "#fedcba",
    outlineWidth: 0,
    dashStyle: "solid",
  });
});

test("rivers owner renders toggle, inputs, and value labels", () => {
  const harness = createHarness();

  harness.owner.renderRiversUi();

  assert.equal(harness.nodes.toggleRivers.checked, true);
  assert.equal(harness.nodes.riversColor.value, "#3b82f6");
  assert.equal(harness.nodes.riversOpacity.value, "44");
  assert.equal(harness.nodes.riversOpacityValue.textContent, "44%");
  assert.equal(harness.nodes.riversWidth.value, "1.25");
  assert.equal(harness.nodes.riversWidthValue.textContent, "1.25");
  assert.equal(harness.nodes.riversOutlineColor.value, "#e2efff");
  assert.equal(harness.nodes.riversOutlineWidth.value, "0.75");
  assert.equal(harness.nodes.riversOutlineWidthValue.textContent, "0.75");
  assert.equal(harness.nodes.riversDashStyle.value, "dashed");
});

test("rivers owner toggles visibility and requests river context layer", () => {
  const harness = createHarness({ showRivers: false });

  harness.owner.bindEvents();
  harness.nodes.toggleRivers.checked = true;
  harness.nodes.toggleRivers.dispatch("change");

  assert.equal(harness.runtimeState.showRivers, true);
  assert.deepEqual(harness.contextLayerLoads, [
    {
      layer: "rivers",
      options: { reason: "toolbar-toggle", renderNow: true },
    },
  ]);
  assert.deepEqual(harness.dirtyReasons, ["toggle-rivers"]);
});

test("rivers owner binds controls once and updates style state", () => {
  const harness = createHarness();

  harness.owner.bindEvents();
  harness.owner.bindEvents();
  harness.nodes.riversColor.value = "#224466";
  harness.nodes.riversColor.dispatch("input");
  harness.nodes.riversOpacity.value = "66";
  harness.nodes.riversOpacity.dispatch("input");
  harness.nodes.riversWidth.value = "3.5";
  harness.nodes.riversWidth.dispatch("input");
  harness.nodes.riversOutlineColor.value = "#ddeeff";
  harness.nodes.riversOutlineColor.dispatch("input");
  harness.nodes.riversOutlineWidth.value = "2.5";
  harness.nodes.riversOutlineWidth.dispatch("input");
  harness.nodes.riversDashStyle.value = "dotted";
  harness.nodes.riversDashStyle.dispatch("change");

  assert.equal(harness.nodes.riversOpacity.listeners.get("input").length, 1);
  assert.equal(harness.runtimeState.styleConfig.rivers.color, "#224466");
  assert.equal(harness.runtimeState.styleConfig.rivers.opacity, 0.66);
  assert.equal(harness.runtimeState.styleConfig.rivers.width, 3.5);
  assert.equal(harness.runtimeState.styleConfig.rivers.outlineColor, "#ddeeff");
  assert.equal(harness.runtimeState.styleConfig.rivers.outlineWidth, 2.5);
  assert.equal(harness.runtimeState.styleConfig.rivers.dashStyle, "dotted");
  assert.equal(harness.nodes.riversOpacityValue.textContent, "66%");
  assert.equal(harness.nodes.riversWidthValue.textContent, "3.50");
  assert.equal(harness.nodes.riversOutlineWidthValue.textContent, "2.50");
  assert.deepEqual(harness.dirtyReasons, [
    "rivers-color",
    "rivers-opacity",
    "rivers-width",
    "rivers-outline-color",
    "rivers-outline-width",
    "rivers-dash",
  ]);
});

const fixtureHookNames = ["ensureContextLayerDataFn"];
let savedHooks;
beforeEach(() => {
  savedHooks = fixtureHookNames.map((name) => [name, readRegisteredRuntimeHookSource(null, name)]);
});
afterEach(() => {
  for (const [name, hook] of savedHooks) registerRuntimeHook(null, name, hook);
});
