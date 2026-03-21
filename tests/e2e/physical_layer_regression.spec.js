const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function resolveBaseUrl() {
  if (process.env.MAPCREATOR_BASE_URL) {
    return process.env.MAPCREATOR_BASE_URL;
  }
  const metadataPath = path.join(process.cwd(), ".runtime", "dev", "active_server.json");
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata && typeof metadata.url === "string" && metadata.url.trim()) {
        return metadata.url.trim();
      }
    } catch (error) {
      console.warn("[physical-layer-regression] Unable to parse active_server.json:", error);
    }
  }
  return "http://127.0.0.1:18080";
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
    const stateModule = await import("/js/core/state.js");
    const rendererSource = await fetch("/js/core/map_renderer.js").then((response) => response.text());
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
      normalizedNewSchemaOpacityOnly: normalizePhysicalStyleConfig({
        mode: "atlas_and_contours",
        opacity: 0.44,
        blendMode: "soft-light",
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
      opacity: 0.5,
      atlasOpacity: 0.52,
      atlasIntensity: 0.9,
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
        contourUsesSourceOver:
          /drawPhysicalContourLayer[\s\S]*?context\.globalCompositeOperation = "source-over";/.test(rendererSource),
        hasMountainMultiplier:
          /if \(atlasClass === "mountain_high_relief"\) return 1\.15;/.test(rendererSource),
        hasDesertMultiplier:
          /if \(atlasClass === "desert_bare"\) return 1\.1;/.test(rendererSource),
        hasForestMultiplier:
          /if \(atlasClass === "forest"\) return 0\.95;/.test(rendererSource),
        hasPlateauMultiplier:
          /if \(atlasClass === "upland_plateau"\) return 0\.9;/.test(rendererSource),
        hasPlainsMultiplier:
          /if \(atlasClass === "plains_lowlands"\) return 0\.68;/.test(rendererSource),
        hasTundraMultiplier:
          /if \(atlasClass === "tundra_ice"\) return 0\.85;/.test(rendererSource),
      },
    };
  });

  expect(inspection.defaults.normalizedDefault.blendMode).toBe("soft-light");
  expect(inspection.defaults.normalizedDefault.atlasOpacity).toBeCloseTo(0.52, 5);
  expect(inspection.defaults.normalizedExplicit.blendMode).toBe("overlay");
  expect(inspection.defaults.normalizedExplicit.atlasOpacity).toBeCloseTo(0.27, 5);
  expect(inspection.defaults.normalizedNewSchemaOpacityOnly.opacity).toBeCloseTo(0.44, 5);
  expect(inspection.defaults.normalizedNewSchemaOpacityOnly.atlasOpacity).toBeCloseTo(0.52, 5);
  expect(inspection.defaults.normalizedLegacyOpacityOnly.atlasOpacity).toBeCloseTo(0.31, 5);

  expect(inspection.palette).toEqual({
    mountain_high_relief: "#7a4a2a",
    upland_plateau: "#c4956a",
    plains_lowlands: "#8aad62",
    wetlands_delta: "#3d9e96",
    forest: "#3e6e28",
    rainforest: "#1a5c3e",
    desert_bare: "#dbb56a",
    tundra_ice: "#b8c8dc",
  });

  expect(inspection.rendererSourceChecks.hasValidBlendModes).toBe(true);
  expect(inspection.rendererSourceChecks.hasSafeBlendFallback).toBe(true);
  expect(inspection.rendererSourceChecks.contourUsesSourceOver).toBe(true);
  expect(inspection.rendererSourceChecks.hasMountainMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasDesertMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasForestMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlateauMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasPlainsMultiplier).toBe(true);
  expect(inspection.rendererSourceChecks.hasTundraMultiplier).toBe(true);

  expect(inspection.physicalBlendModeAfterNormalize).toBe("totally-invalid-mode");
  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);
});
