import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TRANSPORT_FACILITY_ICON_CELLS,
  getTransportFacilityIconAtlasImage,
  getTransportFacilityIconAtlasStatus,
  getTransportFacilityIconCell,
  resolveTransportFacilityIconDrawSizePx,
  resolveTransportFacilityIconKey,
} from "../js/core/renderer/transport_facility_icons.js";
import {
  applyTransportFacilityDensity,
  compactTransportFacilityName,
  doTransportFacilityLabelBoxesOverlap,
  findTransportFacilityLabelPlacement,
  getTransportFacilityDensityStrategy,
  getTransportFacilityEntryStableSortKey,
  getTransportFacilityLabelCandidates,
  getTransportOverviewAirportLabelText,
  getTransportOverviewPortLabelText,
} from "../js/core/renderer/transport_facility_display_policy.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";

const globalAirportsUrl = new URL("../data/transport_layers/global_airport/airports.geojson", import.meta.url);
const globalPortsUrl = new URL("../data/transport_layers/global_port/ports.geojson", import.meta.url);

const airportData = JSON.parse(await readFile(globalAirportsUrl, "utf8"));
const portData = JSON.parse(await readFile(globalPortsUrl, "utf8"));

function sampleFeatures(collection, count = 300) {
  return Array.isArray(collection?.features) ? collection.features.slice(0, count) : [];
}

function createRecordingFacilityContext() {
  const calls = [];
  return {
    calls,
    canvas: { width: 800, height: 500 },
    save: () => calls.push({ type: "save" }),
    restore: () => calls.push({ type: "restore" }),
    beginPath: () => calls.push({ type: "beginPath" }),
    moveTo: (x, y) => calls.push({ type: "moveTo", x, y }),
    lineTo: (x, y) => calls.push({ type: "lineTo", x, y }),
    closePath: () => calls.push({ type: "closePath" }),
    rect: (x, y, width, height) => calls.push({ type: "rect", x, y, width, height }),
    arc: (x, y, radius) => calls.push({ type: "arc", x, y, radius }),
    fill: () => calls.push({ type: "fill" }),
    stroke: () => calls.push({ type: "stroke" }),
    strokeText: (text, x, y) => calls.push({ type: "strokeText", text, x, y }),
    fillText: (text, x, y) => calls.push({ type: "fillText", text, x, y }),
    measureText: (text) => ({ width: String(text || "").length * 6 }),
    drawImage: (...args) => calls.push({ type: "drawImage", args }),
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
}

function createFacilityRenderOwnerHarness({
  k = 2,
  features = [],
  familyId = "airport",
  labelDensity = "dense",
  labelsEnabled = true,
  labelMode = "name",
  labelSize = 9,
  labelHalo = 0.22,
  opacity = 1,
  projection = () => [100, 120],
} = {}) {
  const context = createRecordingFacilityContext();
  const metrics = [];
  const hoverUpdates = [];
  const state = {
    showTransport: true,
    showAirports: familyId === "airport",
    showPorts: familyId === "port",
    zoomTransform: { x: 20, y: 30, k },
    styleConfig: {
      transportOverview: {
        visualMode: "distribution",
        [familyId]: {
          opacity,
          visualStrength: 0,
          labelsEnabled,
          labelDensity,
          labelMode,
          labelSize,
          labelHalo,
          scopeLinkMode: "manual",
          scope: familyId === "airport" ? "all_civil" : "expanded",
          importanceThreshold: "all",
        },
      },
    },
    airportsData: familyId === "airport" ? { type: "FeatureCollection", features } : { type: "FeatureCollection", features: [] },
    portsData: familyId === "port" ? { type: "FeatureCollection", features } : { type: "FeatureCollection", features: [] },
  };
  const owner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      buildFacilityEntryKey: (entry) => entry ? `${entry.familyId || ""}:${entry.packId || "global"}:${entry.stableId || ""}` : "",
      buildFacilityTooltipText: (entry) => entry?.properties?.name || "",
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      clearFacilityHoverEntries: (familyIdToClear) => hoverUpdates.push({ familyId: familyIdToClear, entries: [], cleared: true }),
      collectContextMetric: (name, _duration, detail) => metrics.push({ name, detail }),
      getActiveFacilityHighlightEntry: () => null,
      getCanvasColorRelativeLuminance: () => 0.5,
      getContext: () => context,
      getFacilityHoverRadiusPx: (entry) => Number(entry?.markerRadiusPx || 0) + 4,
      getFeatureCollectionFeatureCount: (collection) => Array.isArray(collection?.features) ? collection.features.length : 0,
      getLineMidpointFromCoordinates: () => null,
      getMultiLineLabelAnchor: () => null,
      getPathCanvas: () => null,
      getProjection: () => projection,
      invalidateRenderPasses: () => {},
      mixCanvasColors: (color) => color,
      nowMs: () => 0,
      requestRender: () => {},
      setVisibleFacilityHoverEntries: (familyIdToSet, entries, options = {}) => hoverUpdates.push({ familyId: familyIdToSet, entries, options }),
    },
  });
  return { context, hoverUpdates, metrics, owner, state };
}

