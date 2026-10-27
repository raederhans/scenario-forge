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

test("ocean owner records topology mask and avoids loading when advanced bathymetry is inactive", () => {
  for (const [experimentalAdvancedStyles, preset, opacity, status] of [
    [false, "bathymetry_soft", 1, "off"], [true, "flat", 1, "off"],
    [true, "bathymetry_soft", 0, "hidden"],
  ]) {
    let summary;
    const harness = createOwner({
      oceanStyle: { experimentalAdvancedStyles, preset, opacity },
      helperOverrides: {
        drawBathymetryTexture: () => assert.fail("inactive texture draw"),
        publishBathymetryVisibility: value => { summary = value; },
      },
    });
    harness.owner.drawOceanStyle();
    assert.equal(harness.state.oceanMaskMode, "topology_ocean");
    assert.equal(harness.state.oceanMaskQuality, 0);
    assert.deepEqual(harness.context.calls, []);
    assert.deepEqual(harness.helperCalls, []);
    assert.equal(summary.status, status);
  }
});

test("ocean owner clips the texture once and publishes backend, detail and source visibility", () => {
  for (const detail of [false, true]) {
    let summary;
    const oceanStyle = { experimentalAdvancedStyles: true, preset: "bathymetry_contours", opacity: .7 };
    const harness = createOwner({ oceanStyle,
      helperOverrides: {
        drawBathymetryTexture: style => {
          assert.equal(style, oceanStyle);
          assert.deepEqual(harness.helperCalls.map(call => call.type), ["ocean-mask"]);
          harness.helperCalls.push({ type: "texture" });
          return { status: "ready", backend: "webgl2", detail, missingTileCount: 2,
            loadedTileCount: 4, globalVisibleCount: 1, scenarioVisibleCount: 1 };
        },
        publishBathymetryVisibility: value => { summary = value; },
        getBathymetryFeatureCollections: () => assert.fail("vector data lookup"),
        paintGlobalBathymetry: () => assert.fail("vector compositor"),
      },
    });
    harness.owner.drawOceanStyle();
    assert.equal(harness.state.oceanMaskMode, "bathymetry_features");
    assert.equal(harness.state.oceanMaskQuality, 1);
    assert.deepEqual(harness.helperCalls.map(call => call.type), ["ocean-mask", "texture"]);
    assert.deepEqual(harness.context.calls.map(call => call.type), ["save", "restore"]);
    assert.deepEqual(harness.pathCalls, []);
    assert.deepEqual(summary, { status: "ready", lod: detail ? "detail" : "overview",
      backend: "webgl2", missingTileCount: 2, loadedTileCount: 4,
      globalVisibleCount: 1, scenarioVisibleCount: 1, visibleCount: 1 });
  }
});

test("ocean owner reports loading, errors and unsupported projections without claiming visibility", () => {
  for (const status of ["loading", "error", "unsupported-projection"]) {
    let summary;
    const harness = createOwner({ helperOverrides: {
      drawBathymetryTexture: () => ({ status }),
      publishBathymetryVisibility: value => { summary = value; },
    } });
    harness.owner.drawOceanStyle();
    assert.equal(summary.status, status === "unsupported-projection" ? "unsupported" : status);
    assert.equal(summary.visibleCount, 0);
    assert.equal(summary.globalVisibleCount, 0);
    assert.equal(summary.scenarioVisibleCount, 0);
    assert.equal(harness.state.oceanMaskMode, "topology_ocean");
    assert.equal(harness.state.oceanMaskQuality, 0);
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

test("coastal accent never re-strokes the main coastline for either source", () => {
  const overlayFeature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[4, 4], [5, 5]] } };
  for (const coastlineSource of ["global", "scenario"]) {
    const harness = createOwner({ coastlineSource, overlayFeatures: coastlineSource === "scenario" ? [overlayFeature] : [] });
    harness.owner.drawScenarioCoastalAccentLayer(1, { interactive: false });
    assert.equal(harness.context.calls.filter(call => call.type === "stroke").length, 0, coastlineSource);
    assert.equal(harness.pathCalls.includes(overlayFeature), false);
  }
});
