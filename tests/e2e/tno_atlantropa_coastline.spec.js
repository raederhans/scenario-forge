const { test, expect } = require("@playwright/test");
const {
  gotoApp, primeStateRef, waitForAppInteractive, waitForRenderIdle,
} = require("./support/playwright-app");

const TNO_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=tno_1962";

async function findNewLandPoint(page, id) {
  // Fixed probes from the admitted source geometry must remain land; do not
  // silently choose a different point if a future water/shore regression occurs.
  const points = {
    ATLPRV_18349: [28.91253315812773, 40.69848993243577],
    ATLPRV_18332: [5.755634918046521, 36.92663313862793],
    ATLPRV_19191: [27.897687956506662, 36.92037650023392],
    ATLPRV_19190: [27.407739670234427, 37.27662123649061],
    // Lesvos probe is inside source province 19159, beyond the previous island.
    ATLISL_aegean_lesvos: [26.484973940648494, 38.88440388803889],
    ATLISL_aegean_chios: [25.96705967059671, 38.629139213892145],
    ATLISL_aegean_GRE_5: [24.33351633416709, 38.89679769808103],
    ATLISL_aegean_samos: [26.645476797366552, 37.66541650627095],
    ATLISL_aegean_ikaria: [26.32819220178265, 37.59475007842151],
    ATLISL_sicily_tunis_malta: [14.822375882050203, 35.680959879396916],
    ATLPRV_19158: [26.802820065599498, 38.48013932352826],
  };
  return page.evaluate(({ targetId, point }) => {
    const state = globalThis.__playwrightStateRef;
    const feature = (state.scenarioAtlantropaData?.features || [])
      .find(entry => entry.properties?.id === targetId);
    if (!feature || feature.properties?.atl_render_layer !== "land") return null;
    const primary = state.topologyPrimary || state.topology;
    const baseObject = primary?.objects?.[globalThis.__mapCoastlineDiag?.primaryObjectName];
    const baseLand = baseObject ? globalThis.topojson.feature(primary, baseObject) : null;
    const runtime = state.runtimePoliticalTopology;
    const waterObject = runtime?.objects?.scenario_water;
    const scenarioWater = waterObject ? globalThis.topojson.feature(runtime, waterObject) : null;
    const visibleWater = state.scenarioWaterRegionsData;
    if (!visibleWater?.features?.length) return null;
    const coastObject = runtime?.objects?.scenario_coastline;
    const coastLand = coastObject ? globalThis.topojson.feature(runtime, coastObject) : null;
    const atlWater = (state.scenarioAtlantropaData?.features || [])
      .filter(entry => entry.properties?.atl_render_layer === "water");
    return {
      id: targetId, point,
      inLand: globalThis.d3.geoContains(feature, point),
      inCoast: !!coastLand && globalThis.d3.geoContains(coastLand, point),
      outsideOriginalLand: !!baseLand && !globalThis.d3.geoContains(baseLand, point),
      inWater: !!(scenarioWater && globalThis.d3.geoContains(scenarioWater, point))
        || globalThis.d3.geoContains(visibleWater, point)
        || atlWater.some(entry => globalThis.d3.geoContains(entry, point)),
    };
  }, { targetId: id, point: points[id] });
}

async function centerNewLand(page, point) {
  await page.evaluate(async () => {
    const renderer = await import(new URL("./js/core/map_renderer.js", location.href).toString());
    renderer.setZoomPercent(800);
  });
  await page.waitForFunction(() => Math.abs(globalThis.__playwrightStateRef.zoomTransform.k - 8) < 0.01);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 20_000 });
  const dragTowardTarget = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const movement = await page.evaluate(async (target) => {
        const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href).toString());
        const [x, y] = projectGeoToScreen(...target);
        const svg = document.querySelector("#map-svg");
        const rect = svg.getBoundingClientRect();
        const projected = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return { dx: Math.max(-220, Math.min(220, centerX - projected.x)),
          dy: Math.max(-220, Math.min(220, centerY - projected.y)), x: centerX, y: centerY };
      }, point);
      if (Math.hypot(movement.dx, movement.dy) < 5) return;
      await page.keyboard.down("Shift");
      try {
        await page.mouse.move(movement.x, movement.y);
        await page.mouse.down();
        await page.mouse.move(movement.x + movement.dx, movement.y + movement.dy, { steps: 8 });
        await page.mouse.up();
      } finally {
        await page.keyboard.up("Shift");
      }
      await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 20_000 });
    }
  };
  await dragTowardTarget();
  return page.evaluate(async (target) => {
    const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href).toString());
    const [x, y] = projectGeoToScreen(...target);
    const svg = document.querySelector("#map-svg");
    const rect = svg.getBoundingClientRect();
    const projected = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    return { x: projected.x, y: projected.y,
      inMap: x > 15 && x < rect.width - 15 && y > 15 && y < rect.height - 15 };
  }, point);
}

