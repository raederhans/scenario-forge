import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const PUBLIC_SCENARIO_IDS = [
  "blank_base",
  "modern_world",
  "hoi4_1936",
  "hoi4_1939",
  "tno_1962",
];

function readJsonAsset(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

function resolveMarkerPath(value, expression) {
  let current = value;
  for (const segment of expression.split(".")) {
    if (segment === "length") {
      assert.ok(
        typeof current === "string" || Array.isArray(current),
        `marker segment length requires an array or string for ${expression}`,
      );
      current = current.length;
      continue;
    }
    assert.ok(current && Object.hasOwn(current, segment), `marker segment missing: ${expression}`);
    current = current[segment];
  }
  return current;
}

function resolveStatMarker(marker) {
  const [assetPath, expression] = marker.split(":");
  assert.ok(assetPath && expression, `invalid stat marker: ${marker}`);
  const asset = readJsonAsset(assetPath);
  return expression
    .split("+")
    .map((part) => resolveMarkerPath(asset, part))
    .reduce((total, value) => total + Number(value), 0);
}

function parseAttributes(source) {
  const attributes = new Map();
  const attributePattern = /\s([a-zA-Z0-9:-]+)="([^"]*)"/g;
  for (const match of source.matchAll(attributePattern)) {
    attributes.set(match[1], match[2]);
  }
  return attributes;
}

function extractLandingStats(html) {
  const stats = new Map();
  const statPattern = /<span\b([^>]*\bclass="stat-card__value"[^>]*)>([^<]*)<\/span>/g;
  for (const match of html.matchAll(statPattern)) {
    const attributes = parseAttributes(match[1]);
    const statId = attributes.get("data-stat-id");
    if (!statId) continue;
    stats.set(statId, {
      source: attributes.get("data-stat-source"),
      text: match[2].trim(),
      value: Number(attributes.get("data-stat-value")),
    });
  }
  return stats;
}

function extractStoryEvidence(html) {
  const evidence = new Map();
  const evidencePattern =
    /<div\b([^>]*\bdata-story-evidence="[^"]+"[^>]*)>\s*<dt\b[^>]*>[^<]*<\/dt>\s*<dd\b([^>]*)>([^<]*)<\/dd>/g;
  for (const match of html.matchAll(evidencePattern)) {
    const itemAttributes = parseAttributes(match[1]);
    const valueAttributes = parseAttributes(match[2]);
    const evidenceId = itemAttributes.get("data-story-evidence");
    if (!evidenceId) continue;
    evidence.set(evidenceId, {
      source: itemAttributes.get("data-story-evidence-source"),
      text: match[3].trim(),
      value: Number(valueAttributes.get("data-story-evidence-value")),
    });
  }
  return evidence;
}

function extractSampleRuns(html) {
  const runs = new Map();
  const cardPattern = /<article\b([^>]*\bdata-sample-run-card\b[^>]*)>([\s\S]*?)<\/article>/g;
  for (const match of html.matchAll(cardPattern)) {
    const cardAttributes = parseAttributes(match[1]);
    const runId = cardAttributes.get("data-sample-run-id");
    if (!runId) continue;

    const imageMatch = match[2].match(/<img\b([^>]*)>/);
    const imageAttributes = parseAttributes(imageMatch?.[1] || "");
    const openLinkMatch = match[2].match(/<a\b([^>]*\bdata-sample-project-open-link\b[^>]*)>/);
    const projectLinkMatch = match[2].match(/<a\b([^>]*\bdata-sample-project-link\b[^>]*)>/);
    const manifestLinkMatch = match[2].match(/<a\b([^>]*\bdata-sample-manifest-link\b[^>]*)>/);
    const evidence = new Map();
    const evidencePattern =
      /<div\b([^>]*\bdata-sample-evidence="[^"]+"[^>]*)>\s*<dt\b[^>]*>[^<]*<\/dt>\s*<dd\b([^>]*)>([^<]*)<\/dd>/g;
    for (const evidenceMatch of match[2].matchAll(evidencePattern)) {
      const evidenceAttributes = parseAttributes(evidenceMatch[1]);
      const valueAttributes = parseAttributes(evidenceMatch[2]);
      const evidenceId = evidenceAttributes.get("data-sample-evidence");
      if (!evidenceId) continue;
      evidence.set(evidenceId, {
        source: evidenceAttributes.get("data-sample-evidence-source"),
        text: evidenceMatch[3].trim(),
        value: Number(valueAttributes.get("data-sample-evidence-value")),
      });
    }

    runs.set(runId, {
      evidence,
      image: imageAttributes.get("src"),
      manifestLink: parseAttributes(manifestLinkMatch?.[1] || "").get("href"),
      metadata: cardAttributes.get("data-sample-metadata"),
      openLink: parseAttributes(openLinkMatch?.[1] || "").get("href"),
      project: cardAttributes.get("data-sample-project"),
      projectLink: parseAttributes(projectLinkMatch?.[1] || "").get("href"),
      scenario: cardAttributes.get("data-sample-scenario"),
      tags: String(cardAttributes.get("data-sample-tags") || "").split(/\s+/).filter(Boolean),
    });
  }
  return runs;
}

function extractSampleRunsManifestUrl(html) {
  const sectionMatch = html.match(/<section\b([^>]*\bid="sample-runs"[^>]*)>/);
  const attributes = parseAttributes(sectionMatch?.[1] || "");
  return attributes.get("data-sample-runs-manifest");
}

function extractSampleProjectListLinks(html) {
  const links = new Map();
  const linkPattern = /<a\b([^>]*\bdata-sample-project-list-link\b[^>]*)>/g;
  for (const match of html.matchAll(linkPattern)) {
    const attributes = parseAttributes(match[1]);
    const href = attributes.get("href");
    if (!href) continue;
    links.set(href, {
      id: attributes.get("data-sample-project-id"),
      scenario: attributes.get("data-sample-scenario"),
    });
  }
  return links;
}

function extractSampleProjectOpenLinks(html) {
  const links = new Set();
  const linkPattern = /<a\b([^>]*\bdata-sample-project-open-link\b[^>]*)>/g;
  for (const match of html.matchAll(linkPattern)) {
    const attributes = parseAttributes(match[1]);
    const href = attributes.get("href");
    if (href) links.add(href);
  }
  return links;
}

