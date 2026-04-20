const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

function resolveBaseUrl() {
  return getAppUrl();
}

function shouldReadServedSourceText() {
  return !!(
    process.env.PLAYWRIGHT_TEST_BASE_URL
    || process.env.MAPCREATOR_BASE_URL
    || process.env.MAPCREATOR_APP_URL
  );
}

async function readSourceTextForAssertions(request, pageUrl, repoRoot, relativePath) {
  if (!shouldReadServedSourceText()) {
    return fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8");
  }

  const sourceUrl = new URL(relativePath, pageUrl).toString();
  const response = await request.get(sourceUrl);
  expect(response.ok()).toBeTruthy();
  return await response.text();
}

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const canvas = Array.from(document.querySelectorAll("canvas"))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== "none");
    return !!select && select.querySelectorAll("option").length > 0 && !!canvas;
  }, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function captureCanvasSnapshot(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    if (!canvas || !context) {
      return null;
    }
    const { width, height } = canvas;
    const step = Math.max(6, Math.round(Math.min(width, height) / 180));
    const imageData = context.getImageData(0, 0, width, height).data;
    const pixels = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        pixels.push(imageData[offset], imageData[offset + 1], imageData[offset + 2]);
      }
    }
    return { width, height, step, pixels };
  });
}

function getMeanRgbDiff(snapshotA, snapshotB) {
  if (!snapshotA || !snapshotB) {
    throw new Error("Missing canvas snapshot for RGB diff comparison.");
  }
  expect(snapshotA.width).toBe(snapshotB.width);
  expect(snapshotA.height).toBe(snapshotB.height);
  expect(snapshotA.step).toBe(snapshotB.step);
  expect(snapshotA.pixels.length).toBe(snapshotB.pixels.length);
  let diffTotal = 0;
  for (let index = 0; index < snapshotA.pixels.length; index += 1) {
    diffTotal += Math.abs(snapshotA.pixels[index] - snapshotB.pixels[index]);
  }
  return diffTotal / snapshotA.pixels.length;
}

