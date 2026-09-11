import test from "node:test";
import assert from "node:assert/strict";

import { createPhysicalLayerRenderOwner } from "../js/core/renderer/physical_layer_render_owner.js";

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineCap: "",
    lineJoin: "",
    lineWidth: 1,
    strokeStyle: "",
    arc(x, y, radius) {
      calls.push({ type: "arc", x, y, radius });
    },
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    createRadialGradient() {
      const stops = [];
      return {
        stops,
        addColorStop(offset, color) {
          stops.push({ offset, color });
        },
      };
    },
    fill() {
      calls.push({
        type: "fill",
        alpha: this.globalAlpha,
        composite: this.globalCompositeOperation,
        fillStyle: this.fillStyle,
      });
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
        composite: this.globalCompositeOperation,
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
      });
    },
  };
}

function createAtlasFeature(atlasClass, layerName, id = `${atlasClass}:${layerName}`) {
  return {
    id,
    properties: {
      atlasClass,
      layerName,
    },
  };
}

function createContourFeature(id, elevation = 500) {
  return {
    id,
    properties: {
      elevation_m: elevation,
    },
  };
}

function createOwner({
  atlasFeatures = [],
  context = createCanvasContext(),
  contourMajorFeatures = [],
  contourMinorFeatures = [],
  intensityPoints = [],
  showPhysical = true,
  getterOverrides = {},
  helperOverrides = {},
} = {}) {
  const metrics = [];
  const pathCalls = [];
  const helperCalls = [];
  const state = {
    intensityFields: {
      channels: {
        physicalAtlas: {
          enabled: intensityPoints.length > 0,
          points: intensityPoints,
        },
      },
    },
    physicalContourMajorData: { type: "FeatureCollection", features: contourMajorFeatures },
    physicalContourMinorData: { type: "FeatureCollection", features: contourMinorFeatures },
    showPhysical,
    styleConfig: {
      physical: {
        atlasClassVisibility: {},
        atlasIntensity: 1,
        atlasOpacity: 1,
        blendMode: "multiply",
        contourColor: "#776655",
        contourMajorIntervalM: 500,
        contourMajorLowReliefCutoffM: 0,
        contourMajorWidth: 1,
        contourMinorIntervalM: 100,
        contourMinorLowReliefCutoffM: 0,
        contourMinorVisible: true,
        contourMinorWidth: 0.5,
        contourOpacity: 0.8,
        mode: "atlas_and_contours",
        opacity: 1,
      },
    },
  };
  const atlasCollection = { type: "FeatureCollection", features: atlasFeatures };
  const owner = createPhysicalLayerRenderOwner({
    state,
    constants: {
      PHYSICAL_ATLAS_PALETTE: {
        forest: "#446644",
        mountain: "#887766",
      },
    },
    getters: {
      getContext: () => context,
      getPathCanvas: () => (feature) => pathCalls.push(feature),
      getProjection: () => ([lon, lat]) => [lon * 10, lat * 10],
      ...getterOverrides,
    },
    helpers: {
      applyPhysicalLandClipMask: () => helperCalls.push("clip"),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      collectContextMetric: (name, durationMs, details) => metrics.push({ name, durationMs, details }),
      getAdaptiveContourStrokeColor: (feature, baseColor) => (feature.id === "minor-a" ? "#334455" : baseColor),
      getAtlasFeatureAlphaMultiplier: (atlasClass) => (atlasClass === "mountain" ? 0.8 : 1),
      getContourVisibleFeatures: (collection) => collection?.features || [],
      getContourZoomStyleProfile: () => ({
        majorIntervalMultiplier: 1,
        majorMinScreenSpanPx: 0,
        majorOpacityMultiplier: 1,
        majorWidthMultiplier: 1,
        minorIntervalMultiplier: 1,
        minorMaxFeaturesBase: 10,
        minorMaxFeaturesHardCap: 100,
        minorMaxFeaturesPerMajor: 1,
        minorMinScreenSpanPx: 0,
        minorOpacityMultiplier: 0.5,
        minorVisible: true,
        minorWidthMultiplier: 1,
      }),
      getFeatureCollectionFeatureCount: (collection) => collection?.features?.length || 0,
      getFieldFeatureMultiplier: (channelId, feature) => (channelId === "physicalContour" && feature.id === "minor-a" ? 0.5 : 1),
      getPhysicalAtlasClass: (feature) => feature?.properties?.atlasClass || "",
      getPhysicalAtlasLayer: (feature) => feature?.properties?.layerName || "",
      getPhysicalLandMaskInfo: () => ({
        maskArcRefEstimate: 7,
        maskFeatureCount: 3,
        maskSource: "landData",
      }),
      getPhysicalPresetRenderProfile: () => ({
        majorContourOpacityMultiplier: 1,
        minorContourMinZoom: 1,
        minorContourOpacityRatio: 0.5,
        reliefBlendFallback: "source-over",
        reliefOpacityMultiplier: 0.8,
        reliefOverlayOpacityCap: 0.5,
        reliefOverlayOpacityRatio: 0.5,
        semanticBlendMode: "multiply",
        semanticOpacityMultiplier: 1,
      }),
      getPhysicalReliefOverlayBlendMode: () => "soft-light",
      getProjectedDegreeRadiusPx: () => 12,
      getResolvedPhysicalAtlasCollection: () => atlasCollection,
      getSafeBlendMode: (value, fallback) => value || fallback,
      getSafeCanvasColor: (value, fallback) => value || fallback,
      normalizeIntensityFieldsState: (fields) => fields,
      normalizePhysicalStyleConfig: (config) => config,
      nowMs: () => 10,
      pathBoundsInScreen: () => true,
      shouldReportDeferredContextLayerGap: () => true,
      warnMissingPhysicalContextOnce: (key) => helperCalls.push(`warn:${key}`),
      ...helperOverrides,
    },
  });
  return { context, helperCalls, metrics, owner, pathCalls, state };
}

