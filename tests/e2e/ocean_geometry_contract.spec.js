const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  primeStateRef,
  waitForAppInteractive,
  waitForRenderIdle,
} = require("./support/playwright-app");

const BASE_PROBES = [
  { id: "north-pole", point: [0, 89], expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true, expectWaterPixel: true },
  { id: "antarctic-interior", point: [90, -80], expectedIds: [], expectedLand: true, expectedOcean: false },
  { id: "mid-atlantic", point: [-30, 30], expectedIds: ["marine_atlantic_ocean"], expectedLand: false, expectedOcean: true, expectWaterPixel: true },
  { id: "dateline-east", point: [179.5, 85], expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true, expectWaterPixel: true },
  { id: "dateline-west", point: [-179.5, 85], expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true, expectWaterPixel: true },
];

const TNO_PROBES = [
  { id: "antarctic-indian-80e", point: [80, -70], expectedIds: [], expectedLand: true },
  { id: "antarctic-indian-90e", point: [90, -75], expectedIds: [], expectedLand: true },
  { id: "arctic", point: [0, 85], expectedIds: ["tno_western_arctic_ocean"], expectedLand: false, expectWaterPixel: true },
  { id: "dateline-east", point: [179.5, 75], expectedIds: ["tno_eastern_arctic_ocean"], expectedLand: false, expectWaterPixel: true },
  { id: "dateline-west", point: [-179.5, 75], expectedIds: ["tno_western_arctic_ocean"], expectedLand: false, expectWaterPixel: true },
  { id: "mid-atlantic", point: [-30, 30], expectedIds: ["tno_northeast_atlantic_ocean"], expectedLand: false, expectWaterPixel: true },
];

async function setOpenOceanInteraction(page) {
  await page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    const { clearHistory } = await import(new URL("./js/core/history_manager.js", globalThis.location.href).toString());
    const {
      invalidateOceanWaterInteractionVisualState,
      render,
    } = await import(new URL("./js/core/map_renderer.js", globalThis.location.href).toString());
    state.allowOpenOceanSelect = true;
    state.allowOpenOceanPaint = true;
    state.showOpenOceanRegions = true;
    state.currentTool = "fill";
    state.devSelectedHit = null;
    clearHistory();
    invalidateOceanWaterInteractionVisualState("e2e-ocean-geometry-contract");
    render();
  });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state?.showOpenOceanRegions
      && !!state?.allowOpenOceanSelect
      && !!state?.allowOpenOceanPaint
      && Array.isArray(state?.waterSpatialItems)
      && state.waterSpatialItems.length > 0;
  }, undefined, { timeout: 30_000 });
}

async function ensureBaseMode(page) {
  await page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    if (!state.activeScenarioId) return;
    const { clearActiveScenarioCommand } = await import(new URL("./js/core/scenario_dispatcher.js", globalThis.location.href).toString());
    await clearActiveScenarioCommand({
      renderMode: "flush",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state && !state.activeScenarioId && !state.scenarioApplyInFlight;
  }, undefined, { timeout: 60_000 });
}

async function applyScenarioFromActiveApp(page, scenarioId, options) {
  await page.evaluate(async ({ targetScenarioId, applyOptions }) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) select.value = targetScenarioId;
    const { applyScenarioByIdCommand } = await import(
      new URL("./js/core/scenario_dispatcher.js", globalThis.location.href).toString()
    );
    await applyScenarioByIdCommand(targetScenarioId, applyOptions);
  }, { targetScenarioId: scenarioId, applyOptions: options });
  await primeStateRef(page);
  await page.waitForFunction((targetScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    return state?.activeScenarioId === targetScenarioId && !state?.scenarioApplyInFlight;
  }, scenarioId, { timeout: 120_000 });
}

async function projectGeoPointToPagePoint(page, point) {
  return page.evaluate(async (targetPoint) => {
    const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", globalThis.location.href).toString());
    const mapSvg = document.querySelector("#map-svg");
    const screenMatrix = mapSvg?.getScreenCTM();
    if (!screenMatrix) return null;
    const projected = projectGeoToScreen(Number(targetPoint[0]), Number(targetPoint[1]));
    if (!Array.isArray(projected) || !projected.every(Number.isFinite)) return null;
    // D3's pointer handler inverts this same matrix. The outer container's
    // border shifts its rectangle by one pixel, enough to miss a polar cap.
    const screenPoint = new DOMPoint(projected[0], projected[1]).matrixTransform(screenMatrix);
    return { x: screenPoint.x, y: screenPoint.y };
  }, point);
}

