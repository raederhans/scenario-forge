const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

const PROJECTION_FIT_PADDING_RATIO = 0.04;
const SAMPLE_REGIONS = [
  { name: "europe_land", lon: 12, lat: 50, radius: 20 },
  { name: "atlantic_ocean", lon: -35, lat: 30, radius: 20 },
  { name: "mediterranean", lon: 17, lat: 35, radius: 18 },
];
const LINE_SAMPLE_REGIONS = [
  { name: "prime_meridian_parallel", lon: 0, lat: 30, radius: 14 },
  { name: "eastern_minor_cross", lon: 15, lat: 15, radius: 14 },
];

async function setTextureStyle(page, patch) {
  await page.evaluate(async (inputPatch) => {
    const stateModule = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    const { state, normalizeTextureStyleConfig } = stateModule;
    const current = state.styleConfig?.texture || {};
    state.styleConfig.texture = normalizeTextureStyleConfig({
      ...current,
      ...inputPatch,
      paper: {
        ...(current.paper || {}),
        ...(inputPatch.paper || {}),
      },
      graticule: {
        ...(current.graticule || {}),
        ...(inputPatch.graticule || {}),
      },
      draftGrid: {
        ...(current.draftGrid || {}),
        ...(inputPatch.draftGrid || {}),
      },
    });
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, patch);
}

async function sampleCanvasRegions(page, regions) {
  return page.evaluate(async ({ sampleRegions, projectionFitPaddingRatio }) => {
    const { state } = await import("/js/core/state.js");
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    if (!canvas || !context || !state.landData) {
      return [];
    }
    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * projectionFitPaddingRatio));
    const x1 = Math.max(padding + 1, state.width - padding);
    const y1 = Math.max(padding + 1, state.height - padding);
    const projection = globalThis.d3.geoEqualEarth();
    projection.clipExtent(null);
    projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);

    return sampleRegions.map((region) => {
      const projected = projection([region.lon, region.lat]);
      if (!projected || !projected.every(Number.isFinite)) {
        return { name: region.name, error: "projection-miss" };
      }
      const cx = ((projected[0] * transform.k) + transform.x) * dpr;
      const cy = ((projected[1] * transform.k) + transform.y) * dpr;
      const radius = Math.max(4, Number(region.radius || 12) * dpr);
      const minX = Math.max(0, Math.floor(cx - radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radius));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radius));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const data = context.getImageData(minX, minY, width, height).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let pixelCount = 0;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        pixelCount += 1;
      }
      return {
        name: region.name,
        avgRed: pixelCount ? red / pixelCount : 0,
        avgGreen: pixelCount ? green / pixelCount : 0,
        avgBlue: pixelCount ? blue / pixelCount : 0,
      };
    });
  }, {
    sampleRegions: regions,
    projectionFitPaddingRatio: PROJECTION_FIT_PADDING_RATIO,
  });
}

function mapSamplesByName(samples) {
  return Object.fromEntries(samples.map((sample) => [sample.name, sample]));
}

function meanChannelDiff(left, right) {
  return (
    Math.abs(Number(left?.avgRed || 0) - Number(right?.avgRed || 0))
    + Math.abs(Number(left?.avgGreen || 0) - Number(right?.avgGreen || 0))
    + Math.abs(Number(left?.avgBlue || 0) - Number(right?.avgBlue || 0))
  ) / 3;
}