async function checkNativeCoastEditing(page, testInfo, targets) {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await gotoApp(page, TNO_PATH, { waitUntil: "domcontentloaded" });
  await primeStateRef(page);
  await waitForAppInteractive(page, { timeout: 70_000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef;
    return state?.activeScenarioId === "tno_1962"
      && globalThis.__playwrightIsScenarioRuntimeReady(state)
      && state.interactionInfrastructureReady && !state.startupReadonly;
  }, undefined, { timeout: 70_000 });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 20_000 });
  if (await page.locator("#scenarioGuidePopover").isVisible()) {
    await page.locator("#scenarioGuideCloseBtn").click();
  }

  for (const [id, owner] of targets) {
    const target = await findNewLandPoint(page, id);
    expect(target, `${id} needs a reclaimed interior point outside ATL and scenario water`).not.toBeNull();
    expect(target).toMatchObject({ inLand: true, inCoast: true, outsideOriginalLand: true, inWater: false });
    const screen = await centerNewLand(page, target.point);
    expect(screen, `${id} interior point must be visible: ${JSON.stringify(screen)}`).toMatchObject({ inMap: true });
    await page.keyboard.down("Control");
    try {
      await page.mouse.click(screen.x, screen.y);
    } finally {
      await page.keyboard.up("Control");
    }
    await expect.poll(() => page.evaluate(() => globalThis.__playwrightStateRef.devSelectedHit?.id || ""),
      { timeout: 10_000 }).toBe(id);
    const before = await page.evaluate(featureId => {
      const state = globalThis.__playwrightStateRef;
      const feature = state.scenarioAtlantropaData.features.find(entry => entry.properties?.id === featureId);
      return { owner: feature?.properties?.owner_tag, layer: feature?.properties?.atl_render_layer,
        indexed: !!state.landIndex?.has(featureId), color: String(state.colors?.[featureId] || ""),
        overrides: { ...(state.visualOverrides || {}) }, past: state.historyPast?.length || 0,
      };
    }, id);
    expect(before).toMatchObject({ owner, layer: "land", indexed: true });
    await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
    await page.locator("#paintModeVisualBtn").click();
    await page.locator("#toolFillBtn").click();
    await page.locator("#customColor").fill("#e31ac4");
    await page.mouse.click(screen.x, screen.y);
    await expect.poll(() => page.evaluate(featureId => ({
      override: String(globalThis.__playwrightStateRef.visualOverrides?.[featureId] || "").toLowerCase(),
      past: globalThis.__playwrightStateRef.historyPast?.length || 0,
      future: globalThis.__playwrightStateRef.historyFuture?.length || 0,
    }), id), { timeout: 10_000 }).toEqual({ override: "#e31ac4", past: before.past + 1, future: 0 });
    await page.locator("#undoBtn").click();
    await expect.poll(() => page.evaluate(featureId => {
      const state = globalThis.__playwrightStateRef;
      return { overrides: { ...(state.visualOverrides || {}) },
        color: String(state.colors?.[featureId] || ""),
        past: state.historyPast?.length || 0, future: state.historyFuture?.length || 0 };
    }, id), { timeout: 10_000 }).toEqual({
      overrides: before.overrides, color: before.color,
      past: before.past, future: 1,
    });
  }
  expect(pageErrors).toEqual([]);
}

test("new TNO Atlantropa coasts accept native hit, fill, and undo without water coverage", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await checkNativeCoastEditing(page, testInfo, [["ATLPRV_18349", "TUR"], ["ATLPRV_18332", "IAL"]]);
});

test("Bodrum and Milas coasts accept native hit, fill, and undo without water coverage", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await checkNativeCoastEditing(page, testInfo, [["ATLPRV_19191", "TUR"], ["ATLPRV_19190", "TUR"]]);
});

test("southern expansion islands accept native hit, fill, and undo without water coverage", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await checkNativeCoastEditing(page, testInfo, [
    ["ATLISL_aegean_samos", "TUR"], ["ATLISL_aegean_ikaria", "TUR"],
    ["ATLISL_sicily_tunis_malta", "ITA"], ["ATLPRV_19158", "TUR"],
  ]);
});