function getExpectedLandingStats() {
  const scenarioIndex = readJsonAsset("data/scenarios/index.json");
  const scenarioIds = new Set((scenarioIndex.scenarios || []).map((scenario) => scenario.scenario_id));
  assert.deepEqual(scenarioIndex.public_baseline_ids, PUBLIC_SCENARIO_IDS);
  for (const scenarioId of PUBLIC_SCENARIO_IDS) {
    assert.ok(scenarioIds.has(scenarioId), `missing public scenario baseline: ${scenarioId}`);
  }
  assert.deepEqual(scenarioIndex.developer_preview_ids, ["hgo_1936"]);
  assert.ok(scenarioIds.has("hgo_1936"), "HGO 1936 should stay available as a developer/local preview");

  return new Map([
    [
      "public-baselines",
      {
        source: "data/scenarios/index.json:public_baseline_ids.length",
      },
    ],
    [
      "world-city-points",
      {
        source: "data/world_cities.geojson:features.length",
      },
    ],
    [
      "city-aliases",
      {
        source: "data/city_aliases.json:alias_count",
      },
    ],
    [
      "catalog-assets",
      {
        source: "data/CATALOG.json:counts.entries",
      },
    ],
    [
      "japan-transport-features",
      {
        source: "landing/assets/japan-preview.json:counts.road_source_features+counts.rail_source_features",
      },
    ],
  ].map(([statId, expected]) => [
    statId,
    {
      ...expected,
      value: resolveStatMarker(expected.source),
    },
  ]));
}

class TestClassList {
  toggle() {}
  add() {}
}

class TestNode {
  constructor() {
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = new Map();
    this.classList = new TestClassList();
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = String(value);
      },
    };
    this.textContent = "";
  }

  addEventListener(name, callback) {
    const callbacks = this.eventListeners.get(name) || [];
    callbacks.push(callback);
    this.eventListeners.set(name, callbacks);
  }

  dispatchEvent(name, event = {}) {
    const callbacks = this.eventListeners.get(name) || [];
    event.currentTarget = this;
    callbacks.forEach((callback) => callback(event));
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  focus() {
    this.focused = true;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class ShowcaseRoot extends TestNode {
  constructor(objectNode, tabs, panel, status = new TestNode()) {
    super();
    this.objectNode = objectNode;
    this.tabs = tabs;
    this.panel = panel;
    this.status = status;
    this.status.hidden = true;
  }

  querySelector(selector) {
    if (selector === "[data-showcase-object]") return this.objectNode;
    if (selector === "[role=\"tabpanel\"]") return this.panel;
    if (selector === "[data-showcase-status]") return this.status;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-showcase-view-action]") return [];
    if (selector === "[data-showcase-layer-tab]") return this.tabs;
    return [];
  }
}

class PreviewRoot extends TestNode {
  constructor(surface, viewport, zoomButtons = [], images = [], status = new TestNode(), tabs = []) {
    super();
    this.surface = surface;
    this.viewport = viewport;
    this.zoomButtons = zoomButtons;
    this.images = images;
    this.status = status;
    this.tabs = tabs;
    this.status.hidden = true;
  }

  querySelector(selector) {
    if (selector === "[data-preview-surface]") return this.surface;
    if (selector === "[data-preview-viewport]") return this.viewport;
    if (selector === "[data-preview-status]") return this.status;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-preview-zoom]") return this.zoomButtons;
    if (selector === "[data-preview-image]") return this.images;
    if (selector === "[data-preview-tab]") return this.tabs;
    return [];
  }
}

class ProductStoryRoot extends TestNode {
  constructor({ stageImage, badge, title, body, stepButtons, compareButtons, evidenceItems }) {
    super();
    this.stageImage = stageImage;
    this.badge = badge;
    this.title = title;
    this.body = body;
    this.stepButtons = stepButtons;
    this.compareButtons = compareButtons;
    this.evidenceItems = evidenceItems;
  }

  querySelector(selector) {
    if (selector === "[data-story-stage-image]") return this.stageImage;
    if (selector === "[data-story-stage-badge]") return this.badge;
    if (selector === "[data-story-stage-title]") return this.title;
    if (selector === "[data-story-stage-body]") return this.body;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-story-step-button]") return this.stepButtons;
    if (selector === "[data-story-compare]") return this.compareButtons;
    if (selector === "[data-story-evidence]") return this.evidenceItems;
    return [];
  }
}

class SampleRunsRoot extends TestNode {
  constructor(filterButtons, cards) {
    super();
    this.filterButtons = filterButtons;
    this.cards = cards;
  }

  querySelectorAll(selector) {
    if (selector === "[data-sample-run-filter]") return this.filterButtons;
    if (selector === "[data-sample-run-card]") return this.cards;
    return [];
  }
}

function createEvent(overrides = {}) {
  return {
    defaultPrevented: false,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...overrides,
  };
}

function createPreviewHarness({ preFailedMode } = {}) {
  const surface = new TestNode();
  const viewport = new TestNode();
  const images = ["transport", "cities", "terrain", "night"].map((mode) => {
    const image = new TestNode();
    image.setAttribute("data-preview-image", mode);
    image.setAttribute("src", `./assets/japan-preview-${mode}.webp`);
    if (mode === preFailedMode) {
      image.complete = true;
      image.naturalWidth = 0;
    }
    return image;
  });
  const status = new TestNode();
  const tabs = ["transport", "cities", "terrain", "night"].map((mode) => {
    const tab = new TestNode();
    tab.setAttribute("data-preview-tab", mode);
    return tab;
  });
  const panels = tabs.map((tab) => {
    const panel = new TestNode();
    panel.setAttribute("data-preview-panel", tab.getAttribute("data-preview-tab"));
    return panel;
  });
  const root = new PreviewRoot(surface, viewport, [], images, status, tabs);
  const domContentLoaded = [];
  surface.setPointerCapture = () => {};
  surface.releasePointerCapture = () => {};

  const document = {
    documentElement: { lang: "en", dataset: {} },
    title: "",
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") domContentLoaded.push(callback);
    },
    querySelector(selector) {
      if (selector === "[data-preview-root]") return root;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-preview-panel]") return panels;
      return [];
    },
  };

  return {
    context: {
      console,
      document,
      Intl,
      localStorage: {
        getItem: () => "en",
        setItem: () => {},
      },
      matchMedia: () => ({ matches: true }),
    },
    domContentLoaded,
    root,
    surface,
    viewport,
    images,
    status,
    tabs,
    panels,
  };
}

