import test from "node:test";
import assert from "node:assert/strict";

import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";

function createCanvasContext() {
  const calls = [];
  const stack = [];
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
      Object.assign(this, stack.pop());
    },
    save() {
      calls.push({ type: "save" });
      stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle, lineCap: this.lineCap, lineJoin: this.lineJoin });
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
  exportRendering = false,
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
      isExportRendering: () => exportRendering,
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
      getPhysicalLandMaskInfo: () => ({ collection: { type: "FeatureCollection", features: [createFeature(0)] } }),
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

test("contour strokes keep the same screen width after zoom", () => {
  const collection = { features: [createFeature(2000)] };
  const widths = [];
  for (const k of [1, 4, 8]) {
    const h = createOwner({ state: { zoomTransform: { k } } });
    h.owner.drawBathymetryContours(collection, { opacity: 1, contourStrength: 0.8, preset: "bathymetry_contours" });
    widths.push(h.context.calls.find(call => call.type === "stroke").lineWidth * k);
  }
  assert.deepEqual(widths, [1.3, 1.3, 1.3]);
});

test("bathymetry diagnostics distinguish an empty viewport and zero opacity", () => {
  for (const opacity of [0, 1]) {
    let summary;
    const h = createOwner({ bathymetryData: { bands: { features: [createFeature(200)] } },
      oceanStyle: { experimentalAdvancedStyles: true, preset: "bathymetry_soft", opacity, contourStrength: 0, scale: 1 },
      helperOverrides: { pathBoundsInScreen: () => false, publishBathymetryVisibility: value => { summary = value; } },
    });
    h.owner.drawOceanStyle();
    assert.equal(summary.status, opacity ? "ready" : "hidden");
    assert.equal(summary.visibleCount, 0);
  }
});

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
    ["ensure-bathymetry", "ocean-mask", "coverage-mask"],
  );
  assert.equal(harness.context.calls.filter((call) => call.type === "fill").length, 2);
  assert.equal(harness.context.calls.filter((call) => call.type === "stroke").length, 2);
  assert.ok(harness.pathCalls.includes(globalBand));
  assert.ok(harness.pathCalls.includes(scenarioBand));
  assert.ok(harness.pathCalls.includes(globalContour));
  assert.ok(harness.pathCalls.includes(scenarioContour));
});

test("overview geometry is selected below zoom two while scenario geometry stays detailed", () => {
  const detailBand = createFeature(1000);
  const overviewBand = createFeature(1000);
  const scenarioBand = createFeature(250, "scenario");
  const detailContour = createFeature(2000);
  const overviewContour = createFeature(2000);
  const scenarioContour = createFeature(750, "scenario");
  const bathymetryData = {
    bands: { features: [detailBand, scenarioBand] },
    contours: { features: [detailContour, scenarioContour] },
    globalOverviewBands: { features: [overviewBand] },
    globalOverviewContours: { features: [overviewContour] },
  };
  for (const [zoom, exportRendering, expectedBand, expectedContour] of [
    [1.99, false, overviewBand, overviewContour],
    [2, false, detailBand, detailContour],
    [1.99, true, detailBand, detailContour],
  ]) {
    let summary;
    const harness = createOwner({ bathymetryData, exportRendering, state: { zoomTransform: { k: zoom } },
      helperOverrides: { publishBathymetryVisibility: value => { summary = value; } },
    });
    harness.owner.drawOceanStyle();
    assert.equal(summary.lod, expectedBand === overviewBand ? "overview" : "detail");
    assert.equal(summary.visibleCount, 4);
    assert.ok(harness.pathCalls.includes(expectedBand), `band at zoom ${zoom}, export=${exportRendering}`);
    assert.ok(harness.pathCalls.includes(expectedContour), `contour at zoom ${zoom}, export=${exportRendering}`);
    assert.ok(harness.pathCalls.includes(scenarioBand));
    assert.ok(harness.pathCalls.includes(scenarioContour));
    assert.equal(harness.pathCalls.includes(expectedBand === detailBand ? overviewBand : detailBand), false);
    assert.equal(harness.pathCalls.includes(expectedContour === detailContour ? overviewContour : detailContour), false);
  }
});

