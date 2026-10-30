import assert from "node:assert/strict";
import test from "node:test";
import { createRegionSearchController } from "../js/ui/sidebar/region_search_controller.js";

class FakeElement extends EventTarget {
  constructor(tagName, document) {
    super();
    this.tagName = tagName;
    this.document = document;
    this.children = [];
    this.attributes = new Map();
    this.className = "";
    this.value = "";
    this.textContent = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        const add = force ?? !names.has(name);
        if (add) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren() { this.children = []; }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
  remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
}

function setup({ selected = true } = {}) {
  const document = { createElement: (tag) => new FakeElement(tag, document) };
  const container = document.createElement("div");
  const entries = [
    ["id-z", "Alpha", "AA"],
    ["alpha-id", "Zulu", "AA"],
    ["id-a", "Aardvark alpha", "AA"],
    ["foreign", "Alpha abroad", "BB"],
    ...Array.from({ length: 35 }, (_, i) => [`bulk-${i}`, `Bulk ${String(i).padStart(2, "0")}`, "AA"]),
  ];
  const owners = new Map(entries.map(([id, , owner]) => [id, ` ${owner.toLowerCase()} `]));
  const calls = [];
  const controller = createRegionSearchController({
    documentRef: document,
    state: { landIndex: new Map(entries.map(([id, label, owner]) => [id, {
      label, properties: { cntr_code: owner === "AA" ? "BB" : "AA" },
    }])) },
    t: (key) => key,
    getFeatureOwnerCode: (id) => owners.get(id),
    getFeatureLabel: (feature) => feature.label,
    selectLandFeatureById: (id) => { calls.push(id); return selected; },
  });
  controller.mount(container);
  controller.setCountry(" aa ");
  const block = container.children[0];
  const input = block.children[1].children[0];
  const results = block.children[2];
  const status = block.children[3];
  return {
    controller, container, block, input, results, status, calls, document,
    search(value) { input.value = value; input.dispatchEvent(new Event("input")); },
    key(key) {
      const event = new Event("keydown", { cancelable: true, bubbles: true });
      event.key = key;
      let stopped = false;
      const stop = event.stopPropagation.bind(event);
      event.stopPropagation = () => { stopped = true; stop(); };
      input.dispatchEvent(event);
      return { prevented: event.defaultPrevented, stopped };
    },
    ids() { return results.children.map((node) => node.getAttribute("data-feature-id")); },
  };
}

test("filters by scenario ownership and matches labels and IDs case-insensitively with prefixes first", () => {
  const h = setup();
  h.search("  ALPHA  ");
  assert.deepEqual(h.ids(), ["id-z", "alpha-id", "id-a"]);
  assert.equal(h.status.textContent, "3 matching regions");
  h.search("ID-Z");
  assert.deepEqual(h.ids(), ["id-z"]);
  h.controller.setCountry("BB");
  h.search("alpha");
  assert.deepEqual(h.ids(), ["foreign"]);
});

test("limits results to 30 and appends a disabled refinement hint", () => {
  const h = setup();
  h.search("bulk");
  assert.equal(h.results.children.length, 31);
  const note = h.results.children[30];
  assert.equal(note.getAttribute("aria-disabled"), "true");
  assert.equal(note.textContent, "Showing first 30 matches. Refine the search.");
  assert.equal(h.status.textContent, "35 matching regions");
});

test("arrow navigation wraps, updates ARIA, and Enter selects the active region", () => {
  const h = setup();
  h.search("alpha");
  h.key("ArrowUp");
  assert.equal(h.input.getAttribute("aria-activedescendant"), "regionSearchOption-2");
  h.key("ArrowDown");
  assert.equal(h.results.children[0].getAttribute("aria-selected"), "true");
  assert.equal(h.results.children[2].getAttribute("aria-selected"), "false");
  h.key("Enter");
  assert.deepEqual(h.calls, ["id-z"]);
  assert.equal(h.status.textContent, "Selected Alpha (id-z)");
  assert.equal(h.input.value, "Alpha");
  assert.equal(h.input.getAttribute("aria-expanded"), "false");
  assert.equal(h.input.getAttribute("aria-activedescendant"), null);
  assert.equal(h.document.activeElement, h.input);
});

test("single match is selected by Enter without arrow navigation; multiple matches require an active option", () => {
  const h = setup();
  h.search("alpha");
  h.key("Enter");
  assert.deepEqual(h.calls, []);
  h.search("id-z");
  h.key("Enter");
  assert.deepEqual(h.calls, ["id-z"]);
});

test("Escape closes then clears, consuming only those two steps", () => {
  const h = setup();
  h.search("alpha");
  assert.deepEqual(h.key("Escape"), { prevented: true, stopped: true });
  assert.equal(h.input.value, "alpha");
  assert.equal(h.results.classList.contains("hidden"), true);
  assert.deepEqual(h.key("Escape"), { prevented: true, stopped: true });
  assert.equal(h.input.value, "");
  assert.equal(h.results.children.length, 0);
  assert.deepEqual(h.key("Escape"), { prevented: false, stopped: false });
});

test("same normalized country preserves input and results; a changed or empty country clears", () => {
  const h = setup();
  h.search("alpha");
  h.key("ArrowDown");
  const first = h.results.children[0];
  h.controller.setCountry("AA");
  assert.equal(h.input.value, "alpha");
  assert.equal(h.results.children[0], first);
  assert.equal(h.input.getAttribute("aria-activedescendant"), "regionSearchOption-0");
  h.controller.setCountry("BB");
  assert.equal(h.input.value, "");
  assert.equal(h.results.children.length, 0);
  h.controller.setCountry("");
  assert.equal(h.block.classList.contains("hidden"), true);
});

test("click selects and failure announces that the region is not loaded", () => {
  const h = setup({ selected: false });
  h.search("id-z");
  h.results.children[0].dispatchEvent(new Event("click"));
  assert.deepEqual(h.calls, ["id-z"]);
  assert.equal(h.status.textContent, "Region is not loaded yet.");
  const success = setup();
  success.search("id-z");
  success.results.children[0].dispatchEvent(new Event("click"));
  assert.equal(success.status.textContent, "Selected Alpha (id-z)");
});

test("empty query has no results, no matches is announced, and destroy detaches the UI", () => {
  const h = setup();
  h.search("missing");
  assert.equal(h.status.textContent, "No matching regions");
  h.search("  ");
  assert.equal(h.results.children.length, 0);
  assert.equal(h.status.textContent, "");
  h.controller.destroy();
  assert.equal(h.container.children.length, 0);
  h.search("alpha");
  assert.equal(h.results.children.length, 0);
});

test("matches the source name when the UI shows a translated label", () => {
  const document = { createElement: (tag) => new FakeElement(tag, document) };
  const container = document.createElement("div");
  const controller = createRegionSearchController({
    documentRef: document,
    state: { landIndex: new Map([
      ["DE300", { label: "柏林", properties: { name: "Berlin" } }],
      ["DE600", { label: "汉堡", properties: { name: "Hamburg" } }],
    ]) },
    t: (key) => key,
    getFeatureOwnerCode: () => "GER",
    getFeatureLabel: (feature) => feature.label,
    selectLandFeatureById: () => true,
  });
  controller.mount(container);
  controller.setCountry("GER");
  const block = container.children[0];
  const input = block.children[1].children[0];
  input.value = "ber";
  input.dispatchEvent(new Event("input"));
  const results = block.children[2];
  assert.deepEqual(results.children.map((node) => node.getAttribute("data-feature-id")), ["DE300"]);
  assert.equal(results.children[0].children[1].textContent, "DE300 · Berlin");
  assert.equal(block.children[3].textContent, "1 matching region");
});

test("ignores Enter, arrows, and Escape while an IME composition is active", () => {
  const h = setup();
  h.search("zulu");
  assert.deepEqual(h.ids(), ["alpha-id"]);
  for (const key of ["Enter", "ArrowDown", "Escape"]) {
    const event = new Event("keydown", { cancelable: true, bubbles: true });
    event.key = key;
    event.isComposing = true;
    h.input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(h.calls, []);
  assert.equal(h.input.value, "zulu");
  assert.equal(h.input.getAttribute("aria-expanded"), "true");
});