function createShowcaseHarness({ reducedMotion = true, fetchImpl } = {}) {
  const viewport = new TestNode();
  const svg = new TestNode();
  const objectNode = new TestNode();
  const panel = new TestNode();
  const status = new TestNode();
  const tabs = ["political", "rail", "cities", "day-night"].map((layer, index) => {
    const tab = new TestNode();
    tab.id = `showcase-layer-${layer}`;
    tab.setAttribute("data-showcase-layer-tab", layer);
    tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
    return tab;
  });
  const root = new ShowcaseRoot(objectNode, tabs, panel, status);
  const domContentLoaded = [];
  svg.animationCalls = [];
  svg.pauseAnimations = () => svg.animationCalls.push("pause");
  svg.unpauseAnimations = () => svg.animationCalls.push("unpause");

  objectNode.contentDocument = {
    querySelector(selector) {
      if (selector === "svg") return svg;
      if (selector === "[data-showcase-viewport]") return viewport;
      return null;
    },
  };
  objectNode.setPointerCapture = () => {};
  objectNode.releasePointerCapture = () => {};
  svg.setPointerCapture = () => {};
  svg.releasePointerCapture = () => {};

  const document = {
    documentElement: { lang: "en", dataset: {} },
    title: "",
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") domContentLoaded.push(callback);
    },
    querySelector(selector) {
      if (selector === "[data-showcase-root]") return root;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  return {
    context: {
      console,
      document,
      Intl,
      localStorage: {
        getItem: () => "en",
        setItem: () => {},
      },
      matchMedia: () => ({ matches: reducedMotion }),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    },
    domContentLoaded,
    objectNode,
    panel,
    root,
    svg,
    tabs,
    status,
    viewport,
  };
}

function createProductStoryHarness({ reducedMotion = true } = {}) {
  const domContentLoaded = [];
  const stageImage = new TestNode();
  const badge = new TestNode();
  const title = new TestNode();
  const body = new TestNode();
  const stepButtons = ["baseline", "scenario", "transport", "evidence", "export"].map((stepId, index) => {
    const button = new TestNode();
    button.setAttribute("data-story-step-button", stepId);
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    return button;
  });
  const compareButtons = ["hoi4-1936", "hoi4-1939", "tno-1962"].map((comparisonId, index) => {
    const button = new TestNode();
    button.setAttribute("data-story-compare", comparisonId);
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    return button;
  });
  const evidenceItems = ["baseline", "scenario", "transport", "evidence", "export"].map((stepId) => {
    const item = new TestNode();
    item.setAttribute("data-story-evidence", stepId);
    return item;
  });
  const root = new ProductStoryRoot({ stageImage, badge, title, body, stepButtons, compareButtons, evidenceItems });
  root.dataset.storyStep = "baseline";
  root.dataset.storyComparison = "hoi4-1936";

  const document = {
    documentElement: { lang: "en", dataset: {} },
    title: "",
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") domContentLoaded.push(callback);
    },
    querySelector(selector) {
      if (selector === "[data-story-root]") return root;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  return {
    context: {
      console,
      document,
      Intl,
      localStorage: {
        getItem: () => "en",
        setItem: () => {},
      },
      matchMedia: () => ({ matches: reducedMotion }),
    },
    badge,
    body,
    compareButtons,
    domContentLoaded,
    evidenceItems,
    root,
    stageImage,
    stepButtons,
    title,
  };
}

function createSampleRunsGalleryHarness({ reducedMotion = true } = {}) {
  const domContentLoaded = [];
  const filterButtons = ["all", "scenario", "transport", "atlas", "evidence"].map((filter, index) => {
    const button = new TestNode();
    button.setAttribute("data-sample-run-filter", filter);
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    return button;
  });
  const cards = [
    ["tno-atlantropa-mediterranean", "scenario evidence"],
    ["hoi4-europe-comparison", "scenario evidence"],
    ["japan-tokaido-corridor", "transport atlas evidence"],
  ].map(([id, tags]) => {
    const card = new TestNode();
    card.setAttribute("data-sample-run-id", id);
    card.setAttribute("data-sample-tags", tags);
    return card;
  });
  const root = new SampleRunsRoot(filterButtons, cards);
  root.dataset.sampleFilter = "all";

  const document = {
    documentElement: { lang: "en", dataset: {} },
    title: "",
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") domContentLoaded.push(callback);
    },
    querySelector(selector) {
      if (selector === "[data-sample-runs-root]") return root;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  return {
    cards,
    context: {
      console,
      document,
      Intl,
      localStorage: {
        getItem: () => "en",
        setItem: () => {},
      },
      matchMedia: () => ({ matches: reducedMotion }),
    },
    domContentLoaded,
    filterButtons,
    root,
  };
}

test("landing local asset references exist", () => {
  const html = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const referencedAssets = new Set();
  const assetPattern = /\.\/assets\/[^"')\s]+/g;

  for (const source of [html, app]) {
    for (const match of source.matchAll(assetPattern)) {
      referencedAssets.add(match[0]);
    }
  }

  assert.ok(referencedAssets.size > 0, "expected landing page to reference local assets");
  for (const assetPath of referencedAssets) {
    const assetUrl = new URL(`../landing/${assetPath.slice(2)}`, import.meta.url);
    assert.ok(existsSync(assetUrl), `missing landing asset referenced by HTML/JS: ${assetPath}`);
  }
});

test("landing stat cards stay aligned with source data", () => {
  const expectedStats = getExpectedLandingStats();
  for (const assetRoot of ["landing", "dist"]) {
    const html = readFileSync(new URL(`../${assetRoot}/index.html`, import.meta.url), "utf8");
    const actualStats = extractLandingStats(html);

    assert.deepEqual([...actualStats.keys()].sort(), [...expectedStats.keys()].sort(), `${assetRoot} stat ids drifted`);
    for (const [statId, expected] of expectedStats) {
      const actual = actualStats.get(statId);
      assert.equal(actual.source, expected.source, `${assetRoot}/${statId} source marker drifted`);
      assert.equal(actual.value, expected.value, `${assetRoot}/${statId} data-stat-value drifted`);
      assert.equal(actual.text, String(expected.value), `${assetRoot}/${statId} visible value drifted`);
    }
  }
});

test("landing product story evidence markers resolve to checked-in metadata", () => {
  const expectedEvidence = new Map([
    ["baseline", "data/scenarios/index.json:public_baseline_ids.length"],
    ["scenario", "landing/assets/europe-1936-showcase.json:counts.political_features"],
    ["transport", "landing/assets/japan-preview.json:counts.road_source_features+counts.rail_source_features"],
    ["evidence", "data/CATALOG.json:counts.entries"],
    ["export", "landing/assets/work-atlas-japan-corridor.json:counts.road_lines+counts.rail_lines+counts.major_stations"],
  ]);

  for (const assetRoot of ["landing", "dist"]) {
    const html = readFileSync(new URL(`../${assetRoot}/index.html`, import.meta.url), "utf8");
    const actualEvidence = extractStoryEvidence(html);

    assert.deepEqual([...actualEvidence.keys()].sort(), [...expectedEvidence.keys()].sort(), `${assetRoot} story evidence ids drifted`);
    for (const [evidenceId, expectedSource] of expectedEvidence) {
      const actual = actualEvidence.get(evidenceId);
      const expectedValue = resolveStatMarker(expectedSource);
      assert.equal(actual.source, expectedSource, `${assetRoot}/${evidenceId} source marker drifted`);
      assert.equal(actual.value, expectedValue, `${assetRoot}/${evidenceId} data-story-evidence-value drifted`);
      assert.equal(actual.text, String(expectedValue), `${assetRoot}/${evidenceId} visible value drifted`);
    }
  }
});

test("landing product story controls initialize and change stage state", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createProductStoryHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);

  assert.equal(harness.domContentLoaded.length, 1);
  harness.domContentLoaded[0]();

  assert.equal(harness.root.dataset.storyStep, "baseline");
  assert.equal(harness.root.dataset.storyComparison, "hoi4-1936");
  assert.equal(harness.stageImage.attributes.src, "./assets/hero-hoi4-1936.webp");
  assert.equal(harness.stageImage.alt, "Generated HOI4 1936 baseline map.");
  assert.equal(harness.evidenceItems[0].dataset.storyEvidenceActive, "true");

  harness.stepButtons.find((button) => button.getAttribute("data-story-step-button") === "transport").dispatchEvent("click");
  assert.equal(harness.root.dataset.storyStep, "transport");
  assert.equal(harness.stageImage.attributes.src, "./assets/japan-preview-transport.webp");
  assert.equal(harness.title.textContent, "Transport and geography turn the map into a readable place.");
  assert.equal(harness.evidenceItems[2].dataset.storyEvidenceActive, "true");

  harness.compareButtons.find((button) => button.getAttribute("data-story-compare") === "hoi4-1939").dispatchEvent("click");
  assert.equal(harness.root.dataset.storyStep, "scenario");
  assert.equal(harness.root.dataset.storyComparison, "hoi4-1939");
  assert.equal(harness.stageImage.attributes.src, "./assets/hero-hoi4-1939.webp");
  assert.equal(harness.stepButtons[1].attributes["aria-current"], "step");
  assert.equal(harness.compareButtons[1].attributes["aria-pressed"], "true");
  assert.equal(harness.evidenceItems[1].dataset.storyEvidenceActive, "true");
});

test("landing product story keyboard navigation works", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createProductStoryHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  const nextStepEvent = createEvent({ key: "ArrowRight" });
  harness.stepButtons[0].dispatchEvent("keydown", nextStepEvent);
  assert.equal(nextStepEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.storyStep, "scenario");
  assert.equal(harness.stepButtons[1].focused, true);

  harness.stepButtons[1].dispatchEvent("keydown", createEvent({ key: "End" }));
  assert.equal(harness.root.dataset.storyStep, "export");
  assert.equal(harness.stepButtons[4].focused, true);
  assert.equal(harness.stageImage.attributes.src, "./assets/work-atlas-japan-corridor.webp");

  const nextComparisonEvent = createEvent({ key: "ArrowRight" });
  harness.compareButtons[0].dispatchEvent("keydown", nextComparisonEvent);
  assert.equal(nextComparisonEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.storyStep, "scenario");
  assert.equal(harness.root.dataset.storyComparison, "hoi4-1939");
  assert.equal(harness.compareButtons[1].focused, true);
  assert.equal(harness.stageImage.attributes.src, "./assets/hero-hoi4-1939.webp");
});

test("landing product story reduced-motion path does not require observer animation", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createProductStoryHarness({ reducedMotion: true });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  harness.stepButtons.find((button) => button.getAttribute("data-story-step-button") === "export").dispatchEvent("click");
  assert.equal(harness.root.dataset.storyStep, "export");
  assert.equal(harness.stageImage.attributes.src, "./assets/work-atlas-japan-corridor.webp");
  assert.equal(harness.evidenceItems[4].dataset.storyEvidenceActive, "true");
});

