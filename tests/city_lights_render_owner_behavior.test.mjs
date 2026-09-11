import test from "node:test";
import assert from "node:assert/strict";
import { createCityLightsRenderOwner } from "../js/core/renderer/city_lights_render_owner.js";
import { normalizeDayNightStyleConfig } from "../js/core/state_defaults.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function createCanvasContext(width = 1600, height = 1200) {
  return {
    canvas: {
      width,
      height,
      ownerDocument: {
        createElement: () => createCanvasContext(width, height).canvas,
      },
    },
  };
}

function createRecordedCanvasContext(width, height, label, events, counters) {
  const savedStates = [];
  const context = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    arc: () => {},
    beginPath: () => {},
    clip: (path, rule) => events.push({ type: "clip", label, path, rule }),
    clearRect: () => events.push({ type: "clear", label }),
    createRadialGradient: () => {
      counters.gradients += 1;
      return { addColorStop: () => {} };
    },
    drawImage(image, ...args) {
      events.push({ type: "draw-image", label, image, args, alpha: this.globalAlpha });
    },
    fill(path, rule) {
      events.push({ type: "fill", label, path, rule, alpha: this.globalAlpha });
    },
    fillRect: () => {},
    restore() {
      const saved = savedStates.pop();
      if (!saved) return;
      this.globalAlpha = saved.globalAlpha;
      this.globalCompositeOperation = saved.globalCompositeOperation;
    },
    rotate: () => {},
    save() {
      savedStates.push({
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
      });
    },
    scale: () => {},
    setTransform: () => {},
    translate: () => {},
  };
  context.canvas = {
    width,
    height,
    getContext: () => context,
  };
  return context;
}

