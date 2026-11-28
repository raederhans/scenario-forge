import test from "node:test";
import assert from "node:assert/strict";
import { createCityLightsRenderOwner } from "../js/core/renderer/city_lights_render_owner.js";
import { normalizeDayNightStyleConfig } from "../js/core/state_defaults.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRecordedCanvasContext(width, height, label, events) {
  const context = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    arc: () => {},
    beginPath: () => {},
    clip: (path, rule) => events.push({ type: "clip", label, path, rule }),
    clearRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage(image) {
      events.push({ type: "draw-image", label, image, blend: this.globalCompositeOperation });
    },
    fill(path, rule) {
      events.push({ type: "fill", path, rule });
    },
    fillRect: () => {},
    restore() {}, rotate() {}, save() {},
    scale: () => {},
    setTransform() {},
    translate: () => {},
  };
  context.canvas = {
    width,
    height,
    getContext: () => context,
  };
  return context;
}

function createModernDrawHarness({ cities = [], urbanFeatures = [], assets = {}, helpers = {} } = {}) {
  const grid = [40, 80, 120, 249];
  const events = [];
  const metrics = [];
  const state = {
    activeScenarioId: "scenario-a",
    cityLayerRevision: 4,
    contextLayerRevision: 3,
    dpr: 1,
    height: 200,
    intensityFields: { channels: { urbanGlow: { revision: 7 } } },
    topologyRevision: 2,
    urbanData: { type: "FeatureCollection", features: urbanFeatures },
    width: 400,
    zoomTransform: { x: 0, y: 0, k: 1 },
  };
  const mainContext = createRecordedCanvasContext(400, 200, "main", events);
  let activeContext = mainContext;
  const pathCanvas = () => {};
  pathCanvas.centroid = () => [100, 100];
  const projection = ([lon, lat]) => [(lon + 180) * 4, (90 - lat) * 4];
  projection.scale = () => 4;
  projection.translate = () => [0, 0];
  projection.center = () => [0, 0];
  projection.rotate = () => [0, 0, 0];
  const owner = createCityLightsRenderOwner({
    state,
    assets: {
      MODERN_CITY_LIGHTS_BASE_THRESHOLD: 10,
      MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: 80,
      MODERN_CITY_LIGHTS_GRID: grid,
      MODERN_CITY_LIGHTS_GRID_HEIGHT: 1,
      MODERN_CITY_LIGHTS_GRID_WIDTH: grid.length,
      MODERN_CITY_LIGHTS_STATS: { p90: 183, max: 249 },
      MODERN_CITY_LIGHTS_STEP_LAT_DEG: 1,
      MODERN_CITY_LIGHTS_STEP_LON_DEG: 1,
      ...assets,
    },
    getters: {
      getContext: () => activeContext,
      getPathCanvas: () => pathCanvas,
      getProjection: () => projection,
    },
    helpers: {
      buildNightHemisphereFeature: () => ({ type: "Feature" }),
      clamp,
      createCanvas: (width, height) => createRecordedCanvasContext(width, height, "offscreen", events).canvas,
      getCityAnchor: () => [100, 100],
      getCityCanonicalId: (feature) => feature?.properties?.id || "",
      getCityGeoCoordinates: () => [-179, 89.5],
      getCityScreenPoint: (anchor) => anchor,
      getDefaultZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      getEffectiveCityCollection: () => ({ type: "FeatureCollection", features: cities }),
      getRenderPassLayout: () => ({}),
      getSafeBlendMode: (preferred) => preferred,
      getTransformSignature: (transform) => `${transform.x}:${transform.y}:${transform.k}`,
      getUrbanCityPolicyOwner: () => ({
        getUrbanFeatureIndex: () => new Map(),
        getCityUrbanRuntimeInfo: () => ({ hasUrbanMatch: false }),
      }),
      normalizeIntensityFieldsState: (fields) => fields,
      normalizeLongitude: (value) => value,
      prepareTargetContext: (context) => { context.clearRect(0, 0, context.canvas.width, context.canvas.height); return 1; },
      recordRenderPerfMetric(name, duration, details) {
        if (name === "modernCityLightsStaticLayerCache") metrics.push({ details });
      },
      stableJson: JSON.stringify,
      withRenderTarget: (targetContext, callback) => {
        const previousContext = activeContext;
        activeContext = targetContext;
        try {
          return callback();
        } finally {
          activeContext = previousContext;
        }
      },
      ...helpers,
    },
  });
  return { events, metrics, owner };
}

