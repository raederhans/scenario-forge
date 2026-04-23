const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const canvas = Array.from(document.querySelectorAll("canvas"))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== "none");
    return !!select && select.querySelectorAll("option").length > 0 && !!canvas;
  }, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

test("physical layer runtime defaults and normalize contract stay stable", async ({ page }) => {
  test.setTimeout(60_000);
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

  await page.goto(getAppUrl(), { waitUntil: "domcontentloaded" });
  await waitForMapReady(page);

  const inspection = await page.evaluate(async () => {
    const stateModuleUrl = new URL("js/core/state.js", document.baseURI).href;
    const {
      normalizePhysicalStyleConfig,
      PHYSICAL_ATLAS_PALETTE,
      state,
    } = await import(stateModuleUrl);

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
  expect(inspection.physicalBlendModeAfterNormalize).toBe("source-over");
  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);
});