function createModernDrawHarness({
  cities = [], grid = [40, 80, 120, 249], urbanFeatures = [], assets = {},
  helpers = {}, assetProvider = null, effects = {},
} = {}) {
  const events = [];
  const metrics = [];
  const counters = { gradients: 0, canvases: 0 };
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
  const mainContext = createRecordedCanvasContext(400, 200, "main", events, counters);
  let activeContext = mainContext;
  let canvasIndex = 0;
  let nowValue = 10;
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
    assetProvider,
    effects,
    getters: {
      getContext: () => activeContext,
      getPathCanvas: () => pathCanvas,
      getProjection: () => projection,
    },
    helpers: {
      buildNightHemisphereFeature: () => ({ type: "Feature" }),
      clamp,
      ColorManager: {
        normalizeHexColor: (color) => (/^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null),
        hexToRgb: (hex) => ({
          r: Number.parseInt(hex.slice(1, 3), 16),
          g: Number.parseInt(hex.slice(3, 5), 16),
          b: Number.parseInt(hex.slice(5, 7), 16),
        }),
      },
      createCanvas: (width, height) => {
        canvasIndex += 1;
        counters.canvases += 1;
        return createRecordedCanvasContext(width, height, `offscreen-${canvasIndex}`, events, counters).canvas;
      },
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
      normalizeDayNightStyleConfig,
      normalizeIntensityFieldsState: (fields) => fields,
      normalizeLongitude: (value) => value,
      now: () => {
        const current = nowValue;
        nowValue += 4;
        return current;
      },
      prepareTargetContext: () => 1,
      recordRenderPerfMetric: (name, duration, details) => metrics.push({ name, duration, details }),
      stableJson,
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
  return { counters, events, metrics, owner, state };
}

function createOwner(overrides = {}) {
  const urbanFeature = overrides.urbanFeature || { properties: { id: "urban-1", area_sqkm: 10 } };
  const cityCollection = overrides.cityCollection || {
    type: "FeatureCollection",
    features: [
      { properties: { id: "matched", __city_population: 500000, capitalScore: 0, lon: 10, lat: 20 } },
      {
        properties: {
          id: "capital",
          __city_population: 90000,
          __city_is_country_capital: true,
          capitalScore: 2,
          lon: 30,
          lat: 40,
          name_ascii: "Fallback Capital",
        },
      },
    ],
  };
  const state = overrides.state || {};
  state.activeScenarioId ??= "scenario-a";
  state.cityLayerRevision ??= 4;
  state.contextLayerRevision ??= 3;
  state.dpr ??= 2;
  state.height ??= 600;
  state.intensityFields ??= { channels: { urbanGlow: { revision: 7 } } };
  state.topologyRevision ??= 2;
  state.urbanData ??= { type: "FeatureCollection", features: [urbanFeature] };
  state.width ??= 800;
  state.zoomTransform ??= { x: 10, y: 20, k: 2 };
  const context = overrides.context || createCanvasContext();
  const policyOwner = {
    getUrbanFeatureIndex: () => new Map(),
    getCityUrbanRuntimeInfo: (feature) => (
      feature?.properties?.id === "matched"
        ? { hasUrbanMatch: true, urbanMatchId: "urban-1", urbanFeature }
        : { hasUrbanMatch: false }
    ),
  };
  const projection = ([lon, lat]) => [lon + 180, 90 - lat];
  projection.scale = () => 1;
  projection.translate = () => [2, 3];
  projection.center = () => [4, 5];
  projection.rotate = () => [6, 7, 8];
  return createCityLightsRenderOwner({
    state,
    assets: {
      HISTORICAL_1930_CITY_LIGHTS_ENTRIES: overrides.historicalEntries || [],
      HISTORICAL_DERIVED_GLOW_MAX_ENTRIES: 2,
      HISTORICAL_DERIVED_GLOW_MIN_WEIGHT: 0.62,
      MODERN_CITY_LIGHTS_BASE_THRESHOLD: 10,
      MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD: 14,
      MODERN_CITY_LIGHTS_GRID: [0, 12, 15, 20],
      MODERN_CITY_LIGHTS_GRID_HEIGHT: 2,
      MODERN_CITY_LIGHTS_GRID_WIDTH: 2,
      MODERN_CITY_LIGHTS_STATS: { p90: 20, max: 255 },
      MODERN_CITY_LIGHTS_STEP_LAT_DEG: 90,
      MODERN_CITY_LIGHTS_STEP_LON_DEG: 180,
      ...overrides.assets,
    },
    assetProvider: overrides.assetProvider,
    getters: {
      getContext: () => context,
      getPathCanvas: () => {},
      getProjection: () => projection,
      ...overrides.getters,
    },
    helpers: {
      clamp,
      ColorManager: {
        normalizeHexColor: (color) => (/^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null),
        hexToRgb: (hex) => ({
          r: Number.parseInt(hex.slice(1, 3), 16),
          g: Number.parseInt(hex.slice(3, 5), 16),
          b: Number.parseInt(hex.slice(5, 7), 16),
        }),
      },
      createCanvas: (width, height, targetContext) => (
        targetContext?.canvas?.ownerDocument?.createElement?.("canvas") || createCanvasContext(width, height).canvas
      ),
      getCityCapitalScore: (feature) => Number(feature?.properties?.capitalScore || 0),
      getCityGeoCoordinates: (feature) => [feature.properties.lon, feature.properties.lat],
      getDefaultZoomTransform: () => ({ x: 0, y: 0, k: 1 }),
      getEffectiveCityCollection: () => cityCollection,
      getTransformSignature: (transform) => `${transform.x}:${transform.y}:${transform.k}`,
      getUrbanCityPolicyOwner: () => policyOwner,
      normalizeDayNightStyleConfig,
      normalizeIntensityFieldsState: (fields) => fields,
      normalizeLongitude: (value) => value,
      stableJson,
      stringHash: (value) => {
        let hash = 0;
        for (const char of String(value || "")) {
          hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        }
        return Math.abs(hash);
      },
      ...overrides.helpers,
    },
    effects: overrides.effects,
  });
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

test("visible urban polygons survive offscreen anchors and take precedence over local urban data", () => {
  const globalFeature = createShapeFeature("global", { anchor: [0, 0] });
  const harness = createModernDrawHarness({
    urbanFeatures: [createShapeFeature("local")],
    assets: { MODERN_CITY_LIGHTS_URBAN_AREAS: { type: "FeatureCollection", features: [globalFeature] } },
    helpers: shapeHelpers(),
  });
  const entries = harness.owner.collectModernUrbanCoreEntries(1, normalizeDayNightStyleConfig({}), 1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].feature, globalFeature);
  assert.ok(entries[0].screenX > harness.state.width);
  harness.owner.drawModernNightLightsLayer(1, normalizeDayNightStyleConfig({}), {});
  assert.ok(harness.events.some((event) => event.type === "fill" && event.path === globalFeature.geometry));
});

test("global urban light cores use a real city anchor before the interior representative point", () => {
  const feature = createShapeFeature("global-city", { anchor: [-140, 55], anchors: [[-155, 65]] });
  const harness = createModernDrawHarness({
    assets: { MODERN_CITY_LIGHTS_URBAN_AREAS: { type: "FeatureCollection", features: [feature] } },
    helpers: shapeHelpers(),
  });
  const [entry] = harness.owner.collectModernUrbanCoreEntries(1, normalizeDayNightStyleConfig({}), 1);
  assert.deepEqual([entry.cx, entry.cy], [100, 100]);
});

test("urban shape transition is gradual and absent projected paths retain point rendering", () => {
  let area = 16;
  let pathAvailable = true;
  const harness = createModernDrawHarness({
    urbanFeatures: [createShapeFeature()],
    helpers: shapeHelpers({
      estimateProjectedAreaPx: () => area,
      getProjectedGeographicPath: (feature) => pathAvailable ? feature.geometry : null,
    }),
  });
  const config = normalizeDayNightStyleConfig({});
  const blendAt = (nextArea) => {
    area = nextArea;
    return harness.owner.collectModernUrbanCoreEntries(1, config, 1)[0].shapeBlend;
  };
  const blends = [16, 16.01, 64, 143.99, 144].map(blendAt);
  assert.equal(blends[0], 0);
  assert.equal(blends.at(-1), 1);
  assert.ok(blends[1] < 0.001 && blends[3] > 0.999, "neither transition boundary should visibly jump");
  assert.ok(blends.every((value, index) => index === 0 || value > blends[index - 1]));
  pathAvailable = false;
  assert.equal(blendAt(400), 0);
  harness.owner.drawModernNightLightsLayer(1, config, {});
  assert.equal(harness.events.filter((event) => event.type === "fill" && event.path).length, 0);
  assert.ok(harness.metrics.at(-1).details.blobs > 4, "city point lights must still draw without Path2D");
});

test("shape fills preserve holes and clock-only cache hits avoid shape work while pan reuses one surface", () => {
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
  const canvases = harness.counters.canvases;
  const maskLabel = shapeFills()[0].label;
  assert.ok(shapeFills().every((event) => event.label === maskLabel));
  harness.owner.drawModernNightLightsLayer(1, config, { hour: 1 });
  assert.equal(shapeFills().length, features.length);
  assert.equal(harness.counters.canvases, canvases);
  harness.state.zoomTransform.x += 1;
  harness.owner.drawModernNightLightsLayer(1, config, { hour: 1 });
  assert.equal(shapeFills().length, features.length * 2);
  assert.equal(harness.counters.canvases, canvases, "pan must reuse the existing shared mask and sprite canvases");
  assert.ok(shapeFills().every((event) => event.label === maskLabel));
  assert.deepEqual(harness.metrics.map(({ details }) => details.hit), [false, true, false]);
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

test("shape loading is modern-only and a failed optional load does not loop or block the grid", async () => {
  const failures = [];
  let requests = 0;
  const harness = createModernDrawHarness({
    assetProvider: {
      isModernAssetsReady: () => true,
      isUrbanShapeAssetsReady: () => false,
      ensureUrbanShapeAssets: async () => { requests += 1; throw new Error("shapes unavailable"); },
    },
    effects: { onModernAssetsError: (error) => failures.push(error.message) },
  });
  harness.owner.drawNightLightsLayer(1, normalizeDayNightStyleConfig({ cityLightsEnabled: false }), {});
  harness.owner.drawNightLightsLayer(1, normalizeDayNightStyleConfig({ cityLightsStyle: "historical_1930s" }), {});
  assert.equal(requests, 0);
  const config = normalizeDayNightStyleConfig({});
  harness.owner.drawNightLightsLayer(1, config, {});
  await Promise.resolve();
  await Promise.resolve();
  harness.owner.drawNightLightsLayer(1, config, {});
  harness.state.zoomTransform.x += 1;
  harness.owner.drawNightLightsLayer(1, config, {});
  assert.equal(requests, 1);
  assert.deepEqual(failures, ["shapes unavailable"]);
  assert.deepEqual(harness.metrics.map(({ details }) => details.hit), [false, true, false]);
  assert.ok(harness.metrics.filter(({ details }) => !details.hit).every(({ details }) => details.blobs > 0));
});

test("global urban population boost follows current scenario city population and capital status", () => {
  const feature = createShapeFeature("global-runtime", {
    city_ids: ["runtime-city"], population_sum: 9_000_000_000, capital_score: 3,
  });
  const city = { properties: { id: "runtime-city", __city_population: 200000, capitalScore: 0 } };
  const cityCollection = { type: "FeatureCollection", features: [city] };
  const harness = createModernDrawHarness({
    cities: [city],
    assets: { MODERN_CITY_LIGHTS_URBAN_AREAS: { type: "FeatureCollection", features: [feature] } },
    helpers: shapeHelpers({
      getEffectiveCityCollection: () => cityCollection,
      getCityCapitalScore: (current) => current.properties.capitalScore,
    }),
  });
  const config = normalizeDayNightStyleConfig({
    cityLightsPopulationBoostEnabled: true, cityLightsPopulationBoostStrength: 1.5,
  });
  const coreAlpha = () => harness.owner.collectModernUrbanCoreEntries(1, config, 1)[0].coreAlpha;
  const initial = coreAlpha();
  const initialEntry = harness.owner.getModernCityLightsPopulationBoostData().urbanByFeature.get(feature);
  assert.ok(initialEntry, "global city_ids must associate the polygon with the active city collection");
  assert.equal(initialEntry.populationSum, 200000, "build-time population must not override the active city data");
  assert.equal(initialEntry.capitalScore, 0, "build-time capital designation must not override the active scenario");

  city.properties.__city_population = 3000000;
  harness.state.cityLayerRevision += 1;
  const populated = coreAlpha();
  assert.ok(populated > initial, "runtime population edits must update the same global polygon's core gain");
  city.properties.capitalScore = 3;
  harness.state.cityLayerRevision += 1;
  const capital = coreAlpha();
  assert.ok(capital > populated, "runtime capital edits must update core gain independently of population");

  city.properties.__city_population = 200000;
  city.properties.capitalScore = 0;
  harness.state.activeScenarioId = "scenario-b";
  assert.equal(coreAlpha(), initial, "a scenario change must invalidate cached population and capital data");
  feature.properties.population_sum = 0;
  feature.properties.capital_score = 0;
  harness.state.cityLayerRevision += 1;
  assert.equal(coreAlpha(), initial, "changing build-time summaries must have no effect on active city lighting");
});

test("explicit modern reactivation retries failed shapes and publishes a successful retry once", async () => {
  for (const inactiveConfig of [
    { cityLightsEnabled: false }, { cityLightsStyle: "historical_1930s" },
  ]) {
    let attempts = 0;
    let ready = false;
    const callbacks = [];
    const harness = createModernDrawHarness({
      assetProvider: {
        isModernAssetsReady: () => true,
        isUrbanShapeAssetsReady: () => ready,
        ensureUrbanShapeAssets: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary shape failure");
          ready = true;
          return { type: "FeatureCollection", features: [createShapeFeature()] };
        },
      },
      effects: {
        onModernAssetsError: () => callbacks.push("error"),
        onModernAssetsReady: () => callbacks.push("ready"),
      },
    });
    const config = normalizeDayNightStyleConfig({});
    harness.owner.drawNightLightsLayer(1, config, {});
    await Promise.resolve();
    await Promise.resolve();
    harness.owner.drawNightLightsLayer(1, config, {});
    harness.state.zoomTransform.x += 1;
    harness.owner.drawNightLightsLayer(1, config, {});
    assert.equal(attempts, 1, "a failed activation must not retry every frame or cache rebuild");
    harness.owner.drawNightLightsLayer(1, normalizeDayNightStyleConfig(inactiveConfig), {});
    harness.owner.drawNightLightsLayer(1, config, {});
    await Promise.resolve();
    await Promise.resolve();
    harness.owner.drawNightLightsLayer(1, config, {});
    assert.equal(attempts, 2, "an explicit reactivation permits one new attempt");
    assert.deepEqual(callbacks, ["error", "ready"]);
  }
});

function createDispatchProbe() {
  const calls = [];
  const context = {
    canvas: createCanvasContext().canvas,
    beginPath: () => calls.push("begin-path"),
    clip: () => calls.push("clip"),
    drawImage: () => calls.push("modern-draw-image"),
    ellipse: () => calls.push("historical-ellipse"),
    fill: () => calls.push("fill"),
    restore: () => calls.push("restore"),
    save: () => calls.push("save"),
    setTransform: () => calls.push("set-transform"),
  };
  const owner = createOwner({
    assets: {
      MODERN_CITY_LIGHTS_GRID: [],
      MODERN_CITY_LIGHTS_GRID_HEIGHT: 0,
      MODERN_CITY_LIGHTS_GRID_WIDTH: 0,
    },
    cityCollection: { type: "FeatureCollection", features: [] },
    context,
    historicalEntries: [
      {
        lon: 12,
        lat: 34,
        weight: 0.9,
        capitalKind: "country_capital",
        population: 1000,
        nameAscii: "Historical Probe",
      },
    ],
    getters: {
      getPathCanvas: () => () => calls.push("night-mask-path"),
    },
    helpers: {
      buildNightHemisphereFeature: () => ({ type: "Feature" }),
      createCanvas: () => {
        calls.push("modern-static-canvas-create");
        return null;
      },
    },
  });
  return { calls, owner };
}

function drawWithNormalizedConfig(owner, rawConfig) {
  const config = normalizeDayNightStyleConfig(rawConfig);
  owner.drawNightLightsLayer(1, config, {});
  return config;
}

test("city lights owner requests modern assets only for the enabled modern variant", async () => {
  const calls = [];
  let resolveLoad;
  const loadPromise = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const assetProvider = {
    isModernAssetsReady: () => false,
    ensureModernAssets: () => {
      calls.push("load-modern");
      return loadPromise;
    },
  };
  const owner = createOwner({
    assetProvider,
    effects: {
      onModernAssetsReady: () => calls.push("modern-ready"),
      onModernAssetsError: (error) => calls.push(`modern-error:${error.message}`),
    },
  });

  owner.drawNightLightsLayer(1, { cityLightsEnabled: false, cityLightsStyle: "modern" }, {});
  owner.drawNightLightsLayer(1, { cityLightsEnabled: true, cityLightsStyle: "historical_1930s" }, {});
  assert.deepEqual(calls, []);

  owner.drawNightLightsLayer(1, { cityLightsEnabled: true, cityLightsStyle: "modern" }, {});
  owner.drawNightLightsLayer(1, { cityLightsEnabled: true, cityLightsStyle: "modern" }, {});
  assert.deepEqual(calls, ["load-modern"], "concurrent draw passes must share one asset request");

  resolveLoad();
  await loadPromise;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["load-modern", "modern-ready"]);
});

test("city lights owner reports modern asset load failure without drawing stale data", async () => {
  const failure = new Error("asset unavailable");
  const calls = [];
  const owner = createOwner({
    assetProvider: {
      isModernAssetsReady: () => false,
      ensureModernAssets: async () => {
        calls.push("load-modern");
        throw failure;
      },
    },
    effects: {
      onModernAssetsReady: () => calls.push("modern-ready"),
      onModernAssetsError: (error) => calls.push(error),
    },
  });

  owner.drawNightLightsLayer(1, { cityLightsEnabled: true, cityLightsStyle: "modern" }, {});
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, ["load-modern", failure]);
});