function createShapeFeature(id = "shape-city", properties = {}) {
  return {
    type: "Feature", id,
    properties: { area_sqkm: 700, scalerank: 1, anchor: [-155, 65], ...properties },
    geometry: { type: "Polygon", coordinates: [
      [[-160, 60], [-150, 60], [-150, 70], [-160, 60]],
      [[-157, 63], [-156, 63], [-156, 64], [-157, 63]],
    ] },
  };
}

function shapeHelpers(overrides = {}) {
  return {
    estimateProjectedAreaPx: () => 160,
    getFeatureGeoCentroid: () => [-179, 89.5],
    getProjectedGeographicPath: (feature) => feature.geometry,
    getProjectedFeatureBounds: () => ({ minX: 80, minY: 80, maxX: 120, maxY: 120 }),
    pathBoundsInScreen: () => true,
    ...overrides,
  };
}

test("shape clipping and filling preserve polygon holes", () => {
  const features = [createShapeFeature("a"), createShapeFeature("b")];
  const harness = createModernDrawHarness({ urbanFeatures: features, helpers: shapeHelpers() });
  const config = normalizeDayNightStyleConfig({});
  harness.owner.drawModernNightLightsLayer(1, config, { hour: 0 });
  const shapeFills = () => harness.events.filter((event) => event.type === "fill" && event.path);
  assert.equal(shapeFills().length, features.length);
  assert.ok(shapeFills().every((event) => event.rule === "evenodd"));
  assert.ok(features.every((feature) => harness.events.some((event) => (
    event.type === "clip" && event.path === feature.geometry && event.rule === "evenodd"
  ))));
});

test("missing global coverage and culled global polygons retain visible fallback city lights", () => {
  const city = { properties: { id: "fallback", __city_population: 500000, __city_is_country_capital: true } };
  for (const features of [[], [createShapeFeature("culled", { city_ids: ["fallback"] })]]) {
    const harness = createModernDrawHarness({
      cities: [city],
      assets: { MODERN_CITY_LIGHTS_URBAN_AREAS: { type: "FeatureCollection", features } },
      helpers: shapeHelpers({
        pathBoundsInScreen: () => false,
        getUrbanCityPolicyOwner: () => ({
          getUrbanFeatureIndex: () => new Map(),
          getCityUrbanRuntimeInfo: () => ({ hasUrbanMatch: true }),
        }),
      }),
    });
    harness.owner.drawModernNightLightsLayer(1, normalizeDayNightStyleConfig({}), {});
    assert.equal(harness.metrics.at(-1).details.urbanShapes, 0);
    assert.ok(harness.metrics.at(-1).details.blobs > 4, "a culled or absent global polygon must not suppress a city point");
  }
});

test("modern city lights normalization preserves bright-range contrast and the asset maximum", () => {
  const { owner } = createModernDrawHarness();

  const normalized = [0, 183, 203, 249].map((value) => owner.normalizeModernCityLightsValue(value));

  assert.ok(normalized.every(Number.isFinite), "normalization must stay finite at zero and across the bright range");
  assert.equal(normalized[0], 0);
  assert.ok(normalized[1] < normalized[2], "183 and 203 must retain distinct brightness");
  assert.ok(normalized[2] < normalized[3], "203 and the asset maximum must retain distinct brightness");
  assert.equal(normalized[3], 1, "the observed asset maximum must retain full output intensity");
});

test("modern lights apply the shared night mask", () => {
  const mask = { width: 100, height: 50 };
  const harness = createModernDrawHarness({ helpers: { getNightMask: () => mask } });
  const config = normalizeDayNightStyleConfig({ cityLightsStyle: "modern" });
  harness.owner.drawModernNightLightsLayer(1, config, {});
  harness.owner.drawModernNightLightsLayer(1, { ...config, twilightWidthDeg: 20 }, {});
  const maskDraws = harness.events.filter((event) => event.type === "draw-image" && event.image === mask);
  assert.equal(maskDraws.length, 2);
  assert.ok(maskDraws.every((event) => event.blend === "destination-in"));
  assert.ok(harness.events.filter((event) => event.type === "draw-image" && event.label === "main")
    .every((event) => event.blend === "screen"));
});
