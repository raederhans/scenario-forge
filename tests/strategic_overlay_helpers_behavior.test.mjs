import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createStrategicOverlayHelpersOwner } from "../js/core/renderer/strategic_overlay_helpers.js";

class SvgNode {
  constructor(tagName, ownerDocument) {
    Object.assign(this, { tagName, ownerDocument, namespaceURI: "http://www.w3.org/2000/svg", parentNode: null, children: [], attributes: new Map() });
  }
  set textContent(value) {
    for (const child of [...this.children]) this.removeChild(child);
    this.text = value;
  }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, next) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child); child.parentNode = this; return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  querySelectorAll(selector) {
    const [tag, cls] = selector.split(".");
    return this.children.flatMap((child) => [
      ...(child.tagName === tag && (!cls || child.getAttribute("class")?.split(" ").includes(cls)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function renderLabels(t) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), context);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "d3");
  Object.defineProperty(globalThis, "d3", { configurable: true, value: context.d3 });
  t.after(() => previous ? Object.defineProperty(globalThis, "d3", previous) : delete globalThis.d3);
  const document = { createElementNS: (_ns, tag) => new SvgNode(tag, document) };
  const lines = new SvgNode("g", document);
  const line = { id: "a b", points: [[30, 0], [0, 0]], label: "East", labelSize: 14, labelOnPath: true };
  const uLine = { ...line, id: 'a"b', points: [[2, 0], [8, 10], [0, 10], [6, 0]] };
  const state = {
    operationalLines: [line, uLine],
  };
  const owner = createStrategicOverlayHelpersOwner({
    state,
    groupGetters: {
      getOperationalLinesGroup: () => context.d3.select(lines),
    },
    helpers: {
      ensureOperationalLineEditorState() {},
      getOperationalLinePreset: () => ({ width: 2, curved: false }),
      projectStrategicPoints: points => points,
      createOperationGraphicPath: points => context.d3.line()(points),
      getOperationGraphicLabelAnchor: () => [12, 8],
    },
  });
  owner.renderOperationalLinesOverlay();
  return { lines, owner, uLine };
}

test("operation labels follow readable open paths", t => {
  const { lines } = renderLabels(t);
  assert.equal(lines.children[0].querySelector("path.operation-label-path").getAttribute("d"), "M0,0L30,0");
  assert.equal(lines.children[1].querySelector("path.operation-label-path").getAttribute("d"), "M6,0L0,10L8,10L2,0");
});

test("overlong operation labels fall back to the anchor", t => {
  const { lines, owner, uLine } = renderLabels(t);
  lines.children[1].querySelector("text").getComputedTextLength = () => 100;
  lines.children[1].querySelector("path.operation-label-path").getTotalLength = () => 35;
  uLine.label = "Too long for the path";
  owner.renderOperationalLinesOverlay();
  assert.equal(lines.children[1].querySelector("textPath"), null);
  assert.equal(lines.children[1].querySelector("text").text, uLine.label);
  assert.equal(lines.children[1].querySelector("g").getAttribute("transform"), "translate(12,8)");
});
