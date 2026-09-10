import test from "node:test";
import assert from "node:assert/strict";

import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    globalAlpha: 1,
    lineCap: "",
    lineJoin: "",
    lineWidth: 1,
    strokeStyle: "",
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    fill(path) {
      calls.push({ type: "fill", path, fillStyle: this.fillStyle, alpha: this.globalAlpha });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    save() {
      calls.push({ type: "save" });
    },
    stroke(path) {
      calls.push({
        type: "stroke",
        path,
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
      });
    },
  };
}

function createFeature(depth, source = "global") {
  return {
    type: "Feature",
    properties: {
      _bathymetrySource: source,
      depth_max_m: depth,
    },
    geometry: {
      type: "Polygon",
      coordinates: [],
    },
  };
}

function createOwner({
  bathymetryData = {},
  context = createCanvasContext(),
  coastlineSource = "global",
  oceanStyle = {
    contourStrength: 0.5,
    experimentalAdvancedStyles: true,
    opacity: 1,
    preset: "layered",
    scale: 1,
  },
  state = {},
  overlayFeatures = [],
  helperOverrides = {},
} = {}) {
  const helperCalls = [];
  const pathCalls = [];
  const runtimeState = {
    styleConfig: {
      coastlines: {
        color: "#ddeeff",
        opacity: 0.75,
        width: 1.2,
      },
    },
    zoomTransform: { k: 1 },
    ...state,
  };
  const owner = createOceanRenderOwner({
    state: runtimeState,
    constants: {
      COASTLINE_ACCENT_DENSITY_ALPHA_LOW: 0.5,
      COASTLINE_ACCENT_DENSITY_ALPHA_MID: 0.75,
      COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW: 1,
      COASTLINE_ACCENT_DENSITY_THRESHOLD_MID: 2,
      COASTLINE_ACCENT_DENSITY_WIDTH_SCALE: 0.9,
      COASTLINE_LOD_LOW_ZOOM_MAX: 2,
      COASTLINE_LOD_MID_ZOOM_MAX: 4,
      OCEAN_MASK_MODE_BATHYMETRY: "bathymetry_features",
      OCEAN_MASK_MODE_TOPOLOGY: "topology_ocean",
      TNO_COASTAL_ACCENT_COLOR: "rgba(1, 2, 3, 0.5)",
    },
    getters: {
      getContext: () => context,
      getPathCanvas: () => (feature) => pathCalls.push(feature),
    },
    helpers: {
      applyBathymetryCoverageExclusionMask: (coverage) => helperCalls.push({ type: "coverage-mask", coverage }),
      applyOceanClipMask: (mode) => helperCalls.push({ type: "ocean-mask", mode }),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      clipOutAtlantropaAccentRegions: () => helperCalls.push({ type: "clip-atlantropa" }),
      doesOceanStyleRequireBathymetry: () => true,
      ensureBathymetryDataAvailability: (options) => helperCalls.push({ type: "ensure-bathymetry", options }),
      getBathymetryBandFillStyle: (feature) => `band-${feature.properties.depth_max_m}`,
      getBathymetryBandVisibilityConfig: () => ({ alpha: 0.8 }),
      getBathymetryCollectionBySource: (collection, source) => ({
        type: "FeatureCollection",
        features: (collection?.features || []).filter((feature) => feature.properties._bathymetrySource === source),
      }),
      getBathymetryContourStrokeStyle: (feature) => `contour-${feature.properties.depth_max_m}`,
      getBathymetryContourVisibilityConfig: () => ({ alpha: 0.6 }),
      getBathymetryFeatureCollections: () => bathymetryData,
      getBathymetryFeatureDepthMax: (feature) => Number(feature?.properties?.depth_max_m || 0),
      getBathymetryPresetProfile: () => ({
        contourLineWidthBase: 0.5,
        contourLineWidthScale: 1,
        skipAlternateContourDepths: true,
      }),
      getCoastlineCollectionForZoom: () => [
        {
          coordinates: [
            [[0, 0], [1, 1]],
            [[2, 2], [3, 3]],
          ],
        },
      ],
      getOceanStyleConfig: () => oceanStyle,
      getProjectedLineDensityStats: (line) => ({ density: line[0][0] === 0 ? 5 : 0 }),
      getSafeCanvasColor: (value, fallback) => value || fallback,
      getScenarioCoastalAccentLineWidth: () => 2,
      getScenarioCoastalAccentOverlayFeatures: () => overlayFeatures,
      getScenarioCoastalAccentOverlayVisualConfig: () => ({ alpha: 0.4, lineWidth: 1 }),
      getViewportAwareCoastlineCollection: (collection) => collection,
      isScenarioCoastalAccentEnabled: () => true,
      isUsableMesh: (mesh) => Array.isArray(mesh?.coordinates),
      pathBoundsInScreen: () => true,
      resolveCoastlineTopologySource: () => ({ source: coastlineSource }),
      resolveOceanMask: () => ({ mode: "topology_ocean", quality: 1 }),
      ...helperOverrides,
      sortBathymetryFeaturesForFill: (collection) => [...(collection?.features || [])].sort(
        (a, b) => b.properties.depth_max_m - a.properties.depth_max_m,
      ),
    },
  });
  return { context, helperCalls, owner, pathCalls, state: runtimeState };
}

