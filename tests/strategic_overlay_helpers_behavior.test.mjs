import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createStrategicOverlayHelpersOwner } from "../js/core/renderer/strategic_overlay_helpers.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

// A small SVG DOM surface; the keyed data joins below run the real bundled D3.
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

test("strategic defs use keyed joins, update existing paths, remove stale markers and read replacement defs", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), context);
  const document = { createElementNS: (_ns, tag) => new SvgNode(tag, document) };
  const root = new SvgNode("defs", document);
  const stale = root.appendChild(new SvgNode("marker", document));
  stale.setAttribute("class", "strategic-marker"); stale.__data__ = { id: "retired" };
  let current = context.d3.select(root);
  const owner = createStrategicOverlayHelpersOwner({ groupGetters: { getStrategicDefs: () => current } });
  owner.renderStrategicDefs();
  assert.equal(stale.parentNode, null);
  assert.deepEqual(root.children.map((node) => node.getAttribute("id")), ["strategic-arrow-attack", "strategic-arrow-retreat", "strategic-arrow-supply", "strategic-arrow-naval"]);
  const attack = root.children[0]; const path = attack.children[0];
  assert.equal(attack.getAttribute("orient"), "auto-start-reverse");
  assert.equal(attack.getAttribute("markerUnits"), "strokeWidth");
  path.setAttribute("fill", "wrong"); owner.renderStrategicDefs();
  assert.equal(root.children.length, 4); assert.equal(root.children[0], attack); assert.equal(attack.children[0], path);
  assert.equal(path.getAttribute("fill"), "#7f1d1d");
  assert.equal(path.getAttribute("d"), "M 0 5 L 8 1.8 L 7 5 L 8 8.2 z");
  const replacement = new SvgNode("defs", document); current = context.d3.select(replacement);
  owner.renderStrategicDefs(); assert.equal(replacement.children.length, 4);
  current = null; assert.doesNotThrow(() => owner.renderStrategicDefs());
});

test("unit binding reuses one drag behavior while reading live runtime, projection and group", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "d3");
  t.after(() => previous ? Object.defineProperty(globalThis, "d3", previous) : delete globalThis.d3);
  const events = []; const handlers = {}; let dragBuilds = 0;
  const behavior = () => {};
  behavior.on = (name, handler) => { handlers[name] = handler; return behavior; };
  Object.defineProperty(globalThis, "d3", { configurable: true, value: {
    drag: () => { dragBuilds += 1; return behavior; },
    select: (node) => ({ style: (key, value) => { events.push(["style", node, key, value]); } }),
  } });
  function group(name) {
    return { selectAll: (selector) => {
      assert.equal(selector, "g.unit-counter");
      return { call: (value) => events.push(["bind", name, value]), on: (event, handler) => { handlers[event] = handler; } };
    } };
  }
  let currentGroup = group("first"); let runtimeName = "first"; let allowed = true;
  let coord = [2, 3]; let projected = [20, 30];
  const owner = createStrategicOverlayHelpersOwner({
    groupGetters: { getUnitCountersGroup: () => currentGroup },
    helpers: {
      getStrategicOverlayRuntimeOwner: () => ({
        beginUnitCounterDrag: (counter) => events.push(["start", runtimeName, counter]),
        moveUnitCounterDrag: (counter, point) => { events.push(["move", runtimeName, counter, point]); return allowed; },
        finishUnitCounterDrag: (counter, options) => events.push(["end", runtimeName, counter, options]),
        selectUnitCounterFromRender: (counter) => events.push(["select", runtimeName, counter]),
      }),
      getMapLonLatFromEvent: (event) => { events.push(["coord", event]); return coord; },
      getProjectedPoint: (point) => { events.push(["project", point]); return projected; },
      getUnitCounterNodeTransform: (datum) => `translate(${datum.projected.join(",")})`,
      getLandFeatureIdFromEvent: (event, kind) => { events.push(["hit", event, kind]); return "land"; },
    },
  });
  owner.bindUnitCounterOverlayInteractions(); currentGroup = group("second"); owner.bindUnitCounterOverlayInteractions();
  assert.equal(dragBuilds, 1); assert.equal(events.filter(([name]) => name === "bind").length, 2);
  assert.equal(events.filter(([name]) => name === "bind")[1][1], "second");
  const node = { setAttribute: (...args) => events.push(["attribute", ...args]) };
  const datum = { counter: { id: "unit" }, projected: [0, 0] }; const sourceEvent = {};
  runtimeName = "replacement"; handlers.start.call(node, {}, datum);
  handlers.drag.call(node, { sourceEvent }, datum);
  assert.deepEqual(datum.projected, [20, 30]);
  assert.ok(events.some((event) => event[0] === "start" && event[1] === "replacement"));
  assert.deepEqual(events.find(([name]) => name === "attribute"), ["attribute", "transform", "translate(20,30)"]);
  assert.equal(events.find(([name]) => name === "coord")[1], sourceEvent);
  allowed = false; projected = [40, 50]; handlers.drag.call(node, {}, datum);
  assert.deepEqual(datum.projected, [20, 30]);
  coord = null; const moveCount = events.filter(([name]) => name === "move").length; handlers.drag.call(node, {}, datum);
  assert.equal(events.filter(([name]) => name === "move").length, moveCount);
  handlers.end.call(node, { sourceEvent }, datum); handlers.click({}, datum);
  const hitIndex = events.findIndex(([name]) => name === "hit");
  assert.equal(events[hitIndex - 1][0], "style");
  assert.deepEqual(events[hitIndex + 1], ["end", "replacement", datum.counter, { featureId: "land" }]);
  assert.deepEqual(events.at(-1), ["select", "replacement", datum.counter]);
  currentGroup = null; assert.doesNotThrow(() => owner.bindUnitCounterOverlayInteractions());
});