test("physical layer owner records skip metrics when hidden", () => {
  const harness = createOwner({
    atlasFeatures: [createAtlasFeature("forest", "semantic_overlay")],
    showPhysical: false,
  });

  harness.owner.drawPhysicalBasePass(1);

  assert.equal(harness.metrics.at(-1).name, "drawPhysicalBasePass");
  assert.equal(harness.metrics.at(-1).details.skipped, true);
  assert.equal(harness.metrics.at(-1).details.reason, "hidden");
  assert.equal(harness.context.calls.length, 0);
});

test("physical base pass draws semantic, intensity, and relief counts in order", () => {
  const semantic = createAtlasFeature("forest", "semantic_overlay", "semantic");
  const relief = createAtlasFeature("mountain", "relief_base", "relief");
  const harness = createOwner({
    atlasFeatures: [semantic, relief],
    intensityPoints: [{ lon: 1, lat: 2, radiusDeg: 1, strength: 1.5 }],
  });

  harness.owner.drawPhysicalBasePass(2);

  assert.deepEqual(harness.pathCalls.map((feature) => feature.id), ["semantic", "relief"]);
  const fills = harness.context.calls.filter((call) => call.type === "fill");
  assert.equal(fills.length, 3);
  assert.equal(harness.metrics.at(-1).name, "drawPhysicalBasePass");
  assert.equal(harness.metrics.at(-1).details.semanticRenderedCount, 1);
  assert.equal(harness.metrics.at(-1).details.intensityRenderedCount, 1);
  assert.equal(harness.metrics.at(-1).details.reliefRenderedCount, 1);
});

test("physical intensity layer tolerates missing intensity channels", () => {
  const harness = createOwner({
    state: {
      intensityFields: {},
    },
  });

  assert.equal(harness.owner.drawPhysicalIntensityFieldLayer(), 0);
  assert.equal(harness.context.calls.length, 0);
});

test("physical owner respects pre-applied clip masks", () => {
  const semantic = createAtlasFeature("forest", "semantic_overlay", "semantic");
  const relief = createAtlasFeature("mountain", "relief_base", "relief");
  const harness = createOwner({
    atlasFeatures: [semantic, relief],
    intensityPoints: [{ lon: 1, lat: 2, radiusDeg: 1, strength: 1.5 }],
  });
  const cfg = harness.state.styleConfig.physical;
  const atlasCollection = { type: "FeatureCollection", features: [semantic, relief] };

  harness.owner.drawPhysicalAtlasCollectionLayer(atlasCollection, "semantic_overlay", cfg, {
    clipAlreadyApplied: true,
  });
  harness.owner.drawPhysicalIntensityFieldLayer({ clipAlreadyApplied: true });
  harness.owner.drawPhysicalReliefOverlayLayer(2, { clipAlreadyApplied: true });

  assert.equal(harness.helperCalls.includes("clip"), false);
  assert.deepEqual(harness.pathCalls.map((feature) => feature.id), ["semantic", "relief"]);
});

