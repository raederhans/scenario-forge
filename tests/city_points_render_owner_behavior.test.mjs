import test from "node:test";
import assert from "node:assert/strict";

import { createCityPointsRenderOwner } from "../js/core/renderer/city_points_render_owner.js";
import { normalizeCityLayerStyleConfig } from "../js/core/state_defaults.js";

const markerTokens = {
  baseShadow: "rgba(0, 0, 0, 0.2)",
  capitalAccent: "rgba(255, 225, 130, 0.95)",
  capitalHighlight: "rgba(255, 255, 255, 0.72)",
  fillBottom: "rgba(70, 76, 86, 0.96)",
  fillMid: "rgba(108, 116, 130, 0.96)",
  fillTop: "rgba(190, 198, 212, 0.98)",
  highlight: "rgba(255, 255, 255, 0.36)",
  rimDark: "rgba(0, 0, 0, 0.22)",
  specular: "rgba(255, 255, 255, 0.28)",
  stroke: "rgba(18, 22, 30, 0.82)",
};

function createSpriteContext() {
  const gradient = { addColorStop: () => {} };
  return {
    scaleCalls: [],
    scale(x, y) { this.scaleCalls.push([x, y]); },
    beginPath: () => {},
    createLinearGradient: () => gradient,
    ellipse: () => {},
    fill: () => {},
    lineTo: () => {},
    moveTo: () => {},
    restore: () => {},
    save: () => {},
    stroke: () => {},
    set fillStyle(_value) {},
    set globalCompositeOperation(_value) {},
    set lineCap(_value) {},
    set lineJoin(_value) {},
    set lineWidth(_value) {},
    set strokeStyle(_value) {},
  };
}

function installCanvasFactory() {
  const previousDocument = globalThis.document;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  globalThis.document = {
    createElement: () => {
      const spriteContext = createSpriteContext();
      return {
        height: 0,
        width: 0,
        getContext: () => spriteContext,
      };
    },
  };
  return () => {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
    if (previousOffscreenCanvas === undefined) {
      delete globalThis.OffscreenCanvas;
    } else {
      globalThis.OffscreenCanvas = previousOffscreenCanvas;
    }
  };
}

function createRecordingContext(events = []) {
  const calls = [];
  return {
    calls,
    drawImage: (...args) => {
      calls.push({ type: "drawImage", args });
      events.push("drawImage");
    },
    restore: () => calls.push({ type: "restore" }),
    save: () => calls.push({ type: "save" }),
    set globalAlpha(value) { calls.push({ type: "globalAlpha", value }); },
    set globalCompositeOperation(value) { calls.push({ type: "globalCompositeOperation", value }); },
    set lineCap(value) { calls.push({ type: "lineCap", value }); },
    set lineJoin(value) { calls.push({ type: "lineJoin", value }); },
  };
}

function createCityPointsHarness({
  buildCityRevealPlan = null,
  getCityMarkerRenderStyle = () => ({ backgroundColor: "", tokens: markerTokens }),
  markerEntries = [],
  labelEntries = [],
  projection = () => [0, 0],
  pointer = () => [20, 20],
  showCityPoints = true,
  styleConfig = {},
  zoomIdentity = { x: 0, y: 0, k: 1 },
} = {}) {
  const events = [];
  const context = createRecordingContext(events);
  const metrics = [];
  const renderMetrics = [];
  const interactionMetrics = [];
  const labelCalls = [];
  const state = {
    colorRevision: 1,
    deferContextBasePass: false,
    showCityPoints,
    styleConfig: {
      cityPoints: {
        opacity: 0.9,
        showLabels: true,
        revealProfile: "hybrid_country_budget",
        ...styleConfig,
      },
    },
    zoomTransform: { x: 0, y: 0, k: 2 },
  };
  const collection = {
    type: "FeatureCollection",
    features: markerEntries.map((entry) => entry.feature || { type: "Feature", properties: {} }),
  };
  const revealPlanBuilder = buildCityRevealPlan || (() => ({ markerEntries, labelEntries }));
  const owner = createCityPointsRenderOwner({
    state,
    constants: {
      cityMarkerSizeLimitsPx: { capital: 26, major: 22, regional: 18, minor: 14 },
      cityMarkerThemeGraphite: "classic_graphite",
      cityRevealProfileHybrid: "hybrid_country_budget",
    },
    getters: {
      getContext: () => context,
      getMapSvg: () => ({ nodeName: "svg" }),
      getProjection: () => projection,
    },
    helpers: {
      buildCityRevealPlan: revealPlanBuilder,
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      collectContextMetric: (name, _duration, detail) => metrics.push({ name, detail }),
      drawCityLabelsFromEntries: (entries, options) => {
        events.push("labels");
        labelCalls.push({ entries, options });
        return entries.length;
      },
      getCityMarkerRenderStyle,
      getCityMarkerSizePx: (entry) => Number(entry?.markerSizePx || 12),
      getCityTooltipText: (entry) => `tooltip:${entry.id || entry.stableId || ""}`,
      getCityVisualCapitalState: (entry, config) => !!entry?.isCapital && config?.showCapitalOverlay !== false,
      getEffectiveCityCollection: () => collection,
      getHoverEntryHitPriority: (entry) => String(entry?.packId || "global") === "global" ? 0 : 1,
      getPointer: pointer,
      getZoomIdentity: () => zoomIdentity,
      getFeatureCollectionFeatureCount: (candidate) => Array.isArray(candidate?.features) ? candidate.features.length : 0,
      isCityEntryEligibleForLandHit: (entry, hit) => (
        !!entry
        && hit?.targetType === "land"
        && String(entry?.feature?.properties?.__city_host_feature_id || "") === String(hit?.id || "")
      ),
      normalizeCityLayerStyleConfig,
      nowMs: () => 0,
      recordInteractionDurationMetric: (name, _duration, detail) => interactionMetrics.push({ name, detail }),
      recordRenderPerfMetric: (name, _duration, detail) => renderMetrics.push({ name, detail }),
    },
  });
  return {
    context,
    events,
    interactionMetrics,
    labelCalls,
    metrics,
    owner,
    renderMetrics,
    state,
  };
}

