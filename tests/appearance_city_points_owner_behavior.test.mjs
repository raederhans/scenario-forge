import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppearanceCityPointsOwner,
} from "../js/ui/toolbar/appearance_city_points_owner.js";

class TestElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName || "div").toLowerCase();
    this.checked = false;
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.id = "";
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  get options() {
    return this.children.filter((child) => child.tagName === "option");
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => {
      if (node instanceof TestFragment) {
        node.children.forEach((child) => this.appendChild(child));
        return;
      }
      this.appendChild(node);
    });
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({
        target: this,
        ...event,
      });
    }
  }
}

class TestFragment {
  constructor() {
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }
}

function createTestDocument(nodeMap) {
  return {
    createDocumentFragment: () => new TestFragment(),
    createElement: (tagName) => new TestElement(tagName),
    getElementById: (id) => nodeMap[id] || null,
  };
}

function buildNodes(ids) {
  return Object.fromEntries(ids.map((id) => [id, new TestElement()]));
}

function createHarness(ids, runtimeOverrides = {}) {
  const nodes = buildNodes(ids);
  const dirtyReasons = [];
  const optionalLayerLoads = [];
  const runtimeState = {
    currentLanguage: "en",
    showCityPoints: true,
    styleConfig: {
      cityPoints: {
        theme: "atlas_ink",
        markerDensity: 1.25,
        labelDensity: "dense",
        color: "#ABCDEF",
        capitalColor: "#123456",
        opacity: 0.5,
        markerScale: 1.5,
        showLabels: false,
        labelSize: 16,
        showCapitalOverlay: false,
      },
    },
    persistViewSettingsCount: 0,
    persistViewSettingsFn() {
      this.persistViewSettingsCount += 1;
    },
    ...runtimeOverrides,
  };
  const owner = createAppearanceCityPointsOwner({
    runtimeState,
    t: (value, scope) => `${scope}:${value}`,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
    renderDirty: (reason) => dirtyReasons.push(reason),
    ensureActiveScenarioOptionalLayerLoaded: (layerId, options) => {
      optionalLayerLoads.push({ layerId, options });
      return Promise.resolve();
    },
    documentRef: createTestDocument(nodes),
  });
  return { dirtyReasons, nodes, optionalLayerLoads, owner, runtimeState };
}

const CITY_POINT_NODE_IDS = [
  "toggleCityPoints",
  "cityPointsTheme",
  "cityPointsThemeHint",
  "cityPointsMarkerScale",
  "cityPointsMarkerDensity",
  "cityPointsMarkerDensityHint",
  "cityPointsLabelDensity",
  "cityPointsLabelDensityHint",
  "cityPointsColor",
  "cityPointsCapitalColor",
  "cityPointsOpacity",
  "cityPointLabelsEnabled",
  "cityPointsLabelSize",
  "cityCapitalOverlayEnabled",
  "cityPointsMarkerScaleValue",
  "cityPointsMarkerDensityValue",
  "cityPointsOpacityValue",
  "cityPointsLabelSizeValue",
];

test("city-points owner renders theme options and current style controls", () => {
  const harness = createHarness(CITY_POINT_NODE_IDS);

  harness.owner.renderCityPointsUi();

  assert.equal(harness.nodes.cityPointsTheme.options.length, 5);
  assert.equal(harness.nodes.cityPointsTheme.options[0].id, "optCityPointsThemeClassicGraphite");
  assert.equal(harness.nodes.cityPointsTheme.options[0].textContent, "ui:Graphite Signal");
  assert.equal(harness.nodes.cityPointsTheme.value, "atlas_ink");
  assert.equal(harness.nodes.cityPointsThemeHint.textContent, "Cyan symbols with warm capital accents. Density and labels stay unchanged.");
  assert.equal(harness.nodes.cityPointsMarkerScale.value, "1.50");
  assert.equal(harness.nodes.cityPointsMarkerScaleValue.textContent, "1.50x");
  assert.equal(harness.nodes.cityPointsMarkerDensity.value, "1.25");
  assert.equal(harness.nodes.cityPointsMarkerDensityValue.textContent, "1.25x");
  assert.equal(harness.nodes.cityPointsLabelDensity.value, "dense");
  assert.equal(harness.nodes.cityPointsOpacity.value, "50");
  assert.equal(harness.nodes.cityPointsOpacityValue.textContent, "50%");
  assert.equal(harness.nodes.cityPointLabelsEnabled.checked, false);
  assert.equal(harness.nodes.cityPointsLabelSize.value, "16");
  assert.equal(harness.nodes.cityPointsLabelSizeValue.textContent, "16px");
  assert.equal(harness.nodes.cityCapitalOverlayEnabled.checked, false);
});

test("city-points owner refreshes existing theme option labels without rebuilding options", () => {
  const harness = createHarness(["cityPointsTheme"], {
    currentLanguage: "zh",
  });

  harness.owner.ensureCityPointsThemeOptions();
  const firstOption = harness.nodes.cityPointsTheme.options[0];
  harness.owner.ensureCityPointsThemeOptions();

  assert.equal(harness.nodes.cityPointsTheme.options[0], firstOption);
  assert.equal(harness.nodes.cityPointsTheme.options[0].textContent, "ui:Graphite Signal");
});