test("city lights dispatcher reaches the modern draw body through the real config normalizer", () => {
  const rawConfigs = [
    {},
    { cityLightsStyle: "unknown" },
    { cityLightsStyle: " MODERN " },
  ];
  for (const rawConfig of rawConfigs) {
    const { calls, owner } = createDispatchProbe();

    const config = drawWithNormalizedConfig(owner, rawConfig);

    assert.equal(config.cityLightsEnabled, true);
    assert.equal(config.cityLightsStyle, "modern");
    assert.equal(config.cityLightsIntensity, 1.15);
    assert.equal(calls.filter((call) => call === "modern-static-canvas-create").length, 1);
    assert.equal(calls.includes("historical-ellipse"), false);
  }
});

test("city lights dispatcher reaches the historical draw body through the real config normalizer", () => {
  for (const style of ["historical_1930s", " Historical_1930s ", " HISTORICAL_1930S "]) {
    const { calls, owner } = createDispatchProbe();

    const config = drawWithNormalizedConfig(owner, { cityLightsStyle: style });

    assert.equal(config.cityLightsStyle, "historical_1930s");
    assert.ok(calls.filter((call) => call === "historical-ellipse").length >= 2, style);
    assert.equal(calls.includes("modern-static-canvas-create"), false, style);
  }
});