async function sampleCanvasPatch(page, point, radiusPx = 5) {
  const pagePoint = await projectGeoPointToPagePoint(page, point);
  if (!pagePoint) return null;
  return page.evaluate(({ targetPoint, radius }) => {
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    if (!canvas || !context) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const centerX = (targetPoint.x - rect.left) * scaleX;
    const centerY = (targetPoint.y - rect.top) * scaleY;
    const left = Math.max(0, Math.floor(centerX - radius));
    const top = Math.max(0, Math.floor(centerY - radius));
    const right = Math.min(canvas.width, Math.ceil(centerX + radius));
    const bottom = Math.min(canvas.height, Math.ceil(centerY + radius));
    if (right <= left || bottom <= top) return null;
    const pixels = context.getImageData(left, top, right - left, bottom - top).data;
    const opaqueSums = { red: 0, green: 0, blue: 0, alpha: 0 };
    let alphaSum = 0;
    let opaquePixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      alphaSum += alpha;
      if (alpha < 240) continue;
      opaqueSums.red += pixels[index];
      opaqueSums.green += pixels[index + 1];
      opaqueSums.blue += pixels[index + 2];
      opaqueSums.alpha += alpha;
      opaquePixelCount += 1;
    }
    const pixelCount = pixels.length / 4;
    const opaqueDivisor = Math.max(1, opaquePixelCount);
    return {
      avgRed: opaqueSums.red / opaqueDivisor,
      avgGreen: opaqueSums.green / opaqueDivisor,
      avgBlue: opaqueSums.blue / opaqueDivisor,
      avgAlpha: opaqueSums.alpha / opaqueDivisor,
      overallAvgAlpha: alphaSum / pixelCount,
      pixelCount,
      opaquePixelCount,
      coverageFraction: opaquePixelCount / pixelCount,
    };
  }, { targetPoint: pagePoint, radius: radiusPx });
}

async function readProbeResults(page, probes) {
  return page.evaluate(async (targets) => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", globalThis.location.href).toString());
    const d3 = globalThis.d3;
    const macroFeatures = Array.from(state.waterRegionsById?.values?.() || [])
      .filter((feature) => feature?.properties?.region_group === "ocean_macro");
    const macroSpatialItems = (state.waterSpatialItems || [])
      .filter((item) => item?.feature?.properties?.region_group === "ocean_macro");
    // Chunked startup shells intentionally contain empty mask collections.
    // Match the renderer's nonempty-mask preference and background fallback.
    const landMask = [state.scenarioContextLandMaskData, state.scenarioLandMaskData, state.landBgData]
      .find((collection) => Array.isArray(collection?.features) && collection.features.length > 0);
    const oceanMask = state.oceanData || null;
    const transform = state.zoomTransform || d3.zoomIdentity || { x: 0, y: 0, k: 1 };
    const zoomScale = Math.max(0.0001, Number(transform.k || 1));
    return targets.map((probe) => {
      const screenPoint = projectGeoToScreen(Number(probe.point[0]), Number(probe.point[1]));
      const projected = Array.isArray(screenPoint)
        ? [
            (screenPoint[0] - Number(transform.x || 0)) / zoomScale,
            (screenPoint[1] - Number(transform.y || 0)) / zoomScale,
          ]
        : null;
      const geometryIds = macroFeatures
        .filter((feature) => d3.geoContains(feature, probe.point))
        .map((feature) => String(feature.properties?.id || feature.id || ""))
        .filter(Boolean)
        .sort();
      const spatialCandidates = macroSpatialItems.map((item) => {
        const contains = d3.geoContains(item.hitGeometry || item.feature, probe.point);
        const bboxContains = Array.isArray(projected)
          && projected[0] >= Number(item.minX) - 0.5
          && projected[0] <= Number(item.maxX) + 0.5
          && projected[1] >= Number(item.minY) - 0.5
          && projected[1] <= Number(item.maxY) + 0.5;
        return {
          itemId: String(item.id || ""),
          featureId: String(item.featureId || item.id || ""),
          bbox: [item.minX, item.minY, item.maxX, item.maxY].map(Number),
          contains,
          bboxContains,
        };
      }).filter((item) => item.contains || item.bboxContains);
      const spatialIds = Array.from(new Set(spatialCandidates
        .filter((item) => item.contains && item.bboxContains)
        .map((item) => item.featureId)
        .filter(Boolean)))
        .sort();
      return {
        id: probe.id,
        geometryIds,
        spatialIds,
        projected,
        screenPoint,
        zoomTransform: {
          x: Number(transform.x || 0),
          y: Number(transform.y || 0),
          k: zoomScale,
        },
        spatialItemCount: macroSpatialItems.length,
        spatialCandidates,
        land: !!(landMask && d3.geoContains(landMask, probe.point)),
        ocean: !!(oceanMask && d3.geoContains(oceanMask, probe.point)),
      };
    });
  }, probes);
}

