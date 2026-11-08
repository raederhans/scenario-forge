import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransportWorkbenchPopoverOwner,
} from "../js/ui/toolbar/transport_workbench_popover_owner.js";

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
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = new Map();
    this.focusCallCount = 0;
    this.replaceChildrenCallCount = 0;
    this.style = {};
    this.offsetWidth = 280;
    this.offsetHeight = 140;
    this.rect = { left: 0, top: 0, right: 360, bottom: 360 };
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(name, callback) {
    this.eventListeners.set(name, callback);
  }

  dispatchEvent(name, event = {}) {
    this.eventListeners.get(name)?.(event);
  }

  focus() {
    this.focusCallCount += 1;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new TestElement(tagName),
  };
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

function createOwner() {
  const panel = new TestElement("section");
  panel.rect = { left: 0, top: 0, right: 360, bottom: 360 };
  const infoButton = new TestElement("button");
  const infoPopover = new TestElement("aside");
  infoPopover.className = "hidden";
  const infoBody = new TestElement("div");
  const sectionHelpPopover = new TestElement("aside");
  sectionHelpPopover.className = "hidden";
  const sectionHelpTitle = new TestElement("div");
  const sectionHelpBody = new TestElement("div");
  let focusedSurface = null;
  let rememberedTrigger = null;
  const owner = createTransportWorkbenchPopoverOwner({
    panel,
    infoButton,
    infoPopover,
    infoBody,
    sectionHelpPopover,
    sectionHelpTitle,
    sectionHelpBody,
    translate: (label) => `t:${label}`,
    pickUiCopy: (_zh, en) => en,
    getDataContract: () => ({
      adapterId: "japan_road_v1",
      packs: ["roads", "road_labels"],
      geometrySource: "OSM",
      hardeningSource: "N06",
    }),
    focusSurface: (surface) => {
      focusedSurface = surface;
    },
    rememberTrigger: (surface, trigger) => {
      rememberedTrigger = { surface, trigger };
    },
  });
  return {
    owner,
    panel,
    infoButton,
    infoPopover,
    infoBody,
    sectionHelpPopover,
    sectionHelpTitle,
    sectionHelpBody,
    get focusedSurface() {
      return focusedSurface;
    },
    get rememberedTrigger() {
      return rememberedTrigger;
    },
  };
}

test("transport workbench popover owner keeps info and section help mutually exclusive", () => withTestDocument(() => {
  const testDom = createOwner();
  const family = {
    id: "road",
    label: "Road",
    lensBody: "Review road filters.",
    lensNext: "Check map impact.",
    supportsDetailedControls: true,
  };

  const infoResult = testDom.owner.toggleInfoPopover(family);
  assert.equal(infoResult.opened, true);
  assert.equal(testDom.infoPopover.classList.contains("hidden"), false);
  assert.equal(testDom.infoButton.getAttribute("aria-expanded"), "true");
  assert.equal(testDom.infoBody.replaceChildrenCallCount, 1);
  assert.equal(testDom.infoBody.children.length, 4);
  assert.equal(testDom.infoBody.children.some((node) => node.children[0].textContent === "t:Data path"), false);
  assert.equal(testDom.infoBody.children[3].children[0].textContent, "t:Capability matrix");
  assert.match(testDom.infoBody.children[3].children[1].textContent, /t:Road: t:main map apply/);
  assert.match(testDom.infoBody.children[3].children[1].textContent, /t:Layers: t:workbench board/);
  assert.equal(testDom.focusedSurface, testDom.infoPopover);
  assert.deepEqual(testDom.rememberedTrigger, {
    surface: testDom.infoPopover,
    trigger: testDom.infoButton,
  });

  const helpButton = testDom.owner.createSectionHelpButton("road", { key: "source_hardening" });
  assert.ok(helpButton);
  helpButton.rect = { left: 320, top: 40, right: 340, bottom: 60 };
  helpButton.dispatchEvent("click", {
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(testDom.infoPopover.classList.contains("hidden"), true);
  assert.equal(testDom.infoButton.getAttribute("aria-expanded"), "false");
  assert.equal(testDom.sectionHelpPopover.classList.contains("hidden"), false);
  assert.equal(testDom.sectionHelpPopover.getAttribute("aria-hidden"), "false");
  assert.equal(helpButton.getAttribute("aria-expanded"), "true");
  assert.equal(testDom.sectionHelpTitle.textContent, "t:Source hardening");
  assert.match(testDom.sectionHelpBody.children[0].textContent, /t:Use official road names and route numbers where available/);
  assert.equal(testDom.sectionHelpPopover.style.left, "30px");
  assert.equal(testDom.sectionHelpPopover.style.top, "36px");

  helpButton.dispatchEvent("click", {
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(testDom.sectionHelpPopover.classList.contains("hidden"), true);
  assert.equal(helpButton.getAttribute("aria-expanded"), "false");
  assert.equal(helpButton.focusCallCount, 1);
}));

test("transport workbench popover owner restores focus and lets Escape close the active popover", () => withTestDocument(() => {
  const testDom = createOwner();
  const family = {
    id: "layers",
    label: "Layers",
    supportsDetailedControls: false,
  };
  let preventDefaultCount = 0;
  const escapeEvent = {
    key: "Escape",
    preventDefault() {
      preventDefaultCount += 1;
    },
  };

  testDom.owner.toggleInfoPopover(family);
  assert.equal(testDom.infoBody.children.length, 2);
  assert.equal(testDom.infoBody.children[0].children[1].textContent, "t:Drag layers in the middle board to change their drawing order.");
  assert.equal(testDom.owner.handleEscape(escapeEvent), true);
  assert.equal(testDom.infoPopover.classList.contains("hidden"), true);
  assert.equal(testDom.infoButton.focusCallCount, 1);
  assert.equal(preventDefaultCount, 1);

  const helpButton = testDom.owner.createSectionHelpButton("rail", { key: "line_presentation" });
  assert.ok(helpButton);
  testDom.owner.toggleSectionHelpPopover(helpButton, "rail", "line_presentation");
  assert.equal(testDom.owner.handleEscape(escapeEvent), true);
  assert.equal(testDom.sectionHelpPopover.classList.contains("hidden"), true);
  assert.equal(helpButton.focusCallCount, 1);
  assert.equal(preventDefaultCount, 2);

  assert.equal(testDom.owner.handleEscape({ key: "Enter", preventDefault() {} }), false);
  assert.equal(testDom.owner.createSectionHelpButton("airport", { key: "source_hardening" }), null);
}));