test("city lights dispatcher exits silently for disabled and null config", () => {
  {
    const { calls, owner } = createDispatchProbe();
    owner.drawNightLightsLayer(1, null, {});
    assert.deepEqual(calls, []);
  }
  {
    const { calls, owner } = createDispatchProbe();
    const config = drawWithNormalizedConfig(owner, { cityLightsEnabled: false });
    assert.equal(config.cityLightsEnabled, false);
    assert.deepEqual(calls, []);
  }
});

test("modern city lights owner keeps color helpers deterministic", () => {
  const owner = createOwner();

  assert.deepEqual(owner.getLightBlobRgb("#336699"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(owner.getLightBlobRgb("invalid"), { r: 255, g: 255, b: 255 });
  assert.equal(owner.toRgbaString({ r: 1, g: 2, b: 3 }, 2), "rgba(1, 2, 3, 1)");
});

test("modern city lights owner culls entries outside the viewport", () => {
  const owner = createOwner();

  assert.equal(owner.shouldCullModernLightEntry({ x: 50, y: 50 }, 10), false);
  assert.equal(owner.shouldCullModernLightEntry({ x: -200, y: 50 }, 10), true);
});

test("modern city lights normalization preserves bright-range contrast and the asset maximum", () => {
  const owner = createOwner({
    assets: {
      MODERN_CITY_LIGHTS_STATS: { p90: 183, max: 249 },
    },
  });

  const normalized = [0, 183, 203, 249].map((value) => owner.normalizeModernCityLightsValue(value));

  assert.ok(normalized.every(Number.isFinite), "normalization must stay finite at zero and across the bright range");
  assert.equal(normalized[0], 0);
  assert.ok(normalized[1] < normalized[2], "183 and 203 must retain distinct brightness");
  assert.ok(normalized[2] < normalized[3], "203 and the asset maximum must retain distinct brightness");
  assert.equal(normalized[3], 1, "the observed asset maximum must retain full output intensity");
});

test("modern city lights zoom does not add exposure or enlarge the texture footprint", () => {
  const state = { zoomTransform: { x: 0, y: 0, k: 1 } };
  const owner = createOwner({ state });
  const profiles = [1, 2, 3.5].map((zoom) => {
    state.zoomTransform.k = zoom;
    return owner.getModernCityLightsZoomProfile();
  });

  for (let index = 1; index < profiles.length; index += 1) {
    const previous = profiles[index - 1];
    const current = profiles[index];
    assert.ok(current.textureAlphaScale <= previous.textureAlphaScale, "the combined texture/corridor field must not brighten with zoom");
    assert.ok(current.coreAlphaScale <= previous.coreAlphaScale, "city cores must not brighten with zoom");
    assert.ok(current.textureRadiusScale <= previous.textureRadiusScale, "the coarse texture footprint must not grow with zoom");
  }
});

test("modern background splats overlap at their geographic grid centers without jitter", () => {
  const harness = createModernDrawHarness();
  const config = normalizeDayNightStyleConfig({ cityLightsStyle: "modern" });

  harness.owner.drawModernNightLightsLayer(1, config, {});

  const geometryCenters = harness.owner.getModernCityLightsGeometry().baseEntries
    .map((entry) => [entry.x, entry.y]);
  const splats = harness.events.filter((event) => event.type === "draw-image" && event.image?.width === 96);
  const renderedCenters = splats.map(({ args }) => [args[0] + (args[2] / 2), args[1] + (args[3] / 2)]);
  assert.deepEqual(renderedCenters, geometryCenters);
  for (let index = 1; index < splats.length; index += 1) {
    const previous = renderedCenters[index - 1];
    const current = renderedCenters[index];
    const centerDistance = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const previousRadius = splats[index - 1].args[2] / 2;
    const currentRadius = splats[index].args[2] / 2;
    assert.ok(centerDistance < previousRadius + currentRadius, "adjacent kernels should overlap into a continuous field");
  }
});

test("modern static cache reuses bounded blob sprites and reports measured rebuild work", () => {
  const harness = createModernDrawHarness();
  const config = normalizeDayNightStyleConfig({ cityLightsStyle: "modern" });

  harness.owner.drawModernNightLightsLayer(1, config, {});
  harness.owner.drawModernNightLightsLayer(1, config, {});
  harness.state.zoomTransform.x = 5;
  harness.owner.drawModernNightLightsLayer(1, config, {});
  harness.state.cityLayerRevision += 1;
  harness.owner.drawModernNightLightsLayer(1, config, {});

  assert.equal(harness.counters.gradients, 1, "one reusable sprite profile should serve every visible background entry and rebuild");
  assert.deepEqual(harness.metrics.map(({ details }) => details.hit), [false, true, false, false]);
  assert.deepEqual(harness.metrics.map(({ duration }) => duration), [4, 0, 4, 4]);
  for (const metric of harness.metrics) {
    assert.equal(metric.name, "modernCityLightsStaticLayerCache");
  }
  const misses = harness.metrics.filter(({ details }) => !details.hit);
  assert.deepEqual(
    misses.map(({ details }) => ({
      blobs: details.blobs,
      spriteBuilds: details.spriteBuilds,
      spriteCacheSize: details.spriteCacheSize,
      width: details.width,
      height: details.height,
    })),
    [
      { blobs: 4, spriteBuilds: 1, spriteCacheSize: 1, width: 400, height: 200 },
      { blobs: 4, spriteBuilds: 0, spriteCacheSize: 1, width: 400, height: 200 },
      { blobs: 4, spriteBuilds: 0, spriteCacheSize: 1, width: 400, height: 200 },
    ],
  );
});

test("modern blob sprite cache remains bounded across many visual profiles", () => {
  const city = {
    properties: {
      id: "sprite-cache-city",
      __city_is_country_capital: true,
      __city_population: 500000,
    },
  };
  const harness = createModernDrawHarness({ cities: [city] });

  for (let index = 0; index < 60; index += 1) {
    const config = normalizeDayNightStyleConfig({
      cityLightsCoreSharpness: index / 59,
      cityLightsPopulationBoostEnabled: false,
      cityLightsStyle: "modern",
    });
    harness.owner.drawModernNightLightsLayer(1, config, {});
  }

  assert.ok(harness.counters.gradients > 48, "the exercise must create enough distinct profiles to reach eviction");
  assert.ok(harness.metrics.every(({ details }) => details.spriteCacheSize <= 48));
  assert.equal(harness.metrics.at(-1).details.spriteCacheSize, 48);
});

test("population boost changes existing urban core opacity without changing core count", () => {
  const pathCanvas = () => {};
  pathCanvas.centroid = () => [100, 100];
  const urbanFeature = {
    properties: {
      id: "urban-1",
      area_sqkm: 700,
      scalerank: 1,
      name: "High-intensity urban core",
    },
  };
  const owner = createOwner({
    assets: {
      MODERN_CITY_LIGHTS_GRID: [249, 249, 249, 249],
      MODERN_CITY_LIGHTS_STATS: { p90: 183, max: 249 },
    },
    getters: {
      getPathCanvas: () => pathCanvas,
    },
    helpers: {
      estimateProjectedAreaPx: () => 100,
      getFeatureGeoCentroid: () => [10, 20],
      pathBoundsInScreen: () => true,
    },
    urbanFeature,
  });
  const disabled = normalizeDayNightStyleConfig({
    cityLightsCoreSharpness: 1,
    cityLightsPopulationBoostEnabled: false,
    cityLightsPopulationBoostStrength: 1.5,
    cityLightsTextureOpacity: 1,
  });
  const enabled = normalizeDayNightStyleConfig({
    cityLightsCoreSharpness: 1,
    cityLightsPopulationBoostEnabled: true,
    cityLightsPopulationBoostStrength: 1.5,
    cityLightsTextureOpacity: 1,
  });

  const withoutBoost = owner.collectModernUrbanCoreEntries(1, disabled, 1.8);
  const withBoost = owner.collectModernUrbanCoreEntries(1, enabled, 1.8);

  assert.equal(withoutBoost.length, 1);
  assert.equal(withBoost.length, withoutBoost.length, "population data must enrich existing cores instead of adding boost splats");
  assert.equal(withBoost[0].feature, withoutBoost[0].feature);
  assert.ok(withoutBoost[0].weight >= 1.3, "fixture must exercise a high-weight core");
  assert.equal(withoutBoost[0].sample, 1, "fixture must exercise the brightest grid value");
  assert.ok(withBoost[0].haloAlpha > withoutBoost[0].haloAlpha);
  assert.ok(withBoost[0].coreAlpha > withoutBoost[0].coreAlpha);
  assert.ok(withoutBoost[0].haloAlpha < 0.4);
  assert.ok(withBoost[0].haloAlpha < 0.4, "soft saturation must retain halo headroom at high intensity");
  assert.ok(withoutBoost[0].coreAlpha < 0.7);
  assert.ok(withBoost[0].coreAlpha < 0.7, "soft saturation must retain core headroom at high intensity");
});

test("modern city lights owner caches population boost data by current renderer state", () => {
  const state = { cityLayerRevision: 4 };
  const owner = createOwner({ state });

  const first = owner.getModernCityLightsPopulationBoostData();
  const second = owner.getModernCityLightsPopulationBoostData();
  const firstUrbanEntries = first.urbanEntries;
  const firstCityEntries = first.cityEntries;

  assert.equal(first, second);
  assert.equal(first.urbanEntries.length, 1);
  assert.equal(first.urbanEntries[0].urbanId, "urban-1");
  assert.equal(first.urbanEntries[0].populationSum, 500000);
  assert.equal(first.urbanEntries[0].density, 50000);
  assert.equal(first.cityEntries.length, 1);
  assert.equal(first.cityEntries[0].feature.properties.id, "capital");

  state.cityLayerRevision = 5;
  const afterRevisionChange = owner.getModernCityLightsPopulationBoostData();
  assert.equal(afterRevisionChange, first);
  assert.notEqual(afterRevisionChange.urbanEntries, firstUrbanEntries);
  assert.notEqual(afterRevisionChange.cityEntries, firstCityEntries);
  assert.equal(afterRevisionChange.cityLayerRevision, 5);

  const revisionUrbanEntries = afterRevisionChange.urbanEntries;
  state.activeScenarioId = "scenario-b";
  const afterScenarioChange = owner.getModernCityLightsPopulationBoostData();
  assert.equal(afterScenarioChange, afterRevisionChange);
  assert.notEqual(afterScenarioChange.urbanEntries, revisionUrbanEntries);
  assert.equal(afterScenarioChange.scenarioId, "scenario-b");
});

test("modern city lights owner static layer key includes render invalidation inputs", () => {
  const state = {
    cityLayerRevision: 4,
    contextLayerRevision: 3,
    intensityFields: { channels: { urbanGlow: { revision: 7 } } },
    topologyRevision: 2,
  };
  const owner = createOwner({ state });
  const key = owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 });

  assert.ok(key.includes("1600::1200::2.000"));
  assert.match(key, /10:20:2/);
  assert.match(key, /800\|600\|1\.0000\|2\.00\|3\.00\|4\.00\|5\.00\|6\.00\|7\.00\|8\.00/);
  assert.match(key, /scenario-a/);
  assert.match(key, /field:urbanGlow:7/);
  assert.match(key, /"intensity":"1\.100"/);

  state.topologyRevision = 20;
  assert.notEqual(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 }), key);
  state.topologyRevision = 2;

  state.contextLayerRevision = 30;
  assert.notEqual(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 }), key);
  state.contextLayerRevision = 3;

  state.cityLayerRevision = 40;
  assert.notEqual(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 }), key);
  state.cityLayerRevision = 4;

  state.intensityFields = { channels: { urbanGlow: { revision: 70 } } };
  assert.notEqual(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 }), key);

  assert.notEqual(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.2 }), key);
});