test("clean mode disables texture opacity and old paper affects land plus key water regions", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#labelMapStyle").evaluate((summary) => { summary.parentElement.open = true; });
  await page.locator("[data-appearance-tab='texture']").click();
  await page.locator("#textureSelect").selectOption("none");
  await expect(page.locator("#textureOpacity")).toBeDisabled();

  await setTextureStyle(page, { mode: "none", opacity: 0.67 });
  const baseline = mapSamplesByName(await sampleCanvasRegions(page, SAMPLE_REGIONS));

  await setTextureStyle(page, {
    mode: "paper",
    opacity: 1,
    paper: {
      scale: 1.1,
      warmth: 0.74,
      grain: 0.52,
      wear: 0.38,
    },
  });
  const paper = mapSamplesByName(await sampleCanvasRegions(page, SAMPLE_REGIONS));

  expect(meanChannelDiff(baseline.europe_land, paper.europe_land)).toBeGreaterThan(3.5);
  expect(meanChannelDiff(baseline.atlantic_ocean, paper.atlantic_ocean)).toBeGreaterThan(5);
  expect(meanChannelDiff(baseline.mediterranean, paper.mediterranean)).toBeGreaterThan(5);
});

test("graticule and draft grid expose dynamic controls and produce visible pixel changes", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#labelMapStyle").evaluate((summary) => { summary.parentElement.open = true; });
  await page.locator("[data-appearance-tab='texture']").click();
  await page.locator("#textureSelect").selectOption("graticule");
  await page.locator("#textureGraticuleMajorStep").evaluate((element) => {
    element.value = "10";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#textureGraticuleMinorStep")).toHaveAttribute("max", "10");
  await expect(page.locator("#textureGraticuleLabelStep")).toHaveAttribute("min", "10");
  await page.locator("#textureGraticuleColor").evaluate((element) => {
    element.value = "#112233";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#textureGraticuleMajorOpacity").evaluate((element) => {
    element.value = "62";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const graticuleUiState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      color: state.styleConfig.texture.graticule.color,
      majorOpacity: state.styleConfig.texture.graticule.majorOpacity,
    };
  });
  expect(graticuleUiState).toEqual({
    color: "#112233",
    majorOpacity: 0.62,
  });

  await page.locator("#textureSelect").selectOption("draft_grid");
  await page.locator("#textureDraftWidth").evaluate((element) => {
    element.value = "1.95";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#textureDraftDash").selectOption("solid");
  const draftUiState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      width: state.styleConfig.texture.draftGrid.width,
      dash: state.styleConfig.texture.draftGrid.dash,
    };
  });
  expect(draftUiState).toEqual({
    width: 1.95,
    dash: "solid",
  });

  await setTextureStyle(page, { mode: "none", opacity: 0.73 });
  const baseline = mapSamplesByName(await sampleCanvasRegions(page, LINE_SAMPLE_REGIONS));

  await setTextureStyle(page, {
    mode: "graticule",
    opacity: 1,
    graticule: {
      majorStep: 30,
      minorStep: 15,
      labelStep: 60,
      color: "#0f172a",
      labelColor: "#0f172a",
      labelSize: 14,
      majorWidth: 2.2,
      minorWidth: 1.2,
      majorOpacity: 0.82,
      minorOpacity: 0.4,
    },
  });
  const graticule = mapSamplesByName(await sampleCanvasRegions(page, LINE_SAMPLE_REGIONS));
  expect(meanChannelDiff(baseline.prime_meridian_parallel, graticule.prime_meridian_parallel)).toBeGreaterThan(10);

  await setTextureStyle(page, {
    mode: "draft_grid",
    opacity: 1,
    draftGrid: {
      majorStep: 30,
      minorStep: 15,
      lonOffset: 0,
      latOffset: 0,
      roll: 0,
      color: "#0f172a",
      width: 2.1,
      majorOpacity: 0.82,
      minorOpacity: 0.38,
      dash: "solid",
    },
  });
  const draft = mapSamplesByName(await sampleCanvasRegions(page, LINE_SAMPLE_REGIONS));
  expect(meanChannelDiff(baseline.prime_meridian_parallel, draft.prime_meridian_parallel)).toBeGreaterThan(9);
});