test("landing sample runs resolve checked-in assets and evidence markers", () => {
  const expectedRuns = new Map([
    [
      "tno-atlantropa-mediterranean",
      {
        image: "./assets/work-alt-history-med.webp",
        metadata: "./assets/work-alt-history-med.json",
        open: "./app/?sample=tno-1962-atlantropa-briefing&view=guide",
        project: "./assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
        scenario: "tno_1962",
        tags: ["scenario", "evidence"],
        evidence: new Map([
          ["tno-atlantropa-features", "landing/assets/work-alt-history-med.json:counts.rendered_atlantropa_features"],
          ["tno-owner-count", "landing/assets/work-alt-history-med.json:counts.dissolved_country_owners"],
        ]),
      },
    ],
    [
      "hoi4-europe-comparison",
      {
        image: "./assets/work-scenario-switch-europe.webp",
        metadata: "./assets/work-scenario-switch-europe.json",
        open: "./app/?sample=hoi4-1936-europe-briefing&view=guide",
        project: "./assets/sample-projects/hoi4-1936-europe-briefing.project.json",
        scenario: "hoi4_1936",
        tags: ["scenario", "evidence"],
        evidence: new Map([
          ["hoi4-1936-features", "landing/assets/work-scenario-switch-europe.json:counts.hoi4_1936_political_features"],
          ["hoi4-1939-features", "landing/assets/work-scenario-switch-europe.json:counts.hoi4_1939_political_features"],
        ]),
      },
    ],
    [
      "japan-tokaido-corridor",
      {
        image: "./assets/work-atlas-japan-corridor.webp",
        metadata: "./assets/work-atlas-japan-corridor.json",
        open: "./app/?sample=modern-world-japan-corridor&view=guide",
        project: "./assets/sample-projects/modern-world-japan-corridor.project.json",
        scenario: "modern_world",
        tags: ["transport", "atlas", "evidence"],
        evidence: new Map([
          ["japan-transport-lines", "landing/assets/work-atlas-japan-corridor.json:counts.road_lines+counts.rail_lines"],
          ["japan-stations", "landing/assets/work-atlas-japan-corridor.json:counts.major_stations"],
        ]),
      },
    ],
  ]);

  for (const assetRoot of ["landing", "dist"]) {
    const html = readFileSync(new URL(`../${assetRoot}/index.html`, import.meta.url), "utf8");
    const actualRuns = extractSampleRuns(html);
    const sampleRunsManifestUrl = extractSampleRunsManifestUrl(html);
    const sampleRunsManifestPath = new URL(`../${assetRoot}/${sampleRunsManifestUrl.slice(2)}`, import.meta.url);
    assert.equal(sampleRunsManifestUrl, "./assets/sample-runs.json", `${assetRoot} sample manifest URL drifted`);
    assert.ok(existsSync(sampleRunsManifestPath), `missing ${assetRoot} sample-runs manifest`);
    const sampleRunsManifest = JSON.parse(readFileSync(sampleRunsManifestPath, "utf8"));
    const manifestRuns = new Map(sampleRunsManifest.featured_runs.map((run) => [run.id, run]));
    const sampleProjects = new Map(sampleRunsManifest.sample_projects.map((project) => [project.project_url, project]));
    const sampleProjectListLinks = extractSampleProjectListLinks(html);
    const sampleProjectOpenLinks = extractSampleProjectOpenLinks(html);
    assert.ok(html.includes("Open editable sample"), `${assetRoot} editable sample CTA copy missing`);
    assert.ok(html.includes("Download JSON"), `${assetRoot} short download CTA copy missing`);
    assert.ok(html.includes("View recipe"), `${assetRoot} recipe CTA copy missing`);
    assert.ok(
      html.includes("Editor links open the sample with the Guide panel"),
      `${assetRoot} sample guide note missing`,
    );
    assert.deepEqual(sampleRunsManifest.public_scenario_ids, PUBLIC_SCENARIO_IDS);
    assert.deepEqual(sampleRunsManifest.developer_preview_exclusions, ["hgo_1936"]);
    assert.equal(sampleRunsManifest.project_schema_version, 22);
    assert.deepEqual(
      [...sampleProjectListLinks.keys()].sort(),
      [...sampleProjects.keys()].sort(),
      `${assetRoot} sample project list links drifted from manifest`,
    );
    for (const [projectUrl, project] of sampleProjects) {
      const listLink = sampleProjectListLinks.get(projectUrl);
      const sampleOpenPath = `./app/?sample=${project.id}&view=guide`;
      assert.equal(listLink.id, project.id, `${assetRoot}/${project.id} project list id drifted`);
      assert.equal(listLink.scenario, project.scenario_id, `${assetRoot}/${project.id} project list scenario drifted`);
      assert.ok(sampleProjectOpenLinks.has(sampleOpenPath), `${assetRoot}/${project.id} open-in-editor link missing`);
      assert.ok(existsSync(new URL(`../${assetRoot}/${projectUrl.slice(2)}`, import.meta.url)), `missing ${assetRoot}/${project.id} list project`);
    }

    assert.deepEqual([...actualRuns.keys()].sort(), [...expectedRuns.keys()].sort(), `${assetRoot} sample run ids drifted`);
    for (const [runId, expected] of expectedRuns) {
      const actual = actualRuns.get(runId);
      assert.equal(actual.image, expected.image, `${assetRoot}/${runId} image drifted`);
      assert.equal(actual.metadata, expected.metadata, `${assetRoot}/${runId} metadata drifted`);
      assert.equal(actual.openLink, expected.open, `${assetRoot}/${runId} open link drifted`);
      assert.equal(actual.project, expected.project, `${assetRoot}/${runId} project attribute drifted`);
      assert.equal(actual.projectLink, expected.project, `${assetRoot}/${runId} project download link drifted`);
      assert.equal(actual.manifestLink, "./assets/sample-runs.json", `${assetRoot}/${runId} manifest link drifted`);
      assert.equal(actual.scenario, expected.scenario, `${assetRoot}/${runId} scenario attribute drifted`);
      assert.deepEqual(actual.tags, expected.tags, `${assetRoot}/${runId} tags drifted`);

      const imageUrl = new URL(`../${assetRoot}/${expected.image.slice(2)}`, import.meta.url);
      const metadataUrl = new URL(`../${assetRoot}/${expected.metadata.slice(2)}`, import.meta.url);
      const projectUrl = new URL(`../${assetRoot}/${expected.project.slice(2)}`, import.meta.url);
      assert.ok(existsSync(imageUrl), `missing ${assetRoot}/${runId} image`);
      assert.ok(existsSync(metadataUrl), `missing ${assetRoot}/${runId} metadata`);
      assert.ok(existsSync(projectUrl), `missing ${assetRoot}/${runId} sample project`);

      const manifestRun = manifestRuns.get(runId);
      assert.equal(manifestRun?.image_url, expected.image, `${assetRoot}/${runId} manifest image drifted`);
      assert.equal(manifestRun?.metadata_url, expected.metadata, `${assetRoot}/${runId} manifest metadata drifted`);
      assert.equal(manifestRun?.project_url, expected.project, `${assetRoot}/${runId} manifest project drifted`);
      assert.equal(manifestRun?.demo_path, expected.open, `${assetRoot}/${runId} manifest demo path drifted`);
      assert.equal(manifestRun?.scenario_id, expected.scenario, `${assetRoot}/${runId} manifest scenario drifted`);
      assert.equal(
        sampleProjects.get(expected.project)?.scenario_id,
        expected.scenario,
        `${assetRoot}/${runId} sample project manifest scenario drifted`,
      );

      assert.deepEqual([...actual.evidence.keys()].sort(), [...expected.evidence.keys()].sort(), `${assetRoot}/${runId} evidence ids drifted`);
      for (const [evidenceId, expectedSource] of expected.evidence) {
        const actualEvidence = actual.evidence.get(evidenceId);
        const expectedValue = resolveStatMarker(expectedSource);
        assert.equal(actualEvidence.source, expectedSource, `${assetRoot}/${runId}/${evidenceId} source marker drifted`);
        assert.equal(actualEvidence.value, expectedValue, `${assetRoot}/${runId}/${evidenceId} data value drifted`);
        assert.equal(actualEvidence.text, String(expectedValue), `${assetRoot}/${runId}/${evidenceId} visible value drifted`);
      }
    }
  }
});