test("city points owner records hidden skip metrics and clears hover entries", () => {
  const entry = {
    id: "hidden-city",
    anchor: [10, 10],
    screenPoint: [20, 20],
    feature: { type: "Feature", properties: { __city_host_feature_id: "LAND1" } },
  };
  const harness = createCityPointsHarness({ markerEntries: [entry], showCityPoints: true });
  harness.owner.getCityLayerRenderState(1, { interactive: true, cacheHoverEntries: true });
  assert.equal(
    harness.owner.getHoveredCityTooltipEntry({ type: "mousemove" }, { targetType: "land", id: "LAND1" })?.id,
    "hidden-city"
  );

  harness.state.showCityPoints = false;
  harness.owner.drawCityPointsLayer(1, { interactive: true });

  assert.deepEqual(harness.metrics.at(-1), {
    name: "drawCityPointsLayer",
    detail: {
      featureCount: 1,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "hidden",
    },
  });
  assert.equal(harness.owner.getHoveredCityTooltipEntry({ type: "mousemove" }, { targetType: "land", id: "LAND1" }), null);
});

test("city labels pass draws markers before delegating labels", () => {
  const restoreCanvas = installCanvasFactory();
  try {
    const entry = {
      id: "capital",
      anchor: [40, 50],
      cityTier: "major",
      feature: { type: "Feature", properties: { __city_host_feature_id: "LAND1" } },
      isCapital: true,
      markerSizePx: 16,
      screenPoint: [80, 100],
    };
    const labelEntry = { ...entry, id: "capital-label" };
    const harness = createCityPointsHarness({
      labelEntries: [labelEntry],
      markerEntries: [entry],
    });
    harness.owner.drawLabelsPass(2, { interactive: false });

    assert.equal(harness.context.calls.filter((call) => call.type === "drawImage").length, 1);
    assert.equal(harness.labelCalls.length, 1);
    assert.deepEqual(harness.labelCalls[0].entries, [labelEntry]);
    assert.ok(harness.events.indexOf("drawImage") > -1);
    assert.ok(harness.events.indexOf("drawImage") < harness.events.indexOf("labels"));
    assert.deepEqual(harness.renderMetrics.at(-1), {
      name: "drawLabelsPass",
      detail: {
        interactive: false,
        skipped: false,
        featureCount: 1,
        visibleFeatureCount: 1,
        labelCount: 1,
      },
    });
  } finally {
    restoreCanvas();
  }
});

