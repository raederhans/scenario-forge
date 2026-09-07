import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createStrategicOverlayHelpersOwner } from "../js/core/renderer/strategic_overlay_helpers.js";

// A small SVG DOM surface; the keyed data joins below run the real bundled D3.
class SvgNode {
  constructor(tagName, ownerDocument) {
    Object.assign(this, { tagName, ownerDocument, namespaceURI: "http://www.w3.org/2000/svg", parentNode: null, children: [], attributes: new Map() });
  }
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
