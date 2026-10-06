import hdiManifest from "../data/thematic_layers/social/human_development_v1/manifest.json" with { type: "json" };
import populationManifest from "../data/thematic_layers/population/wdi_population_v1/manifest.json" with { type: "json" };
import assert from "node:assert/strict";
import test from "node:test";

import { createThematicLayerPreviewController } from "../js/ui/toolbar/thematic_layer_preview_controller.js";
import thematicIndex from "../data/thematic_layers/index.json" with { type: "json" };
import wgiManifest from "../data/thematic_layers/political/wgi_state_capacity_v1/manifest.json" with { type: "json" };
import { normalizeThematicLayerCatalogPayload } from "../js/core/thematic_layer_catalog.js";

class TestClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  toggle(value, force) {
    if (force) {
      this.add(value);
    } else {
      this.values.delete(value);
    }
  }
}

class TestNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.attributes = {};
    this.classList = new TestClassList();
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function createTestDocument() {
  const nodes = {
    thematicLayerCatalogStatus: new TestNode("p"),
    thematicLayerPreviewList: new TestNode("div"),
  };
  return {
    nodes,
    document: {
      createElement: (tagName) => new TestNode(tagName),
      getElementById: (id) => nodes[id] || null,
    },
  };
}

test("preview controller keeps rejected loader values out of rendered text", async () => {
  const previousDocument = globalThis.document;
  const { document, nodes } = createTestDocument();
  globalThis.document = document;

  try {
    const controller = createThematicLayerPreviewController({
      t: (key) => key,
      loadCatalogPreview: async () => {
        throw NaN;
      },
    });

    const preview = await controller.load();
    const emptyText = nodes.thematicLayerPreviewList.children[0]?.textContent || "";
    const renderedText = `${nodes.thematicLayerCatalogStatus.textContent} ${emptyText}`;

    assert.equal(preview.error, "Preview load failed");
    assert.equal(emptyText, "Preview load failed");
    assert.doesNotMatch(renderedText, /\b(?:undefined|null|NaN)\b/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("accepted real-source previews name official scope and omit disabled badges while fixtures remain unavailable", async () => {
  const previousDocument = globalThis.document;
  const { document, nodes } = createTestDocument();
  globalThis.document = document;
  try {
    const controller = createThematicLayerPreviewController({
      t: (key) => key,
      loadCatalogPreview: async () => normalizeThematicLayerCatalogPayload(thematicIndex, {
        manifestByLayerId: {
          political_wgi_state_capacity_v1: wgiManifest,
          social_human_development_v1: hdiManifest,
          population_wdi_population_v1: populationManifest,
        },
      }),
    });
    await controller.load();
    const cards = nodes.thematicLayerPreviewList.children;
    const wgi = cards.find((card) => card.dataset.thematicLayerId === "political_wgi_state_capacity_v1");
    assert.equal(wgi.children[0].children[0].textContent, "WGI governance · Scenario reference");
    assert.match(wgi.children[0].children[1].textContent, /WGI governance · Scenario reference/);
    assert.doesNotMatch(wgi.children[0].children[1].textContent, /Runtime rendering disabled/);
    assert.deepEqual(wgi.children[1].children.map((badge) => badge.textContent), ["Hidden by default"]);
    const hdi = cards.find((card) => card.dataset.thematicLayerId === "social_human_development_v1");
    assert.equal(hdi.children[0].children[0].textContent, "UNDP human development · Scenario reference");
    assert.deepEqual(hdi.children[1].children.map((badge) => badge.textContent), ["Hidden by default"]);
    const population = cards.find((card) => card.dataset.thematicLayerId === "population_wdi_population_v1");
    assert.equal(population.children[0].children[0].textContent, "WDI population · Scenario reference");
    assert.match(population.children[0].children[1].textContent, /WDI population · Scenario reference/);
    assert.doesNotMatch(population.children[0].children[1].textContent, /Runtime rendering disabled/);
    assert.deepEqual(population.children[1].children.map((badge) => badge.textContent), ["Hidden by default"]);
    cards.filter((card) => card !== wgi && card !== hdi && card !== population).forEach((card) => {
      const badges = card.children[1].children.map((badge) => badge.textContent);
      assert.ok(badges.includes("Fixture only"));
      assert.ok(badges.includes("Runtime rendering disabled"));
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test("real-source previews without accepted manifests retain unavailable badges", async () => {
  const previousDocument = globalThis.document;
  const { document, nodes } = createTestDocument();
  globalThis.document = document;
  try {
    const controller = createThematicLayerPreviewController({
      t: (key) => key,
      loadCatalogPreview: async () => normalizeThematicLayerCatalogPayload(thematicIndex),
    });
    await controller.load();
    for (const layerId of ["political_wgi_state_capacity_v1", "social_human_development_v1", "population_wdi_population_v1"]) {
      const card = nodes.thematicLayerPreviewList.children.find((entry) => entry.dataset.thematicLayerId === layerId);
      assert.ok(card.children[1].children.some((badge) => badge.textContent === "Runtime rendering disabled"));
    }
  } finally {
    globalThis.document = previousDocument;
  }
});
