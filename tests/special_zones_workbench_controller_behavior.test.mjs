import test from "node:test";
import assert from "node:assert/strict";
import { createLayerFromPreset } from "../js/core/special_zone_layers.js";
import { createSpecialZonesWorkbenchController } from "../js/ui/toolbar/special_zones_workbench_controller.js";

import { findFirst } from "./helpers/element_tree_queries.mjs";
import { Element } from "./helpers/legend_element.mjs";

class TestElement extends Element {
  get options() { return this.children.filter(child => child.tagName === "option"); }
  prepend(node) { this.children.unshift(node); node.parent = this; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  async click() {
    const event = { target: this, currentTarget: this };
    for (const handler of this.listeners.get("click") || []) {
      await handler(event);
    }
  }
}

function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
    createElementNS: (_ns, tagName) => new TestElement(tagName),
  };
}
function findButtonByText(root, text) {
  return findFirst(root, (node) => node.tagName === "button" && node.textContent === text);
}

test("scenario save ignores a response after the scenario apply context changes", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    currentScenarioApplyRequestId: 1,
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "local-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "local-layer",
    },
  };
  let resolveJson;
  globalThis.fetch = async () => {
    return {
      ok: true,
      json: () => new Promise((resolve) => { resolveJson = resolve; }),
    };
  };

  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => runtimeState.specialZoneLayers,
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const saveBtn = findButtonByText(container, "Save scenario layer asset");
    const savePromise = saveBtn.click();
    while (!resolveJson) await Promise.resolve();
    runtimeState.activeScenarioId = "hoi4_1936";
    runtimeState.currentScenarioApplyRequestId = 2;
    resolveJson({
      ok: true,
      specialZoneLayers: {
        layers: [createLayerFromPreset("custom", { id: "stale-server-layer" })],
        activeLayerId: "stale-server-layer",
      },
    });
    await savePromise;
    assert.equal(runtimeState.specialZoneLayers.layers[0].id, "local-layer");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("scenario save coalesces three same-context clicks into active and newest pending snapshots", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    currentScenarioApplyRequestId: 1,
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "local-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "local-layer",
    },
  };
  const requests = [];
  const responseResolvers = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Promise((resolve) => {
      responseResolvers.push(() => {
        resolve({
          ok: true,
          json: async () => ({
            ok: true,
            specialZoneLayers: request.specialZoneLayers,
          }),
        });
      });
    });
  };

  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => runtimeState.specialZoneLayers,
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const firstSaveButton = findButtonByText(container, "Save scenario layer asset");
    const firstSave = firstSaveButton.click();
    while (responseResolvers.length < 1) await Promise.resolve();

    runtimeState.specialZoneLayers = {
      layers: [createLayerFromPreset("custom", { id: "newest-local-layer", memberFeatureIds: ["b"] })],
      activeLayerId: "newest-local-layer",
    };
    controller.renderSpecialZonesWorkbenchUi();
    const secondSaveButton = findButtonByText(container, "Save scenario layer asset");
    const secondSave = secondSaveButton.click();
    await Promise.resolve();
    assert.equal(requests.length, 1);
    runtimeState.specialZoneLayers = {
      layers: [createLayerFromPreset("custom", { id: "final-local-layer", memberFeatureIds: ["c"] })],
      activeLayerId: "final-local-layer",
    };
    controller.renderSpecialZonesWorkbenchUi();
    const thirdSaveButton = findButtonByText(container, "Save scenario layer asset");
    const thirdSave = thirdSaveButton.click();
    await Promise.resolve();
    assert.equal(requests.length, 1);
    responseResolvers[0]();
    await firstSave;
    while (responseResolvers.length < 2) await Promise.resolve();
    assert.equal(requests.length, 2);
    responseResolvers[1]();
    await Promise.all([secondSave, thirdSave]);

    assert.equal(requests[0].specialZoneLayers.layers[0].id, "local-layer");
    assert.equal(requests[1].specialZoneLayers.layers[0].id, "final-local-layer");
    assert.equal(runtimeState.specialZoneLayers.layers[0].id, "final-local-layer");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("new scenario layer ignores stale optional layer load after scenario changes", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    currentScenarioApplyRequestId: 1,
    activeScenarioManifest: { special_zone_layers_url: "data/scenarios/tno_1962/special_zone_layers.json" },
    showSpecialZones: false,
    specialZoneLayers: { layers: [], activeLayerId: "" },
  };
  let resolveLoad;
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => {
      await new Promise((resolve) => { resolveLoad = resolve; });
      runtimeState.specialZoneLayers = { layers: [], activeLayerId: "", diagnostics: [] };
      return runtimeState.specialZoneLayers;
    },
    t: (value) => value,
  });
  try {
    controller.renderSpecialZonesWorkbenchUi();
    const newLayerButton = findButtonByText(container, "New region");
    await newLayerButton.click();
    const clickPromise = findButtonByText(container, "Create").click();
    await Promise.resolve();

    runtimeState.activeScenarioId = "hoi4_1936";
    runtimeState.currentScenarioApplyRequestId = 2;
    resolveLoad();
    await clickPromise;

    assert.equal(runtimeState.showSpecialZones, false);
    assert.equal(runtimeState.specialZoneLayers.layers.length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});
