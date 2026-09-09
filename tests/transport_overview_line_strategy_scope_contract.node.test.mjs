import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getTransportWorkbenchOverviewBridgeSupport,
  getTransportOverviewImportanceThresholdRank,
  resolveTransportOverviewPatchFromWorkbench,
  resolveTransportOverviewLineStrategy,
} from "../js/core/transport_capability_registry.js";
import {
  createTransportPackSourceGateReport,
  resolveTransportActivePack,
} from "../js/core/transport_pack_resolver.js";
import {
  applyTransportCountryOverlayState,
} from "../js/core/transport_country_overlay.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import { doScreenLabelBoxesOverlap } from "../js/core/renderer/screen_label_placement.js";
import {
  formatCityPointsDensityValue,
  getCityPointsLabelDensityHint,
  getCityPointsThemeHint,
  getCityPointsThemeLabel,
  getCityPointsThemeMeta,
  getCityPointsThemeStyle,
} from "../js/ui/toolbar/appearance_city_points_descriptor.js";
import {
  buildTransportFamilySummaryText,
  formatTransportPercent,
  formatTransportScopeLabel,
  formatTransportThresholdLabel,
  getTransportFamilyFilteredCount,
  getTransportFamilyRenderMetric,
} from "../js/ui/toolbar/appearance_transport_summary.js";
import {
  buildTransportOverviewLineStrokeSpecs,
  getTransportLineFeatureLabelAnchor,
  getTransportLineLabelGridSize,
  getTransportOverviewRailLabelText,
  getTransportOverviewRoadLabelText,
  measureProjectedLineSetLength,
  projectTransportLineGeometry,
  resolveTransportOverviewLineCoordinateWidth,
  resolveTransportOverviewLineDash,
  resolveTransportRoadLabelClassAndPriority,
} from "../js/core/renderer/transport_line_label_policy.js";
import {
  getIncludedTransportOverviewLineClass,
  getTransportOverviewLabelZoomConfig,
  shouldIncludeTransportOverviewLineFeature,
} from "../js/core/transport_overview_visibility_policy.js";
import {
  getTransportOverviewAirportVisualStyle,
  getTransportOverviewPortVisualStyle,
  getTransportOverviewPrimaryColor,
  getTransportOverviewRailVisualStyle,
  getTransportOverviewRoadVisualStyle,
} from "../js/core/renderer/transport_overview_style_policy.js";

const mapRendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");

const LINE_FIXTURES = Object.freeze({
  road: Object.freeze([
    { type: "Feature", properties: { class: "motorway", reveal_rank: 1 } },
    { type: "Feature", properties: { class: "motorway", reveal_rank: 2 } },
    { type: "Feature", properties: { class: "trunk", reveal_rank: 2 } },
    { type: "Feature", properties: { class: "primary", reveal_rank: 3 } },
    { type: "Feature", properties: { class: "secondary", reveal_rank: 3 } },
  ]),
  rail: Object.freeze([
    { type: "Feature", properties: { class: "mainline", reveal_rank: 1 } },
    { type: "Feature", properties: { class: "mainline", reveal_rank: 2 } },
    { type: "Feature", properties: { class: "regional", reveal_rank: 2 } },
    { type: "Feature", properties: { class: "secondary", reveal_rank: 2 } },
  ]),
});

function assertClose(actual, expected, message = "") {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message || `expected ${actual} to be close to ${expected}`,
  );
}

function countVisibleLines(familyId, config, scale) {
  const strategy = resolveTransportOverviewLineStrategy(familyId, config, { scale });
  return LINE_FIXTURES[familyId].filter((feature) => shouldIncludeTransportOverviewLineFeature(familyId, feature, strategy)).length;
}

test("rail and road line scope thresholds still constrain counts across overview scales", () => {
  const cases = [
    {
      familyId: "road",
      primaryConfig: { scope: "motorway_only", importanceThreshold: "primary" },
      broadConfig: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    },
    {
      familyId: "rail",
      primaryConfig: { scope: "mainline_only", importanceThreshold: "primary" },
      broadConfig: { scope: "mainline_plus_regional", importanceThreshold: "secondary" },
      broadCount: 4,
    },
  ];

  for (const { familyId, primaryConfig, broadConfig, broadCount = 3 } of cases) {
    for (const scale of [1.2, 3, 5]) {
      assert.equal(countVisibleLines(familyId, primaryConfig, scale), 1, `${familyId} primary scale ${scale}`);
      assert.equal(countVisibleLines(familyId, broadConfig, scale), broadCount, `${familyId} broad scale ${scale}`);
    }
  }

  assert.equal(
    countVisibleLines("road", { scope: "motorway_trunk", importanceThreshold: "all" }, 5),
    3,
    "road motorway_trunk scope should keep primary/secondary out even when threshold is all",
  );

  const roadBroadStrategy = resolveTransportOverviewLineStrategy(
    "road",
    { scope: "motorway_trunk", importanceThreshold: "secondary" },
    { scale: 5 },
  );
  assert.equal(getIncludedTransportOverviewLineClass("road", { properties: { class: "service", reveal_rank: 1 } }, roadBroadStrategy), "");
  assert.equal(getIncludedTransportOverviewLineClass("road", { properties: { class: "trunk" } }, roadBroadStrategy), "trunk");
  assert.equal(shouldIncludeTransportOverviewLineFeature("road", { properties: { class: "primary", reveal_rank: 3 } }, roadBroadStrategy), false);
});