test("ocean owner records topology mask when advanced bathymetry is inactive", () => {
  const harness = createOwner({
    oceanStyle: {
      contourStrength: 0,
      experimentalAdvancedStyles: false,
      opacity: 1,
      preset: "flat",
      scale: 1,
    },
  });

  harness.owner.drawOceanStyle();

  assert.equal(harness.state.oceanMaskMode, "topology_ocean");
  assert.equal(harness.state.oceanMaskQuality, 0);
  assert.deepEqual(harness.context.calls, []);
  assert.equal(harness.helperCalls[0].type, "ensure-bathymetry");
});

test("ocean owner draws global and scenario bathymetry behind the bathymetry mask mode", () => {
  const globalBand = createFeature(1000, "global");
  const scenarioBand = createFeature(250, "scenario");
  const globalContour = createFeature(2000, "global");
  const scenarioContour = createFeature(750, "scenario");
  const scenarioCoverage = { type: "FeatureCollection", features: [createFeature(25, "scenario")] };
  const harness = createOwner({
    bathymetryData: {
      bands: { type: "FeatureCollection", features: [globalBand, scenarioBand] },
      contours: { type: "FeatureCollection", features: [globalContour, scenarioContour] },
      scenarioCoverage,
    },
  });

  harness.owner.drawOceanStyle();

  assert.equal(harness.state.oceanMaskMode, "bathymetry_features");
  assert.equal(harness.state.oceanMaskQuality, 1);
  assert.deepEqual(
    harness.helperCalls.map((call) => call.type),
    ["ensure-bathymetry", "ocean-mask", "coverage-mask", "coverage-mask"],
  );
  assert.equal(harness.context.calls.filter((call) => call.type === "fill").length, 2);
  assert.equal(harness.context.calls.filter((call) => call.type === "stroke").length, 2);
  assert.ok(harness.pathCalls.includes(globalBand));
  assert.ok(harness.pathCalls.includes(scenarioBand));
  assert.ok(harness.pathCalls.includes(globalContour));
  assert.ok(harness.pathCalls.includes(scenarioContour));
});

test("ocean owner skips alternate contour depths through the preset profile", () => {
  const features = [
    createFeature(100, "global"),
    createFeature(200, "global"),
    createFeature(300, "global"),
  ];
  const harness = createOwner();
  const visibleDepths = harness.owner.buildVisibleBathymetryContourDepthSet(
    { type: "FeatureCollection", features },
    { preset: "layered" },
  );

  assert.deepEqual([...visibleDepths], [100, 300]);
});