test("modern city lights owner static layer key tolerates missing intensity channels", () => {
  const state = {
    cityLayerRevision: 4,
    contextLayerRevision: 3,
    intensityFields: {},
    topologyRevision: 2,
  };
  const owner = createOwner({ state });

  assert.match(owner.getModernCityLightsStaticLayerKey({ cityLightsIntensity: 1.1 }), /field:urbanGlow:0/);
});

test("city lights owner normalizes historical density and retention controls", () => {
  const owner = createOwner();

  assert.equal(owner.getHistoricalCityLightsDensity({ historicalCityLightsDensity: 1.4 }), 1.4);
  assert.equal(owner.getHistoricalCityLightsDensity({ historicalCityLightsDensity: 9 }), 2);
  assert.equal(owner.getHistoricalCityLightsDensity({ historicalCityLightsDensity: "bad" }), 1.25);
  assert.equal(owner.getHistoricalCityLightsSecondaryRetention({ historicalCityLightsSecondaryRetention: 0.8 }), 0.8);
  assert.equal(owner.getHistoricalCityLightsSecondaryRetention({ historicalCityLightsSecondaryRetention: -1 }), 0);
  assert.equal(owner.getHistoricalCityLightsSecondaryRetention({ historicalCityLightsSecondaryRetention: "bad" }), 0.55);
});