test("transport overview visibility policy keeps label zoom and point threshold boundaries deterministic", () => {
  assert.deepEqual(getTransportOverviewLabelZoomConfig("airport", "balanced"), {
    nationalLabelScale: 2,
    regionalLabelScale: 5,
  });
  const sparsePortZoom = getTransportOverviewLabelZoomConfig("port", "sparse");
  assertClose(sparsePortZoom.nationalLabelScale, 2.9);
  assertClose(sparsePortZoom.regionalLabelScale, 6.5);
  const denseRailZoom = getTransportOverviewLabelZoomConfig("rail", "dense");
  assertClose(denseRailZoom.nationalLabelScale, 1.85);
  assertClose(denseRailZoom.regionalLabelScale, 4.5);
  assert.equal(getTransportOverviewImportanceThresholdRank("primary"), 3);
  assert.equal(getTransportOverviewImportanceThresholdRank("secondary"), 2);
  assert.equal(getTransportOverviewImportanceThresholdRank("all"), 1);
  assert.equal(getTransportOverviewImportanceThresholdRank("unknown"), 1);
});

test("transport line label policy keeps label text, anchors, and projected length deterministic", () => {
  assert.equal(getTransportLineLabelGridSize("dense"), 112);
  assert.equal(getTransportLineLabelGridSize("sparse"), 176);
  assert.equal(getTransportLineLabelGridSize("balanced"), 144);

  assert.equal(getTransportOverviewRailLabelText({ name: "Tokaido Main Line" }, "name"), "Tokaido Main Line");
  assert.equal(getTransportOverviewRoadLabelText({ ref: "A1", name: "Autobahn 1" }, "ref"), "A1");
  assert.equal(getTransportOverviewRoadLabelText({ ref: "A1", name: "Autobahn 1" }, "name"), "Autobahn 1");
  assert.equal(getTransportOverviewRoadLabelText({ ref: "A1", name: "Autobahn 1" }, "both"), "A1 · Autobahn 1");

  assert.deepEqual(resolveTransportRoadLabelClassAndPriority({ road_class: "trunk" }), {
    roadClass: "trunk",
    priority: 3,
  });
  assert.deepEqual(resolveTransportRoadLabelClassAndPriority({ priority: 4 }), {
    roadClass: "motorway",
    priority: 4,
  });

  const lineFeature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1], [2, 1]] },
    properties: {},
  };
  const anchor = getTransportLineFeatureLabelAnchor(lineFeature, {
    getLineMidpointFromCoordinates: (coordinates) => coordinates[1],
    getMultiLineLabelAnchor: () => null,
  });
  assert.deepEqual(anchor, [1, 1]);

  const projectedLines = projectTransportLineGeometry(lineFeature.geometry, ([x, y]) => [x * 3, y * 4]);
  assert.deepEqual(projectedLines, [[[0, 0], [3, 4], [6, 4]]]);
  assert.equal(measureProjectedLineSetLength(projectedLines), 8);
});

test("transport line label policy keeps line stroke specs in screen-pixel units", () => {
  assert.equal(resolveTransportOverviewLineCoordinateWidth(2, 4, 0.75), 0.5);
  assert.equal(resolveTransportOverviewLineCoordinateWidth(0.25, 4, 0.75), 0.1875);
  assert.deepEqual(resolveTransportOverviewLineDash([6, 0, -2, 4], 2), [3, 2]);
  assert.deepEqual(resolveTransportOverviewLineDash(null, 2), []);

  const strokeSpecs = buildTransportOverviewLineStrokeSpecs({
    casingStroke: "#ffffff",
    innerStroke: "#111827",
    casingWidth: 4,
    innerWidth: 2,
    opacity: 0.5,
    dashPx: [6, 4],
  }, {
    baseOpacity: 0.8,
    strategy: { widthMultiplier: 1.5, opacityMultiplier: 0.75 },
    k: 3,
    widthFloorPx: 0.75,
  });
  assert.equal(strokeSpecs.length, 2);
  assert.deepEqual(strokeSpecs.map((spec) => spec.strokeStyle), ["#ffffff", "#111827"]);
  assertClose(strokeSpecs[0].lineWidth, 2);
  assertClose(strokeSpecs[1].lineWidth, 1);
  assertClose(strokeSpecs[0].opacity, 0.246);
  assertClose(strokeSpecs[1].opacity, 0.3);
  assert.deepEqual(strokeSpecs[0].dash, []);
  assert.deepEqual(strokeSpecs[1].dash, [2, 4 / 3]);
});

