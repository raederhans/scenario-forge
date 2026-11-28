import assert from "node:assert/strict";
import test from "node:test";
import { createRegionSearchController } from "../js/ui/sidebar/region_search_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function setup(context) {
  const { doc: document } = harness(context);
  const container = document.createElement("div");
  const entries = [
    ["id-z", "Alpha", "AA"],
    ["alpha-id", "Zulu", "AA"],
    ["id-a", "Aardvark alpha", "AA"],
    ["foreign", "Alpha abroad", "BB"],
  ];
  const owners = new Map(entries.map(([id, , owner]) => [id, ` ${owner.toLowerCase()} `]));
  const controller = createRegionSearchController({
    documentRef: document,
    state: { landIndex: new Map(entries.map(([id, label, owner]) => [id, {
      label, properties: { cntr_code: owner === "AA" ? "BB" : "AA" },
    }])) },
    t: (key) => key,
    getFeatureOwnerCode: (id) => owners.get(id),
    getFeatureLabel: (feature) => feature.label,
  });
  controller.mount(container);
  controller.setCountry(" aa ");
  const block = container.children[0];
  const input = block.children[1].children[0];
  const results = block.children[2];
  return {
    controller,
    search(value) { input.value = value; input.fire("input"); },
    ids() { return results.children.map((node) => node.getAttribute("data-feature-id")); },
  };
}

test("filters by scenario ownership and matches labels and IDs case-insensitively with prefixes first", context => {
  const h = setup(context);
  h.search("  ALPHA  ");
  assert.deepEqual(h.ids(), ["id-z", "alpha-id", "id-a"]);
  h.search("ID-Z");
  assert.deepEqual(h.ids(), ["id-z"]);
  h.controller.setCountry("BB");
  h.search("alpha");
  assert.deepEqual(h.ids(), ["foreign"]);
});

test("matches the source name when the UI shows a translated label", context => {
  const { doc: document } = harness(context);
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
  input.fire("input");
  const results = block.children[2];
  assert.deepEqual(results.children.map((node) => node.getAttribute("data-feature-id")), ["DE300"]);
});