test("landing sample runs gallery filters cards and updates active state", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createSampleRunsGalleryHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  assert.equal(harness.root.dataset.sampleFilter, "all");
  assert.equal(harness.filterButtons[0].attributes["aria-pressed"], "true");
  assert.equal(harness.cards.every((card) => card.hidden === false), true);
  assert.equal(harness.cards[0].dataset.sampleFeatured, "true");

  harness.filterButtons.find((button) => button.getAttribute("data-sample-run-filter") === "transport").dispatchEvent("click");
  assert.equal(harness.root.dataset.sampleFilter, "transport");
  assert.equal(harness.filterButtons[2].attributes["aria-pressed"], "true");
  assert.equal(harness.filterButtons[0].attributes["tabindex"], "-1");
  assert.equal(harness.filterButtons[2].attributes["tabindex"], "0");
  assert.equal(harness.cards[0].hidden, true);
  assert.equal(harness.cards[1].hidden, true);
  assert.equal(harness.cards[2].hidden, false);
  assert.equal(harness.cards[2].dataset.sampleActive, "true");
});

test("landing sample runs gallery keyboard navigation changes filter focus", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createSampleRunsGalleryHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  const nextFilterEvent = createEvent({ key: "ArrowRight" });
  harness.filterButtons[0].dispatchEvent("keydown", nextFilterEvent);
  assert.equal(nextFilterEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.sampleFilter, "scenario");
  assert.equal(harness.filterButtons[1].focused, true);
  assert.equal(harness.cards[0].hidden, false);
  assert.equal(harness.cards[1].hidden, false);
  assert.equal(harness.cards[2].hidden, true);

  harness.filterButtons[1].dispatchEvent("keydown", createEvent({ key: "End" }));
  assert.equal(harness.root.dataset.sampleFilter, "evidence");
  assert.equal(harness.filterButtons[4].focused, true);
  assert.equal(harness.cards.every((card) => card.hidden === false), true);

  harness.filterButtons[4].dispatchEvent("keydown", createEvent({ key: "Home" }));
  assert.equal(harness.root.dataset.sampleFilter, "all");
  assert.equal(harness.filterButtons[0].focused, true);
});

