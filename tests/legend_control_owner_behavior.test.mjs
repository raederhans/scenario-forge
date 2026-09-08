import test from "node:test";
import assert from "node:assert/strict";
import { createLegendControlOwner } from "../js/core/renderer/legend_control_owner.js";

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.rebuilds = 0;
    this.classList = {
      toggle: (name, on) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.rebuilds++; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  contains(child) { return this === child || this.children.some((node) => node.contains(child)); }
  setAttribute(key, value) { this.attributes[key] = value; }
  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return key in this.dataset && (match[2] === undefined || this.dataset[key] === match[2]);
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return selector.split(", ").some((part) => this.matches(part)) ? this : this.parent?.closest(selector); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  fire(type, extras = {}) {
    const event = { button: 0, clientX: 30, clientY: 30, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extras };
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
  }
  get offsetWidth() { return parseInt(this.style.width) || 240; }
  get offsetHeight() { return parseInt(this.style.height) || 340; }
  getBoundingClientRect() {
    const left = parseInt(this.style.left) || 0, top = parseInt(this.style.top) || 0;
    return { left, top, right: left + (this.parent ? this.offsetWidth : this.clientWidth), bottom: top + (this.parent ? this.offsetHeight : this.clientHeight) };
  }
}
function harness(t) {
  const previous = globalThis.document;
  const document = new Element("document");
  document.createElement = (tag) => new Element(tag);
  globalThis.document = document;
  t.after(() => { globalThis.document = previous; });
  const h = {
    document, container: new Element(), language: "en", updates: [], modelReads: 0,
    control: { visible: true, collapsed: false, width: 240, height: 340, opacity: 0.9, xRatio: 0, yRatio: 0 },
    model: { colors: ["#ff0000"], labelMap: { "#ff0000": "Red" }, specialZoneLegendLayers: [], activeScenarioId: "", hasScenarioVisualEdits: false },
  };
  h.owner = createLegendControlOwner({
    getMapContainer: () => h.container,
    getLanguage: () => h.language,
    getLegendModel: (colors, labels) => { h.modelReads++; return { ...h.model, colors: colors || h.model.colors, labelMap: labels || h.model.labelMap }; },
    getControlState: () => h.control,
    updateControlState: (patch) => { h.updates.push(patch); Object.assign(h.control, patch); return h.control; },
    toggleControlCollapsed: () => { h.control.collapsed = !h.control.collapsed; return h.control; },
    hideControl: () => { h.control.visible = false; },
    clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  });
  h.render = (...args) => h.owner.renderLegend(...args);
  h.element = () => h.owner.ensureLegendControlElement();
  h.body = () => h.element().querySelector(".map-legend-control-body");
  h.labels = () => h.body().querySelectorAll(".map-legend-label").map((node) => node.textContent);
  return h;
}

test("hidden updates rebuild when shown and unchanged content reuses its rows", (t) => {
  const h = harness(t);
  h.render();
  const first = h.body().children[0];
  h.render();
  assert.equal(h.body().children[0], first);
  h.control.visible = false;
  h.model.labelMap["#ff0000"] = "Updated";
  h.render();
  assert.equal(h.element().hidden, true);
  assert.deepEqual(h.labels(), ["Red"]);
  h.control.visible = true;
  h.render();
  assert.deepEqual(h.labels(), ["Updated"]);
  assert.notEqual(h.body().children[0], first);
});

test("first render while hidden cannot cache an unbuilt body", (t) => {
  const h = harness(t);
  h.control.visible = false;
  h.render();
  assert.equal(h.body().children.length, 0);
  h.control.visible = true;
  h.render();
  assert.deepEqual(h.labels(), ["Red"]);
});

test("new map container builds fresh content even with identical model", (t) => {
  const h = harness(t);
  h.render();
  const oldContainer = h.container, oldElement = h.element();
  h.container = new Element();
  h.render();
  assert.notEqual(h.element(), oldElement);
  assert.deepEqual(h.labels(), ["Red"]);
  assert.equal(oldContainer.contains(oldElement), false);
});

test("language updates refresh special zone sections, headers and handles", (t) => {
  const h = harness(t);
  h.model.specialZoneLegendLayers = [{ id: "zone", name: "Zone", style: { fill: "pink", pattern: "stripes" } }];
  h.render();
  assert.equal(h.body().querySelector(".map-legend-section-title").textContent, "Special Zone Layers");
  h.language = "zh-CN";
  h.render();
  assert.equal(h.body().querySelector(".map-legend-section-title").textContent, "特殊区域图层");
  assert.equal(h.element().querySelector(".map-legend-control-title").textContent, "图例");
  assert.equal(h.element().querySelector('[data-legend-resize="e"]').title, "调整图例宽度");
  assert.equal(h.body().querySelectorAll(".map-legend-swatch")[1].className, "map-legend-swatch has-pattern");
});