test("transport facility icon owner exposes a compact 4x2 atlas contract", () => {
  assert.equal(Object.keys(TRANSPORT_FACILITY_ICON_CELLS).length, 8);
  for (const [key, cell] of Object.entries(TRANSPORT_FACILITY_ICON_CELLS)) {
    assert.equal(getTransportFacilityIconCell(key), cell);
    assert.equal(cell.size, 64);
    assert.ok(cell.x === 0 || cell.x === 64 || cell.x === 128 || cell.x === 192);
    assert.ok(cell.y === 0 || cell.y === 64);
  }
});

test("airport subcategories resolve to stable icon keys", () => {
  assert.equal(resolveTransportFacilityIconKey("airport", { airport_type: "spaceport" }), "airport_spaceport");
  assert.equal(resolveTransportFacilityIconKey("airport", { airport_type: "military" }), "airport_military");
  assert.equal(resolveTransportFacilityIconKey("airport", { airport_type: "major" }), "airport_major");
  assert.equal(resolveTransportFacilityIconKey("airport", { airport_type: "regional" }), "airport_regional");
  assert.equal(resolveTransportFacilityIconKey("airport", { airport_type: "local" }), "airport_local");
  assert.equal(resolveTransportFacilityIconKey("airport", { importance_rank: 3 }), "airport_major");
  assert.equal(resolveTransportFacilityIconKey("airport", { importance_rank: 2 }), "airport_regional");
});

test("port subcategories resolve to stable icon keys", () => {
  assert.equal(resolveTransportFacilityIconKey("port", { legal_designation: "international_hub" }), "port_hub");
  assert.equal(resolveTransportFacilityIconKey("port", { legal_designation: "important" }), "port_important");
  assert.equal(resolveTransportFacilityIconKey("port", { legal_designation: "local" }), "port_local");
  assert.equal(resolveTransportFacilityIconKey("port", { importance_rank: 3 }), "port_hub");
  assert.equal(resolveTransportFacilityIconKey("port", { importance_rank: 2 }), "port_important");
});

test("real transport data maps every airport and port sample to an atlas cell", () => {
  for (const feature of sampleFeatures(airportData)) {
    const key = resolveTransportFacilityIconKey("airport", feature.properties || {});
    assert.ok(getTransportFacilityIconCell(key), `airport icon key ${key} should have a cell`);
  }
  for (const feature of sampleFeatures(portData)) {
    const key = resolveTransportFacilityIconKey("port", feature.properties || {});
    assert.ok(getTransportFacilityIconCell(key), `port icon key ${key} should have a cell`);
  }
});