test("landing sample runs gallery reduced-motion path is state-only", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createSampleRunsGalleryHarness({ reducedMotion: true });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  assert.equal(harness.root.dataset.sampleMotion, "reduced");
  harness.filterButtons.find((button) => button.getAttribute("data-sample-run-filter") === "atlas").dispatchEvent("click");
  assert.equal(harness.root.dataset.sampleFilter, "atlas");
  assert.equal(harness.cards[0].hidden, true);
  assert.equal(harness.cards[1].hidden, true);
  assert.equal(harness.cards[2].hidden, false);
});

test("landing sample runs bilingual keys exist", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  for (const key of [
    "sampleFiltersLabel",
    "sampleFilterScenario",
    "sampleFilterTransport",
    "sampleFilterAtlas",
    "sampleFilterEvidence",
    "sampleRecipeLabel",
    "sampleEvidenceLabel",
    "sampleProjectActionsLabel",
    "sampleProjectOpen",
    "sampleProjectDownload",
    "sampleRecipeManifest",
    "sampleProjectGuideNote",
    "sampleProjectDownloadsTitle",
    "sampleProjectDownloadsBody",
    "sampleProjectBlank",
    "sampleProjectModern",
    "sampleProjectHoi41936",
    "sampleProjectHoi41939",
    "sampleProjectTno",
    "workOneScenario",
    "workTwoScenario",
    "workThreeScenario",
  ]) {
    const occurrences = source.match(new RegExp(`\\b${key}:`, "g")) || [];
    assert.equal(occurrences.length, 2, `missing English/Chinese translation pair for ${key}`);
  }
  assert.ok(source.includes('worksEyebrow: "精选地图"'), "missing Simplified Chinese sample-runs copy");
});

test("landing work-card maps expose source-backed metadata", () => {
  const metadataFiles = [
    "work-alt-history-med.json",
    "work-scenario-switch-europe.json",
    "work-atlas-japan-corridor.json",
  ];

  for (const assetRoot of ["landing", "dist"]) {
    for (const fileName of metadataFiles) {
      const metadataUrl = new URL(`../${assetRoot}/assets/${fileName}`, import.meta.url);
      assert.ok(existsSync(metadataUrl), `missing ${assetRoot} work-card metadata: ${fileName}`);
      const metadata = JSON.parse(readFileSync(metadataUrl, "utf8"));
      assert.equal(metadata.schema_version, 1);
      assert.equal(metadata.asset_type, "landing_work_card_map");
      assert.ok(metadata.asset_id, `missing asset id for ${assetRoot}/${fileName}`);
      assert.ok(metadata.title, `missing title for ${assetRoot}/${fileName}`);
      assert.equal(metadata.scope?.projection, "regional_mercator_uniform_fit");
      assert.equal(metadata.scope?.bbox?.length, 4);
      assert.ok(Array.isArray(metadata.sources), `missing sources for ${assetRoot}/${fileName}`);
      assert.ok(metadata.sources.length >= 3, `expected source list for ${assetRoot}/${fileName}`);
      assert.ok(metadata.selection_policy?.note, `missing selection policy for ${assetRoot}/${fileName}`);

      for (const sourcePath of metadata.sources) {
        const sourceUrl = new URL(`../${sourcePath}`, import.meta.url);
        assert.ok(existsSync(sourceUrl), `missing metadata source for ${assetRoot}/${fileName}: ${sourcePath}`);
      }

      const counts = Object.values(metadata.counts || {});
      assert.ok(counts.length > 0, `missing counts for ${assetRoot}/${fileName}`);
      assert.ok(counts.some((value) => Number(value) > 0), `expected positive rendered count for ${assetRoot}/${fileName}`);
    }
  }
});

