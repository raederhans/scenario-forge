import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransportWorkbenchShellOwner,
  getTransportWorkbenchPackOptionsSignature,
  syncTransportWorkbenchPackSelectOptions,
} from "../js/ui/transport_workbench/transport_workbench_shell_owner.js";

class TestSelect {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.value = "";
    this.replaceChildrenCallCount = 0;
  }

  replaceChildren(...children) {
    this.replaceChildrenCallCount += 1;
    this.children = children;
  }
}

class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const removals = new Set(tokens);
    const values = String(this.node.className || "").split(/\s+/).filter((token) => token && !removals.has(token));
    this.node.className = values.join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldEnable = force === undefined ? !this.contains(token) : !!force;
    if (shouldEnable) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldEnable;
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.className = "";
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.attributes = {};
    this.disabled = false;
    this.textContent = "";
    this.title = "";
    this.value = "";
    this.replaceChildrenCallCount = 0;
    this.setAttributeCallCount = 0;
    this.textWriteCount = 0;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...children) {
    this.replaceChildrenCallCount += 1;
    this.children = children;
  }

  setAttribute(name, value) {
    this.setAttributeCallCount += 1;
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }
}

function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return {
        tagName: String(tagName || "").toLowerCase(),
        textContent: "",
        value: "",
      };
    },
  };
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

const roadPacks = Object.freeze([
  Object.freeze({ packId: "japan_road", label: "Japan road" }),
  Object.freeze({ packId: "germany_road", label: "Germany road" }),
]);

test("transport workbench pack select reuses options while refreshing value and disabled state", () => withTestDocument(() => {
  const selectNode = new TestSelect();

  const firstRender = syncTransportWorkbenchPackSelectOptions({
    selectNode,
    packOptions: roadPacks,
    activePackId: "japan_road",
  });
  const secondRender = syncTransportWorkbenchPackSelectOptions({
    selectNode,
    packOptions: roadPacks.map((pack) => ({ ...pack })),
    activePackId: "germany_road",
  });

  assert.equal(firstRender.rebuilt, true);
  assert.equal(secondRender.rebuilt, false);
  assert.equal(selectNode.replaceChildrenCallCount, 1);
  assert.equal(selectNode.value, "germany_road");
  assert.equal(selectNode.disabled, false);
  assert.equal(selectNode.dataset.packOptionsSignature, getTransportWorkbenchPackOptionsSignature(roadPacks));

  const emptyRender = syncTransportWorkbenchPackSelectOptions({
    selectNode,
    packOptions: [],
    activePackId: "",
  });

  assert.equal(emptyRender.rebuilt, true);
  assert.equal(selectNode.replaceChildrenCallCount, 2);
  assert.equal(selectNode.children.length, 0);
  assert.equal(selectNode.value, "");
  assert.equal(selectNode.disabled, true);
}));

function createShellHarness({ carrierViewState = { quarterTurns: 1 } } = {}) {
  const nodes = {
    body: new TestElement("body"),
    scenarioButton: new TestElement("button"),
    overlay: new TestElement("div"),
    title: new TestElement("h2"),
    lensTitle: new TestElement("h3"),
    familyStatus: new TestElement("div"),
    countryStatus: new TestElement("div"),
    packSelect: new TestSelect(),
    previewMode: new TestElement("div"),
    previewTitle: new TestElement("div"),
    previewCanvas: new TestElement("canvas"),
    previewControls: new TestElement("div"),
    carrierMount: new TestElement("div"),
    layerOrderPanel: new TestElement("div"),
    zoomOutButton: new TestElement("button"),
    zoomInButton: new TestElement("button"),
    rotateButton: new TestElement("button"),
    inspectorTitle: new TestElement("h3"),
    inspectorEmptyTitle: new TestElement("div"),
    inspectorEmptyBody: new TestElement("p"),
    familyTabs: [new TestElement("button"), new TestElement("button")],
    applyButton: new TestElement("button"),
  };
  nodes.familyTabs[0].dataset.transportFamily = "road";
  nodes.familyTabs[1].dataset.transportFamily = "layers";
  const carrierFamilies = [];
  let infoRenderCount = 0;
  const owner = createTransportWorkbenchShellOwner({
    ...nodes,
    translate: (label) => `t:${label}`,
    listPackOptions: ({ familyId }) => familyId === "road" ? roadPacks : [],
    getApplyButtonState: (familyId) => ({
      enabled: familyId === "road",
      label: familyId === "road" ? "Apply road" : "Unavailable",
      reason: familyId === "road" ? "" : "Reserved",
    }),
    getCarrierViewState: () => typeof carrierViewState === "function" ? carrierViewState() : carrierViewState,
    setCarrierFamily: (familyId) => carrierFamilies.push(familyId),
    isInfoPopoverOpen: () => true,
    renderInfoContent: () => {
      infoRenderCount += 1;
    },
  });
  return {
    owner,
    nodes,
    carrierFamilies,
    get infoRenderCount() {
      return infoRenderCount;
    },
  };
}