test("transport facility icon size stays in small screen-pixel bounds", () => {
  for (const familyId of ["airport", "port"]) {
    for (const visualScale of [0.25, 0.6, 1, 1.8, 3]) {
      const size = resolveTransportFacilityIconDrawSizePx(familyId, { importance_rank: 3 }, { visualScale });
      assert.ok(size >= 8, `${familyId} size ${size} should stay readable`);
      assert.ok(size <= 22, `${familyId} size ${size} should stay compact`);
    }
  }
  assert.ok(
    resolveTransportFacilityIconDrawSizePx("airport", { importance_rank: 3 }, { visualScale: 1 })
    > resolveTransportFacilityIconDrawSizePx("airport", { importance_rank: 1 }, { visualScale: 1 }),
    "major airport icons should remain larger than local airport icons",
  );
  assert.ok(
    resolveTransportFacilityIconDrawSizePx("port", { importance_rank: 3 }, { visualScale: 1 })
    > resolveTransportFacilityIconDrawSizePx("port", { importance_rank: 1 }, { visualScale: 1 }),
    "hub port icons should remain larger than local port icons",
  );
});

test("transport facility marker opacity follows the family opacity config", () => {
  const features = [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { stable_key: "airport:opacity:1", importance_rank: 3, name: "Opacity Test Airport" },
  }];
  const lowOpacityHarness = createFacilityRenderOwnerHarness({
    k: 2,
    features,
    opacity: 0.35,
    projection: () => [80, 60],
  });
  lowOpacityHarness.owner.drawAirportsLayer(2);
  const lowOpacity = lowOpacityHarness.context.calls.find((call) => call.type === "globalAlpha")?.value;

  const highOpacityHarness = createFacilityRenderOwnerHarness({
    k: 2,
    features,
    opacity: 0.7,
    projection: () => [80, 60],
  });
  highOpacityHarness.owner.drawAirportsLayer(2);
  const highOpacity = highOpacityHarness.context.calls.find((call) => call.type === "globalAlpha")?.value;

  assert.ok(lowOpacity < 0.72, "low configured opacity should not be forced to the visibility floor");
  assert.equal(Number((highOpacity / lowOpacity).toFixed(2)), 2);
});

test("atlas loading fallback draws visible markers and keeps hover entries", () => {
  const previousImage = globalThis.Image;
  let imageInstance = null;
  const invalidations = [];
  const renderRequests = [];
  class MockImage {
    constructor() {
      imageInstance = this;
      this.complete = false;
      this.naturalWidth = 0;
    }
    set src(value) {
      this.value = value;
    }
  }
  const state = {
    showTransport: true,
    showAirports: true,
    zoomTransform: { x: 20, y: 30, k: 2 },
    airportsData: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.7, 35.7] },
        properties: { stable_key: "airport:test", importance_rank: 3, name: "Test Airport" },
      }],
    },
  };
  try {
    globalThis.Image = MockImage;
    const { context, hoverUpdates, metrics, owner } = createFacilityRenderOwnerHarness({
      k: 2,
      features: state.airportsData.features,
    });
    owner.drawAirportsLayer(1);
    assert.equal(getTransportFacilityIconAtlasStatus(), "loading");
    assert.ok(context.calls.some((call) => call.type === "fill"), "loading atlas should draw a fallback marker");
    assert.equal(context.calls.some((call) => call.type === "drawImage"), false, "loading atlas should avoid drawImage");
    const hoverUpdate = hoverUpdates.findLast((entry) => entry.familyId === "airport");
    assert.equal(hoverUpdate?.entries?.length, 1);
    assert.equal(hoverUpdate.entries[0].shape, "diamond");
    assert.equal(hoverUpdate.entries[0].iconKey, "airport_major");
    assert.equal(metrics.at(-1)?.detail?.skipped, false);
    assert.equal(metrics.at(-1)?.detail?.iconAtlasStatus, "loading");
    assert.equal(metrics.at(-1)?.detail?.visibleFeatureCount, 1);

    imageInstance.naturalWidth = 256;
    imageInstance.onload();
    assert.equal(getTransportFacilityIconAtlasStatus(), "ready");
  } finally {
    globalThis.Image = previousImage;
  }
});