test("transport overview style policy keeps family visual tokens deterministic", () => {
  assert.equal(getTransportOverviewPrimaryColor("bad-color", "#123456"), "#123456");
  assert.equal(getTransportOverviewPrimaryColor("#ABC"), "#aabbcc");

  const airportStyle = getTransportOverviewAirportVisualStyle("#000000", 2);
  assert.equal(airportStyle.fillStyle, "#000000");
  assertClose(airportStyle.radiusScale, 1.57);
  assertClose(airportStyle.strokeScale, 1.25);
  assertClose(airportStyle.hoverScale, 1.24);
  assert.match(airportStyle.labelColor, /^#[0-9a-f]{6}$/);

  const portStyle = getTransportOverviewPortVisualStyle(null, -1);
  assert.equal(portStyle.fillStyle, "#b45309");
  assertClose(portStyle.radiusScale, 0.95);

  const railStyle = getTransportOverviewRailVisualStyle("#0f172a", 1);
  assertClose(railStyle.mainlineCasingWidth, 5);
  assertClose(railStyle.mainlineWidth, 2.8);
  assertClose(railStyle.mainlineOpacity, 1);
  assert.deepEqual(railStyle.regionalDashPx, [5.5, 4.5]);
  assert.deepEqual(railStyle.secondaryDashPx, [2.8, 4.8]);

  const roadStyle = getTransportOverviewRoadVisualStyle("#374151", 0);
  assertClose(roadStyle.motorwayCasingWidth, 3.45);
  assertClose(roadStyle.motorwayWidth, 1.55);
  assertClose(roadStyle.secondaryWidth, 0.62);
  assertClose(roadStyle.secondaryOpacity, 0.24);
  assert.deepEqual(roadStyle.trunkDashPx, [6, 5]);
  assert.deepEqual(roadStyle.primaryDashPx, [4.2, 5.4]);
  assert.deepEqual(roadStyle.secondaryDashPx, [2.6, 5.8]);
});

test("appearance transport summary reports hidden, loading, visible, and loaded states", () => {
  const translate = (key) => key;
  const collections = {
    road: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { class: "motorway", reveal_rank: 1 } },
        { type: "Feature", properties: { class: "trunk", reveal_rank: 2 } },
      ],
    },
    rail: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { class: "mainline", reveal_rank: 1 } },
      ],
    },
    airport: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { importance_rank: 1 } },
      ],
    },
    port: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { importance_rank: 1 } },
      ],
    },
  };
  const baseInput = {
    familyConfig: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    effectiveScope: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    collections,
    zoomScale: 4,
    visualMode: "distribution",
    translate,
  };

  assert.equal(buildTransportFamilySummaryText({
    ...baseInput,
    familyId: "road",
    masterEnabled: false,
    familyEnabled: true,
    metrics: {},
  }), "Hidden");

  assert.match(buildTransportFamilySummaryText({
    ...baseInput,
    familyId: "airport",
    masterEnabled: true,
    familyEnabled: true,
    metrics: { drawAirportsLayer: { reason: "staged-apply" } },
  }), /^Loading\/settling/);

  assert.match(buildTransportFamilySummaryText({
    ...baseInput,
    familyId: "road",
    masterEnabled: true,
    familyEnabled: true,
    metrics: { drawRoadsLayer: { reason: "complete", visibleFeatureCount: 2, featureCount: 2 } },
  }), /^Visible · 2 roads/);

  assert.match(buildTransportFamilySummaryText({
    ...baseInput,
    familyId: "road",
    masterEnabled: true,
    familyEnabled: true,
    metrics: { drawRoadsLayer: { reason: "complete", visibleFeatureCount: 0, featureCount: 2 } },
  }), /^Loaded · 0 visible · 2 roads loaded/);
});

test("appearance transport summary count cache refreshes when transport collection changes", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { class: "motorway", reveal_rank: 1 } },
    ],
  };
  const input = {
    familyId: "road",
    familyConfig: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    effectiveScope: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    collections: { road: collection },
    zoomScale: 4,
    visualMode: "distribution",
  };

  assert.equal(getTransportFamilyFilteredCount(input), 1);
  collection.features = [
    ...collection.features,
    { type: "Feature", properties: { class: "trunk", reveal_rank: 2 } },
  ];
  assert.equal(getTransportFamilyFilteredCount(input), 2);
  collection.features.push({ type: "Feature", properties: { class: "trunk", reveal_rank: 2 } });
  assert.equal(getTransportFamilyFilteredCount(input), 3);
});

test("appearance transport summary count cache ignores pure visual style changes", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { class: "motorway", reveal_rank: 1 } },
      { type: "Feature", properties: { class: "trunk", reveal_rank: 2 } },
    ],
  };
  const baseInput = {
    familyId: "road",
    effectiveScope: { scope: "motorway_trunk", importanceThreshold: "secondary" },
    collections: { road: collection },
    zoomScale: 4,
    visualMode: "distribution",
  };

  assert.equal(getTransportFamilyFilteredCount({
    ...baseInput,
    familyConfig: {
      scope: "motorway_trunk",
      importanceThreshold: "secondary",
      opacity: 0.7,
      visualStrength: 0.4,
      primaryColor: "#111111",
    },
  }), 2);
  collection.features = [
    { type: "Feature", properties: { class: "motorway", reveal_rank: 1 } },
  ];
  assert.equal(getTransportFamilyFilteredCount({
    ...baseInput,
    familyConfig: {
      scope: "motorway_trunk",
      importanceThreshold: "secondary",
      opacity: 0.2,
      visualStrength: 0.9,
      primaryColor: "#eeeeee",
    },
  }), 1);
});

test("appearance transport summary prefers contextBreakdown metrics and ignores global metrics", () => {
  assert.equal(getTransportFamilyRenderMetric("road", {
    contextBreakdown: {
      drawRoadsLayer: { reason: "context-breakdown" },
    },
    drawRoadsLayer: { reason: "root-metric" },
  })?.reason, "context-breakdown");

  const previousMetrics = globalThis.__renderPerfMetrics;
  globalThis.__renderPerfMetrics = {
    drawRoadsLayer: { reason: "global-metric" },
  };
  try {
    assert.equal(getTransportFamilyRenderMetric("road", null), null);
  } finally {
    globalThis.__renderPerfMetrics = previousMetrics;
  }
});