function createRoadContext() {
  return {
    uiState: {
      open: true,
      sampleCountry: "Japan",
      previewMode: "bounded_zoom_pan",
    },
    family: {
      id: "road",
      title: "Road workbench",
      lensTitle: "Road lens",
      label: "Road",
      previewTitle: "Road preview",
      inspectorEmptyTitle: "No road",
      inspectorEmptyBody: "Select a road.",
      supportsDetailedControls: true,
    },
    activePackId: "japan_road",
    activePackMeta: { country: "Japan" },
    isOpen: true,
    compareHeld: false,
    config: {},
  };
}

test("transport workbench shell owner skips unchanged shell writes", () => withTestDocument(() => {
  const harness = createShellHarness();
  const context = createRoadContext();

  const firstRender = harness.owner.render(context);
  const secondRender = harness.owner.render({ ...context, family: { ...context.family } });

  assert.ok(firstRender.updated > 0);
  assert.equal(secondRender.updated, 0);
  assert.equal(harness.nodes.title.textContent, "t:Road workbench");
  assert.equal(harness.nodes.overlay.getAttribute("aria-hidden"), "false");
  assert.equal(harness.nodes.scenarioButton.getAttribute("aria-expanded"), "true");
  assert.equal(harness.nodes.packSelect.replaceChildrenCallCount, 1);
  assert.equal(harness.nodes.packSelect.value, "japan_road");
  assert.equal(harness.nodes.rotateButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.nodes.familyTabs[0].getAttribute("aria-selected"), "true");
  assert.equal(harness.nodes.applyButton.disabled, false);
  assert.equal(harness.nodes.applyButton.getAttribute("aria-label"), "Apply road");
  assert.deepEqual(harness.carrierFamilies, ["road", "road"]);
  assert.equal(harness.infoRenderCount, 2);
}));

test("transport workbench shell owner updates changed family and preview control state", () => withTestDocument(() => {
  const harness = createShellHarness();
  harness.owner.render(createRoadContext());
  const layersContext = {
    ...createRoadContext(),
    family: {
      id: "layers",
      title: "Layers workbench",
      lensTitle: "Layers lens",
      label: "Layers",
      previewTitle: "Layer order",
      inspectorEmptyTitle: "No layer",
      inspectorEmptyBody: "Use the board.",
      supportsDetailedControls: false,
    },
    activePackId: "",
    activePackMeta: null,
    config: {},
  };

  const changedRender = harness.owner.render(layersContext);

  assert.ok(changedRender.updated > 0);
  assert.equal(harness.nodes.title.textContent, "t:Layers workbench");
  assert.equal(harness.nodes.packSelect.disabled, true);
  assert.equal(harness.nodes.packSelect.value, "");
  assert.equal(harness.nodes.packSelect.replaceChildrenCallCount, 2);
  assert.equal(harness.nodes.previewMode.textContent, "t:Layer order");
  assert.equal(harness.nodes.previewCanvas.classList.contains("is-layer-order-mode"), true);
  assert.equal(harness.nodes.carrierMount.classList.contains("hidden"), true);
  assert.equal(harness.nodes.layerOrderPanel.classList.contains("hidden"), false);
  assert.equal(harness.nodes.familyTabs[1].getAttribute("aria-selected"), "true");
  assert.equal(harness.nodes.applyButton.disabled, true);
  assert.equal(harness.nodes.applyButton.title, "Reserved");
  assert.equal(harness.nodes.applyButton.getAttribute("aria-label"), "Unavailable: Reserved");
}));

test("transport workbench shell owner treats configured quarter turn as the default view", () => withTestDocument(() => {
  let carrierViewState = { quarterTurns: 1, defaultQuarterTurns: 1 };
  const harness = createShellHarness({ carrierViewState: () => carrierViewState });
  const context = createRoadContext();

  harness.owner.render(context);

  assert.equal(harness.nodes.rotateButton.getAttribute("aria-pressed"), "false");
  assert.equal(harness.nodes.rotateButton.classList.contains("is-active"), false);

  carrierViewState = { quarterTurns: 0, defaultQuarterTurns: 1 };
  const changedRender = harness.owner.render(context);

  assert.ok(changedRender.updated > 0);
  assert.equal(harness.nodes.rotateButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.nodes.rotateButton.classList.contains("is-active"), true);
}));