test("texture overlay payload rehydrates new controls back into state and UI", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#labelMapStyle").evaluate((summary) => { summary.parentElement.open = true; });
  await page.locator("[data-appearance-tab='texture']").click();

  const payload = {
    mode: "draft_grid",
    opacity: 0.74,
    paper: {
      assetId: "paper_vintage_01",
      scale: 1.08,
      warmth: 0.64,
      grain: 0.39,
      wear: 0.28,
      vignette: 0.18,
      blendMode: "multiply",
    },
    graticule: {
      majorStep: 10,
      minorStep: 4,
      labelStep: 70,
      color: "#2f4858",
      labelColor: "#1e293b",
      labelSize: 16,
      majorWidth: 1.55,
      minorWidth: 0.8,
      majorOpacity: 0.52,
      minorOpacity: 0.19,
    },
    draftGrid: {
      majorStep: 36,
      minorStep: 12,
      lonOffset: 14,
      latOffset: -8,
      roll: 24,
      color: "#6b7280",
      width: 1.55,
      majorOpacity: 0.41,
      minorOpacity: 0.16,
      dash: "solid",
    },
  };

  await page.evaluate(async (texturePayload) => {
    const { state, normalizeTextureStyleConfig } = await import("/js/core/state.js");
    state.styleConfig.texture = normalizeTextureStyleConfig(texturePayload);
    state.updateToolbarInputsFn?.();
  }, payload);

  const hydrated = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const byId = (selector) => document.querySelector(selector);
    return {
      stateTexture: state.styleConfig.texture,
      ui: {
        mode: byId("#textureSelect")?.value,
        opacity: byId("#textureOpacity")?.value,
        draftColor: byId("#textureDraftColor")?.value?.toLowerCase(),
        draftWidth: byId("#textureDraftWidth")?.value,
        draftMajorOpacity: byId("#textureDraftMajorOpacity")?.value,
        draftMinorOpacity: byId("#textureDraftMinorOpacity")?.value,
        draftDash: byId("#textureDraftDash")?.value,
        draftMajorStep: byId("#textureDraftMajorStep")?.value,
        draftMinorStep: byId("#textureDraftMinorStep")?.value,
        draftLonOffset: byId("#textureDraftLonOffset")?.value,
        draftLatOffset: byId("#textureDraftLatOffset")?.value,
        draftRoll: byId("#textureDraftRoll")?.value,
        graticuleColor: byId("#textureGraticuleColor")?.value?.toLowerCase(),
        graticuleLabelColor: byId("#textureGraticuleLabelColor")?.value?.toLowerCase(),
        graticuleLabelSize: byId("#textureGraticuleLabelSize")?.value,
        graticuleMajorWidth: byId("#textureGraticuleMajorWidth")?.value,
        graticuleMinorWidth: byId("#textureGraticuleMinorWidth")?.value,
        graticuleMajorOpacity: byId("#textureGraticuleMajorOpacity")?.value,
        graticuleMinorOpacity: byId("#textureGraticuleMinorOpacity")?.value,
        graticuleMajorStep: byId("#textureGraticuleMajorStep")?.value,
        graticuleMinorStep: byId("#textureGraticuleMinorStep")?.value,
        graticuleLabelStep: byId("#textureGraticuleLabelStep")?.value,
      },
    };
  });

  expect(hydrated.stateTexture).toMatchObject(payload);
  expect(hydrated.ui).toMatchObject({
    mode: "draft_grid",
    opacity: "74",
    draftColor: "#6b7280",
    draftWidth: "1.55",
    draftMajorOpacity: "41",
    draftMinorOpacity: "16",
    draftDash: "solid",
    draftMajorStep: "36",
    draftMinorStep: "12",
    draftLonOffset: "14",
    draftLatOffset: "-8",
    draftRoll: "24",
    graticuleColor: "#2f4858",
    graticuleLabelColor: "#1e293b",
    graticuleLabelSize: "16",
    graticuleMajorWidth: "1.55",
    graticuleMinorWidth: "0.8",
    graticuleMajorOpacity: "52",
    graticuleMinorOpacity: "19",
    graticuleMajorStep: "10",
    graticuleMinorStep: "4",
    graticuleLabelStep: "70",
  });
});