test("label delimiters and changes to displayed special zone styles invalidate safely", (t) => {
  const h = harness(t);
  h.model.colors = ["red", "blue"];
  h.model.labelMap = { red: "a|b", blue: "c" };
  h.render();
  h.model.labelMap = { red: "a", blue: "b|c" };
  h.render();
  assert.deepEqual(h.labels(), ["a", "b|c"]);
  h.model.specialZoneLegendLayers = [{ id: "zone", style: { fill: "pink" } }];
  h.render();
  h.model.specialZoneLegendLayers[0].style.fill = "orange";
  h.render();
  assert.equal(h.body().querySelectorAll(".map-legend-swatch")[2].style.backgroundColor, "orange");
});

for (const interaction of ["drag", "resize"]) {
  for (const exit of ["hidden", "empty", "scenario", "close", "container", "no-container"]) {
    test(`${interaction} document listeners stop on ${exit}`, (t) => {
      const h = harness(t);
      h.render();
      const element = h.element();
      const target = element.querySelector(interaction === "drag" ? ".map-legend-control-header" : '[data-legend-resize="se"]');
      target.fire("pointerdown");
      assert.equal(h.document.listeners.get("pointermove").size, 1);
      if (exit === "hidden") h.control.visible = false;
      if (exit === "empty") h.model.colors = [];
      if (exit === "scenario") { h.model.activeScenarioId = "test"; h.model.labelMap = {}; }
      if (exit === "close") element.querySelector('[data-legend-action="close"]').fire("click");
      if (exit === "container") h.container = new Element();
      if (exit === "no-container") h.container = null;
      h.render();
      assert.equal(h.document.listeners.get("pointermove").size, 0);
      assert.equal(h.document.listeners.get("pointerup").size, 0);
      assert.equal(h.document.listeners.get("pointercancel").size, 0);
      assert.ok(!element.className.includes(interaction === "drag" ? "is-dragging" : "is-resizing"));
      h.document.fire("pointermove", { clientX: 100, clientY: 100 });
      assert.deepEqual(h.updates, []);
    });
  }
}

test("drag, resize, opacity and collapse persist control adjustments", (t) => {
  const h = harness(t);
  h.render();
  const element = h.element();
  element.querySelector(".map-legend-control-header").fire("pointerdown");
  h.document.fire("pointermove", { clientX: 60, clientY: 70 });
  assert.ok(h.control.xRatio > 0);
  assert.ok(h.control.yRatio > 0);
  h.document.fire("pointerup");
  element.querySelector('[data-legend-resize="e"]').fire("pointerdown");
  h.document.fire("pointermove", { clientX: 70, clientY: 80 });
  assert.equal(h.control.width, 280);
  assert.equal(h.control.height, 340);
  h.document.fire("pointercancel");
  const opacity = element.querySelector(".map-legend-opacity-input");
  opacity.value = "50";
  opacity.fire("input");
  assert.equal(h.control.opacity, 0.5);
  assert.equal(element.style.opacity, "0.5");
  element.querySelector('[data-legend-action="toggle"]').fire("click");
  assert.equal(h.control.collapsed, true);
  assert.equal(element.style.height, "");
  assert.equal(element.querySelector('[data-legend-action="toggle"]').attributes["aria-label"], "Expand legend");
});
for (const [edge, width, height] of [["s", 240, 390], ["se", 280, 390]]) {
  test(`${edge} handle resizes intended axes and reveals opacity controls`, (t) => {
    const h = harness(t);
    h.render();
    const element = h.element();
    const handle = element.querySelector(`[data-legend-resize="${edge}"]`);
    handle.fire("pointerenter");
    assert.equal(element.querySelector(".map-legend-opacity-panel").hidden, false);
    handle.fire("pointerdown");
    h.document.fire("pointermove", { clientX: 70, clientY: 80 });
    assert.equal(h.control.width, width);
    assert.equal(h.control.height, height);
    h.document.fire("pointerup");
    element.fire("pointerleave");
    assert.equal(element.querySelector(".map-legend-opacity-panel").hidden, true);
  });
}


test("hidden legend skips model reads and unchanged layout performs no style writes", (t) => {
  const h = harness(t);
  h.control.visible = false;
  h.render();
  h.render();
  assert.equal(h.modelReads, 0);
  h.control.visible = true;
  h.render();
  let writes = 0;
  h.element().style = new Proxy(h.element().style, {
    set(target, key, value) { writes++; target[key] = value; return true; },
  });
  h.render();
  assert.equal(writes, 0);
  h.control.width = 280;
  h.render();
  assert.equal(h.element().style.width, "280px");
  assert.ok(writes > 0);
});


test("unchanged visible legend header avoids repeated text writes but language and collapse refresh", t => {
  const h = harness(t);
  h.render();
  const title = h.element().querySelector(".map-legend-control-title");
  let text = title.textContent, writes = 0;
  Object.defineProperty(title, "textContent", { get: () => text, set(value) { writes++; text = value; } });
  h.render();
  h.render();
  assert.equal(writes, 0);
  h.language = "zh";
  h.render();
  assert.equal(writes, 1);
  assert.equal(text, "图例");
  h.control.collapsed = true;
  h.render();
  assert.equal(writes, 2);
  assert.ok(h.element().className.includes("is-collapsed"));
});