test("atlas ready state draws sprite icons after fallback loading pass", () => {
  const invalidations = [];
  const renderRequests = [];
  const state = {
    showTransport: true,
    showAirports: true,
    zoomTransform: { x: 20, y: 30, k: 2 },
    airportsData: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.7, 35.7] },
        properties: { stable_key: "airport:test", importance_rank: 3, name: "Test Airport" },
      }],
    },
  };
  const context = createRecordingFacilityContext();
  const metrics = [];
  const owner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      buildFacilityEntryKey: (entry) => entry ? `${entry.familyId || ""}:${entry.stableId || ""}` : "",
      buildFacilityTooltipText: () => "",
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      clearFacilityHoverEntries: () => {},
      collectContextMetric: (name, _duration, detail) => metrics.push({ name, detail }),
      getActiveFacilityHighlightEntry: () => null,
      getCanvasColorRelativeLuminance: () => 0.5,
      getContext: () => context,
      getFacilityHoverRadiusPx: () => 12,
      getFeatureCollectionFeatureCount: (collection) => Array.isArray(collection?.features) ? collection.features.length : 0,
      getLineMidpointFromCoordinates: () => null,
      getMultiLineLabelAnchor: () => null,
      getPathCanvas: () => null,
      getProjection: () => () => [100, 120],
      invalidateRenderPasses: () => {},
      mixCanvasColors: (color) => color,
      nowMs: () => 0,
      requestRender: () => {},
      setVisibleFacilityHoverEntries: () => {},
    },
  });
    owner.drawAirportsLayer(1);
    assert.equal(getTransportFacilityIconAtlasStatus(), "ready");
    assert.ok(context.calls.some((call) => call.type === "drawImage"), "ready atlas should draw sprite icons");
    assert.deepEqual(invalidations, []);
    assert.deepEqual(renderRequests, []);
});

test("facility density keeps fewer world entries than regional and local entries", () => {
  const features = Array.from({ length: 30 }, (_, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [index, 0] },
    properties: {
      stable_key: `airport:density:${index}`,
      importance_rank: 3,
      name: `Density ${index}`,
    },
  }));
  const projection = ([x]) => [20 + (Number(x) * 3), 50];
  const counts = [1.2, 3, 5].map((k) => {
    const { metrics, owner } = createFacilityRenderOwnerHarness({ k, features, projection, labelsEnabled: false });
    owner.drawAirportsLayer(k);
    return metrics.findLast((entry) => entry.name === "drawAirportsLayer")?.detail;
  });

  assert.equal(counts[0]?.densityLevel, "world");
  assert.equal(counts[1]?.densityLevel, "regional");
  assert.equal(counts[2]?.densityLevel, "local");
  assert.ok(counts[0].visibleFeatureCount < counts[1].visibleFeatureCount, "world density should hide the most clustered points");
  assert.ok(counts[1].visibleFeatureCount <= counts[2].visibleFeatureCount, "local density should keep at least regional detail");
});

