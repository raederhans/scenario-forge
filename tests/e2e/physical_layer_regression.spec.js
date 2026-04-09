const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

function resolveBaseUrl() {
  return getAppUrl();
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

test("physical layer defaults and atlas rendering regression", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
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

  const inspection = await page.evaluate(async () => {
    const stateModuleUrl = new URL("js/core/state.js", document.baseURI).href;
    const rendererSourceUrl = new URL("js/core/map_renderer.js", document.baseURI).href;
    const stateModule = await import(stateModuleUrl);
    const rendererSource = await fetch(rendererSourceUrl).then((response) => response.text());
    const {
      normalizePhysicalStyleConfig,
      PHYSICAL_ATLAS_PALETTE,
      state,
    } = stateModule;

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
    state.renderPassCache.dirty.contextBase = true;
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
        hasPhysicalExactRefresh:
          /invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);/.test(rendererSource),
        contourUsesSourceOver:
          /drawPhysicalContourLayer[\s\S]*?context\.globalCompositeOperation = "source-over";/.test(rendererSource),
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
    };
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
  expect(inspection.rendererSourceChecks.hasPhysicalExactRefresh).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesSourceOver).toBe(true);
  expect(inspection.rendererSourceChecks.hasMountainMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasMountainHillsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasDesertMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasForestMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlateauMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasBadlandsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlainsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasGrasslandMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasTundraMultiplier).toBe(true);

  expect(inspection.physicalBlendModeAfterNormalize).toBe("source-over");
  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);
});
