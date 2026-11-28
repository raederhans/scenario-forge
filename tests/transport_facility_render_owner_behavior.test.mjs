import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getTransportFacilityIconAtlasStatus,
  getTransportFacilityIconCell,
  resolveTransportFacilityIconKey,
} from "../js/core/renderer/transport_facility_icons.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";

const globalAirportsUrl = new URL("../data/transport_layers/global_airport/airports.geojson", import.meta.url);
const globalPortsUrl = new URL("../data/transport_layers/global_port/ports.geojson", import.meta.url);

const airportData = JSON.parse(await readFile(globalAirportsUrl, "utf8"));
const portData = JSON.parse(await readFile(globalPortsUrl, "utf8"));

function sampleFeatures(collection, count = 300) {
  return Array.isArray(collection?.features) ? collection.features.slice(0, count) : [];
}

function createFacilityRenderOwnerHarness({ k = 2, features, projection = () => [100, 120] }) {
  const context = {
    canvas: { width: 800, height: 500 },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, rect() {}, arc() {}, fill() {}, stroke() {},
  };
  const hoverUpdates = [];
  const state = {
    showTransport: true,
    showAirports: true,
    zoomTransform: { x: 20, y: 30, k },
    styleConfig: {
      transportOverview: {
        visualMode: "distribution",
        airport: {
          labelsEnabled: false,
          scopeLinkMode: "manual", scope: "all_civil",
          importanceThreshold: "all",
        },
      },
    },
    airportsData: { type: "FeatureCollection", features },
  };
  const owner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      buildFacilityEntryKey: (entry) => entry ? `${entry.familyId || ""}:${entry.packId || "global"}:${entry.stableId || ""}` : "",
      buildFacilityTooltipText: (entry) => entry?.properties?.name || "",
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      clearFacilityHoverEntries: (familyIdToClear) => hoverUpdates.push({ familyId: familyIdToClear, entries: [], cleared: true }),
      getActiveFacilityHighlightEntry: () => null,
      getCanvasColorRelativeLuminance: () => 0.5,
      collectContextMetric() {},
      getContext: () => context,
      getFacilityHoverRadiusPx: (entry) => Number(entry?.markerRadiusPx || 0) + 4,
      getFeatureCollectionFeatureCount: (collection) => Array.isArray(collection?.features) ? collection.features.length : 0,
      getProjection: () => projection,
      invalidateRenderPasses: () => {},
      mixCanvasColors: (color) => color,
      nowMs: () => 0,
      requestRender: () => {},
      setVisibleFacilityHoverEntries: (familyIdToSet, entries, options = {}) => hoverUpdates.push({ familyId: familyIdToSet, entries, options }),
    },
  });
  return { context, hoverUpdates, owner };
}

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

test("airports remain hittable while their icon atlas loads", () => {
  const previousImage = globalThis.Image;
  class MockImage {}
  const state = {
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
    const { hoverUpdates, owner } = createFacilityRenderOwnerHarness({
      k: 2,
      features: state.airportsData.features,
    });
    owner.drawAirportsLayer(1);
    assert.equal(getTransportFacilityIconAtlasStatus(), "loading");
    const hoverUpdate = hoverUpdates.findLast((entry) => entry.familyId === "airport");
    assert.equal(hoverUpdate?.entries?.length, 1);
  } finally {
    globalThis.Image = previousImage;
  }
});

test("facility candidates are clipped to what the target canvas paints at any device pixel ratio", () => {
  const point = (name, x, y) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { stable_key: `airport:clip:${name}`, importance_rank: 3, name },
  });
  // Logical viewport 400x250 at zoom {x: 20, y: 30, k: 2}; the pass canvas adds 60px of overscan per side.
  const features = [
    point("inside", 50, 50),            // screen x 120
    point("left-overscan", -30, 50),    // screen x -40
    point("left-outside", -63, 50),     // screen x -106, past overscan + padding
    point("right-overscan", 210, 50),   // screen x 440
    point("right-outside", 243, 50),    // screen x 506, past overscan + padding
    point("top-overscan", 50, -35),     // screen y -40
    point("bottom-outside", 50, 162),   // screen y 354, past overscan + padding
  ];
  const visibleNames = (dpr) => {
    const harness = createFacilityRenderOwnerHarness({ k: 2, features, projection: ([x, y]) => [x, y] });
    const overscan = 60;
    harness.context.canvas = { width: (400 + overscan * 2) * dpr, height: (250 + overscan * 2) * dpr };
    harness.context.getTransform = () => ({ a: dpr * 2, b: 0, c: 0, d: dpr * 2,
      e: dpr * (overscan + 20), f: dpr * (overscan + 30) });
    harness.owner.drawAirportsLayer(2);
    return harness.hoverUpdates.at(-1).entries.map((entry) => entry.properties.name).sort();
  };
  const expected = ["inside", "left-overscan", "right-overscan", "top-overscan"];
  assert.deepEqual(visibleNames(1), expected);
  assert.deepEqual(visibleNames(2), expected);
});
