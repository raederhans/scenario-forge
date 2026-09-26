import test from "node:test";
import assert from "node:assert/strict";

import { registerRuntimeHook } from "../js/core/state/index.js";
import { createLayerFromPreset } from "../js/core/special_zone_layers.js";
import { createSpecialZonesWorkbenchController } from "../js/ui/toolbar/special_zones_workbench_controller.js";

class TestClassList {
  constructor(node) { this.node = node; this.values = new Set(); }
  add(...tokens) { tokens.forEach((token) => this.values.add(token)); this.node.className = Array.from(this.values).join(" "); }
  remove(...tokens) { tokens.forEach((token) => this.values.delete(token)); this.node.className = Array.from(this.values).join(" "); }
  contains(token) { return this.values.has(token); }
  toggle(token, force) {
    const enabled = force === undefined ? !this.values.has(token) : !!force;
    if (enabled) this.add(token); else this.remove(token);
    return enabled;
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new TestClassList(this);
    this.className = "";
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.type = "";
    this.open = false;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) {
    if (typeof node === "string") {
      const text = new TestElement("#text");
      text.textContent = node;
      node = text;
    }
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  prepend(node) {
    this.children.unshift(node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  async click() {
    const event = { target: this, currentTarget: this };
    for (const handler of this.listeners.get("click") || []) {
      await handler(event);
    }
  }
  focus() { this.dataset.focused = "true"; }
  showModal() { this.open = true; this.hidden = false; }
  close() { this.open = false; this.hidden = true; }
  get options() { return this.children.filter((child) => child.tagName === "option"); }
  querySelector(selector) { return findFirst(this, (node) => matchesSelector(node, selector)); }
  querySelectorAll(selector) { return findAll(this, (node) => matchesSelector(node, selector)); }
}

function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
    createElementNS: (_ns, tagName) => new TestElement(tagName),
  };
}

function walk(node, visit) {
  for (const child of node.children || []) {
    visit(child);
    walk(child, visit);
  }
}

function findFirst(root, predicate) {
  let result = null;
  walk(root, (node) => {
    if (!result && predicate(node)) result = node;
  });
  return result;
}

function findAll(root, predicate) {
  const result = [];
  walk(root, (node) => {
    if (predicate(node)) result.push(node);
  });
  return result;
}

function matchesSimple(node, selector) {
  if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith("[data-")) {
    const key = selector.slice(6, -1).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    return Object.prototype.hasOwnProperty.call(node.dataset, key);
  }
  return node.tagName === selector.toLowerCase();
}

function matchesSelector(node, selector) {
  if (!selector) return false;
  if (selector.includes(" ")) {
    const parts = selector.split(/\s+/);
    const last = parts.pop();
    if (!matchesSelector(node, last)) return false;
    let parent = node.parentNode;
    while (parent) {
      if (matchesSelector(parent, parts.join(" "))) return true;
      parent = parent.parentNode;
    }
    return false;
  }
  if (selector.includes(".")) {
    const [tag, ...classes] = selector.split(".");
    if (tag && node.tagName !== tag.toLowerCase()) return false;
    return classes.every((className) => node.className.split(/\s+/).includes(className));
  }
  return matchesSimple(node, selector);
}

function findButtonByText(root, text) {
  return findFirst(root, (node) => node.tagName === "button" && node.textContent === text);
}

function getNodeText(node) {
  return [node.textContent, ...(node.children || []).map(getNodeText)].join(" ");
}