test("city lights owner prefers historical asset entries before fallback cities", () => {
  const owner = createOwner({
    historicalEntries: [
      {
        lon: 12,
        lat: 34,
        weight: 0.9,
        capitalKind: "country_capital",
        population: 1000,
        nameAscii: "Asset Capital",
      },
    ],
  });

  const entries = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 0 });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].nameAscii, "Asset Capital");
});

test("city lights owner invalidates historical fallback entries by renderer state", () => {
  const state = { cityLayerRevision: 1, activeScenarioId: "scenario-a" };
  const owner = createOwner({ state });

  const first = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 0.2 });
  const second = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 0.2 });
  assert.equal(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].nameAscii, "Fallback Capital");

  state.cityLayerRevision = 2;
  const afterRevisionChange = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 0.2 });
  assert.notEqual(afterRevisionChange, first);

  state.activeScenarioId = "scenario-b";
  const afterScenarioChange = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 0.2 });
  assert.notEqual(afterScenarioChange, afterRevisionChange);

  const afterRetentionChange = owner.getHistoricalNightLightEntries({ historicalCityLightsSecondaryRetention: 1 });
  assert.notEqual(afterRetentionChange, afterScenarioChange);
});

test("city lights owner invalidates historical derived glow entries by projection and retention", () => {
  const state = { width: 800, height: 600 };
  const owner = createOwner({ state });
  const entries = [
    { lon: 10, lat: 20, weight: 0.9, nameAscii: "Glow A" },
    { lon: 30, lat: 40, weight: 0.7, nameAscii: "Glow B" },
  ];

  const first = owner.getHistoricalDerivedGlowEntries(entries, { historicalCityLightsSecondaryRetention: 0.1 });
  const second = owner.getHistoricalDerivedGlowEntries(entries, { historicalCityLightsSecondaryRetention: 0.1 });
  assert.equal(first, second);
  assert.equal(first.length, 2);

  const afterRetentionChange = owner.getHistoricalDerivedGlowEntries(entries, { historicalCityLightsSecondaryRetention: 0.9 });
  assert.notEqual(afterRetentionChange, first);

  state.width = 900;
  const afterProjectionKeyChange = owner.getHistoricalDerivedGlowEntries(entries, { historicalCityLightsSecondaryRetention: 0.9 });
  assert.notEqual(afterProjectionKeyChange, afterRetentionChange);
});