test("facility display policy keeps deterministic density and compact labels", () => {
  assert.deepEqual(getTransportFacilityDensityStrategy(1.2), { level: "world", gridSizePx: 56, maxVisible: 600 });
  assert.deepEqual(getTransportFacilityDensityStrategy(3), { level: "regional", gridSizePx: 32, maxVisible: 1200 });
  assert.deepEqual(getTransportFacilityDensityStrategy(5), { level: "local", gridSizePx: 16, maxVisible: 5000 });

  const densityEntries = [
    { importanceRank: 1, stableSortKey: "b", screenX: 8, screenY: 8 },
    { importanceRank: 3, stableSortKey: "a", screenX: 9, screenY: 9 },
    { importanceRank: 2, stableSortKey: "c", screenX: 80, screenY: 8 },
  ];
  const filtered = applyTransportFacilityDensity(densityEntries, { gridSizePx: 16, maxVisible: 3 });
  assert.deepEqual(filtered.map((entry) => entry.stableSortKey), ["a", "c"]);

  const labelCandidates = getTransportFacilityLabelCandidates([
    { label: "Regional Long Name", importanceRank: 2, stableSortKey: "c" },
    { label: "Major Longer", importanceRank: 3, stableSortKey: "b" },
    { label: "Major", importanceRank: 3, stableSortKey: "a" },
    { label: "", importanceRank: 4, stableSortKey: "d" },
  ], {
    k: 6,
    configuredLabelSize: 9,
    nationalLabelScale: 2,
    regionalLabelScale: 5,
  });
  assert.deepEqual(labelCandidates.map((entry) => entry.stableSortKey), ["a", "b", "c"]);
  assert.deepEqual(getTransportFacilityLabelCandidates([
    { label: "Regional Long Name", importanceRank: 2, stableSortKey: "c" },
  ], {
    k: 5,
    configuredLabelSize: 12,
    nationalLabelScale: 2,
    regionalLabelScale: 5,
  }), []);

  const placements = findTransportFacilityLabelPlacement({
    label: "Alpha",
    screenX: 100,
    screenY: 50,
  }, {
    fontSizePx: 10,
    iconSizePx: 12,
    zoomScale: 2,
    measureText: () => 30,
    zoomTransform: { x: 20, y: 30 },
  });
  assert.equal(placements?.[0]?.textX, 110);
  assert.equal(placements?.[0]?.worldX, 45);
  assert.equal(placements?.[0]?.worldY, 10);
  assert.equal(findTransportFacilityLabelPlacement({ label: "" }), null);
  assert.equal(
    doTransportFacilityLabelBoxesOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 9, y: 9, width: 10, height: 10 },
    ),
    true,
  );
  assert.equal(
    doTransportFacilityLabelBoxesOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 10, width: 10, height: 10 },
    ),
    false,
  );

  assert.equal(
    getTransportFacilityEntryStableSortKey(
      { id: "feature-id" },
      { stable_key: "", name: "Named Facility" },
      [139.7, 35.7],
    ),
    "Named Facility",
  );
  assert.equal(getTransportFacilityEntryStableSortKey({ id: "feature-id" }, {}, []), "feature-id");
  assert.equal(getTransportFacilityEntryStableSortKey({ id: "feature-id" }, {}, [139.7, 35.7]), "139.7:35.7");
  assert.equal(compactTransportFacilityName("Tokyo International Airport Haneda", "airport"), "Tokyo Intl Haneda");
  assert.equal(compactTransportFacilityName("Port of Yokohama Harbor", "port"), "Yokohama Hbr");
  assert.equal(getTransportOverviewAirportLabelText({ iata: "HND", name: "Tokyo International Airport Haneda" }, "adaptive", { scale: 6, importanceRank: 3 }), "HND · Tokyo Intl Haneda");
  assert.equal(getTransportOverviewPortLabelText({ name: "Port of Yokohama Harbor", legal_designation_label: "International hub" }, "adaptive", { scale: 6, importanceRank: 3 }), "Yokohama Hbr · International hub");
});