test("appearance transport summary keeps invalid family ids explicit and empty", () => {
  assert.equal(buildTransportFamilySummaryText({
    familyId: "pipeline",
    masterEnabled: true,
    familyEnabled: true,
    familyConfig: {},
    effectiveScope: {},
    collections: {
      airport: { type: "FeatureCollection", features: [{ type: "Feature", properties: { importance_rank: 1 } }] },
    },
    metrics: {},
    zoomScale: 4,
    visualMode: "distribution",
    translate: (key) => key,
  }), "Loading/settling");

  assert.equal(getTransportFamilyRenderMetric("pipeline", {
    drawAirportsLayer: { reason: "airport" },
  }), null);
});

test("appearance city-points descriptor returns stable theme labels, colors, and hints", () => {
  const translated = getCityPointsThemeLabel("atlas_ink", (key, domain) => `${domain}:${key}`);
  assert.equal(translated, "ui:Cyan Beacon");
  assert.equal(Object.isFrozen(getCityPointsThemeMeta("atlas_ink")), true);
  assert.equal(Object.isFrozen(getCityPointsThemeStyle("atlas_ink")), true);
  assert.equal(getCityPointsThemeMeta("missing_theme").value, "classic_graphite");
  assert.equal(getCityPointsThemeStyle("atlas_ink").color, "#008ea8");
  assert.equal(getCityPointsThemeStyle("atlas_ink").markerDensity, 1.25);
  assert.match(getCityPointsThemeHint("classic_graphite", "zh"), /深石墨/);
  assert.match(getCityPointsThemeHint("classic_graphite", "en"), /graphite/i);
  assert.match(getCityPointsLabelDensityHint("dense", "zh"), /P4 32/);
  assert.match(getCityPointsLabelDensityHint("sparse", "en"), /P4 16/);
  assert.equal(formatCityPointsDensityValue(1.25), "1.25x");
  assert.equal(formatCityPointsDensityValue(undefined), "1.00x");
});

test("appearance transport summary exposes pure display formatters", () => {
  assert.equal(formatTransportPercent(0.625), "63%");
  assert.equal(formatTransportPercent(undefined), "0%");
  assert.equal(formatTransportScopeLabel("major_civil"), "Major Civil");
  assert.equal(formatTransportThresholdLabel("primary_only"), "Primary Only");
  assert.equal(formatTransportScopeLabel(""), "");
});


function createRecordingCanvasContext() {
  const calls = [];
  const context = {
    calls,
    save: () => calls.push({ type: "save" }),
    restore: () => calls.push({ type: "restore" }),
    beginPath: () => calls.push({ type: "beginPath" }),
    rect: (x, y, width, height) => calls.push({ type: "rect", x, y, width, height }),
    fill: () => calls.push({ type: "fill" }),
    stroke: () => calls.push({ type: "stroke" }),
    strokeText: (text, x, y) => calls.push({ type: "strokeText", text, x, y }),
    fillText: (text, x, y) => calls.push({ type: "fillText", text, x, y }),
    setLineDash: (value) => calls.push({ type: "setLineDash", value: [...value] }),
    set globalAlpha(value) { calls.push({ type: "globalAlpha", value }); },
    set strokeStyle(value) { calls.push({ type: "strokeStyle", value }); },
    set fillStyle(value) { calls.push({ type: "fillStyle", value }); },
    set lineWidth(value) { calls.push({ type: "lineWidth", value }); },
    set lineCap(value) { calls.push({ type: "lineCap", value }); },
    set lineJoin(value) { calls.push({ type: "lineJoin", value }); },
    set textAlign(value) { calls.push({ type: "textAlign", value }); },
    set textBaseline(value) { calls.push({ type: "textBaseline", value }); },
    set font(value) { calls.push({ type: "font", value }); },
  };
  return context;
}

function createLineRenderOwnerHarness({ k = 4, roadLabelsEnabled = false, railLabelsEnabled = false } = {}) {
  const context = createRecordingCanvasContext();
  const metrics = [];
  const state = {
    showTransport: true,
    showRoad: true,
    showRail: true,
    showPorts: true,
    zoomTransform: { k },
    styleConfig: {
      transportOverview: {
        visualMode: "network",
        road: {
          opacity: 1,
          visualStrength: 0,
          labelsEnabled: roadLabelsEnabled,
          labelDensity: "dense",
          labelMode: "ref",
          scopeLinkMode: "manual",
          scope: "motorway_trunk",
          importanceThreshold: "secondary",
        },
        rail: {
          opacity: 1,
          visualStrength: 0,
          labelsEnabled: railLabelsEnabled,
          labelDensity: "dense",
          labelMode: "name",
          scopeLinkMode: "manual",
          scope: "mainline_plus_regional",
          importanceThreshold: "secondary",
        },
        port: {
          opacity: 1,
          visualStrength: 0,
          labelsEnabled: true,
          labelDensity: "dense",
          labelMode: "name",
          importanceThreshold: "all",
        },
      },
    },
    roadsData: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "trunk", reveal_rank: 2 } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 1], [1, 2]] }, properties: { class: "motorway", reveal_rank: 1, ref: "A1" } },
      ],
    },
    railwaysData: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "secondary", reveal_rank: 2, name: "Secondary line" } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 1], [1, 2]] }, properties: { class: "regional", reveal_rank: 2, name: "Regional line" } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 2], [1, 3]] }, properties: { class: "mainline", reveal_rank: 1, name: "Mainline" } },
      ],
    },
    railStationsMajorData: { type: "FeatureCollection", features: [] },
    portsData: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "global-port", name: "Global Port", importance_rank: 2 } },
      ],
    },
  };
  const hoverEntries = [];
  const owner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      buildFacilityEntryKey: (entry) => entry ? `${entry.familyId || ""}:${entry.packId || "global"}:${entry.stableId || ""}` : "",
      buildFacilityTooltipText: () => "",
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      clearFacilityHoverEntries: () => {},
      collectContextMetric: (name, _duration, detail) => metrics.push({ name, detail }),
      getActiveFacilityHighlightEntry: () => null,
      getCanvasColorRelativeLuminance: () => 0.5,
      getFacilityHoverRadiusPx: () => 12,
      getContext: () => context,
      getFeatureCollectionFeatureCount: (collection) => Array.isArray(collection?.features) ? collection.features.length : 0,
      getLineMidpointFromCoordinates: (coordinates) => coordinates[Math.floor((coordinates.length - 1) / 2)] || null,
      getMultiLineLabelAnchor: (geometry) => geometry?.coordinates?.[0]?.[0] || null,
      getPathCanvas: () => (feature) => context.calls.push({ type: "path", className: feature?.properties?.class }),
      getProjection: () => ([x, y]) => [Number(x) * 100, Number(y) * 100],
      mixCanvasColors: (color) => color,
      nowMs: () => 0,
      setVisibleFacilityHoverEntries: (_familyId, entries, options = {}) => hoverEntries.push({ entries, options }),
    },
  });
  return { context, metrics, owner, appRuntime: state, hoverEntries };
}

