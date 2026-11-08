import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransportWorkbenchLensRenderSignature,
  createTransportWorkbenchLensOwner,
} from "../js/ui/toolbar/transport_workbench_lens_owner.js";

class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
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
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
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
    return node;
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children = [];
    this.append(...nodes);
  }
}

function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new TestElement(tagName),
    createTextNode(text) {
      const node = new TestElement("#text");
      node.textContent = String(text || "");
      return node;
    },
  };
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

function textOf(node) {
  return [node.textContent, ...(node.children || []).map(textOf)].join(" ");
}

function createOwner(mount, closeEvents = []) {
  return createTransportWorkbenchLensOwner({
    mount,
    closeSectionHelpPopover: (options) => closeEvents.push(options),
    translate: (label) => `t:${label}`,
    pickUiCopy: (_zh, en) => en,
    createRow(label, value) {
      const row = document.createElement("div");
      row.className = "transport-workbench-inspector-row";
      row.textContent = `${label}: ${value}`;
      return row;
    },
    buildLensSummaryRows({ previewSnapshot, rightDeckLabel }) {
      return [
        ["Status", previewSnapshot?.status || "pending"],
        ["Right deck", rightDeckLabel],
      ];
    },
  });
}

test("transport workbench lens owner reuses unchanged rendered lens output", () => withTestDocument(() => {
  const mount = document.createElement("section");
  const closeEvents = [];
  const owner = createOwner(mount, closeEvents);
  const family = {
    id: "road",
    lensBody: "Review road filters.",
    lensNext: "Check map impact.",
  };

  const firstRender = owner.render({
    family,
    previewSnapshot: { status: "ready" },
    compareHeld: false,
    rightDeckLabel: "Deck",
  });
  const secondRender = owner.render({
    family: { ...family },
    previewSnapshot: { status: "ready" },
    compareHeld: false,
    rightDeckLabel: "Deck",
  });

  assert.equal(firstRender.reused, false);
  assert.equal(secondRender.reused, true);
  assert.equal(mount.replaceChildrenCallCount, 1);
  assert.equal(mount.childElementCount, 1);
  assert.doesNotMatch(textOf(mount), /Review focus|Review road filters|Check map impact/);
  assert.equal(closeEvents.length, 2);
  assert.match(textOf(mount), /Status: ready/);

  const deckRender = owner.render({
    family,
    previewSnapshot: { status: "ready" },
    rightDeckLabel: "Updated deck",
  });
  assert.equal(deckRender.reused, false);
  assert.equal(mount.replaceChildrenCallCount, 2);
  assert.match(textOf(mount), /Right deck: Updated deck/);
}));

test("transport workbench lens owner rebuilds when lens family or row content changes", () => withTestDocument(() => {
  const mount = document.createElement("section");
  const owner = createOwner(mount);

  owner.render({
    family: { id: "road", lensBody: "Road body", lensNext: "Road next" },
    previewSnapshot: { status: "ready" },
    rightDeckLabel: "Deck",
  });
  const changedRows = owner.render({
    family: { id: "road", lensBody: "Road body", lensNext: "Road next" },
    previewSnapshot: { status: "error" },
    rightDeckLabel: "Deck",
  });
  const changedFamily = owner.render({
    family: { id: "layers", lensBody: "", lensNext: "" },
    previewSnapshot: { status: "error" },
    rightDeckLabel: "Deck",
  });

  assert.equal(changedRows.reused, false);
  assert.equal(changedFamily.reused, false);
  assert.equal(mount.replaceChildrenCallCount, 3);
  assert.equal(mount.childElementCount, 1);
  assert.match(textOf(mount), /Drag rows to change the drawing order/);

  assert.equal(
    buildTransportWorkbenchLensRenderSignature(owner.buildModel({
      family: { id: "layers" },
    })),
    buildTransportWorkbenchLensRenderSignature(owner.buildModel({
      family: { id: "layers" },
    })),
  );
}));