test("facility labels use bbox placement and report drawn labelCount", () => {
  const features = Array.from({ length: 8 }, (_, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [index, 0] },
    properties: {
      stable_key: `airport:label:${index}`,
      importance_rank: 3,
      name: `Long Airport Label ${index}`,
    },
  }));
  const projection = ([x]) => [100 + (Number(x) * 4), 50];
  const { context, metrics, owner } = createFacilityRenderOwnerHarness({
    k: 6,
    features,
    projection,
    labelsEnabled: true,
    labelDensity: "dense",
  });
  owner.resetLabelCandidates();
  owner.drawAirportsLayer(6);
  assert.equal(context.calls.filter((call) => call.type === "fillText").length, 0);
  owner.drawPendingLabels(6, { occupiedBoxes: [] });

  const labels = context.calls.filter((call) => call.type === "fillText");
  const metric = metrics.findLast((entry) => entry.name === "drawAirportsLayerLabels");
  assert.equal(metric?.detail?.labelCount, labels.length);
  assert.ok(labels.length > 0, "at least one label should be drawn");
  assert.ok(labels.length < features.length, "bbox placement should skip labels when all directions collide");
  assert.ok(
    labels.some((label) => label.x < 100) || labels.some((label) => label.y !== 50),
    "labels should move beyond the default right-side placement when boxes collide",
  );
});

test("facility label size, halo, and adaptive text follow overview config", () => {
  const features = [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      stable_key: "airport:adaptive:1",
      importance_rank: 3,
      iata: "HND",
      name: "Tokyo International Airport Haneda",
    },
  }];
  const { context, owner } = createFacilityRenderOwnerHarness({
    k: 6,
    features,
    labelsEnabled: true,
    labelMode: "adaptive",
    labelSize: 12,
    labelHalo: 0.1,
    projection: () => [80, 60],
  });
  owner.resetLabelCandidates();
  owner.drawAirportsLayer(6);
  owner.drawPendingLabels(6, { occupiedBoxes: [] });

  const label = context.calls.find((call) => call.type === "fillText");
  assert.equal(label?.text, "HND");
  const fontCall = context.calls.findLast((call) => call.type === "font");
  assert.match(fontCall?.value || "", /2px "IBM Plex Sans"/);
  const lineWidthCall = context.calls.findLast((call) => call.type === "lineWidth");
  assert.ok(lineWidthCall?.value < 0.2, "light facility halo should stay visually thin at high zoom");
});

test("atlas loader exposes loading and ready states without registering invisible targets", async () => {
  const moduleUrl = new URL(`../js/core/renderer/transport_facility_icons.js?ready-status=${Date.now()}`, import.meta.url);
  const iconModule = await import(moduleUrl.href);
  const previousImage = globalThis.Image;
  let imageInstance = null;
  let callbackCount = 0;
  class MockImage {
    constructor() {
      imageInstance = this;
      this.complete = false;
      this.naturalWidth = 0;
    }
    set src(value) {
      this.value = value;
    }
  }
  try {
    globalThis.Image = MockImage;
    const image = iconModule.getTransportFacilityIconAtlasImage(() => {
      callbackCount += 1;
    });
    assert.equal(image, imageInstance);
    assert.equal(iconModule.getTransportFacilityIconAtlasStatus(), "loading");
    imageInstance.naturalWidth = 256;
    imageInstance.onload();
    assert.equal(iconModule.getTransportFacilityIconAtlasStatus(), "ready");
    assert.equal(callbackCount, 1);
    assert.equal(iconModule.isTransportFacilityIconAtlasReady(), true);
  } finally {
    globalThis.Image = previousImage;
  }
});

test("atlas loader exposes error state for render-owner gating", async () => {
  const moduleUrl = new URL(`../js/core/renderer/transport_facility_icons.js?error-status=${Date.now()}`, import.meta.url);
  const iconModule = await import(moduleUrl.href);
  const previousImage = globalThis.Image;
  let imageInstance = null;
  class MockImage {
    constructor() {
      imageInstance = this;
      this.complete = false;
      this.naturalWidth = 0;
    }
    set src(value) {
      this.value = value;
    }
  }
  try {
    globalThis.Image = MockImage;
    iconModule.getTransportFacilityIconAtlasImage(() => {});
    imageInstance.onerror();
    assert.equal(iconModule.getTransportFacilityIconAtlasStatus(), "error");
    assert.equal(iconModule.isTransportFacilityIconAtlasReady(), false);
  } finally {
    globalThis.Image = previousImage;
  }
});