test("facility labels defer until the shared labels draw and retain candidates across cached marker passes", () => {
  const { owner, context, appRuntime, hoverEntries } = createLineRenderOwnerHarness({ k: 8 });
  appRuntime.portsData = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [0.25, 0.25] }, properties: { id: "p", name: "Port", importance_rank: 3 } },
  ] };
  owner.resetLabelCandidates();
  owner.drawPortsLayer(8);
  assert.equal(context.calls.filter((call) => call.type === "fillText").length, 0);
  assert.equal(hoverEntries.at(-1).entries.length, 1);
  const occupiedBoxes = [];
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes }), 1);
  assert.equal(occupiedBoxes.length, 1);
  const oldBox = occupiedBoxes[0];
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes: [{ x: -1000, y: -1000, w: 3000, h: 3000 }] }), 0);
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes: [] }), 1);
  appRuntime.zoomTransform = { x: 100, y: 60, k: 8 };
  const movedBoxes = [];
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes: movedBoxes }), 1);
  assert.equal(movedBoxes[0].x, oldBox.x + 100);
  assert.equal(movedBoxes[0].y, oldBox.y + 60);
  appRuntime.showPorts = false;
  assert.equal(owner.drawPendingLabels(8), 0);
  appRuntime.showPorts = true;
  appRuntime.activeScenarioId = "changed";
  assert.equal(owner.drawPendingLabels(8), 0);
  owner.resetLabelCandidates();
  owner.drawPortsLayer(8);
  assert.equal(owner.drawPendingLabels(8), 1);
  owner.resetLabelCandidates();
  assert.equal(owner.drawPendingLabels(8), 0);
});

test("airport and port candidates share occupancy after city labels have reserved space", () => {
  const { owner, context, appRuntime } = createLineRenderOwnerHarness({ k: 8 });
  Object.assign(context, { moveTo() {}, lineTo() {}, closePath() {} });
  appRuntime.showAirports = true;
  appRuntime.styleConfig.transportOverview.airport = { ...appRuntime.styleConfig.transportOverview.port };
  appRuntime.portsData = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [0.25, 0.25] }, properties: { id: "p", name: "Port", importance_rank: 3 } },
  ] };
  appRuntime.airportsData = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [0.25, 0.25] }, properties: { id: "a", name: "Aero Hub", importance_rank: 3 } },
  ] };
  owner.resetLabelCandidates();
  owner.drawAirportsLayer(8);
  owner.drawPortsLayer(8);
  const occupiedBoxes = [{ x: 210, y: 199, w: 80, h: 2 }];
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes }), 2);
  assert.equal(occupiedBoxes.length, 3);
  for (let i = 0; i < occupiedBoxes.length; i += 1) {
    for (let j = i + 1; j < occupiedBoxes.length; j += 1) {
      assert.equal(doScreenLabelBoxesOverlap(occupiedBoxes[i], occupiedBoxes[j]), false);
    }
  }
});

test("transport overview road line draw resets dash and keeps screen-width floors", () => {
  const zoom = 4;
  const { context, metrics, owner } = createLineRenderOwnerHarness({ k: zoom });
  owner.drawRoadsLayer(zoom);

  const dashCalls = context.calls.filter((call) => call.type === "setLineDash");
  assert.ok(dashCalls.some((call) => call.value.length === 2 && call.value[0] > 0 && call.value[1] > 0), "trunk inner stroke should use a dash pattern");
  assert.deepEqual(dashCalls.at(-1)?.value, [], "last line draw must clear dash state");

  const widths = context.calls.filter((call) => call.type === "lineWidth").map((call) => call.value * zoom);
  assert.ok(widths.length >= 4, "casing and inner strokes should both draw for trunk and motorway");
  assert.ok(Math.min(...widths) >= 0.95, `minimum screen width ${Math.min(...widths)} should keep the visible floor`);

  assert.equal(metrics.at(-1)?.name, "drawRoadsLayer");
  assert.equal(metrics.at(-1)?.detail?.visibleFeatureCount, 2);
});