test("physical contour collection batches colors and scales line width by zoom", () => {
  const major = createContourFeature("major-a", 500);
  const minor = createContourFeature("minor-a", 100);
  const harness = createOwner();

  const result = harness.owner.drawContourCollection(
    { type: "FeatureCollection", features: [major, minor] },
    {
      cacheSlot: "major",
      color: "#776655",
      colorResolver: (feature) => (feature.id === "minor-a" ? "#334455" : "#776655"),
      opacity: 0.8,
      width: 2,
      k: 4,
      opacityMultiplierResolver: (feature) => (feature.id === "minor-a" ? 0.5 : 1),
    },
  );

  const strokes = harness.context.calls.filter((call) => call.type === "stroke");
  assert.equal(result.renderedCount, 2);
  assert.equal(result.selectedCount, 2);
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0].lineWidth, 0.5);
  assert.notEqual(strokes[0].strokeStyle, strokes[1].strokeStyle);
  assert.ok(strokes.some((stroke) => stroke.alpha === 0.4));
});

test("physical contour layer uses source-over and reports major and minor counts", () => {
  const harness = createOwner({
    contourMajorFeatures: [createContourFeature("major-a", 500)],
    contourMinorFeatures: [createContourFeature("minor-a", 100)],
  });

  harness.owner.drawPhysicalContourLayer(2);

  const strokes = harness.context.calls.filter((call) => call.type === "stroke");
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every((stroke) => stroke.composite === "source-over"));
  assert.equal(harness.metrics.at(-1).name, "drawPhysicalContourLayer");
  assert.equal(harness.metrics.at(-1).details.majorFeatureCount, 1);
  assert.equal(harness.metrics.at(-1).details.minorFeatureCount, 1);
});

class AggregatePath {
  constructor() { this.paths = []; }
  addPath(path) { this.paths.push(path); }
}

function withPathConstructor(constructor, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  Object.defineProperty(globalThis, "Path2D", { configurable: true, writable: true, value: constructor });
  try { return run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, "Path2D", previous);
    else delete globalThis.Path2D;
  }
}

const batchStyle = { cacheSlot: "major", color: "#776655", opacity: 0.8, width: 2, k: 4 };

test("same-style cached contours merge two paths into exactly one stroke", () => withPathConstructor(AggregatePath, () => {
  const features = [createContourFeature("a"), createContourFeature("b")];
  const paths = features.map((feature) => ({ id: feature.id }));
  const requests = [];
  const harness = createOwner({ getterOverrides: { getContourPath2D: (feature, options) => {
    requests.push({ feature, options });
    return paths[features.indexOf(feature)];
  } } });
  const result = harness.owner.drawContourCollection({ features }, batchStyle);
  const strokes = harness.context.calls.filter((call) => call.type === "stroke");
  assert.equal(strokes.length, 1);
  assert.deepEqual(strokes[0].path.paths, paths);
  assert.deepEqual(harness.pathCalls, []);
  assert.deepEqual(requests.map((request) => request.options), [{ cacheSlot: "major", k: 4 }, { cacheSlot: "major", k: 4 }]);
  assert.deepEqual(result, { drewAny: true, selectedCount: 2, renderedCount: 2 });
}));

for (const mode of ["missing-constructor", "missing-addPath", "partial-cache"]) {
  test(`contour batching fully falls back without missed or double strokes: ${mode}`, () => {
    const Constructor = mode === "missing-constructor" ? undefined : mode === "missing-addPath" ? class {} : AggregatePath;
    withPathConstructor(Constructor, () => {
      const features = [createContourFeature("a"), createContourFeature("b")];
      let reads = 0;
      const harness = createOwner({ getterOverrides: { getContourPath2D: (feature) => {
        reads++;
        return feature.id === "a" ? { id: "cached-a" } : null;
      } } });
      const result = harness.owner.drawContourCollection({ features }, batchStyle);
      const strokes = harness.context.calls.filter((call) => call.type === "stroke");
      assert.equal(strokes.length, 1);
      assert.equal(strokes[0].path, undefined);
      assert.deepEqual(harness.pathCalls, features);
      assert.equal(reads, mode === "partial-cache" ? 2 : 0);
      assert.deepEqual(result, { drewAny: true, selectedCount: 2, renderedCount: 2 });
    });
  });
}

