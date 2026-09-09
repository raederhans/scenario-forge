const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// Real browser Canvas and production owners; this isolates draw semantics from app startup.
test("@dev visual owners preserve zero values and target sprite density", async ({ page }, testInfo) => {
  await page.route("**/__visual_owner_fixture", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Visual owner fixture</title>",
  }));
  await page.goto("/__visual_owner_fixture");
  const results = await page.evaluate(async () => {
    const { createCityPointsRenderOwner } = await import("/js/core/renderer/city_points_render_owner.js");
    const { createRiverLayerRenderOwner } = await import("/js/core/renderer/river_layer_render_owner.js");
    const { normalizeCityLayerStyleConfig } = await import("/js/core/state_defaults.js");
    const alphaSum = (context) => {
      const bytes = context.getImageData(0, 0, context.canvas.width, context.canvas.height).data;
      let sum = 0;
      for (let i = 3; i < bytes.length; i += 4) sum += bytes[i];
      return sum;
    };
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const tokens = Object.fromEntries(["fillTop", "fillMid", "fillBottom", "baseShadow", "stroke", "rimDark", "highlight", "specular", "capitalAccent", "capitalHighlight"].map((key) => [key, "#336699"]));
    const city = [];
    for (const density of [1, 1.25, 2, 3]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128 * density;
      const context = canvas.getContext("2d");
      let spriteDimensions;
      const drawImage = context.drawImage.bind(context);
      context.drawImage = (sprite, ...args) => {
        spriteDimensions = { width: sprite.width, height: sprite.height, logicalWidth: args[2], logicalHeight: args[3] };
        return drawImage(sprite, ...args);
      };
      const feature = { type: "Feature", properties: {} };
      const entry = { cityId: "fixture", cityTier: "major", markerSizePx: 12, anchor: [64, 64], screenPoint: [64, 64], feature };
      const state = { showCityPoints: true, styleConfig: { cityPoints: {} }, zoomTransform: { k: 1, x: 0, y: 0 } };
      const owner = createCityPointsRenderOwner({ state,
        getters: { getContext: () => context, getProjection: () => (() => [64, 64]) },
        helpers: { normalizeCityLayerStyleConfig, getEffectiveCityCollection: () => ({ features: [feature] }),
          buildCityRevealPlan: () => ({ markerEntries: [entry], labelEntries: [] }),
          getCityMarkerRenderStyle: () => ({ tokens }), getCityMarkerSizePx: () => 12 },
      });
      for (const opacity of [0, "0", 0.01, 1]) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.setTransform(density, 0, 0, density, 0, 0);
        state.styleConfig.cityPoints = { opacity };
        owner.drawCityPointsLayer(1, { interactive: true });
        city.push({ density, opacity, alpha: alphaSum(context), spriteDimensions });
      }
    }
    const rivers = [];
    for (const rank of [0, "0", 1, 8, "bad", null]) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 96;
      const context = canvas.getContext("2d");
      const props = { featurecla: "River", ...(rank === null ? {} : { scalerank: rank }) };
      const state = { showRivers: true, riversData: { features: [{ properties: props }] }, styleConfig: { rivers: { width: 1.2, opacity: 1, color: "#336699", outlineWidth: 0 } } };
      const owner = createRiverLayerRenderOwner({ state, helpers: {
        clamp, getContext: () => context, getContextBaseZoomBucketId: (k) => k < 1.4 ? "low" : "high",
        collectContextMetric: () => {}, getDashPattern: () => [], getFeatureCollectionFeatureCount: (c) => c.features.length,
        getPathCanvas: () => (() => { context.moveTo(10, 48); context.lineTo(86, 48); }),
        getSafeCanvasColor: (color, fallback) => color || fallback, nowMs: () => 0, pathBoundsInScreen: () => true,
      }});
      owner.drawRiversLayer(1);
      const lowAlpha = alphaSum(context);
      context.clearRect(0, 0, 96, 96);
      owner.drawRiversLayer(3);
      rivers.push({ rank, lowAlpha, highAlpha: alphaSum(context) });
    }
    return { city, rivers, mode: "real-canvas-owner-fixture" };
  });
  const evidencePath = path.join(".runtime", "browser", "visual-correctness", "owner-semantics.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(results, null, 2));
  await testInfo.attach("owner-pixel-semantics", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  for (const row of results.city) {
    expect(row.spriteDimensions.width).toBe(Math.ceil(row.spriteDimensions.logicalWidth * row.density));
    expect(row.spriteDimensions.height).toBe(Math.ceil(row.spriteDimensions.logicalHeight * row.density));
    if (Number(row.opacity) === 0) expect(row.alpha, JSON.stringify(row)).toBe(0);
    else expect(row.alpha, JSON.stringify(row)).toBeGreaterThan(0);
  }
  for (const row of results.rivers) {
    if ([0, "0", 1].includes(row.rank)) expect(row.lowAlpha).toBeGreaterThan(0);
    else expect(row.lowAlpha).toBe(0);
    expect(row.highAlpha).toBeGreaterThan(0);
  }
});