test("city hover prefers higher-priority scenario entries without bestPriority errors", () => {
  const globalEntry = {
    id: "global-city",
    anchor: [20, 20],
    cityTier: "major",
    feature: { type: "Feature", properties: { __city_host_feature_id: "LAND1" } },
    markerSizePx: 14,
    packId: "global",
    screenPoint: [50, 50],
  };
  const scenarioEntry = {
    id: "scenario-city",
    anchor: [21, 20],
    cityTier: "major",
    feature: { type: "Feature", properties: { __city_host_feature_id: "LAND2" } },
    markerSizePx: 14,
    packId: "scenario",
    screenPoint: [51, 50],
  };
  const harness = createCityPointsHarness({
    markerEntries: [globalEntry, scenarioEntry],
    pointer: () => [50, 50],
  });
  harness.owner.getCityLayerRenderState(2, { interactive: true, cacheHoverEntries: true });

  const hovered = harness.owner.getHoveredCityTooltipEntry(
    { type: "mousemove" },
    { targetType: "land", id: "LAND2" }
  );

  assert.equal(hovered?.id, "scenario-city");
  assert.equal(hovered?.tooltipText, "tooltip:scenario-city");
  assert.deepEqual(harness.interactionMetrics.at(-1), {
    name: "interactionHoverCityProbeDuration",
    detail: {
      eventType: "hover",
      entryCount: 2,
      hit: true,
    },
  });
});

test("city layer render state uses injected zoom identity when runtime transform is absent", () => {
  const injectedIdentity = { x: 7, y: 8, k: 3 };
  const captured = [];
  const entry = {
    id: "zoom-city",
    anchor: [10, 10],
    feature: { type: "Feature", properties: { __city_host_feature_id: "LAND1" } },
    markerSizePx: 12,
    screenPoint: [20, 20],
  };
  const harness = createCityPointsHarness({
    buildCityRevealPlan: (_collection, scale, transform) => {
      captured.push({ scale, transform });
      return { markerEntries: [entry], labelEntries: [] };
    },
    markerEntries: [entry],
    zoomIdentity: injectedIdentity,
  });
  harness.state.zoomTransform = null;

  const renderState = harness.owner.getCityLayerRenderState(1, { interactive: true });

  assert.equal(captured[0]?.scale, 3);
  assert.equal(captured[0]?.transform, injectedIdentity);
  assert.equal(renderState.scale, 3);
});

test("city marker sprite cache reuses unchanged visuals across color revisions", () => {
  const restoreCanvas = installCanvasFactory();
  try {
    const entry = {
      id: "sprite-city",
      cityTier: "regional",
      isCapital: false,
      markerSizePx: 12,
    };
    const harness = createCityPointsHarness();

    const first = harness.owner.getCityMarkerSprite(entry, {});
    const cached = harness.owner.getCityMarkerSprite(entry, {});
    harness.state.colorRevision = 2;
    const refreshed = harness.owner.getCityMarkerSprite(entry, {});

    assert.equal(first, cached);
    assert.equal(first, refreshed);
  } finally {
    restoreCanvas();
  }
});

test("city marker sprite cache distinguishes background, paint tokens and exact geometry", () => {
  const restoreCanvas = installCanvasFactory();
  try {
    let backgroundColor = "#ffffff";
    let tokens = { ...markerTokens };
    const { owner } = createCityPointsHarness({
      getCityMarkerRenderStyle: () => ({ backgroundColor, tokens }),
    });
    const entry = { cityTier: "regional", isCapital: true, markerSizePx: 12.001 };
    const first = owner.getCityMarkerSprite(entry);
    backgroundColor = "#000000";
    assert.notEqual(owner.getCityMarkerSprite(entry), first);
    backgroundColor = "#ffffff";
    assert.equal(owner.getCityMarkerSprite(entry), first);
    for (const token of Object.keys(markerTokens)) {
      tokens = { ...markerTokens, [token]: "#123456" };
      assert.notEqual(owner.getCityMarkerSprite(entry), first, token);
    }
    tokens = { ...markerTokens };
    assert.notEqual(owner.getCityMarkerSprite({ ...entry, markerSizePx: 12.002 }), first);
    assert.notEqual(owner.getCityMarkerSprite({ ...entry, isCapital: false }), first);
    assert.notEqual(owner.getCityMarkerSprite({ ...entry, cityTier: "major" }), first);
    assert.notEqual(owner.getCityMarkerSprite(entry, { theme: "alternate" }), first);
    assert.equal(owner.getCityMarkerSprite(entry), first);
  } finally {
    restoreCanvas();
  }
});