test("operation labels follow readable open paths, switch modes and fall back when too long", (t) => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), context);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "d3");
  Object.defineProperty(globalThis, "d3", { configurable: true, value: context.d3 });
  t.after(() => previous ? Object.defineProperty(globalThis, "d3", previous) : delete globalThis.d3);
  const document = { createElementNS: (_ns, tag) => new SvgNode(tag, document) };
  const lines = new SvgNode("g", document);
  const graphics = new SvgNode("g", document);
  const line = { id: "a b", points: [[30, 0], [0, 0]], label: "East", labelSize: 14, labelOnPath: true };
  const uLine = { ...line, id: 'a"b', points: [[2, 0], [8, 10], [0, 10], [6, 0]] };
  const state = {
    operationalLines: [line, uLine],
    operationGraphics: [{ ...line, kind: "open" }, { ...uLine, kind: "closed" }],
  };
  const owner = createStrategicOverlayHelpersOwner({
    state,
    groupGetters: {
      getOperationalLinesGroup: () => context.d3.select(lines),
      getOperationGraphicsGroup: () => context.d3.select(graphics),
    },
    helpers: {
      ensureOperationalLineEditorState() {}, renderOperationGraphicsEditorOverlay() {},
      getOperationalLinePreset: () => ({ width: 2, curved: false }),
      getOperationGraphicPreset: kind => ({ width: 2, curved: false, closed: kind === "closed" }),
      projectStrategicPoints: points => points,
      createOperationGraphicPath: points => context.d3.line()(points),
      getOperationGraphicLabelAnchor: () => [12, 8],
    },
  });
  owner.renderOperationalLinesOverlay();
  owner.renderOperationGraphicsOverlay();
  const ids = new Set();
  for (const group of [...lines.children, graphics.children[0]]) {
    const path = group.querySelector("path.operation-label-path");
    const id = path.getAttribute("id");
    assert.match(id, /^[A-Za-z0-9_-]+$/);
    assert.ok(!ids.has(id));
    ids.add(id);
    assert.equal(group.querySelectorAll("textPath").length, 1);
    assert.equal(group.querySelector("textPath").getAttribute("href"), "#" + id);
    assert.equal(group.querySelector("g").getAttribute("transform"), null);
    assert.equal(group.querySelector("rect").getAttribute("display"), "none");
    assert.equal(group.querySelector("text").getAttribute("font-size"), "14");
  }
  assert.equal(lines.children[0].querySelector("path.operation-label-path").getAttribute("d"), "M0,0L30,0");
  assert.equal(lines.children[1].querySelector("path.operation-label-path").getAttribute("d"), "M6,0L0,10L8,10L2,0");
  assert.equal(graphics.children[1].querySelector("textPath"), null);
  line.labelOnPath = false;
  owner.renderOperationalLinesOverlay();
  assert.equal(lines.children[0].querySelector("path.operation-label-path"), null);
  assert.equal(lines.children[0].querySelector("textPath"), null);

  lines.children[1].querySelector("text").getComputedTextLength = () => 100;
  lines.children[1].querySelector("path.operation-label-path").getTotalLength = () => 35;
  uLine.label = "Too long for the path";
  owner.renderOperationalLinesOverlay();
  assert.equal(lines.children[1].querySelector("textPath"), null);
  assert.equal(lines.children[1].querySelector("text").text, uLine.label);
  assert.equal(lines.children[1].querySelector("g").getAttribute("transform"), "translate(12,8)");
  assert.equal(lines.children[1].querySelector("rect").getAttribute("display"), null);
});

for (const [type, collection, editor] of [
  ["OperationalLine", "operationalLines", "operationalLineEditor"],
  ["OperationGraphic", "operationGraphics", "operationGraphicsEditor"],
]) {
  test(`${type} keeps label settings through drawing, selection and updates`, () => {
    const state = {
      operationalLineEditor: { counter: 1 }, operationGraphicsEditor: { counter: 1 },
      strategicOverlayUi: {}, [collection]: [{ id: "legacy", points: [[1, 1], [2, 2]] }],
    };
    const byId = id => state[collection].find(item => item.id === id);
    const owner = createStrategicOverlayRuntimeOwner({ state, helpers: {
      getMapLonLatFromEvent: point => point, getOperationalLineById: byId, getOperationGraphicById: byId,
    } });
    owner[`start${type}Draw`]({ labelSize: 100, labelOnPath: true });
    owner[`append${type}VertexFromEvent`]([0, 0]);
    owner[`append${type}VertexFromEvent`]([1, 1]);
    assert.equal(owner[`finish${type}Draw`](), true);
    const id = state[editor].selectedId;
    assert.equal(byId(id).labelSize, 64);
    assert.equal(byId(id).labelOnPath, true);
    owner[`select${type}ById`]("legacy");
    assert.equal(state[editor].labelSize, 9);
    assert.equal(state[editor].labelOnPath, false);
    owner[`select${type}ById`](id);
    assert.equal(state[editor].labelSize, 64);
    assert.equal(state[editor].labelOnPath, true);
    owner[`updateSelected${type}`]({ labelSize: 1, labelOnPath: false });
    assert.equal(byId(id).labelSize, 4);
    assert.equal(byId(id).labelOnPath, false);
    assert.equal(state[editor].labelSize, 4);
    assert.equal(state[editor].labelOnPath, false);
  });
}