test("TNO work-card map uses dissolved detail sources without visible topology blocks", () => {
  for (const assetRoot of ["landing", "dist"]) {
    const svg = readFileSync(new URL(`../${assetRoot}/assets/work-alt-history-med.svg`, import.meta.url), "utf8");
    const metadata = JSON.parse(
      readFileSync(new URL(`../${assetRoot}/assets/work-alt-history-med.json`, import.meta.url), "utf8"),
    );

    assert.ok(svg.includes('class="political-countries"'), `missing dissolved country layer for ${assetRoot}`);
    assert.ok(!svg.includes('class="scenario-water"'), `TNO work map must not render blocky scenario water for ${assetRoot}`);
    assert.ok(
      metadata.sources.every((sourcePath) => sourcePath !== "data/scenarios/tno_1962/runtime_topology.topo.json"),
      `TNO work map should not claim runtime topology as a rendered source for ${assetRoot}`,
    );
    assert.equal(
      metadata.counts?.rendered_atlantropa_features,
      metadata.counts?.source_atlantropa_features,
      `TNO Atlantropa work map must render all clipped Atlantropa features for ${assetRoot}`,
    );
    assert.ok(Number(metadata.counts?.political_detail_chunks) > 0, `missing TNO political detail chunk count for ${assetRoot}`);
    assert.ok(Number(metadata.counts?.dissolved_country_owners) > 0, `missing dissolved owner count for ${assetRoot}`);
  }
});

test("landing showcase SVG keeps interactive layer groups after optimization", () => {
  const svg = readFileSync(new URL("../landing/assets/europe-1936-showcase.svg", import.meta.url), "utf8");
  const decodedSvg = svg
    .replaceAll("&quot;", "\"")
    .replaceAll("&gt;", ">");
  for (const required of [
    'class="layer layer-rail"',
    'class="layer layer-cities"',
    'class="layer layer-day-night"',
    'svg[data-active-layer="rail"] .layer-rail',
    'svg[data-active-layer="cities"] .layer-cities',
    'svg[data-active-layer="day-night"] .layer-day-night',
    'class="day-night-shade"',
    '.map-edge-fog > * { filter: url(#softEdgeBlur); pointer-events: none; }',
  ]) {
    assert.ok(decodedSvg.includes(required), `missing showcase SVG contract: ${required}`);
  }
  assert.equal((decodedSvg.match(/<animateTransform\b/g) || []).length, 2);
  assert.equal((decodedSvg.match(/dur="24s"/g) || []).length, 2);
  assert.equal((decodedSvg.match(/repeatCount="indefinite"/g) || []).length, 2);
});

test("landing showcase layer tabs pause and resume embedded SVG animation", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createShowcaseHarness({ reducedMotion: false });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  assert.equal(harness.svg.attributes["data-active-layer"], "political");
  assert.equal(harness.svg.attributes["data-showcase-animation"], "paused");
  assert.equal(harness.svg.animationCalls.at(-1), "pause");

  harness.tabs.find((tab) => tab.getAttribute("data-showcase-layer-tab") === "day-night").dispatchEvent("click");
  assert.equal(harness.root.dataset.showcaseLayer, "day-night");
  assert.equal(harness.svg.attributes["data-active-layer"], "day-night");
  assert.equal(harness.svg.attributes["data-showcase-animation"], "running");
  assert.equal(harness.svg.animationCalls.at(-1), "unpause");

  harness.tabs.find((tab) => tab.getAttribute("data-showcase-layer-tab") === "rail").dispatchEvent("click");
  assert.equal(harness.root.dataset.showcaseLayer, "rail");
  assert.equal(harness.svg.attributes["data-showcase-animation"], "paused");
  assert.equal(harness.svg.animationCalls.at(-1), "pause");
});

test("landing showcase metadata failure exposes a visible status and clears on layer change", async () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createShowcaseHarness({
    fetchImpl: () => Promise.reject(new Error("metadata fetch failed")),
  });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.status.hidden, false);
  assert.equal(harness.root.dataset.showcaseLayerError, "metadata");
  harness.tabs.find((tab) => tab.getAttribute("data-showcase-layer-tab") === "rail").dispatchEvent("click");
  assert.equal(harness.status.hidden, true);
  assert.equal(harness.root.dataset.showcaseLayerError, undefined);
});

test("landing showcase day-night layer respects reduced motion", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createShowcaseHarness({ reducedMotion: true });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  harness.tabs.find((tab) => tab.getAttribute("data-showcase-layer-tab") === "day-night").dispatchEvent("click");
  assert.equal(harness.root.dataset.showcaseLayer, "day-night");
  assert.equal(harness.svg.attributes["data-active-layer"], "day-night");
  assert.equal(harness.svg.attributes["data-showcase-animation"], "paused");
  assert.equal(harness.svg.animationCalls.at(-1), "pause");
});

