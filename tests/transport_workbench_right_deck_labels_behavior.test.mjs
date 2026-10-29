import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransportWorkbenchRightDeckOwner,
} from "../js/ui/toolbar/transport_workbench_right_deck_owner.js";

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
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.delete(token));
    this.node.className = Array.from(values).join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.contains(token) : !!force;
    if (shouldAdd) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldAdd;
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.replaceChildrenCallCount = 0;
  }

  get childElementCount() {
    return this.children.length;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }

  prepend(...nodes) {
    nodes.reverse().forEach((node) => {
      this.children.unshift(node);
      node.parentNode = this;
    });
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    const nextEvent = {
      preventDefault() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(nextEvent);
    }
  }
}

function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
  };
}

function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

function walk(node) {
  return [node, ...(node.children || []).flatMap(walk)];
}

function findByTag(node, tagName) {
  return walk(node).find((candidate) => candidate.tagName === tagName);
}

function findAllByTag(node, tagName) {
  return walk(node).filter((candidate) => candidate.tagName === tagName);
}

function findByText(node, pattern) {
  return walk(node).find((candidate) => pattern.test(candidate.textContent || ""));
}

function findAllByClass(node, className) {
  return walk(node).filter((candidate) => candidate.classList?.contains(className));
}

function textOf(node) {
  return [node.textContent, ...(node.children || []).map(textOf)].join(" ");
}

for (const familyId of ["airport", "port"]) {
  test(`${familyId} point fields retain visible associated labels and edit payloads`, () => withTestDocument(() => {
    const mount = new TestElement();
    const events = [];
    const owner = createTransportWorkbenchRightDeckOwner({
      getPreviewSnapshot: () => ({ selected: { id: "source-1", name: "Selected point", lon: 139.77, lat: 35.68 }, dataRows: [] }),
      addEditOverlayPoint: (...args) => events.push(["add", ...args]),
      updateEditOverlayPoint: (...args) => events.push(["update", ...args]),
    });
    owner.renderTabSections({ id: familyId }, {}, false, "data", mount);
    const form = findAllByClass(mount, "transport-workbench-edit-overlay-form")[0];
    const inputs = findAllByTag(form, "input");
    const labels = findAllByTag(form, "label");
    assert.equal(labels.length, 3);
    assert.deepEqual(labels.map((label) => label.textContent), ["Name", "Longitude", "Latitude"]);
    assert.equal(new Set(inputs.map((input) => input.id)).size, 3);
    inputs.forEach((input, index) => {
      assert.ok(input.id);
      assert.equal(labels[index].htmlFor, input.id);
      assert.equal(input.parentNode, form);
      assert.equal(labels[index].parentNode, form);
    });
    assert.deepEqual(inputs.map((input) => input.value), ["Selected point", "139.77", "35.68"]);
    inputs[0].value = "Renamed point";
    inputs[1].value = "120.5";
    inputs[2].value = "30.25";
    findAllByTag(form, "button").find((button) => button.textContent === "Add point").dispatch("click");
    findAllByTag(form, "button").find((button) => button.textContent === "Save selected").dispatch("click");
    const payload = { name: "Renamed point", lon: "120.5", lat: "30.25" };
    assert.deepEqual(events, [["add", familyId, payload], ["update", familyId, "source-1", payload]]);
    assert.deepEqual(labels.map((label) => label.textContent), ["Name", "Longitude", "Latitude"]);
  }));
}
