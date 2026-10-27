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

function createOwner({
  context = createCanvasContext(),
  coastlineSource = "global",
  oceanStyle = {
    contourStrength: 0.5,
    experimentalAdvancedStyles: true,
    opacity: 1,
    preset: "bathymetry_soft",
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
      OCEAN_MASK_MODE_BATHYMETRY: "bathymetry_features",
      OCEAN_MASK_MODE_TOPOLOGY: "topology_ocean",
      TNO_COASTAL_ACCENT_COLOR: "rgba(1, 2, 3, 0.5)",
    },
    getters: {
      getContext: () => context,
      getPathCanvas: () => (feature) => pathCalls.push(feature),
    },
    helpers: {
      applyOceanClipMask: (mode) => helperCalls.push({ type: "ocean-mask", mode }),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      clipOutAtlantropaAccentRegions: () => helperCalls.push({ type: "clip-atlantropa" }),
      getOceanStyleConfig: () => oceanStyle,
      getSafeCanvasColor: (value, fallback) => value || fallback,
      getScenarioCoastalAccentOverlayFeatures: () => overlayFeatures,
      getScenarioCoastalAccentOverlayVisualConfig: () => ({ alpha: 0.4, lineWidth: 1 }),
      isScenarioCoastalAccentEnabled: () => true,
      pathBoundsInScreen: () => true,
      resolveCoastlineTopologySource: () => ({ source: coastlineSource }),
      resolveOceanMask: () => ({ mode: "topology_ocean", quality: 1 }),
      ...helperOverrides,
    },
  });
  return { context, helperCalls, owner, pathCalls, state: runtimeState };
}

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

test("coastal accent never re-strokes the main coastline for either source", () => {
  const overlayFeature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[4, 4], [5, 5]] } };
  for (const coastlineSource of ["global", "scenario"]) {
    const harness = createOwner({ coastlineSource, overlayFeatures: coastlineSource === "scenario" ? [overlayFeature] : [] });
    harness.owner.drawScenarioCoastalAccentLayer(1, { interactive: false });
    assert.equal(harness.context.calls.filter(call => call.type === "stroke").length, 0, coastlineSource);
    assert.equal(harness.pathCalls.includes(overlayFeature), false);
  }
});