test("zero contour field intensity never becomes a visible full-strength stroke", () => {
  const harness = createOwner();
  const result = harness.owner.drawContourCollection({ features: [createContourFeature("zero")] }, {
    ...batchStyle, opacityMultiplierResolver: () => 0,
  });
  const strokes = harness.context.calls.filter((call) => call.type === "stroke");
  assert.equal(strokes.length, 0);
  assert.deepEqual(result, { drewAny: false, selectedCount: 1, renderedCount: 0 });
});

test("major and minor selected metrics count chosen features rather than whole assets or stroke batches", () => {
  const harness = createOwner({
    contourMajorFeatures: [createContourFeature("major-a"), createContourFeature("major-b"), createContourFeature("excluded-major")],
    contourMinorFeatures: [createContourFeature("minor-a"), createContourFeature("excluded-minor")],
    helperOverrides: { getContourVisibleFeatures: (collection) => collection.features.filter((feature) => !feature.id.startsWith("excluded")) },
  });
  harness.owner.drawPhysicalContourLayer(2);
  const metrics = harness.metrics.at(-1).details;
  assert.equal(metrics.majorFeatureCount, 3);
  assert.equal(metrics.minorFeatureCount, 2);
  assert.equal(metrics.majorSelectedCount, 2);
  assert.equal(metrics.majorRenderedCount, 2);
  assert.equal(metrics.minorSelectedCount, 1);
  assert.equal(metrics.minorRenderedCount, 1);
  assert.equal(harness.context.calls.filter((call) => call.type === "stroke").length, 2);
});

test("selected contours with no resolved stroke color do not inflate rendered count", () => {
  const harness = createOwner();
  const features = [createContourFeature("paint"), createContourFeature("skip")];
  const result = harness.owner.drawContourCollection({ features }, {
    ...batchStyle, color: null, colorResolver: (feature) => feature.id === "paint" ? "#123456" : null,
  });
  assert.equal(result.selectedCount, 2);
  assert.equal(result.renderedCount, 1);
  assert.deepEqual(harness.pathCalls, [features[0]]);
});

for (const cached of [false, true]) {
  test(`contour phase metrics distinguish selection, styles, path build and stroke: ${cached ? "cached" : "fallback"}`, () => withPathConstructor(AggregatePath, () => {
    let clock = 0;
    const feature = createContourFeature("timed");
    const context = createCanvasContext();
    const originalStroke = context.stroke;
    context.stroke = function(path) { clock += 7; originalStroke.call(this, path); };
    const harness = createOwner({
      context,
      getterOverrides: {
        getContourPath2D: cached ? () => { clock += 5; return { id: "cached" }; } : null,
        getPathCanvas: () => () => { clock += 5; },
      },
      helperOverrides: {
        nowMs: () => clock,
        getContourVisibleFeatures: (collection) => { clock += 2; return collection.features; },
      },
    });
    harness.owner.drawContourCollection({ features: [feature] }, {
      ...batchStyle,
      colorResolver: () => { clock += 3; return "#123456"; },
    });
    const metric = harness.metrics.at(-1);
    assert.equal(metric.name, "drawContourCollection:major");
    assert.equal(metric.durationMs, 17);
    assert.deepEqual(metric.details, {
      cacheSlot: "major", selectionMs: 2, styleMs: 3, pathBuildMs: 5, strokeMs: 7,
      selectedCount: 1, renderedCount: 1,
    });
  }));
}

test("empty contour selection still reports its selection cost without path or stroke cost", () => {
  let clock = 0;
  const harness = createOwner({ helperOverrides: {
    nowMs: () => clock,
    getContourVisibleFeatures: () => { clock += 11; return []; },
  } });
  harness.owner.drawContourCollection({ features: [createContourFeature("outside")] }, batchStyle);
  assert.deepEqual(harness.metrics.at(-1).details, {
    cacheSlot: "major", selectionMs: 11, styleMs: 0, pathBuildMs: 0, strokeMs: 0,
    selectedCount: 0, renderedCount: 0,
  });
});