test("missing, partial or empty overview collections fall back to global detail", () => {
  const detailBand = createFeature(1000);
  const detailContour = createFeature(2000);
  for (const [overviewBands, overviewContours] of [
    [undefined, undefined],
    [{ features: [] }, { features: [] }],
    [{ features: [createFeature(1000)] }, undefined],
  ]) {
    let summary;
    const harness = createOwner({
      bathymetryData: {
        bands: { features: [detailBand] },
        contours: { features: [detailContour] },
        globalOverviewBands: overviewBands,
        globalOverviewContours: overviewContours,
      },
      state: { zoomTransform: { k: 1.5 } },
      helperOverrides: { publishBathymetryVisibility: value => { summary = value; } },
    });
    harness.owner.drawOceanStyle();
    assert.equal(summary.lod, "detail");
    assert.ok(harness.pathCalls.includes(detailBand));
    assert.ok(harness.pathCalls.includes(detailContour));
  }
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

test("coastal transition uses physical land exclusion and conservative Atlantropa clipping for every coastline source", () => {
  for (const coastlineSource of ["global", "scenario"]) {
    for (const mode of ["topology_ocean", "sphere_minus_land"]) {
      const events = [];
      const harness = createOwner({ coastlineSource, helperOverrides: {
        resolveOceanMask: () => ({ mode }),
        applyOceanClipMask: (selectedMode) => events.push(["ocean-mask", selectedMode]),
        clipOutAtlantropaAccentRegions: () => events.push(["atlantropa"]),
      } });
      harness.context.globalAlpha = 0.4;
      harness.context.strokeStyle = "#333333";
      harness.context.lineWidth = 0.9;
      const drawn = harness.owner.drawCoastalTransition(2, { lineWidth: 0.9, buildPath: () => events.push(["build-path"]) });
      assert.equal(drawn, true);
      assert.deepEqual(events, [
        ["ocean-mask", "sphere_minus_land"],
        ["atlantropa"],
        ["build-path"],
      ]);
      const stroke = harness.context.calls.find(call => call.type === "stroke");
      assert.equal(stroke.strokeStyle, "#d7ebf5");
      assert.equal(stroke.alpha, 0.75 * 0.13);
      assert.equal(stroke.lineWidth, 2);
      assert.equal(harness.context.globalAlpha, 0.4);
      assert.equal(harness.context.strokeStyle, "#333333");
      assert.equal(harness.context.lineWidth, 0.9);
    }
  }
});

test("coastal transition keeps a narrow screen-space extension across zooms", () => {
  for (const k of [1, 2, 4, 8]) {
    const harness = createOwner();
    harness.owner.drawCoastalTransition(k, { lineWidth: 1.2 / k, buildPath: () => {} });
    const stroke = harness.context.calls.find(call => call.type === "stroke");
    assert.ok(Math.abs(stroke.lineWidth * k - 3.4) < 0.0001);
  }
});

test("coastal transition rejects disabled or unusable requests before clipping or geometry", () => {
  for (const state of [
    { styleConfig: { coastlines: { opacity: 0 } } },
  ]) {
    const harness = createOwner({ state });
    assert.equal(harness.owner.drawCoastalTransition(2, { lineWidth: 1, buildPath: () => assert.fail("unexpected geometry") }), false);
    assert.deepEqual(harness.helperCalls, []);
    assert.deepEqual(harness.context.calls, []);
  }
  for (const options of [{}, { lineWidth: 0, buildPath: () => assert.fail("unexpected geometry") }]) {
    const harness = createOwner();
    assert.equal(harness.owner.drawCoastalTransition(2, options), false);
    assert.deepEqual(harness.helperCalls, []);
  }
});

test("coastal transition fails closed when no usable physical land mask exists", () => {
  for (const maskInfo of [null, { collection: null }, { collection: null, maskSource: "none:rejected" }]) {
    const harness = createOwner({ helperOverrides: { getPhysicalLandMaskInfo: () => maskInfo } });
    assert.equal(harness.owner.drawCoastalTransition(2, {
      lineWidth: 1, buildPath: () => assert.fail("unexpected geometry"),
    }), false);
    assert.deepEqual(harness.helperCalls, []);
    assert.deepEqual(harness.context.calls, []);
  }
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