test("transport overview rail line draw includes secondary with dash and screen-width floors", () => {
  const zoom = 4;
  const { context, metrics, owner } = createLineRenderOwnerHarness({ k: zoom });
  owner.drawRailwaysLayer(zoom);

  const dashedClasses = [];
  context.calls.forEach((call, index) => {
    if (call.type === "setLineDash" && call.value.length === 2) {
      const nextPath = context.calls.slice(index).find((candidate) => candidate.type === "path");
      if (nextPath?.className) dashedClasses.push(nextPath.className);
    }
  });
  assert.ok(dashedClasses.includes("secondary"), "secondary rail should render as a weaker dashed class");
  assert.ok(dashedClasses.includes("regional"), "regional rail should keep dashed rendering");
  assert.deepEqual(context.calls.filter((call) => call.type === "setLineDash").at(-1)?.value, [], "rail draw must clear dash state");

  const widths = context.calls.filter((call) => call.type === "lineWidth").map((call) => call.value * zoom);
  assert.ok(widths.length >= 6, "casing and inner strokes should draw for secondary, regional, and mainline rail");
  assert.ok(Math.min(...widths) >= 0.78, `minimum screen width ${Math.min(...widths)} should keep the rail visible floor`);

  const railMetric = metrics.findLast((entry) => entry.name === "drawRailwaysLayer");
  assert.equal(railMetric?.detail?.visibleFeatureCount, 3);
});

test("transport overview road labels use ref/name fields and report labelCount", () => {
  const zoom = 4;
  const { context, metrics, owner } = createLineRenderOwnerHarness({ k: zoom, roadLabelsEnabled: true });
  owner.drawRoadsLayer(zoom);

  assert.ok(context.calls.some((call) => call.type === "fillText" && call.text === "A1"), "road labels should draw from ref/name fields");
  const roadMetric = metrics.findLast((entry) => entry.name === "drawRoadsLayer");
  assert.equal(roadMetric?.detail?.visibleFeatureCount, 2);
  assert.equal(roadMetric?.detail?.labelCount, 1);
});


test("transport pack resolver gates source and family before apply", () => {
  const germanyManifest = {
    pack_id: "germany_road",
    family: "road",
    source_policy: "real_source_cache_only",
    source_signature: { bkg: { filename: "dlm250.zip", path: ".runtime/source-cache/transport/germany_road/dlm250.zip" } },
    mainMapEligible: true,
    apply_bridge_supported: true,
    coverage_scope: "country",
    main_map_consumer: { supported_keys: ["roads", "road_labels"] },
    sidecars: { road_labels: { required: true } },
    paths: { preview: { roads: "roads.preview.topo.json", road_labels: "road_labels.preview.geojson" }, full: { roads: "roads.topo.json", road_labels: "road_labels.geojson" } },
  };
  const passedGate = createTransportPackSourceGateReport("germany_road", germanyManifest);
  assert.equal(passedGate.passed, true);
  assert.equal(resolveTransportActivePack({ activePackId: "germany_road", familyId: "road", manifest: germanyManifest }).ok, true);

  const familyMismatch = resolveTransportActivePack({ activePackId: "usa_airport", familyId: "road" });
  assert.equal(familyMismatch.ok, false);
  assert.equal(familyMismatch.reason, "family_mismatch");

  const missingManifest = resolveTransportActivePack({ activePackId: "germany_road", familyId: "road" });
  assert.equal(missingManifest.ok, false);
  assert.equal(missingManifest.reason, "manifest_missing");

  const missingSignatureGate = createTransportPackSourceGateReport("germany_road", { ...germanyManifest, source_signature: {} });
  assert.equal(missingSignatureGate.passed, false);
  assert.ok(missingSignatureGate.reasons.includes("source_signature_missing"));

  const forbiddenSignatureGate = createTransportPackSourceGateReport("germany_road", {
    ...germanyManifest,
    source_signature: { bad: { filename: "checked_in_global.geojson" } },
  });
  assert.equal(forbiddenSignatureGate.passed, false);
  assert.ok(forbiddenSignatureGate.reasons.includes("forbidden_source_signature"));

  const consumerMissing = resolveTransportActivePack({
    activePackId: "germany_road",
    familyId: "road",
    manifest: germanyManifest,
    consumerAvailable: false,
  });
  assert.equal(consumerMissing.ok, false);
  assert.equal(consumerMissing.reason, "consumer_missing");
});

function createApplyBridgeManifest({ packId, family, sourcePolicy = "real_source_cache_only", supportedKeys, sidecars = {} }) {
  const paths = Object.fromEntries(supportedKeys.map((key) => [key, `${packId}.${key}.geojson`]));
  return {
    pack_id: packId,
    family,
    source_policy: sourcePolicy,
    source_signature: { source: { filename: `${packId}.source`, path: `.runtime/source-cache/transport/${packId}` } },
    mainMapEligible: true,
    apply_bridge_supported: true,
    coverage_scope: "country",
    main_map_consumer: { supported_keys: supportedKeys },
    sidecars,
    paths: { preview: paths, full: paths },
  };
}