async function expectProbeContracts(page, probes) {
  const results = await readProbeResults(page, probes);
  for (const probe of probes) {
    const result = results.find((entry) => entry.id === probe.id);
    expect(result, `missing runtime probe ${probe.id}`).toBeTruthy();
    expect(result.geometryIds, `${probe.id} geometry ownership`).toEqual(probe.expectedIds);
    expect(
      result.spatialIds,
      `${probe.id} interaction ownership ${JSON.stringify({
        projected: result.projected,
        screenPoint: result.screenPoint,
        zoomTransform: result.zoomTransform,
        spatialItemCount: result.spatialItemCount,
        spatialCandidates: result.spatialCandidates,
      })}`,
    ).toEqual(probe.expectedIds);
    expect(result.land, `${probe.id} land mask`).toBe(probe.expectedLand);
    if (probe.expectedOcean != null) expect(result.ocean, `${probe.id} physical ocean mask`).toBe(probe.expectedOcean);
    if (probe.expectWaterPixel) {
      const patch = await sampleCanvasPatch(page, probe.point);
      expect(patch, `${probe.id} visible canvas patch`).not.toBeNull();
      expect(
        patch.opaquePixelCount,
        `${probe.id} opaque canvas coverage ${JSON.stringify({
          pixelCount: patch.pixelCount,
          opaquePixelCount: patch.opaquePixelCount,
          coverageFraction: patch.coverageFraction,
          overallAvgAlpha: patch.overallAvgAlpha,
        })}`,
      ).toBeGreaterThan(0);
      expect(patch.avgBlue, `${probe.id} blue ocean channel`).toBeGreaterThan(patch.avgRed + 5);
    }
  }
}

function patchDistance(left, right) {
  return Math.abs(left.avgRed - right.avgRed)
    + Math.abs(left.avgGreen - right.avgGreen)
    + Math.abs(left.avgBlue - right.avgBlue);
}

test("open-ocean geometry stays visible, uniquely hittable, paintable, and undo-stable across base and TNO", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await gotoApp(page, "/?startup_interaction=full", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 60_000 });
  await primeStateRef(page);

  await ensureBaseMode(page);
  await setOpenOceanInteraction(page);
  await waitForRenderIdle(page, { timeout: 60_000 });
  await expectProbeContracts(page, BASE_PROBES);

  await applyScenarioFromActiveApp(page, "tno_1962", {
    renderMode: "request",
    markDirtyReason: "e2e-ocean-geometry-contract",
    showToastOnComplete: false,
  });
  await setOpenOceanInteraction(page);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120_000 });
  await expectProbeContracts(page, TNO_PROBES);

  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef;
    return state && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
  }, undefined, { timeout: 30_000 });

  const targetId = "tno_western_arctic_ocean";
  const targetPoint = [0, 85];
  const pagePoint = await projectGeoPointToPagePoint(page, targetPoint);
  expect(pagePoint).not.toBeNull();
  // Undo restores the fill while retaining selection. Establish the same
  // selected/hovered state before taking the baseline pixel sample.
  await page.keyboard.down("Control");
  try {
    await page.mouse.click(pagePoint.x, pagePoint.y);
  } finally {
    await page.keyboard.up("Control");
  }
  await expect.poll(() => page.evaluate(() => globalThis.__playwrightStateRef?.selectedWaterRegionId))
    .toBe(targetId);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 60_000 });
  const before = await sampleCanvasPatch(page, targetPoint, 7);
  expect(before).not.toBeNull();

  await page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    state.currentTool = "fill";
    state.selectedColor = "#ff00ff";
    state.devSelectedHit = null;
  });
  await page.mouse.click(pagePoint.x, pagePoint.y);
  await expect.poll(async () => page.evaluate(async (expectedId) => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    return {
      selectedId: String(state.selectedWaterRegionId || ""),
      override: String(state.waterRegionOverrides?.[expectedId] || "").toLowerCase(),
    };
  }, targetId), { timeout: 30_000 }).toEqual({ selectedId: targetId, override: "#ff00ff" });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 60_000 });

  const painted = await sampleCanvasPatch(page, targetPoint, 7);
  expect(painted).not.toBeNull();
  expect(patchDistance(before, painted)).toBeGreaterThan(35);
  expect(painted.avgRed).toBeGreaterThan(before.avgRed + 20);
  const paintedHits = await readProbeResults(page, [{ id: "painted", point: targetPoint }]);
  expect(paintedHits[0].geometryIds).toEqual([targetId]);
  expect(paintedHits[0].spatialIds).toEqual([targetId]);

  const undoApplied = await page.evaluate(async () => {
    const { undoHistory } = await import(new URL("./js/core/history_manager.js", globalThis.location.href).toString());
    return undoHistory();
  });
  expect(undoApplied).toBe(true);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async (expectedId) => {
    const { state } = await import(new URL("./js/core/state.js", globalThis.location.href).toString());
    return {
      selectedId: String(state.selectedWaterRegionId || ""),
      override: state.waterRegionOverrides?.[expectedId] || null,
    };
  }, targetId)).toEqual({ selectedId: targetId, override: null });

  const restored = await sampleCanvasPatch(page, targetPoint, 7);
  expect(restored).not.toBeNull();
  expect(patchDistance(before, restored)).toBeLessThan(18);
  const restoredHits = await readProbeResults(page, [{ id: "restored", point: targetPoint }]);
  expect(restoredHits[0].geometryIds).toEqual([targetId]);
  expect(restoredHits[0].spatialIds).toEqual([targetId]);
  await page.locator("#mapContainer").screenshot({
    path: testInfo.outputPath("tno-ocean-geometry-contract.png"),
  });
});