test("physical layer defaults and atlas rendering regression", async ({ page, request }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const repoRoot = path.resolve(__dirname, "..", "..");
  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error));
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  });

  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForMapReady(page);

  const rendererSource = await readSourceTextForAssertions(
    request,
    page.url(),
    repoRoot,
    "js/core/map_renderer.js",
  );
  const mainSource = await readSourceTextForAssertions(
    request,
    page.url(),
    repoRoot,
    "js/main.js",
  );
  const startupDataPipelineSource = await readSourceTextForAssertions(
    request,
    page.url(),
    repoRoot,
    "js/bootstrap/startup_data_pipeline.js",
  );
  const appearanceControllerSource = await readSourceTextForAssertions(
    request,
    page.url(),
    repoRoot,
    "js/ui/toolbar/appearance_controls_controller.js",
  );
  const interactionFunnelSource = await readSourceTextForAssertions(
    request,
    page.url(),
    repoRoot,
    "js/core/interaction_funnel.js",
  );

  const inspection = await page.evaluate(async ({
    interactionFunnelSource,
    appearanceControllerSource,
    mainSource,
    rendererSource,
    startupDataPipelineSource,
  }) => {
    const stateModuleUrl = new URL("js/core/state.js", document.baseURI).href;
    const stateModule = await import(stateModuleUrl);
    const {
      normalizePhysicalStyleConfig,
      PHYSICAL_ATLAS_PALETTE,
      state,
    } = stateModule;
    const physicalBaseStart = rendererSource.indexOf("function drawPhysicalBasePass");
    const physicalBaseEnd = rendererSource.indexOf("function drawPhysicalAtlasLayer");
    const contextBaseStart = rendererSource.indexOf("function drawContextBasePass");
    const contextBaseEnd = rendererSource.indexOf("function drawContextMarkersPass");
    const physicalBaseSource =
      physicalBaseStart >= 0 && physicalBaseEnd > physicalBaseStart
        ? rendererSource.slice(physicalBaseStart, physicalBaseEnd)
        : "";
    const contextBaseSource =
      contextBaseStart >= 0 && contextBaseEnd > contextBaseStart
        ? rendererSource.slice(contextBaseStart, contextBaseEnd)
        : "";

    const defaults = {
      normalizedDefault: normalizePhysicalStyleConfig(null),
      normalizedExplicit: normalizePhysicalStyleConfig({
        blendMode: "overlay",
        atlasOpacity: 0.27,
      }),
      normalizedInvalidBlend: normalizePhysicalStyleConfig({
        blendMode: "totally-invalid-mode",
      }),
      normalizedNewSchemaOpacityOnly: normalizePhysicalStyleConfig({
        mode: "atlas_and_contours",
        opacity: 0.44,
        blendMode: "source-over",
      }),
      normalizedLegacyOpacityOnly: normalizePhysicalStyleConfig({
        opacity: 0.31,
      }),
    };

    state.showPhysical = true;
    state.deferContextBasePass = false;
    state.styleConfig.physical = normalizePhysicalStyleConfig({
      ...state.styleConfig.physical,
      mode: "atlas_and_contours",
      opacity: 0.58,
      atlasOpacity: 0.48,
      atlasIntensity: 0.88,
      blendMode: "totally-invalid-mode",
      contourMinorVisible: false,
    });
    state.physicalSemanticsData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            atlas_class: "mountain_high_relief",
            atlas_layer: "relief_base",
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[7, 44], [15, 44], [15, 48], [7, 48], [7, 44]]],
          },
        },
      ],
    };
    state.renderPassCache.dirty.physicalBase = true;
    state.renderPassCache.dirty.contextBase = true;
    state.renderPassCache.reasons.physicalBase = "physical-invalid-blend-regression";
    state.renderPassCache.reasons.contextBase = "physical-invalid-blend-regression";
    state.renderNowFn?.();

    return {
      defaults,
      palette: PHYSICAL_ATLAS_PALETTE,
      physicalBlendModeAfterNormalize: state.styleConfig.physical.blendMode,
      rendererSourceChecks: {
        hasValidBlendModes:
          /const VALID_BLEND_MODES = new Set\(\[/.test(rendererSource)
          && /"source-over"/.test(rendererSource)
          && /"multiply"/.test(rendererSource)
          && /"screen"/.test(rendererSource)
          && /"overlay"/.test(rendererSource)
          && /"soft-light"/.test(rendererSource),
        hasSafeBlendFallback:
          /return VALID_BLEND_MODES\.has\(mode\) \? mode : safeFallback;/.test(rendererSource),
        hasPhysicalBasePass:
          /\["physicalBase", \(k\) => drawPhysicalBasePass\(k\)\]/.test(rendererSource),
        hasPhysicalReliefOverlayHelper:
          /function drawPhysicalReliefOverlayLayer\(k, \{ interactive = false, clipAlreadyApplied = false \} = \{\}\)/.test(rendererSource),
        reliefOverlayBlendClamp:
          /function getPhysicalReliefOverlayBlendMode\(cfg, presetProfile\)/.test(rendererSource)
          && /if \(requestedMode === "overlay" \|\| requestedMode === "multiply"\) \{[\s\S]*?return "soft-light";/.test(rendererSource),
        physicalBaseKeepsSemanticAtlas:
          physicalBaseSource.includes("drawPhysicalAtlasLayer(k, { interactive });")
          && !physicalBaseSource.includes("drawPhysicalReliefOverlayLayer(k, { interactive });"),
        hasPhysicalExactRefresh:
          /invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);/.test(rendererSource),
        contextBaseDrawsReliefOverlayBeforeContours:
          contextBaseSource.includes("drawPhysicalReliefOverlayLayer(k, { interactive });")
          && contextBaseSource.indexOf("drawPhysicalReliefOverlayLayer(k, { interactive });")
            < contextBaseSource.indexOf("drawPhysicalContourLayer(k, { interactive });"),
        deferredContextBaseStillDrawsReliefOverlay:
          contextBaseSource.includes("if (state.deferContextBasePass && !interactive) {")
          && contextBaseSource.includes("drawPhysicalReliefOverlayLayer(k, { interactive: false });"),
        contourUsesSourceOver:
          /drawPhysicalContourLayer[\s\S]*?context\.globalCompositeOperation = "source-over";/.test(rendererSource),
        hasContourZoomProfiles:
          /const CONTOUR_ZOOM_STYLE_PROFILES = Object\.freeze\(\{/.test(rendererSource),
        hasAdaptiveContourColor:
          /function getAdaptiveContourStrokeColor\(feature, baseColor\)/.test(rendererSource),
        contourKeepsInverseScaleWidth:
          /function drawContourCollection[\s\S]*?const scale = Math\.max\(0\.0001, k\);[\s\S]*?context\.lineWidth = width \/ scale;/.test(rendererSource),
        contourUsesAdaptiveColor:
          /drawContourCollection[\s\S]*?colorResolver = null/.test(rendererSource)
          && /drawPhysicalContourLayer[\s\S]*?colorResolver: resolveContourColor/.test(rendererSource),
        contourUsesVisibleSetCache:
          /function getContourVisibleFeatures\(/.test(rendererSource)
          && /contourVisibleSetCache\[cacheSlot\] = \{[\s\S]*?collectionRef: collection,[\s\S]*?features: visibleFeatures,/.test(rendererSource),
        contourMergesBoundsAndFilter:
          /function getContourVisibleFeatures[\s\S]*?const screenBounds = getFeatureScreenBounds\(feature, \{ allowCompute: false \}\) \|\| getFeatureScreenBounds\(feature\);/.test(rendererSource)
          && /function getContourVisibleFeatures[\s\S]*?rectsIntersect\(screenBounds, viewportBounds\)/.test(rendererSource)
          && /function drawContourCollection[\s\S]*?const visibleFeatures = getContourVisibleFeatures\(collection, \{/.test(rendererSource),
        contourUsesStrokeBatching:
          /function drawContourCollection[\s\S]*?const strokeBatches = new Map\(\);/.test(rendererSource)
          && /strokeBatches\.forEach\(\(features, strokeColor\) => \{[\s\S]*?features\.forEach\(\(feature\) => \{[\s\S]*?pathCanvas\(feature\);/.test(rendererSource),
        contourFirstIdleKeepsFastPath:
          /function shouldPreferImmediateExactContextBaseRefresh\(reuseDecision = null\)/.test(rendererSource) === false
          && /const deferredReuseDecision = state\.deferExactAfterSettle \? getContextBaseReuseDecision\(\) : null;/.test(rendererSource) === false,
        contourZoomBucketRefreshesAfterQuietWindow:
          /function scheduleExactAfterSettleRefresh[\s\S]*?const forceExactContextBaseRefresh = shouldForceExactContextBaseRefresh\(reuseDecision\);/.test(rendererSource)
          && /if \(forceExactContextBaseRefresh\) \{[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);/.test(rendererSource),
        hasMountainMultiplier:
          /if \(normalized === "mountain_high_relief"\) return 1\.18;/.test(rendererSource),
        hasMountainHillsMultiplier:
          /if \(normalized === "mountain_hills"\) return 1\.02;/.test(rendererSource),
        hasDesertMultiplier:
          /if \(normalized === "desert_bare"\) return 1\.1;/.test(rendererSource),
        hasForestMultiplier:
          /if \(normalized === "forest" \|\| normalized === "forest_temperate"\) return 0\.95;/.test(rendererSource),
        hasPlateauMultiplier:
          /if \(normalized === "upland_plateau"\) return 0\.9;/.test(rendererSource),
        hasBadlandsMultiplier:
          /if \(normalized === "badlands_canyon"\) return 0\.98;/.test(rendererSource),
        hasPlainsMultiplier:
          /if \(normalized === "plains_lowlands"\) return 0\.68;/.test(rendererSource),
        hasGrasslandMultiplier:
          /if \(normalized === "grassland_steppe"\) return 0\.8;/.test(rendererSource),
        hasTundraMultiplier:
          /if \(normalized === "tundra_ice"\) return 0\.85;/.test(rendererSource),
      },
      mainSourceChecks: {
        physicalSetDefersContours:
          /const PHYSICAL_CONTEXT_LAYER_SET = \[\s*"physical",\s*"physical_semantics",\s*\];/.test(startupDataPipelineSource),
        hasSeparateContourWarmupSet:
          /const PHYSICAL_CONTOUR_LAYER_SET = \[[\s\S]*?"physical_contours_major",[\s\S]*?"physical_contours_minor",[\s\S]*?\];/.test(startupDataPipelineSource)
          && /if \(normalized === "physical-contours-set"\) \{[\s\S]*?return PHYSICAL_CONTOUR_LAYER_SET;/.test(startupDataPipelineSource),
        schedulesDeferredContourWarmup:
          /if \(state\.showPhysical\) \{[\s\S]*?requestedLayerNames\.push\("physical-set"\);[\s\S]*?requestedContourLayerNames\.push\("physical-contours-set"\);/.test(mainSource)
          && /schedulePostReadyTask\("post-ready-contour-warmup", async \(\) => \{[\s\S]*?ensureContextLayerDataReady\(requestedContourLayerNames, \{[\s\S]*?reason: "post-ready-contours",/.test(mainSource),
      },
      integrationSourceChecks: {
        toolbarToggleLoadsFullPhysicalSet:
          /ensureContextLayerDataFn\(\["physical-set", "physical-contours-set"\], \{ reason: "toolbar-toggle", renderNow: true \}\)/.test(appearanceControllerSource),
        projectImportLoadsFullPhysicalSet:
          /ensureContextLayerDataFn\(\["physical-set", "physical-contours-set"\], \{[\s\S]*?reason: "project-import",[\s\S]*?renderNow: false,/.test(interactionFunnelSource),
      },
    };
  }, {
    interactionFunnelSource,
    appearanceControllerSource,
    mainSource,
    rendererSource,
    startupDataPipelineSource,
  });

  expect(inspection.defaults.normalizedDefault.blendMode).toBe("source-over");
  expect(inspection.defaults.normalizedDefault.preset).toBe("balanced");
  expect(inspection.defaults.normalizedDefault.atlasOpacity).toBeCloseTo(0.44, 5);
  expect(inspection.defaults.normalizedExplicit.blendMode).toBe("overlay");
  expect(inspection.defaults.normalizedExplicit.atlasOpacity).toBeCloseTo(0.27, 5);
  expect(inspection.defaults.normalizedInvalidBlend.blendMode).toBe("source-over");
  expect(inspection.defaults.normalizedNewSchemaOpacityOnly.opacity).toBeCloseTo(0.44, 5);
  expect(inspection.defaults.normalizedNewSchemaOpacityOnly.atlasOpacity).toBeCloseTo(0.44, 5);
  expect(inspection.defaults.normalizedLegacyOpacityOnly.atlasOpacity).toBeCloseTo(0.31, 5);

  expect(inspection.palette).toEqual({
    mountain_high_relief: "#6f4430",
    mountain_hills: "#9e6b4e",
    upland_plateau: "#bf8d63",
    badlands_canyon: "#b35b3c",
    plains_lowlands: "#91ab68",
    basin_lowlands: "#b8b07c",
    wetlands_delta: "#4d9a8d",
    forest_temperate: "#4e7240",
    rainforest_tropical: "#236148",
    grassland_steppe: "#c2b66d",
    desert_bare: "#d8b169",
    tundra_ice: "#b8c7d8",
  });

  expect(inspection.rendererSourceChecks.hasValidBlendModes).toBe(true);
  expect(inspection.rendererSourceChecks.hasSafeBlendFallback).toBe(true);
  expect(inspection.rendererSourceChecks.hasPhysicalBasePass).toBe(true);
  expect(inspection.rendererSourceChecks.hasPhysicalReliefOverlayHelper).toBe(true);
  expect(inspection.rendererSourceChecks.reliefOverlayBlendClamp).toBe(true);
  expect(inspection.rendererSourceChecks.physicalBaseKeepsSemanticAtlas).toBe(true);
  expect(inspection.rendererSourceChecks.hasPhysicalExactRefresh).toBe(true);
  expect(inspection.rendererSourceChecks.contextBaseDrawsReliefOverlayBeforeContours).toBe(true);
  expect(inspection.rendererSourceChecks.deferredContextBaseStillDrawsReliefOverlay).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesSourceOver).toBe(true);
  expect(inspection.rendererSourceChecks.hasContourZoomProfiles).toBe(true);
  expect(inspection.rendererSourceChecks.hasAdaptiveContourColor).toBe(true);
  expect(inspection.rendererSourceChecks.contourKeepsInverseScaleWidth).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesAdaptiveColor).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesVisibleSetCache).toBe(true);
  expect(inspection.rendererSourceChecks.contourMergesBoundsAndFilter).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesStrokeBatching).toBe(true);
  expect(inspection.rendererSourceChecks.contourFirstIdleKeepsFastPath).toBe(true);
  expect(inspection.rendererSourceChecks.contourZoomBucketRefreshesAfterQuietWindow).toBe(true);
  expect(inspection.rendererSourceChecks.hasMountainMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasMountainHillsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasDesertMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasForestMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlateauMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasBadlandsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlainsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasGrasslandMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasTundraMultiplier).toBe(true);
  expect(inspection.mainSourceChecks.physicalSetDefersContours).toBe(true);
  expect(inspection.mainSourceChecks.hasSeparateContourWarmupSet).toBe(true);
  expect(inspection.mainSourceChecks.schedulesDeferredContourWarmup).toBe(true);
  expect(inspection.integrationSourceChecks.toolbarToggleLoadsFullPhysicalSet).toBe(true);
  expect(inspection.integrationSourceChecks.projectImportLoadsFullPhysicalSet).toBe(true);

  expect(inspection.physicalBlendModeAfterNormalize).toBe("source-over");

  await page.evaluate(async () => {
    const { state, normalizePhysicalStyleConfig } = await import("/js/core/state.js");
    const reliefFeature = {
      type: "Feature",
      properties: {
        atlas_class: "mountain_high_relief",
        atlas_layer: "relief_base",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[-12, 36], [32, 36], [32, 60], [-12, 60], [-12, 36]]],
      },
    };
    state.physicalSemanticsData = {
      type: "FeatureCollection",
      features: [reliefFeature],
    };
    state.deferContextBasePass = false;
    state.styleConfig.physical = normalizePhysicalStyleConfig({
      ...state.styleConfig.physical,
      preset: "balanced",
      mode: "atlas_only",
      opacity: 0.56,
      atlasOpacity: 0.44,
      atlasIntensity: 0.96,
      blendMode: "source-over",
      contourMinorVisible: false,
    });
    Object.keys(state.renderPassCache.dirty || {}).forEach((key) => {
      state.renderPassCache.dirty[key] = true;
      state.renderPassCache.reasons[key] = "physical-visual-regression";
    });
    state.showPhysical = false;
    state.renderNowFn?.();
  });
  await page.waitForTimeout(400);
  const physicalOffSnapshot = await captureCanvasSnapshot(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.showPhysical = true;
    Object.keys(state.renderPassCache.dirty || {}).forEach((key) => {
      state.renderPassCache.dirty[key] = true;
      state.renderPassCache.reasons[key] = "physical-visual-regression";
    });
    state.renderNowFn?.();
  });
  await page.waitForTimeout(400);
  const physicalOnSnapshot = await captureCanvasSnapshot(page);
  const reliefOverlayDiff = getMeanRgbDiff(physicalOffSnapshot, physicalOnSnapshot);
  expect(reliefOverlayDiff).toBeGreaterThan(0.9);
  expect(reliefOverlayDiff).toBeLessThan(10);

  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);
});