test("city-points palette changes preserve density size and label choices", () => {
  const harness = createHarness(CITY_POINT_NODE_IDS);

  harness.owner.bindEvents();
  harness.owner.bindEvents();
  harness.nodes.cityPointsTheme.value = "parchment_sepia";
  harness.nodes.cityPointsTheme.dispatch("change");

  assert.equal(harness.nodes.cityPointsTheme.listeners.get("change").length, 1);
  assert.equal(harness.runtimeState.styleConfig.cityPoints.theme, "parchment_sepia");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.color, "#9b3f2f");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.capitalColor, "#e6843a");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.markerScale, 1.5);
  assert.equal(harness.runtimeState.styleConfig.cityPoints.markerDensity, 1.25);
  assert.equal(harness.runtimeState.styleConfig.cityPoints.opacity, 0.5);
  assert.equal(harness.runtimeState.styleConfig.cityPoints.labelDensity, "dense");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.labelSize, 16);
  assert.equal(harness.nodes.cityPointsColor.value, "#9b3f2f");
  assert.equal(harness.nodes.cityPointsCapitalColor.value, "#e6843a");
  assert.equal(harness.nodes.cityPointsMarkerScale.value, "1.50");
  assert.equal(harness.nodes.cityPointsMarkerDensity.value, "1.25");
  assert.equal(harness.nodes.cityPointsOpacity.value, "50");
  assert.equal(harness.nodes.cityPointsLabelDensity.value, "dense");
  assert.equal(harness.nodes.cityPointsLabelSize.value, "16");
  assert.equal(harness.runtimeState.persistViewSettingsCount, 1);
  assert.deepEqual(harness.dirtyReasons, ["city-points-theme"]);
});

test("city-points owner toggles visibility and requests city data when enabled", () => {
  const baseCityDataLoads = [];
  const harness = createHarness(["toggleCityPoints"], {
    showCityPoints: false,
    ensureBaseCityDataFn: (options) => {
      baseCityDataLoads.push(options);
      return Promise.resolve();
    },
  });

  harness.owner.bindEvents();
  harness.nodes.toggleCityPoints.checked = true;
  harness.nodes.toggleCityPoints.dispatch("change");

  assert.equal(harness.runtimeState.showCityPoints, true);
  assert.deepEqual(baseCityDataLoads, [{ reason: "toolbar-toggle", renderNow: true }]);
  assert.deepEqual(harness.optionalLayerLoads, [
    { layerId: "cities", options: { renderNow: true } },
  ]);
  assert.equal(harness.runtimeState.persistViewSettingsCount, 1);
  assert.deepEqual(harness.dirtyReasons, ["toggle-city-points"]);
});

test("city-points owner clamps numeric inputs and updates value labels", () => {
  const harness = createHarness(CITY_POINT_NODE_IDS);

  harness.owner.bindEvents();
  harness.nodes.cityPointsMarkerScale.value = "9";
  harness.nodes.cityPointsMarkerScale.dispatch("input");
  harness.nodes.cityPointsOpacity.value = "-10";
  harness.nodes.cityPointsOpacity.dispatch("input");
  harness.nodes.cityPointsLabelSize.value = "99";
  harness.nodes.cityPointsLabelSize.dispatch("input");

  assert.equal(harness.runtimeState.styleConfig.cityPoints.markerScale, 2.5);
  assert.equal(harness.nodes.cityPointsMarkerScaleValue.textContent, "2.50x");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.opacity, 0);
  assert.equal(harness.nodes.cityPointsOpacityValue.textContent, "0%");
  assert.equal(harness.runtimeState.styleConfig.cityPoints.labelSize, 24);
  assert.equal(harness.nodes.cityPointsLabelSizeValue.textContent, "24px");
  assert.deepEqual(harness.dirtyReasons, [
    "city-points-marker-scale",
    "city-points-opacity",
    "city-points-label-size",
  ]);
});

test("city-points marker scale roundtrips back to one-to-one size", () => {
  const harness = createHarness([
    "cityPointsMarkerScale",
    "cityPointsMarkerScaleValue",
  ], {
    styleConfig: {
      cityPoints: {
        markerScale: 1,
      },
    },
  });

  harness.owner.bindEvents();
  harness.nodes.cityPointsMarkerScale.value = "1.30";
  harness.nodes.cityPointsMarkerScale.dispatch("input");
  harness.nodes.cityPointsMarkerScale.value = "1.00";
  harness.nodes.cityPointsMarkerScale.dispatch("input");

  assert.equal(harness.runtimeState.styleConfig.cityPoints.markerScale, 1);
  assert.equal(harness.nodes.cityPointsMarkerScaleValue.textContent, "1.00x");
  assert.deepEqual(harness.dirtyReasons, [
    "city-points-marker-scale",
    "city-points-marker-scale",
  ]);
});
