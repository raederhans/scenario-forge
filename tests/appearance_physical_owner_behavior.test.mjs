import assert from "node:assert/strict";
import test from "node:test";

import {
  PHYSICAL_CLASS_TOGGLE_IDS,
  createAppearancePhysicalOwner,
} from "../js/ui/toolbar/appearance_physical_owner.js";
import {
  createIntensityFieldEditorSection,
} from "../js/ui/toolbar/intensity_field_editor_section.js";
import {
  createIntensityFieldsState,
  updateIntensityFieldChannel,
} from "../js/core/state.js";

class TestElement {
  constructor() {
    this.checked = false;
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
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

function createTestDocument(nodeMap) {
  return {
    getElementById: (id) => nodeMap[id] || null,
  };
}

function buildNodes(ids) {
  return Object.fromEntries(ids.map((id) => [id, new TestElement()]));
}

const PHYSICAL_NODE_IDS = [
  "togglePhysical",
  "physicalPreset",
  "physicalPresetHint",
  "physicalMode",
  "physicalOpacity",
  "physicalAtlasIntensity",
  "physicalRainforestEmphasis",
  "physicalContourColor",
  "physicalContourOpacity",
  "physicalMinorContours",
  "physicalContourMajorWidth",
  "physicalContourMinorWidth",
  "physicalContourMajorInterval",
  "physicalContourMinorInterval",
  "physicalContourMajorLowReliefCutoff",
  "physicalContourMinorLowReliefCutoff",
  "physicalBlendMode",
  "physicalIntensityFieldChannelAtlas",
  "physicalIntensityFieldChannelContour",
  "physicalIntensityFieldEnabled",
  "physicalIntensityFieldToolToggleBtn",
  "physicalIntensityFieldPaintBtn",
  "physicalIntensityFieldEraseBtn",
  "physicalIntensityFieldPointsBtn",
  "physicalIntensityFieldWeight",
  "physicalIntensityFieldRadius",
  "physicalIntensityFieldClearBtn",
  "physicalIntensityFieldPointCount",
  "physicalIntensityFieldPointList",
  "physicalOpacityValue",
  "physicalAtlasIntensityValue",
  "physicalRainforestEmphasisValue",
  "physicalContourOpacityValue",
  "physicalContourMajorWidthValue",
  "physicalContourMinorWidthValue",
  "physicalContourMajorIntervalValue",
  "physicalContourMinorIntervalValue",
  "physicalContourMajorLowReliefCutoffValue",
  "physicalContourMinorLowReliefCutoffValue",
  "physicalIntensityFieldWeightValue",
  "physicalIntensityFieldRadiusValue",
  ...Object.values(PHYSICAL_CLASS_TOGGLE_IDS),
];

function createPhysicalConfig(overrides = {}) {
  return {
    preset: "balanced",
    mode: "atlas_and_contours",
    opacity: 0.62,
    atlasIntensity: 0.72,
    rainforestEmphasis: 0.34,
    contourColor: "#6B5947",
    contourOpacity: 0.45,
    contourMinorVisible: true,
    contourMajorWidth: 1.25,
    contourMinorWidth: 0.55,
    contourMajorIntervalM: 1000,
    contourMinorIntervalM: 200,
    contourMajorLowReliefCutoffM: 300,
    contourMinorLowReliefCutoffM: 180,
    blendMode: "multiply",
    atlasClassVisibility: {
      desert_bare: false,
    },
    ...overrides,
  };
}

function createHarness(ids = PHYSICAL_NODE_IDS, runtimeOverrides = {}) {
  const nodes = buildNodes(ids);
  const dirtyReasons = [];
  const contextLayerLoads = [];
  const historyEntries = [];
  const runtimeState = {
    showPhysical: true,
    styleConfig: {
      physical: createPhysicalConfig(),
    },
    intensityFields: undefined,
    intensityFieldTool: undefined,
    ensureContextLayerDataFn(layers, options) {
      contextLayerLoads.push({ layers, options });
      return Promise.resolve();
    },
    ...runtimeOverrides,
  };
  const owner = createAppearancePhysicalOwner({
    runtimeState,
    t: (value, scope) => `${scope}:${value}`,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
    renderDirty: (reason) => dirtyReasons.push(reason),
    captureHistoryState: () => ({ intensityFields: runtimeState.intensityFields }),
    pushHistoryEntry: (entry) => {
      historyEntries.push(entry);
      return true;
    },
    documentRef: createTestDocument(nodes),
  });
  return { contextLayerLoads, dirtyReasons, historyEntries, nodes, owner, runtimeState };
}

test("physical owner renders preset, value labels, and class toggles", () => {
  const harness = createHarness();

  harness.owner.renderPhysicalUi();

  assert.equal(harness.nodes.togglePhysical.checked, true);
  assert.equal(harness.nodes.physicalPreset.value, "balanced");
  assert.equal(harness.nodes.physicalPresetHint.textContent, "ui:Balanced keeps terrain visible while staying cleaner over political fills.");
  assert.equal(harness.nodes.physicalMode.value, "atlas_and_contours");
  assert.equal(harness.nodes.physicalOpacity.value, "62");
  assert.equal(harness.nodes.physicalOpacityValue.textContent, "62%");
  assert.equal(harness.nodes.physicalAtlasIntensity.value, "72");
  assert.equal(harness.nodes.physicalAtlasIntensityValue.textContent, "72%");
  assert.equal(harness.nodes.physicalRainforestEmphasis.value, "34");
  assert.equal(harness.nodes.physicalRainforestEmphasisValue.textContent, "34%");
  assert.equal(harness.nodes.physicalContourColor.value, "#6b5947");
  assert.equal(harness.nodes.physicalContourOpacity.value, "45");
  assert.equal(harness.nodes.physicalContourOpacityValue.textContent, "45%");
  assert.equal(harness.nodes.physicalContourMajorWidth.value, "1.25");
  assert.equal(harness.nodes.physicalContourMajorWidthValue.textContent, "1.25");
  assert.equal(harness.nodes.physicalContourMinorInterval.value, "200");
  assert.equal(harness.nodes.physicalContourMinorIntervalValue.textContent, "200");
  assert.equal(harness.nodes.physicalClassDesert.checked, false);
  assert.equal(harness.nodes.physicalClassMountain.checked, true);
  assert.equal(harness.nodes.physicalIntensityFieldEnabled.checked, false);
  assert.equal(harness.nodes.physicalIntensityFieldWeight.value, "100");
  assert.equal(harness.nodes.physicalIntensityFieldRadius.value, "300");
  assert.equal(harness.nodes.physicalIntensityFieldPointCount.textContent, "0");
});

test("physical owner toggles visibility and requests physical context layers", () => {
  const harness = createHarness(["togglePhysical"], {
    showPhysical: false,
  });

  harness.owner.bindEvents();
  harness.nodes.togglePhysical.checked = true;
  harness.nodes.togglePhysical.dispatch("change");

  assert.equal(harness.runtimeState.showPhysical, true);
  assert.deepEqual(harness.contextLayerLoads, [
    {
      layers: ["physical-set", "physical-contours-set"],
      options: { reason: "toolbar-toggle", renderNow: true },
    },
  ]);
  assert.deepEqual(harness.dirtyReasons, ["toggle-physical"]);
});

test("physical owner loads contours on demand after atlas-only mode", () => {
  const harness = createHarness(["togglePhysical", "physicalMode"], {
    showPhysical: false,
    styleConfig: { physical: createPhysicalConfig({ mode: "atlas_only" }) },
  });
  harness.owner.bindEvents();
  harness.nodes.togglePhysical.checked = true;
  harness.nodes.togglePhysical.dispatch("change");
  assert.deepEqual(harness.contextLayerLoads[0].layers, ["physical-set"]);
  harness.nodes.physicalMode.value = "atlas_and_contours";
  harness.nodes.physicalMode.dispatch("change");
  assert.deepEqual(harness.contextLayerLoads[1], {
    layers: ["physical-set", "physical-contours-set"],
    options: { reason: "physical-mode", renderNow: true },
  });
});

test("physical owner applies presets once and preserves selected mode", () => {
  const harness = createHarness(PHYSICAL_NODE_IDS, {
    styleConfig: {
      physical: createPhysicalConfig({
        mode: "contours_only",
        contourColor: "#AA5500",
      }),
    },
  });

  harness.owner.bindEvents();
  harness.owner.bindEvents();
  harness.nodes.physicalPreset.value = "terrain_rich";
  harness.nodes.physicalPreset.dispatch("change");

  assert.equal(harness.nodes.physicalPreset.listeners.get("change").length, 1);
  assert.equal(harness.runtimeState.styleConfig.physical.preset, "terrain_rich");
  assert.equal(harness.runtimeState.styleConfig.physical.mode, "contours_only");
  assert.equal(harness.runtimeState.styleConfig.physical.contourColor, "#aa5500");
  assert.equal(harness.nodes.physicalPresetHint.textContent, "ui:Terrain Rich pushes the atlas and contour layer for the strongest relief read.");
  assert.deepEqual(harness.dirtyReasons, ["physical-preset-select"]);
});

test("physical owner clamps numeric inputs and updates value labels", () => {
  const harness = createHarness();

  harness.owner.bindEvents();
  harness.nodes.physicalOpacity.value = "130";
  harness.nodes.physicalOpacity.dispatch("input");
  harness.nodes.physicalAtlasIntensity.value = "10";
  harness.nodes.physicalAtlasIntensity.dispatch("input");
  harness.nodes.physicalContourMajorInterval.value = "1750";
  harness.nodes.physicalContourMajorInterval.dispatch("input");
  harness.nodes.physicalContourMinorLowReliefCutoff.value = "-12";
  harness.nodes.physicalContourMinorLowReliefCutoff.dispatch("input");

  assert.equal(harness.runtimeState.styleConfig.physical.opacity, 1);
  assert.equal(harness.nodes.physicalOpacityValue.textContent, "100%");
  assert.equal(harness.runtimeState.styleConfig.physical.atlasIntensity, 0.2);
  assert.equal(harness.nodes.physicalAtlasIntensityValue.textContent, "20%");
  assert.equal(harness.runtimeState.styleConfig.physical.contourMajorIntervalM, 2000);
  assert.equal(harness.nodes.physicalContourMajorIntervalValue.textContent, "2000");
  assert.equal(harness.runtimeState.styleConfig.physical.contourMinorLowReliefCutoffM, 0);
  assert.equal(harness.nodes.physicalContourMinorLowReliefCutoffValue.textContent, "0");
  assert.deepEqual(harness.dirtyReasons, [
    "physical-opacity",
    "physical-atlas-intensity",
    "physical-contour-major-interval",
    "physical-contour-minor-low-relief-cutoff",
  ]);
});

test("physical owner updates class visibility through class toggles", () => {
  const harness = createHarness(Object.values(PHYSICAL_CLASS_TOGGLE_IDS));

  harness.owner.bindEvents();
  harness.nodes.physicalClassMountain.checked = false;
  harness.nodes.physicalClassMountain.dispatch("change");

  assert.equal(harness.runtimeState.styleConfig.physical.atlasClassVisibility.mountain_high_relief, false);
  assert.deepEqual(harness.dirtyReasons, ["physical-class-mountain_high_relief"]);
});

test("physical owner edits intensity field through history-backed controls", () => {
  const harness = createHarness();

  harness.owner.bindEvents();
  harness.nodes.physicalIntensityFieldEnabled.checked = true;
  harness.nodes.physicalIntensityFieldEnabled.dispatch("change");
  harness.nodes.physicalIntensityFieldWeight.value = "150";
  harness.nodes.physicalIntensityFieldWeight.dispatch("input");
  harness.nodes.physicalIntensityFieldRadius.value = "1250";
  harness.nodes.physicalIntensityFieldRadius.dispatch("input");
  harness.nodes.physicalIntensityFieldToolToggleBtn.dispatch("click");
  harness.nodes.physicalIntensityFieldEraseBtn.dispatch("click");

  assert.equal(harness.nodes.physicalIntensityFieldEnabled.checked, true);
  assert.equal(harness.runtimeState.intensityFields.channels.physicalAtlas.enabled, true);
  assert.equal(harness.runtimeState.intensityFields.channels.physicalAtlas.revision, 1);
  assert.equal(harness.runtimeState.intensityFieldTool.active, true);
  assert.equal(harness.runtimeState.intensityFieldTool.subMode, "erase");
  assert.equal(harness.runtimeState.intensityFieldTool.brushStrength, 1.5);
  assert.equal(harness.runtimeState.intensityFieldTool.brushRadiusDeg, 12.5);
  assert.equal(harness.nodes.physicalIntensityFieldWeightValue.textContent, "150%");
  assert.equal(harness.nodes.physicalIntensityFieldRadiusValue.textContent, "ui:≈ 1388 km");
  assert.equal(harness.historyEntries.length, 1);
  assert.deepEqual(harness.dirtyReasons, ["physical-intensity-field-enabled"]);

  const seededIntensityFields = updateIntensityFieldChannel(createIntensityFieldsState(), "physicalAtlas", (channel) => {
    channel.enabled = true;
    channel.points = [{
      id: "ridge-1",
      lon: 10,
      lat: 46,
      strength: 1.25,
      radiusDeg: 4,
      falloff: "smooth",
    }];
  });

  const selectedPointHarness = createHarness(PHYSICAL_NODE_IDS, {
    intensityFields: seededIntensityFields,
    intensityFieldTool: {
      active: true,
      brushRadiusDeg: 12.5,
      brushStrength: 1.5,
      channelId: "physicalAtlas",
      selectedPointId: "ridge-1",
      subMode: "points",
    },
  });
  selectedPointHarness.owner.bindEvents();
  selectedPointHarness.owner.renderPhysicalIntensityFieldUi();
  selectedPointHarness.nodes.physicalIntensityFieldWeight.value = "175";
  selectedPointHarness.nodes.physicalIntensityFieldWeight.dispatch("input");
  selectedPointHarness.nodes.physicalIntensityFieldWeight.dispatch("change");

  assert.equal(selectedPointHarness.runtimeState.intensityFields.channels.physicalAtlas.points.length, 1);
  assert.equal(selectedPointHarness.runtimeState.intensityFields.channels.physicalAtlas.points[0].strength, 1.75);
  assert.equal(selectedPointHarness.nodes.physicalIntensityFieldPointCount.textContent, "1");
  assert.equal(selectedPointHarness.historyEntries.length, 1);
  assert.equal(selectedPointHarness.dirtyReasons.at(-1), "physical-intensity-field-point-strength");

  const clearChannelHarness = createHarness(PHYSICAL_NODE_IDS, {
    intensityFields: seededIntensityFields,
    intensityFieldTool: {
      active: true,
      brushRadiusDeg: 12.5,
      brushStrength: 1.5,
      channelId: "physicalAtlas",
      selectedPointId: "ridge-1",
      subMode: "points",
    },
  });
  clearChannelHarness.owner.bindEvents();
  clearChannelHarness.owner.renderPhysicalIntensityFieldUi();
  clearChannelHarness.nodes.physicalIntensityFieldClearBtn.dispatch("click");

  assert.equal(clearChannelHarness.runtimeState.intensityFields.channels.physicalAtlas.points.length, 0);
  assert.ok(clearChannelHarness.runtimeState.intensityFields.channels.physicalAtlas.grid.base.every((value) => value === 1));
  assert.ok(clearChannelHarness.runtimeState.intensityFields.channels.physicalAtlas.grid.composite.every((value) => value === 1));
  assert.equal(clearChannelHarness.nodes.physicalIntensityFieldPointCount.textContent, "0");
  assert.equal(clearChannelHarness.historyEntries.length, 1);
});

test("shared intensity field editor owns urban glow channel without stealing physical tools", () => {
  const nodes = buildNodes([
    "urbanIntensityFieldEnabled",
    "urbanIntensityFieldToolToggleBtn",
    "urbanIntensityFieldPaintBtn",
    "urbanIntensityFieldEraseBtn",
    "urbanIntensityFieldPointsBtn",
    "urbanIntensityFieldWeight",
    "urbanIntensityFieldRadius",
    "urbanIntensityFieldClearBtn",
    "urbanIntensityFieldPointCount",
    "urbanIntensityFieldPointList",
    "urbanIntensityFieldWeightValue",
    "urbanIntensityFieldRadiusValue",
  ]);
  const dirtyReasons = [];
  const historyEntries = [];
  const runtimeState = {
    intensityFields: undefined,
    intensityFieldTool: {
      active: true,
      brushRadiusDeg: 4,
      brushStrength: 1.25,
      channelId: "physicalAtlas",
      selectedPointId: "",
      subMode: "paint",
    },
  };
  const section = createIntensityFieldEditorSection({
    runtimeState,
    nodes: {
      enabled: nodes.urbanIntensityFieldEnabled,
      toolToggleBtn: nodes.urbanIntensityFieldToolToggleBtn,
      paintBtn: nodes.urbanIntensityFieldPaintBtn,
      eraseBtn: nodes.urbanIntensityFieldEraseBtn,
      pointsBtn: nodes.urbanIntensityFieldPointsBtn,
      weight: nodes.urbanIntensityFieldWeight,
      radius: nodes.urbanIntensityFieldRadius,
      clearBtn: nodes.urbanIntensityFieldClearBtn,
      pointCount: nodes.urbanIntensityFieldPointCount,
      pointList: nodes.urbanIntensityFieldPointList,
      weightValue: nodes.urbanIntensityFieldWeightValue,
      radiusValue: nodes.urbanIntensityFieldRadiusValue,
    },
    channelIds: ["urbanGlow"],
    defaultChannelId: "urbanGlow",
    historyLabel: "Urban intensity field",
    reasonPrefix: "urban-intensity-field",
    t: (value, scope) => `${scope}:${value}`,
    captureHistoryState: () => ({ intensityFields: runtimeState.intensityFields }),
    pushHistoryEntry: (entry) => {
      historyEntries.push(entry);
      return true;
    },
    renderDirty: (reason) => dirtyReasons.push(reason),
    documentRef: createTestDocument(nodes),
  });

  section.bindEvents();
  section.render();

  assert.equal(nodes.urbanIntensityFieldToolToggleBtn.textContent, "ui:Enter Tool");
  assert.equal(nodes.urbanIntensityFieldPointCount.textContent, "0");

  nodes.urbanIntensityFieldEnabled.checked = true;
  nodes.urbanIntensityFieldEnabled.dispatch("change");
  nodes.urbanIntensityFieldWeight.value = "165";
  nodes.urbanIntensityFieldWeight.dispatch("input");
  nodes.urbanIntensityFieldToolToggleBtn.dispatch("click");
  nodes.urbanIntensityFieldEraseBtn.dispatch("click");

  assert.equal(runtimeState.intensityFields.channels.urbanGlow.enabled, true);
  assert.equal(runtimeState.intensityFields.channels.urbanGlow.revision, 1);
  assert.equal(runtimeState.intensityFieldTool.active, true);
  assert.equal(runtimeState.intensityFieldTool.channelId, "urbanGlow");
  assert.equal(runtimeState.intensityFieldTool.subMode, "erase");
  assert.equal(runtimeState.intensityFieldTool.brushStrength, 1.65);
  assert.equal(historyEntries.length, 1);
  assert.deepEqual(dirtyReasons, ["urban-intensity-field-enabled"]);
});
