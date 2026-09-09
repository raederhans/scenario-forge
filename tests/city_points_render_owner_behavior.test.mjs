import test from "node:test";
import assert from "node:assert/strict";

import { createCityPointsRenderOwner } from "../js/core/renderer/city_points_render_owner.js";

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
    createElement: () => ({
      height: 0,
      width: 0,
      getContext: () => createSpriteContext(),
    }),
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
      normalizeCityLayerStyleConfig: (config) => ({
        opacity: 0.9,
        showLabels: true,
        revealProfile: "hybrid_country_budget",
        ...config,
      }),
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