test("city draw entries consume normalized opacity including zero across zoom and interaction", (t) => {
  t.after(installCanvasFactory());
  const entry = {
    id: "opacity-city",
    anchor: [40, 50],
    screenPoint: [80, 100],
    cityTier: "major",
    markerSizePx: 16,
  };
  const cases = [
    [0, 0],
    ["0", 0],
    [0.45, 0.45],
    [undefined, 0.96],
    ["invalid", 0.96],
    [Number.NaN, 0.96],
    [Infinity, 0.96],
    [-1, 0],
    [2, 1],
  ];
  for (const [opacity, expected] of cases) {
    for (const entryPoint of ["drawCityPointsLayer", "drawLabelsPass"]) {
      for (const interactive of [false, true]) {
        const harness = createCityPointsHarness({
          markerEntries: [entry],
          labelEntries: [entry],
          styleConfig: { opacity },
        });
        let screenSize;
        for (const scale of [1, 3]) {
          harness.state.zoomTransform = { x: 0, y: 0, k: scale };
          harness.context.calls.length = 0;
          harness.owner[entryPoint](scale, { interactive });
          const message = `${entryPoint}, opacity ${String(opacity)}, zoom ${scale}, interactive ${interactive}`;
          if (entryPoint === "drawLabelsPass" && interactive) {
            assert.deepEqual(harness.context.calls, [], message);
            assert.equal(harness.renderMetrics.at(-1).detail.reason, "interactive", message);
            continue;
          }
          const alphaCalls = harness.context.calls.filter((call) => call.type === "globalAlpha");
          assert.deepEqual(alphaCalls.map((call) => call.value), [interactive ? Math.min(expected, 0.8) : expected], message);
          const drawCalls = harness.context.calls.filter((call) => call.type === "drawImage");
          assert.equal(drawCalls.length, 1, message);
          const [, , , width, height] = drawCalls[0].args;
          if (!screenSize) screenSize = [width * scale, height * scale];
          assert.deepEqual([width * scale, height * scale], screenSize, message);
          if (entryPoint === "drawLabelsPass" && !interactive) {
            assert.deepEqual(harness.labelCalls.at(-1).entries, [entry], message);
          }
        }
      }
    }
  }
});

test("city marker sprite cache retains the 256 most recently used sprites", () => {
  const restoreCanvas = installCanvasFactory();
  try {
    const { owner } = createCityPointsHarness();
    const entry = { cityTier: "regional", markerSizePx: 12 };
    const get = (index) => owner.getCityMarkerSprite(entry, { color: `color-${index}` });
    const first = get(0);
    const second = get(1);
    for (let index = 2; index < 256; index += 1) get(index);
    assert.equal(get(0), first, "a hit must refresh recency");
    get(256);
    assert.equal(get(0), first, "recent sprite survives capacity eviction");
    assert.notEqual(get(1), second, "least recently used sprite is evicted");
  } finally {
    restoreCanvas();
  }
});

test("city marker draws use target density while preserving logical geometry and cache reuse", (t) => {
  t.after(installCanvasFactory());
  const entry = {
    id: "density-city",
    anchor: [40, 50],
    screenPoint: [80, 100],
    cityTier: "major",
    markerSizePx: 16,
    isCapital: true,
  };
  const harness = createCityPointsHarness({ markerEntries: [entry] });
  const byDensity = new Map();
  let baselineGeometry;
  let density = 1;
  let zoom = 2;
  // Translation and axis rotation do not affect the target's pixel density.
  harness.context.getTransform = () => ({ a: 0, b: density * zoom, c: -density * zoom, d: 0, e: 300, f: 400 });
  for (density of [1, 1.25, 2, 3, 1.25, 1]) {
    for (zoom of [2, 4]) {
      harness.state.zoomTransform = { x: 0, y: 0, k: zoom };
      harness.owner.drawCityPointsLayer(zoom);
      const { args: [canvas, x, y, width, height] } = harness.context.calls.filter((call) => call.type === "drawImage").at(-1);
      const geometry = [width * zoom, height * zoom, (entry.anchor[0] - x) * zoom, (entry.anchor[1] - y) * zoom];
      if (!baselineGeometry) baselineGeometry = geometry;
      geometry.forEach((value, index) => {
        assert.ok(Math.abs(value - baselineGeometry[index]) < 1e-10, `logical geometry at density ${density}, zoom ${zoom}`);
      });
      assert.equal(canvas.width, Math.ceil(baselineGeometry[0] * density));
      assert.equal(canvas.height, Math.ceil(baselineGeometry[1] * density));
      assert.deepEqual(canvas.getContext("2d").scaleCalls, [[canvas.width / baselineGeometry[0], canvas.height / baselineGeometry[1]]]);
      if (byDensity.has(density)) {
        assert.equal(canvas, byDensity.get(density), "reuse density-specific sprite across zoom changes and return visits");
      } else {
        assert.ok([...byDensity.values()].every((existing) => existing !== canvas), "a different density needs a different bitmap");
        byDensity.set(density, canvas);
      }
    }
  }
  delete harness.context.getTransform;
  harness.owner.drawCityPointsLayer(zoom);
  const fallbackCanvas = harness.context.calls.filter((call) => call.type === "drawImage").at(-1).args[0];
  assert.equal(fallbackCanvas, byDensity.get(1), "missing target transform uses density one");
});
