import test from "node:test";
import assert from "node:assert/strict";
import { resolveTransportOverviewLineStrategy } from "../js/core/transport_capability_registry.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import {
  getIncludedTransportOverviewLineClass,
  getTransportOverviewLabelZoomConfig,
  shouldIncludeTransportOverviewLineFeature,
} from "../js/core/transport_overview_visibility_policy.js";

function assertClose(actual, expected, message = "") {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message || `expected ${actual} to be close to ${expected}`,
  );
}

test("regional rail scope includes secondary and regional lines", () => {
  const strategy = resolveTransportOverviewLineStrategy("rail", {
    scope: "mainline_plus_regional", importanceThreshold: "secondary",
  }, { scale: 5 });
  const included = ["secondary", "regional"].filter((lineClass) => shouldIncludeTransportOverviewLineFeature(
    "rail", { properties: { class: lineClass, reveal_rank: 2 } }, strategy,
  ));
  assert.ok(included.includes("secondary"));
  assert.ok(included.includes("regional"));
});

test("road scope admits trunk and excludes lower road classes", () => {
  const roadBroadStrategy = resolveTransportOverviewLineStrategy(
    "road",
    { scope: "motorway_trunk", importanceThreshold: "secondary" },
    { scale: 5 },
  );
  assert.equal(getIncludedTransportOverviewLineClass("road", { properties: { class: "service", reveal_rank: 1 } }, roadBroadStrategy), "");
  assert.equal(getIncludedTransportOverviewLineClass("road", { properties: { class: "trunk" } }, roadBroadStrategy), "trunk");
  assert.equal(shouldIncludeTransportOverviewLineFeature("road", { properties: { class: "primary", reveal_rank: 3 } }, roadBroadStrategy), false);
});

test("dense rail labels retain national and regional zoom boundaries", () => {
  const denseRailZoom = getTransportOverviewLabelZoomConfig("rail", "dense");
  assertClose(denseRailZoom.nationalLabelScale, 1.85);
  assertClose(denseRailZoom.regionalLabelScale, 4.5);
});

function createRecordingCanvasContext() {
  const calls = [];
  let currentFont = "10px sans-serif";
  const context = {
    calls,
    save() {}, restore() {}, beginPath() {}, rect() {}, fill() {}, stroke() {}, strokeText() {},
    fillText: (text, x, y) => calls.push({ type: "fillText", text, x, y }),
    measureText: (text) => ({ width: String(text).length * Number(currentFont.match(/([\d.]+)px/)[1]) * 0.58 }),
    setLineDash() {},
    set font(value) { currentFont = value; },
  };
  return context;
}

function createLineRenderOwnerHarness() {
  const context = createRecordingCanvasContext();
  const state = {
    showTransport: true,
    showRoad: true,
    showRail: true,
    zoomTransform: { k: 8 },
    styleConfig: {
      transportOverview: {
        visualMode: "network",
        road: {
          opacity: 1,
          visualStrength: 0,
          labelsEnabled: true,
          labelDensity: "dense",
          labelMode: "ref",
          scopeLinkMode: "manual",
          scope: "motorway_trunk",
          importanceThreshold: "secondary",
        },
        rail: {
          opacity: 1,
          visualStrength: 0,
          labelsEnabled: true,
          labelDensity: "dense",
          labelMode: "name",
          scopeLinkMode: "manual",
          scope: "mainline_plus_regional",
          importanceThreshold: "secondary",
        },
      },
    },
    roadsData: { type: "FeatureCollection", features: [lineLabelFeature("road", "A1")] },
    railwaysData: { type: "FeatureCollection", features: [lineLabelFeature("rail", "Mainline")] },
  };
  const owner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      collectContextMetric() {},
      getContext: () => context,
      getFeatureCollectionFeatureCount: (collection) => Array.isArray(collection?.features) ? collection.features.length : 0,
      getLineMidpointFromCoordinates: (coordinates) => coordinates[Math.floor((coordinates.length - 1) / 2)] || null,
      getMultiLineLabelAnchor: (geometry) => geometry?.coordinates?.[0]?.[0] || null,
      getPathCanvas: () => () => {},
      getProjection: () => ([x, y]) => [Number(x) * 100, Number(y) * 100],
      mixCanvasColors: (color) => color,
      nowMs: () => 0,
    },
  });
  return { context, owner };
}

function lineLabelFeature(family, label, x = 0, y = 0, length = 0.6, secondary = false) {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[x, y], [x + length, y]] },
    properties: family === "road"
      ? { class: secondary ? "trunk" : "motorway", reveal_rank: 1, ref: label }
      : { class: secondary ? "regional" : "mainline", reveal_rank: 1, name: label },
  };
}

test("road and rail candidates share occupancy with each other and city labels", () => {
  const { owner, context } = createLineRenderOwnerHarness();
  owner.drawRoadsLayer(8);
  owner.drawRailwaysLayer(8);
  const boxes = [];
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes: boxes }), 1);
  assert.deepEqual(context.calls.filter((call) => call.type === "fillText").map((call) => call.text), ["A1"]);
  context.calls.length = 0;
  const cityBox = { x: -10, y: -8, w: 20, h: 16 };
  assert.equal(owner.drawPendingLabels(8, { occupiedBoxes: [cityBox] }), 0);
  assert.equal(context.calls.some((call) => call.type === "fillText"), false);
  owner.resetLabelCandidates();
  owner.drawRailwaysLayer(8);
  owner.drawRoadsLayer(8);
  assert.equal(owner.drawPendingLabels(8), 1);
  assert.deepEqual(context.calls.filter((call) => call.type === "fillText").map((call) => call.text), ["Mainline"]);
});