test("coastal accent batching clips global coastlines and skips duplicate scenario overlays", () => {
  const overlayFeature = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [[4, 4], [5, 5]],
    },
  };
  for (const coastlineSource of ["global", "scenario"]) {
    const harness = createOwner({ coastlineSource, overlayFeatures: coastlineSource === "scenario" ? [overlayFeature] : [] });
    harness.owner.drawScenarioCoastalAccentLayer(1, { interactive: false });
    assert.equal(harness.helperCalls.some(call => call.type === "clip-atlantropa"), coastlineSource === "global");
    const strokes = harness.context.calls.filter(call => call.type === "stroke");
    assert.equal(strokes.length, 2, coastlineSource);
    if (coastlineSource === "global") assert.ok(strokes[0].alpha < strokes[1].alpha);
    else assert.equal(harness.pathCalls.includes(overlayFeature), false);
  }
});

test("ocean owner suppresses coastal accents for HGO vector scenes", () => {
  const harness = createOwner({
    state: {
      activeScenarioManifest: {
        scenario_contract_profile: "hgo_vector",
        performance_hints: {
          hgo_vector_scene_default: true,
        },
      },
    },
  });

  harness.owner.drawScenarioCoastalAccentLayer(1, { interactive: false });

  assert.equal(harness.helperCalls.some((call) => call.type === "clip-atlantropa"), false);
  assert.equal(harness.pathCalls.length, 0);
  assert.equal(harness.context.calls.filter((call) => call.type === "stroke").length, 0);
});

for (const [method, paintType, visibilityHelper, metricName] of [
  ["drawBathymetryBands", "fill", "getBathymetryBandVisibilityConfig", "drawBathymetryBands"],
  ["drawBathymetryContours", "stroke", "getBathymetryContourVisibilityConfig", "drawBathymetryContours"],
]) {
  for (const cached of [true, false]) {
    test(`${method} ${cached ? "passes cached path only to paint" : "uses the existing current-path fallback"}`, () => {
      const feature = createFeature(100);
      const cachedPath = { name: "cached-path" };
      const requests = [];
      const metrics = [];
      const harness = createOwner({ helperOverrides: {
        getProjectedGeographicPath: (object) => { requests.push(object); return cached ? cachedPath : null; },
        collectContextMetric: (name, duration, details) => metrics.push({ name, details }),
      } });
      harness.owner[method]({ features: [feature] }, { contourStrength: 0.5 });
      const paintCalls = harness.context.calls.filter((call) => call.type === "fill" || call.type === "stroke");
      assert.equal(paintCalls.length, 1);
      assert.equal(paintCalls[0].type, paintType);
      assert.equal(paintCalls[0].path, cached ? cachedPath : undefined);
      assert.deepEqual(harness.pathCalls, cached ? [] : [feature]);
      assert.equal(harness.context.calls.filter((call) => call.type === "beginPath").length, cached ? 0 : 1);
      assert.deepEqual(requests, [feature]);
      assert.deepEqual(metrics, [{ name: metricName, details: { featureCount: 1, renderedCount: 1 } }]);
    });
  }

  test(`${method} skips offscreen and zero-alpha features before requesting paths`, () => {
    const zeroAlpha = createFeature(100);
    const offscreen = createFeature(200);
    const visible = createFeature(300);
    const requests = [];
    const boundsRequests = [];
    const metrics = [];
    const harness = createOwner({ helperOverrides: {
      getBathymetryPresetProfile: () => ({ skipAlternateContourDepths: false }),
      [visibilityHelper]: (feature) => ({ alpha: feature === zeroAlpha ? 0 : 1 }),
      pathBoundsInScreen: (feature) => { boundsRequests.push(feature); return feature !== offscreen; },
      getProjectedGeographicPath: (feature) => { requests.push(feature); return { feature }; },
      collectContextMetric: (name, duration, details) => metrics.push({ name, details }),
    } });
    harness.owner[method]({ features: [zeroAlpha, offscreen, visible] }, { contourStrength: 0.5 });
    assert.deepEqual(requests, [visible]);
    assert.ok(!boundsRequests.includes(zeroAlpha));
    assert.deepEqual(harness.pathCalls, []);
    const paints = harness.context.calls.filter((call) => call.type === "fill" || call.type === "stroke");
    assert.equal(paints.length, 1);
    assert.equal(paints[0].type, paintType);
    assert.deepEqual(metrics, [{ name: metricName, details: { featureCount: 3, renderedCount: 1 } }]);
  });
}