test("transport workbench apply patch exposes only main-map bridge fields", () => {
  const roadGate = createTransportPackSourceGateReport("germany_road", createApplyBridgeManifest({
    packId: "germany_road",
    family: "road",
    supportedKeys: ["roads", "road_labels"],
    sidecars: { road_labels: { required: true } },
  }));
  const railGate = createTransportPackSourceGateReport("france_rail", createApplyBridgeManifest({
    packId: "france_rail",
    family: "rail",
    supportedKeys: ["railways", "rail_stations_major"],
    sidecars: { rail_stations_major: { required: true } },
  }));
  const airportGate = createTransportPackSourceGateReport("usa_airport", createApplyBridgeManifest({
    packId: "usa_airport",
    family: "airport",
    supportedKeys: ["airports"],
  }));
  const portGate = createTransportPackSourceGateReport("usa_port", createApplyBridgeManifest({
    packId: "usa_port",
    family: "port",
    supportedKeys: ["ports"],
  }));

  assert.equal(roadGate.passed, true);
  assert.equal(railGate.passed, true);
  assert.equal(airportGate.passed, true);
  assert.equal(portGate.passed, true);

  const roadPatch = resolveTransportOverviewPatchFromWorkbench("road", {
    activePackId: "germany_road",
    packGateReport: roadGate,
    roadClass: ["motorway", "trunk"],
    showRefs: true,
    labelDensityPreset: "sparse",
    baseOpacity: 88,
    motorwayWidth: 3.2,
    trunkWidth: 2.2,
    primaryWidth: 1.2,
  }, { currentVisualMode: "network" });

  assert.deepEqual(Object.keys(roadPatch).sort(), [
    "activePackId",
    "dataLayerKeys",
    "familyConfig",
    "visibilityField",
    "visualMode",
  ].sort());
  assert.deepEqual(roadPatch.dataLayerKeys, ["roads", "road_labels"]);
  assert.equal(roadPatch.activePackId, "germany_road");
  assert.equal(roadPatch.visualMode, "network");
  ["displayConfig", "previewCamera", "compareHeld", "layerOrder"].forEach((previewOnlyKey) => {
    assert.equal(Object.hasOwn(roadPatch, previewOnlyKey), false);
  });

  const railPatch = resolveTransportOverviewPatchFromWorkbench("rail", {
    activePackId: "france_rail",
    packGateReport: railGate,
    importanceThreshold: "regional_core",
    showStationLabels: true,
    lineOpacity: 90,
    stationOpacity: 80,
  });
  assert.deepEqual(railPatch.dataLayerKeys, ["railways", "rail_stations_major"]);

  const airportPatch = resolveTransportOverviewPatchFromWorkbench("airport", {
    activePackId: "usa_airport",
    packGateReport: airportGate,
    importanceThreshold: "national_core",
    showLabels: true,
    baseOpacity: 84,
  });
  assert.deepEqual(airportPatch.dataLayerKeys, ["airports"]);

  const portPatch = resolveTransportOverviewPatchFromWorkbench("port", {
    activePackId: "usa_port",
    packGateReport: portGate,
    importanceThreshold: "national_core",
    showLabels: true,
    baseOpacity: 84,
  });
  assert.deepEqual(portPatch.dataLayerKeys, ["ports"]);

  const missingPortPack = getTransportWorkbenchOverviewBridgeSupport("port", {});
  assert.equal(missingPortPack.supported, false);
  assert.equal(missingPortPack.reason, "active_pack_required");

  const unknownPortPack = getTransportWorkbenchOverviewBridgeSupport("port", { activePackId: "unknown_port", packGateReport: { passed: true } });
  assert.equal(unknownPortPack.supported, false);
  assert.equal(unknownPortPack.reason, "unknown_pack");
});

test("country road overlay consumes road_labels sidecar on the main map", () => {
  const zoom = 4;
  const { context, metrics, owner, appRuntime } = createLineRenderOwnerHarness({ k: zoom, roadLabelsEnabled: true });
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "germany_road",
    family: "road",
    collectionsByLayer: {
      roads: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "motorway", reveal_rank: 1 } },
        ],
      },
      road_labels: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { name: "E35", road_class: "motorway" } },
        ],
      },
    },
  };

  owner.drawRoadsLayer(zoom);

  assert.ok(context.calls.some((call) => call.type === "fillText" && call.text === "E35"), "country road labels should render from the road_labels sidecar");
  const countryRoadMetric = metrics.findLast((entry) => entry.name === "drawCountryRoadsLayer");
  assert.equal(countryRoadMetric?.detail?.visibleFeatureCount, 1);
  assert.equal(countryRoadMetric?.detail?.labelCount, 1);
});

test("country overlay apply preserves overlays for other transport families", () => {
  const zoom = 4;
  const { metrics, owner, appRuntime } = createLineRenderOwnerHarness({ k: zoom });

  applyTransportCountryOverlayState(appRuntime, {
    status: "ready",
    activePackId: "germany_road",
    family: "road",
    collectionsByLayer: {
      roads: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "motorway", reveal_rank: 1 } },
        ],
      },
      road_labels: { type: "FeatureCollection", features: [] },
    },
  });
  applyTransportCountryOverlayState(appRuntime, {
    status: "ready",
    activePackId: "france_rail",
    family: "rail",
    collectionsByLayer: {
      railways: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "mainline", reveal_rank: 1 } },
        ],
      },
      rail_stations_major: { type: "FeatureCollection", features: [] },
    },
  });

  owner.drawRoadsLayer(zoom);
  owner.drawRailwaysLayer(zoom);

  assert.equal(appRuntime.transportCountryOverlayState.activePackIdByFamily.road, "germany_road");
  assert.equal(appRuntime.transportCountryOverlayState.activePackIdByFamily.rail, "france_rail");
  assert.equal(metrics.findLast((entry) => entry.name === "drawCountryRoadsLayer")?.detail?.visibleFeatureCount, 1);
  assert.equal(metrics.findLast((entry) => entry.name === "drawCountryRailwaysLayer")?.detail?.visibleFeatureCount, 1);
});