test("landing showcase view uses modified wheel zoom, keyboard zoom, and drag without bottom controls", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createShowcaseHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);

  assert.equal(harness.root.querySelectorAll("[data-showcase-view-action]").length, 0);
  assert.equal(harness.domContentLoaded.length, 1);
  harness.domContentLoaded[0]();

  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "1");
  assert.equal(harness.root.dataset.showcaseViewZoomed, "false");
  assert.equal(harness.root.dataset.showcaseCityDetail, "base");
  assert.equal(harness.svg.attributes["data-showcase-city-detail"], "base");
  assert.equal(harness.viewport.attributes.transform, "matrix(1.16 0 0 1.16 -78.4 -49.6)");
  assert.equal(harness.objectNode.style.touchAction, "pan-y");
  assert.equal(harness.svg.style.touchAction, "pan-y");

  const plainWheelEvent = createEvent({ deltaY: -120 });
  harness.svg.dispatchEvent("wheel", plainWheelEvent);
  assert.equal(plainWheelEvent.defaultPrevented, false);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "1");
  const defaultXBeforeDrag = harness.root.dataset.showcaseViewX;
  const defaultYBeforeDrag = harness.root.dataset.showcaseViewY;
  harness.svg.dispatchEvent("pointerdown", createEvent({ clientX: 90, clientY: 95, pointerId: 3 }));
  harness.svg.dispatchEvent("pointermove", createEvent({ clientX: 30, clientY: 35, pointerId: 3 }));
  assert.equal(harness.root.dataset.showcaseViewX, defaultXBeforeDrag);
  assert.equal(harness.root.dataset.showcaseViewY, defaultYBeforeDrag);
  assert.equal(harness.root.dataset.showcaseViewDragging, undefined);

  const wheelEvent = createEvent({ ctrlKey: true, deltaY: -120 });
  harness.svg.dispatchEvent("wheel", wheelEvent);
  assert.equal(wheelEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "2");
  assert.equal(harness.root.dataset.showcaseViewZoomed, "true");
  assert.equal(harness.root.dataset.showcaseCityDetail, "expanded");
  assert.equal(harness.svg.attributes["data-showcase-city-detail"], "expanded");
  assert.equal(harness.objectNode.style.touchAction, "none");
  assert.equal(harness.svg.style.touchAction, "none");
  assert.match(harness.viewport.attributes.transform, /^matrix\(1\.34 0 0 1\.34 /);

  const zoomedWheelEvent = createEvent({ ctrlKey: true, deltaY: 120 });
  harness.svg.dispatchEvent("wheel", zoomedWheelEvent);
  assert.equal(zoomedWheelEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "1");
  assert.equal(harness.svg.style.touchAction, "pan-y");

  harness.svg.dispatchEvent("dblclick", createEvent());
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "2");
  assert.equal(harness.svg.style.touchAction, "none");

  const xBeforeDrag = harness.root.dataset.showcaseViewX;
  const yBeforeDrag = harness.root.dataset.showcaseViewY;
  harness.svg.dispatchEvent("pointerdown", createEvent({ clientX: 100, clientY: 100, pointerId: 7 }));
  harness.svg.dispatchEvent("pointermove", createEvent({ clientX: 70, clientY: 85, pointerId: 7 }));
  harness.svg.dispatchEvent("pointerup", createEvent({ pointerId: 7 }));
  assert.notEqual(harness.root.dataset.showcaseViewX, xBeforeDrag);
  assert.notEqual(harness.root.dataset.showcaseViewY, yBeforeDrag);

  const resetEvent = createEvent();
  harness.svg.dispatchEvent("dblclick", resetEvent);
  assert.equal(resetEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "1");
  assert.equal(harness.root.dataset.showcaseViewZoomed, "false");
  assert.equal(harness.svg.style.touchAction, "pan-y");
  assert.equal(harness.viewport.attributes.transform, "matrix(1.16 0 0 1.16 -78.4 -49.6)");

  const keyboardZoomEvent = createEvent({ key: "+" });
  harness.objectNode.dispatchEvent("keydown", keyboardZoomEvent);
  assert.equal(keyboardZoomEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "2");
  assert.equal(harness.svg.style.touchAction, "none");

  for (let index = 0; index < 6; index += 1) {
    harness.objectNode.dispatchEvent("keydown", createEvent({ key: "+" }));
  }
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "4");
  assert.equal(harness.root.dataset.showcaseViewScale, "1.80");
  assert.equal(harness.root.dataset.showcaseCityDetail, "dense");
  assert.equal(harness.svg.attributes["data-showcase-city-detail"], "dense");

  const keyboardResetEvent = createEvent({ key: "Escape" });
  harness.objectNode.dispatchEvent("keydown", keyboardResetEvent);
  assert.equal(keyboardResetEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.showcaseViewScaleIndex, "1");
  assert.equal(harness.root.dataset.showcaseCityDetail, "base");
  assert.equal(harness.svg.style.touchAction, "pan-y");
});

test("landing preview view keeps normal wheel scrolling and uses modified wheel zoom", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createPreviewHarness();
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);

  assert.equal(harness.domContentLoaded.length, 1);
  harness.domContentLoaded[0]();

  assert.equal(harness.root.dataset.previewScaleIndex, "0");
  // 首页预览嵌在普通页面流里；未按修饰键的滚轮保持页面滚动，只把显式缩放手势交给预览。
  const plainWheelEvent = createEvent({ deltaY: -120 });
  harness.surface.dispatchEvent("wheel", plainWheelEvent);
  assert.equal(plainWheelEvent.defaultPrevented, false);
  assert.equal(harness.root.dataset.previewScaleIndex, "0");

  const modifiedWheelEvent = createEvent({ ctrlKey: true, deltaY: -120 });
  harness.surface.dispatchEvent("wheel", modifiedWheelEvent);
  assert.equal(modifiedWheelEvent.defaultPrevented, true);
  assert.equal(harness.root.dataset.previewScaleIndex, "1");
  assert.equal(harness.root.dataset.previewZoomed, "true");
});

test("landing preview image failure is visible for the active layer and clears on recovery or tab change", () => {
  const source = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
  const harness = createPreviewHarness({ preFailedMode: "transport" });
  vm.createContext(harness.context);
  vm.runInContext(source, harness.context);
  harness.domContentLoaded[0]();

  assert.equal(harness.status.hidden, false);
  assert.equal(harness.root.dataset.previewImageError, "transport");

  harness.tabs.find((tab) => tab.getAttribute("data-preview-tab") === "cities").dispatchEvent("click");
  assert.equal(harness.status.hidden, true);
  assert.equal(harness.root.dataset.previewImageError, undefined);

  const citiesImage = harness.images.find((image) => image.getAttribute("data-preview-image") === "cities");
  citiesImage.dispatchEvent("error");
  assert.equal(harness.status.hidden, false);
  citiesImage.dispatchEvent("load");
  assert.equal(harness.status.hidden, true);
  assert.equal(harness.root.dataset.previewImageError, undefined);
});
