import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransportWorkbenchLayerOrderRows,
  createTransportWorkbenchLayerOrderOwner,
} from "../js/ui/transport_workbench/transport_workbench_layer_order_owner.js";

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
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.draggable = false;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
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

function textOf(node) {
  return [node.textContent, ...(node.children || []).map(textOf)].join(" ");
}

test("transport workbench layer order rows expose live, metadata, and reserved states", () => {
  const rows = buildTransportWorkbenchLayerOrderRows({
    layerOrder: ["road", "energy_facilities", "custom"],
    getLayerFamilyMeta: (familyId) => ({ id: familyId, label: `${familyId}-label` }),
    isLivePreviewFamily: (familyId) => familyId === "road",
    isManifestOnlyRuntimeFamily: (familyId) => familyId === "energy_facilities",
  });

  assert.deepEqual(rows.map((row) => [row.id, row.label, row.status, row.live]), [
    ["road", "road-label", "Available", true],
    ["energy_facilities", "energy_facilities-label", "Not available yet", false],
    ["custom", "custom-label", "Not available yet", false],
  ]);
  assert.equal(rows[0].caption, "Preview available");
  assert.equal(rows[1].caption, "Not available yet");
  assert.equal(rows[2].caption, "Not available yet");
});

test("transport workbench layer order owner renders rows and live status classes", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const panel = new TestElement("section");
    const list = new TestElement("div");
    const owner = createTransportWorkbenchLayerOrderOwner({
      panel,
      list,
      translate: (value) => `t:${value}`,
      ensureUiState() {},
      getLayerOrder: () => ["road", "energy_facilities", "custom"],
      getLayerFamilyMeta: (familyId) => ({ id: familyId, label: familyId }),
      isLivePreviewFamily: (familyId) => familyId === "road",
      isManifestOnlyRuntimeFamily: (familyId) => familyId === "energy_facilities",
    });

    owner.render();

    assert.equal(list.children.length, 3);
    assert.equal(list.children[0].dataset.layerFamily, "road");
    assert.equal(list.children[0].children[2].classList.contains("is-live"), true);
    assert.match(textOf(list.children[0]), /t:Available/);
    assert.match(textOf(list.children[1]), /t:Not available yet/);
    assert.match(textOf(list.children[2]), /t:Not available yet/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("transport workbench layer order owner keeps drop side effects ordered", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const panel = new TestElement("section");
    const list = new TestElement("div");
    let layerOrder = ["road", "rail", "airport"];
    const events = [];
    const context = {
      family: { id: "layers" },
      config: { sentinel: true },
    };
    const owner = createTransportWorkbenchLayerOrderOwner({
      panel,
      list,
      ensureUiState: () => events.push("ensure"),
      getLayerOrder: () => layerOrder,
      getLayerFamilyMeta: (familyId) => ({ id: familyId, label: familyId }),
      isLivePreviewFamily: (familyId) => familyId === "road",
      moveLayerOrder: (draggedFamilyId, targetFamilyId) => {
        events.push(`move:${draggedFamilyId}->${targetFamilyId}`);
        layerOrder = [draggedFamilyId, ...layerOrder.filter((familyId) => familyId !== draggedFamilyId)];
        return true;
      },
      markDirty: (reason) => events.push(`dirty:${reason}`),
      getRenderContext: () => {
        events.push("context");
        return context;
      },
      renderInspector: (family, config) => events.push(`inspector:${family.id}:${config.sentinel}`),
    });

    owner.render();
    const airportRow = list.children[2];
    const roadRow = list.children[0];
    airportRow.dispatch("dragstart");
    roadRow.dispatch("drop");

    assert.deepEqual(events, [
      "ensure",
      "move:airport->road",
      "dirty:transport-workbench-layer-order",
      "context",
      "ensure",
      "inspector:layers:true",
    ]);
    assert.equal(list.children[0].dataset.layerFamily, "airport");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("transport workbench layer order owner keeps inspector refresh unconditional", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const panel = new TestElement("section");
    const list = new TestElement("div");
    const events = [];
    const owner = createTransportWorkbenchLayerOrderOwner({
      panel,
      list,
      ensureUiState: () => events.push("ensure"),
      getLayerOrder: () => ["road", "rail"],
      getLayerFamilyMeta: (familyId) => ({ id: familyId, label: familyId }),
      moveLayerOrder: (draggedFamilyId, targetFamilyId) => {
        events.push(`move:${draggedFamilyId}->${targetFamilyId}`);
        return true;
      },
      markDirty: (reason) => events.push(`dirty:${reason}`),
      getRenderContext: () => {
        events.push("context");
        return { config: { sentinel: true } };
      },
      renderInspector: (family, config) => events.push(`inspector:${family === undefined}:${config.sentinel}`),
    });

    owner.render();
    list.children[1].dispatch("dragstart");
    list.children[0].dispatch("drop");

    assert.deepEqual(events, [
      "ensure",
      "move:rail->road",
      "dirty:transport-workbench-layer-order",
      "context",
      "ensure",
      "inspector:true:true",
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("transport workbench layer order owner skips failed drop side effects", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    const panel = new TestElement("section");
    const list = new TestElement("div");
    const events = [];
    const owner = createTransportWorkbenchLayerOrderOwner({
      panel,
      list,
      ensureUiState: () => events.push("ensure"),
      getLayerOrder: () => ["road", "rail"],
      getLayerFamilyMeta: (familyId) => ({ id: familyId, label: familyId }),
      moveLayerOrder: (draggedFamilyId, targetFamilyId) => {
        events.push(`move:${draggedFamilyId}->${targetFamilyId}`);
        return false;
      },
      markDirty: (reason) => events.push(`dirty:${reason}`),
      getRenderContext: () => {
        events.push("context");
        return { family: { id: "layers" } };
      },
      renderInspector: () => events.push("inspector"),
    });

    owner.render();
    list.children[1].dispatch("dragstart");
    list.children[0].dispatch("drop");

    assert.deepEqual(events, [
      "ensure",
      "move:rail->road",
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});