test("empty workbench presents one create action and reveals editing cards after creation", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  const container = new TestElement("section");
  const runtimeState = { specialZoneLayers: { layers: [], activeLayerId: "" } };
  const controller = createSpecialZonesWorkbenchController({
    runtimeState, container, markDirty() {}, render() {}, updateToolUI() {}, t: (value) => value,
  });
  try {
    controller.renderSpecialZonesWorkbenchUi();
    const root = container.querySelector("[data-special-zone-layers-workbench]");
    const cards = findAll(container, (node) => node.parentNode?.className === "special-zone-workbench-grid");
    assert.equal(root.dataset.emptyState, "true");
    assert.equal(cards.length, 4);
    assert.equal(cards.filter((card) => !card.hidden).length, 1);
    assert.equal(findButtonByText(container, "New layer")?.disabled, false);
    assert.equal(getNodeText(container).includes("Create a layer before editing members or styles."), true);
    assert.equal(getNodeText(container).includes("Select or create a layer to apply style presets."), false);
    await findButtonByText(container, "New layer").click();
    assert.equal(root.dataset.emptyState, "false");
    assert.equal(cards.filter((card) => !card.hidden).length, 4);
    assert.ok(container.querySelector(".special-zone-preset-groups"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("first scenario save loads the optional layer asset and posts canonical payload", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "layer-a", memberFeatureIds: ["b", "a"] })],
      activeLayerId: "layer-a",
    },
  };
  const loads = [];
  const fetches = [];
  globalThis.fetch = async (url, options) => {
    fetches.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, specialZoneLayers: runtimeState.specialZoneLayers };
      },
    };
  };

  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    captureHistoryState: () => ({}),
    pushHistoryEntry() {},
    ensureActiveScenarioOptionalLayerLoaded: async (layerId, options) => {
      loads.push({ layerId, options });
      runtimeState.specialZoneLayers = {
        layers: [createLayerFromPreset("custom", { id: "server-layer", memberFeatureIds: ["server"] })],
        activeLayerId: "server-layer",
        diagnostics: [],
      };
      return runtimeState.specialZoneLayers;
    },
    showToast() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const saveBtn = findButtonByText(container, "Save scenario layer asset");
    assert.ok(saveBtn, "save button should render");
    await saveBtn.click();

    assert.deepEqual(loads, [{ layerId: "specialZoneLayers", options: { renderNow: false } }]);
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url, "/__dev/scenario/special-zone-layers/save");
    const body = JSON.parse(fetches[0].options.body);
    assert.equal(body.scenarioId, "tno_1962");
    assert.equal(body.specialZoneLayers.layers[0].id, "layer-a");
    assert.deepEqual(body.specialZoneLayers.layers[0].memberFeatureIds, ["a", "b"]);
    assert.equal(saveBtn.getAttribute("aria-busy"), null);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

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
  let fetchCount = 0;
  let renderCount = 0;
  const toasts = [];
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: () => new Promise((resolve) => { resolveJson = resolve; }),
    };
  };

  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render: () => { renderCount += 1; },
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => runtimeState.specialZoneLayers,
    showToast: (...args) => toasts.push(args),
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const saveBtn = findButtonByText(container, "Save scenario layer asset");
    const savePromise = saveBtn.click();
    while (!resolveJson) await Promise.resolve();
    controller.renderSpecialZonesWorkbenchUi();
    const pendingSave = findButtonByText(container, "Save scenario layer asset").click();

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
    await pendingSave;

    assert.equal(fetchCount, 1);
    assert.equal(runtimeState.specialZoneLayers.layers[0].id, "local-layer");
    assert.equal(renderCount, 0);
    assert.deepEqual(toasts, []);
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
  let persistedState = null;
  let inFlightRequests = 0;
  let maxInFlightRequests = 0;
  let renderCount = 0;
  const toasts = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    inFlightRequests += 1;
    maxInFlightRequests = Math.max(maxInFlightRequests, inFlightRequests);
    return new Promise((resolve) => {
      responseResolvers.push(() => {
        persistedState = request.specialZoneLayers;
        inFlightRequests -= 1;
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
    render: () => { renderCount += 1; },
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => runtimeState.specialZoneLayers,
    showToast: (...args) => toasts.push(args),
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
    assert.equal(maxInFlightRequests, 1);

    runtimeState.specialZoneLayers = {
      layers: [createLayerFromPreset("custom", { id: "final-local-layer", memberFeatureIds: ["c"] })],
      activeLayerId: "final-local-layer",
    };
    controller.renderSpecialZonesWorkbenchUi();
    const thirdSaveButton = findButtonByText(container, "Save scenario layer asset");
    const thirdSave = thirdSaveButton.click();
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(firstSaveButton.getAttribute("aria-busy"), "true");
    assert.equal(secondSaveButton.getAttribute("aria-busy"), "true");
    assert.equal(thirdSaveButton.getAttribute("aria-busy"), "true");

    responseResolvers[0]();
    await firstSave;
    while (responseResolvers.length < 2) await Promise.resolve();
    assert.equal(requests.length, 2);
    assert.equal(maxInFlightRequests, 1);
    assert.equal(renderCount, 0);
    assert.deepEqual(toasts, []);
    responseResolvers[1]();
    await Promise.all([secondSave, thirdSave]);

    assert.equal(requests[0].specialZoneLayers.layers[0].id, "local-layer");
    assert.equal(requests[1].specialZoneLayers.layers[0].id, "final-local-layer");
    assert.equal(persistedState.layers[0].id, "final-local-layer");
    assert.equal(runtimeState.specialZoneLayers.layers[0].id, "final-local-layer");
    assert.equal(renderCount, 1);
    assert.equal(toasts.length, 1);
    assert.equal(firstSaveButton.getAttribute("aria-busy"), null);
    assert.equal(secondSaveButton.getAttribute("aria-busy"), null);
    assert.equal(thirdSaveButton.getAttribute("aria-busy"), null);
    assert.equal(firstSaveButton.classList.contains("is-loading"), false);
    assert.equal(secondSaveButton.classList.contains("is-loading"), false);
    assert.equal(thirdSaveButton.classList.contains("is-loading"), false);
    assert.equal(container.querySelector(".special-zone-workbench-status").textContent, "Scenario special zone layers saved.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("stale save failure stays silent while the queued current context continues", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    currentScenarioApplyRequestId: 1,
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "tno-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "tno-layer",
    },
  };
  const requests = [];
  const requestSettlers = [];
  const warnings = [];
  const toasts = [];
  let renderCount = 0;
  console.warn = (...args) => warnings.push(args);
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Promise((resolve, reject) => {
      requestSettlers.push({
        reject,
        succeed() {
          resolve({
            ok: true,
            json: async () => ({ ok: true, specialZoneLayers: request.specialZoneLayers }),
          });
        },
      });
    });
  };

  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render: () => { renderCount += 1; },
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => runtimeState.specialZoneLayers,
    showToast: (...args) => toasts.push(args),
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const staleButton = findButtonByText(container, "Save scenario layer asset");
    const staleSave = staleButton.click();
    while (requestSettlers.length < 1) await Promise.resolve();

    runtimeState.activeScenarioId = "hoi4_1936";
    runtimeState.currentScenarioApplyRequestId = 2;
    runtimeState.specialZoneLayers = {
      layers: [createLayerFromPreset("custom", { id: "hoi4-layer", memberFeatureIds: ["b"] })],
      activeLayerId: "hoi4-layer",
    };
    controller.renderSpecialZonesWorkbenchUi();
    const currentButton = findButtonByText(container, "Save scenario layer asset");
    const currentSave = currentButton.click();

    requestSettlers[0].reject(new Error("stale request failed"));
    await staleSave;
    while (requestSettlers.length < 2) await Promise.resolve();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].scenarioId, "hoi4_1936");
    assert.equal(requests[1].specialZoneLayers.layers[0].id, "hoi4-layer");
    assert.deepEqual(warnings, []);
    assert.deepEqual(toasts, []);
    assert.equal(renderCount, 0);

    requestSettlers[1].succeed();
    await currentSave;

    assert.deepEqual(warnings, []);
    assert.equal(toasts.length, 1);
    assert.equal(renderCount, 1);
    assert.equal(runtimeState.specialZoneLayers.layers[0].id, "hoi4-layer");
    assert.equal(staleButton.getAttribute("aria-busy"), null);
    assert.equal(currentButton.getAttribute("aria-busy"), null);
    assert.equal(container.querySelector(".special-zone-workbench-status").textContent, "Scenario special zone layers saved.");
  } finally {
    console.warn = previousWarn;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("project-scoped special zones keep status hidden and expose disabled scenario asset reason", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "project-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "project-layer",
    },
  };
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const status = container.querySelector(".special-zone-workbench-status");
    const saveBtn = findButtonByText(container, "Save scenario layer asset");
    assert.equal(status.id, "specialZoneWorkbenchStatus");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-atomic"), "true");
    assert.ok(status.className.split(/\s+/).includes("visually-hidden"));
    assert.equal(status.textContent, "");
    assert.equal(saveBtn.disabled, true);
    assert.equal(saveBtn.getAttribute("aria-describedby"), null);
    assert.match(saveBtn.getAttribute("aria-label"), /Scenario asset save needs an active scenario/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("style presets render as collapsed category groups with rectangular previews", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "project-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "project-layer",
    },
  };
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const groups = container.querySelectorAll("details.special-zone-preset-group");
    assert.ok(groups.length > 1);
    assert.ok(groups.every((group) => group.open === false));
    assert.ok(groups.some((group) => getNodeText(group).includes("security (5)")));
    assert.equal(container.querySelectorAll(".special-zone-preset-tab").length, 0);
    assert.equal(
      container.querySelectorAll(".special-zone-preset-preview").length,
      container.querySelectorAll(".special-zone-preset-card").length,
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test("style preset category expansion survives workbench rerender", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "project-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "project-layer",
    },
  };
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const securityGroup = findFirst(container, (node) => node.dataset?.presetCategory === "security");
    assert.ok(securityGroup);
    assert.equal(securityGroup.open, false);
    securityGroup.open = true;
    for (const handler of securityGroup.listeners.get("toggle") || []) {
      await handler({ target: securityGroup, currentTarget: securityGroup });
    }

    controller.renderSpecialZonesWorkbenchUi();
    const rerenderedSecurityGroup = findFirst(container, (node) => node.dataset?.presetCategory === "security");
    assert.ok(rerenderedSecurityGroup);
    assert.equal(rerenderedSecurityGroup.open, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("pattern choices render localized preview buttons and update the active layer", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "project-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "project-layer",
    },
  };
  const dirty = [];
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty: (label) => dirty.push(label),
    render() {},
    updateToolUI() {},
    captureHistoryState: () => ({}),
    pushHistoryEntry() {},
    t: (value) => ({ "Cross hatch": "交叉斜线", Pattern: "图案" }[value] || value),
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const styleCard = container.querySelector(".special-zone-style-card");
    assert.ok(styleCard);
    const patternGrid = container.querySelector(".special-zone-pattern-choice-grid");
    assert.ok(patternGrid);
    assert.equal(patternGrid.getAttribute("role"), "radiogroup");
    assert.equal(patternGrid.getAttribute("aria-label"), "图案");
    assert.equal(patternGrid.querySelectorAll("select").length, 0);
    assert.equal(container.querySelectorAll(".special-zone-pattern-choice-preview").length, 10);
    const crossHatchButton = Array.from(container.querySelectorAll(".special-zone-pattern-choice"))
      .find((button) => button.dataset.patternId === "crossHatch");
    assert.ok(crossHatchButton);
    assert.match(getNodeText(crossHatchButton), /交叉斜线/);
    await crossHatchButton.click();
    const layer = runtimeState.specialZoneLayers.layers.find((entry) => entry.id === "project-layer");
    assert.equal(layer.style.pattern, "crossHatch");
    assert.equal(layer.presetId, "custom");
    assert.ok(dirty.includes("special-zone-layer-style"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("overlay toggle enables map overlay and loads scenario layers", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    showSpecialZones: false,
    specialZoneLayers: { layers: [], activeLayerId: "" },
  };
  const loads = [];
  const dirty = [];
  let renderCount = 0;
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty: (label) => dirty.push(label),
    render: () => { renderCount += 1; },
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async (layerId, options) => {
      loads.push({ layerId, options });
      return runtimeState.specialZoneLayers;
    },
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const toggle = container.querySelector("[data-special-zone-overlay-toggle]");
    assert.ok(toggle);
    toggle.checked = true;
    for (const handler of toggle.listeners.get("change") || []) {
      await handler({ target: toggle, currentTarget: toggle });
    }

    assert.equal(runtimeState.showSpecialZones, true);
    assert.deepEqual(loads, [{ layerId: "specialZoneLayers", options: { renderNow: false } }]);
    assert.deepEqual(dirty, ["toggle-special-zones"]);
    assert.equal(renderCount, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("new scenario layer waits for optional layer load before mutating state", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { special_zone_layers_url: "data/scenarios/tno_1962/special_zone_layers.json" },
    showSpecialZones: false,
    specialZoneLayers: { layers: [], activeLayerId: "" },
  };
  let loadCount = 0;
  const dirty = [];
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty: (label) => dirty.push(label),
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => {
      loadCount += 1;
      await Promise.resolve();
      runtimeState.specialZoneLayers = { layers: [], activeLayerId: "", diagnostics: [] };
      return runtimeState.specialZoneLayers;
    },
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const newLayerButton = findButtonByText(container, "New layer");
    assert.ok(newLayerButton, "new layer button should render");
    await newLayerButton.click();

    assert.equal(loadCount, 1);
    assert.equal(runtimeState.showSpecialZones, true);
    assert.equal(runtimeState.specialZoneLayers.layers.length, 1);
    assert.equal(runtimeState.specialZoneLayers.layers[0].source, "scenario");
    assert.equal(runtimeState.specialZoneLayers.activeLayerId, runtimeState.specialZoneLayers.layers[0].id);
    assert.deepEqual(dirty, ["special-zone-layer-add"]);
  } finally {
    globalThis.document = previousDocument;
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
  let loadCount = 0;
  const loadOptions = [];
  const dirty = [];
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty: (label) => dirty.push(label),
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async (_layerKey, options = {}) => {
      loadCount += 1;
      loadOptions.push(options);
      await new Promise((resolve) => { resolveLoad = resolve; });
      runtimeState.specialZoneLayers = { layers: [], activeLayerId: "", diagnostics: [] };
      return runtimeState.specialZoneLayers;
    },
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const newLayerButton = findButtonByText(container, "New layer");
    assert.ok(newLayerButton, "new layer button should render");
    const clickPromise = newLayerButton.click();
    await Promise.resolve();

    assert.equal(loadCount, 1);
    assert.equal(loadOptions[0].scenarioApplyRequestId, 1);
    runtimeState.activeScenarioId = "hoi4_1936";
    runtimeState.currentScenarioApplyRequestId = 2;
    resolveLoad();
    await clickPromise;

    assert.equal(runtimeState.showSpecialZones, false);
    assert.equal(runtimeState.specialZoneLayers.layers.length, 0);
    assert.deepEqual(dirty, []);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("scenario layer load cache follows the current apply request", async () => {
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
  const loadOptions = [];
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async (_layerKey, options = {}) => {
      loadOptions.push(options);
      runtimeState.specialZoneLayers = { layers: [], activeLayerId: "", diagnostics: [] };
      return runtimeState.specialZoneLayers;
    },
    t: (value) => value,
  });

  try {
    await controller.loadScenarioSpecialZoneLayers();
    await controller.loadScenarioSpecialZoneLayers();
    assert.equal(loadOptions.length, 1);
    assert.equal(loadOptions[0].scenarioApplyRequestId, 1);

    runtimeState.currentScenarioApplyRequestId = 2;
    await controller.loadScenarioSpecialZoneLayers();

    assert.equal(loadOptions.length, 2);
    assert.equal(loadOptions[1].scenarioApplyRequestId, 2);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("topology mismatch diagnostics stay out of the workbench chrome", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioManifest: { source: { runtime_topology_sha256: "current-fp" } },
    specialZoneLayers: {
      topologyFingerprint: "old-fp",
      layers: [],
      activeLayerId: "",
    },
  };
  let projectDiagnosticsRenderCount = 0;
  registerRuntimeHook(runtimeState, "renderScenarioAuditPanelFn", () => {
    projectDiagnosticsRenderCount += 1;
  });
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const diagnostics = container.querySelector(".special-zone-workbench-diagnostics");
    assert.equal(diagnostics, null);
    assert.ok(runtimeState.specialZoneLayers.diagnostics.some((entry) =>
      entry.code === "topology_fingerprint_mismatch"
      && entry.expected === "current-fp"
      && entry.actual === "old-fp"
    ));
    assert.equal(projectDiagnosticsRenderCount, 1);
  } finally {
    registerRuntimeHook(runtimeState, "renderScenarioAuditPanelFn", null);
    globalThis.document = previousDocument;
  }
});

test("failed scenario layer load clears current layers and remains retryable", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { special_zone_layers_url: "data/scenarios/tno_1962/special_zone_layers.json" },
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "pending-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "pending-layer",
    },
  };
  let loadCount = 0;
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => {
      loadCount += 1;
      return null;
    },
    showToast() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    await controller.loadScenarioSpecialZoneLayers();
    await controller.loadScenarioSpecialZoneLayers();
    assert.equal(loadCount, 2);
    assert.deepEqual(runtimeState.specialZoneLayers.layers, []);
    assert.equal(runtimeState.specialZoneLayers.activeLayerId, "");
    assert.equal(runtimeState.specialZonesOverlayDirty, true);
    assert.ok(runtimeState.specialZoneLayers.diagnostics.some((entry) => entry.code === "special_zone_layers_load_failed"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("render-triggered scenario layer load failure does not loop", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  const container = new TestElement("section");
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { special_zone_layers_url: "data/scenarios/tno_1962/special_zone_layers.json" },
    showSpecialZones: true,
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "pending-layer", memberFeatureIds: ["a"] })],
      activeLayerId: "pending-layer",
    },
  };
  let loadCount = 0;
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    ensureActiveScenarioOptionalLayerLoaded: async () => {
      loadCount += 1;
      return null;
    },
    showToast() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loadCount, 1);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loadCount, 1);
    assert.deepEqual(runtimeState.specialZoneLayers.layers, []);
    assert.equal(runtimeState.specialZoneLayers.activeLayerId, "");
    assert.equal(runtimeState.specialZonesOverlayDirty, true);
    assert.ok(runtimeState.specialZoneLayers.diagnostics.some((entry) => entry.code === "special_zone_layers_load_failed"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("large member lists render capped chips and keep drawer search bounded", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  const container = new TestElement("section");
  const memberFeatureIds = Array.from({ length: 95 }, (_value, index) => `member-${String(index + 1).padStart(3, "0")}`);
  const runtimeState = {
    specialZoneLayers: {
      layers: [createLayerFromPreset("custom", { id: "layer-a", memberFeatureIds })],
      activeLayerId: "layer-a",
    },
  };
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty() {},
    render() {},
    updateToolUI() {},
    captureHistoryState: () => ({}),
    pushHistoryEntry() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    assert.equal(container.querySelectorAll(".special-zone-member-chip").length, 30);
    assert.ok(findButtonByText(container, "View all (95)"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("member copy select explains empty and selectable source states", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const singleContainer = new TestElement("section");
    const singleRuntimeState = {
      specialZoneLayers: {
        layers: [createLayerFromPreset("custom", { id: "only-layer", name: "Only layer", memberFeatureIds: ["a"] })],
        activeLayerId: "only-layer",
      },
    };
    createSpecialZonesWorkbenchController({
      runtimeState: singleRuntimeState,
      container: singleContainer,
      markDirty() {},
      render() {},
      updateToolUI() {},
      captureHistoryState: () => ({}),
      pushHistoryEntry() {},
      t: (value) => value,
    }).renderSpecialZonesWorkbenchUi();

    const emptyCopySelect = singleContainer.querySelector(".special-zone-member-copy-select");
    assert.ok(emptyCopySelect);
    assert.equal(emptyCopySelect.disabled, true);
    assert.equal(emptyCopySelect.options[0].textContent, "No layers to copy from");
    assert.equal(findButtonByText(singleContainer, "Copy members from layer").disabled, true);

    const multiContainer = new TestElement("section");
    const multiRuntimeState = {
      specialZoneLayers: {
        layers: [
          createLayerFromPreset("custom", { id: "target", name: "Target", memberFeatureIds: ["a"] }),
          createLayerFromPreset("buffer", { id: "source", name: "Source", memberFeatureIds: ["b", "c"] }),
        ],
        activeLayerId: "target",
      },
    };
    const dirty = [];
    createSpecialZonesWorkbenchController({
      runtimeState: multiRuntimeState,
      container: multiContainer,
      markDirty: (label) => dirty.push(label),
      render() {},
      updateToolUI() {},
      captureHistoryState: () => ({}),
      pushHistoryEntry() {},
      t: (value) => value,
    }).renderSpecialZonesWorkbenchUi();

    const copySelect = multiContainer.querySelector(".special-zone-member-copy-select");
    const copyButton = findButtonByText(multiContainer, "Copy members from layer");
    assert.equal(copySelect.disabled, false);
    assert.equal(copySelect.options[0].textContent, "Select source layer");
    assert.equal(copySelect.options[1].textContent, "Source (2)");
    assert.equal(copyButton.disabled, true);

    copySelect.value = "source";
    for (const handler of copySelect.listeners.get("change") || []) {
      handler({ target: copySelect, currentTarget: copySelect });
    }
    assert.equal(copyButton.disabled, false);
    await copyButton.click();
    assert.deepEqual(multiRuntimeState.specialZoneLayers.layers.find((layer) => layer.id === "target").memberFeatureIds, ["b", "c"]);
    assert.ok(dirty.includes("special-zone-members-copy"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("batch import, set operations, and story preview use compact workbench controls", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  const container = new TestElement("section");
  const runtimeState = {
    landIndex: new Map([["a", {}], ["b", {}], ["c", {}], ["d", {}]]),
    specialZoneLayers: {
      layers: [
        createLayerFromPreset("custom", { id: "target", name: "Target", memberFeatureIds: ["a"] }),
        createLayerFromPreset("buffer", { id: "source", name: "Source", memberFeatureIds: ["b", "c"] }),
      ],
      activeLayerId: "target",
    },
  };
  const dirty = [];
  const controller = createSpecialZonesWorkbenchController({
    runtimeState,
    container,
    markDirty: (label) => dirty.push(label),
    render() {},
    updateToolUI() {},
    captureHistoryState: () => ({}),
    pushHistoryEntry() {},
    t: (value) => value,
  });

  try {
    controller.renderSpecialZonesWorkbenchUi();
    const importInput = container.querySelector(".special-zone-member-import-input");
    assert.ok(importInput);
    importInput.value = "d missing b";
    await findButtonByText(container, "Replace with imported ids").click();
    assert.deepEqual(runtimeState.specialZoneLayers.layers.find((layer) => layer.id === "target").memberFeatureIds, ["b", "d"]);

    controller.renderSpecialZonesWorkbenchUi();
    const invalidOnlyInput = container.querySelector(".special-zone-member-import-input");
    invalidOnlyInput.value = "missing";
    await findButtonByText(container, "Replace with imported ids").click();
    assert.deepEqual(runtimeState.specialZoneLayers.layers.find((layer) => layer.id === "target").memberFeatureIds, []);

    controller.renderSpecialZonesWorkbenchUi();
    const restoreInput = container.querySelector(".special-zone-member-import-input");
    restoreInput.value = "d b";
    await findButtonByText(container, "Replace with imported ids").click();
    assert.deepEqual(runtimeState.specialZoneLayers.layers.find((layer) => layer.id === "target").memberFeatureIds, ["b", "d"]);

    controller.renderSpecialZonesWorkbenchUi();
    const selects = container.querySelectorAll("select");
    selects[selects.length - 1].value = "source";
    await findButtonByText(container, "Union with layer").click();
    assert.deepEqual(runtimeState.specialZoneLayers.layers.find((layer) => layer.id === "target").memberFeatureIds, ["b", "c", "d"]);
    assert.ok(dirty.includes("special-zone-members-batch-replace"));
    assert.ok(dirty.includes("special-zone-members-union"));
    assert.match(getNodeText(container), /Story preview/);
    assert.match(getNodeText(container), /Target/);
  } finally {
    globalThis.document = previousDocument;
  }
});