test("country road sidecar labels without class stay below national label priority", () => {
  const zoom = 4;
  const { context, metrics, owner, appRuntime } = createLineRenderOwnerHarness({ k: zoom, roadLabelsEnabled: true });
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "germany_road",
    family: "road",
    collectionsByLayer: {
      roads: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "motorway", reveal_rank: 1 } },
        ],
      },
      road_labels: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { name: "B532" } },
          { type: "Feature", geometry: { type: "Point", coordinates: [0.6, 0.6] }, properties: { name: "A5", priority: 4 } },
        ],
      },
    },
  };

  owner.drawRoadsLayer(zoom);

  assert.equal(context.calls.some((call) => call.type === "fillText" && call.text === "B532"), false);
  assert.ok(context.calls.some((call) => call.type === "fillText" && call.text === "A5"));
  assert.equal(metrics.findLast((entry) => entry.name === "drawCountryRoadsLayer")?.detail?.labelCount, 1);
});

test("country rail overlay consumes rail_stations_major sidecar with pack-scoped hover keys", () => {
  const zoom = 4;
  const { metrics, owner, appRuntime, hoverEntries } = createLineRenderOwnerHarness({ k: zoom });
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "france_rail",
    family: "rail",
    collectionsByLayer: {
      railways: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "mainline", reveal_rank: 1, name: "LGV" } },
        ],
      },
      rail_stations_major: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0.25, 0.25] }, properties: { id: "station-1", name: "Porte Maillot" } },
        ],
      },
    },
  };

  owner.drawRailwaysLayer(zoom);

  const stationMetric = metrics.findLast((entry) => entry.name === "drawCountryRailStationsMajorLayer");
  assert.equal(stationMetric?.detail?.visibleFeatureCount, 1);
  const stationHoverUpdate = hoverEntries.findLast((entry) => entry.options?.packId === "france_rail");
  assert.equal(stationHoverUpdate?.options?.append, true);
  assert.equal(stationHoverUpdate?.entries?.[0]?.packId, "france_rail");
});

test("country port overlay consumes ports collection with pack-scoped hover keys", () => {
  const zoom = 4;
  const { metrics, owner, appRuntime, hoverEntries } = createLineRenderOwnerHarness({ k: zoom });
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "usa_port",
    family: "port",
    collectionsByLayer: {
      ports: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0.25, 0.25] }, properties: { id: "port-1", name: "Country Port", importance_rank: 2 } },
        ],
      },
    },
  };

  owner.drawPortsLayer(zoom);

  const portMetric = metrics.findLast((entry) => entry.name === "drawCountryPortsLayer");
  assert.equal(portMetric?.detail?.visibleFeatureCount, 1);
  const portHoverUpdate = hoverEntries.findLast((entry) => entry.options?.packId === "usa_port");
  assert.equal(portHoverUpdate?.options?.append, true);
  assert.equal(portHoverUpdate?.entries?.[0]?.packId, "usa_port");
});



test("country road overlay still draws when global road data is empty", () => {
  const zoom = 4;
  const { metrics, owner, appRuntime } = createLineRenderOwnerHarness({ k: zoom, roadLabelsEnabled: true });
  appRuntime.roadsData = { type: "FeatureCollection", features: [] };
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "germany_road",
    family: "road",
    collectionsByLayer: {
      roads: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "motorway", reveal_rank: 1 } },
        ],
      },
      road_labels: { type: "FeatureCollection", features: [] },
    },
  };

  owner.drawRoadsLayer(zoom);

  assert.equal(metrics.findLast((entry) => entry.name === "drawRoadsLayer")?.detail?.reason, "no-data");
  assert.equal(metrics.findLast((entry) => entry.name === "drawCountryRoadsLayer")?.detail?.visibleFeatureCount, 1);
});

test("country rail overlay still draws when global rail data is empty", () => {
  const zoom = 4;
  const { metrics, owner, appRuntime } = createLineRenderOwnerHarness({ k: zoom });
  appRuntime.railwaysData = { type: "FeatureCollection", features: [] };
  appRuntime.transportCountryOverlayState = {
    status: "ready",
    activePackId: "france_rail",
    family: "rail",
    collectionsByLayer: {
      railways: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { class: "mainline", reveal_rank: 1 } },
        ],
      },
      rail_stations_major: { type: "FeatureCollection", features: [] },
    },
  };

  owner.drawRailwaysLayer(zoom);

  assert.equal(metrics.findLast((entry) => entry.name === "drawRailwaysLayer")?.detail?.reason, "no-data");
  assert.equal(metrics.findLast((entry) => entry.name === "drawCountryRailwaysLayer")?.detail?.visibleFeatureCount, 1);
});

test("facility hover semantic dedupe keeps pack-scoped keys and prefers country overlays", () => {
  assert.match(mapRendererSource, /function buildFacilityEntryKey\(entry\) \{[\s\S]*return `\$\{familyId\}:\$\{packId\}:\$\{stableId\}`;/);
  assert.match(mapRendererSource, /function buildFacilityEntrySemanticKey\(entry\) \{[\s\S]*return `\$\{familyId\}:stable:\$\{stableId\}`;/);
  assert.match(mapRendererSource, /dedupeFacilityHoverEntriesBySemanticKey\([\s\S]*getFacilityEntryHitPriority\(entry\) >= getFacilityEntryHitPriority\(existing\)/);
  assert.match(mapRendererSource, /visibleFacilityHoverEntriesByFamily\[normalizedFamilyId\] = dedupeFacilityHoverEntriesBySemanticKey/);
});
