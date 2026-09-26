const { test, expect } = require("@playwright/test");
const {
  gotoApp, primeStateRef, waitForAppInteractive, waitForRenderIdle,
} = require("./support/playwright-app");

const TNO_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=tno_1962";

async function readCoastline(page) {
  return page.evaluate(() => {
    const state = globalThis.__playwrightStateRef;
    const diag = globalThis.__mapCoastlineDiag || {};
    const runtime = state.runtimePoliticalTopology;
    const expectedObject = diag.source === "scenario"
      ? runtime?.objects?.scenario_coastline
      : (state.topologyPrimary || state.topology)?.objects?.[diag.primaryObjectName];
    const topology = diag.source === "scenario" ? runtime : state.topologyPrimary || state.topology;
    const mesh = state.cachedCoastlinesHigh?.[0];
    const expectedMesh = expectedObject ? globalThis.topojson.mesh(topology, expectedObject) : null;
    const landCount = (state.scenarioAtlantropaData?.features || [])
      .filter(feature => feature.properties?.atl_render_layer === "land").length;
    return {
      source: diag.source, object: diag.runtimeObjectName, reason: diag.reason,
      chunkManifest: !!state.activeScenarioManifest?.detail_chunk_manifest_url,
      loadedChunks: state.activeScenarioChunks?.loadedChunkIds?.length || 0,
      bootstrapMaskCount: runtime?.objects?.land_mask?.geometries?.length || 0,
      landCount, lineCount: mesh?.coordinates?.length || 0,
      matchesSelectedGeometry: !!mesh && JSON.stringify(mesh) === JSON.stringify(expectedMesh),
      matchesVisibleMesh: !!mesh && JSON.stringify(mesh) === globalThis.__tnoVisibleCoastlineJson,
      changedSinceVisible: !!mesh && mesh !== globalThis.__tnoVisibleCoastlineRef,
    };
  });
}

async function setVisibility(page, field, value) {
  await page.evaluate(async ({ field, value }) => {
    const state = globalThis.__playwrightStateRef;
    const { render } = await import(new URL("./js/core/map_renderer.js", globalThis.location.href).toString());
    state[field] = value;
    // Deliberately do not rebuild meshes or force border invalidation: the
    // ordinary render must observe visibility and retire its old geometry.
    render();
  }, { field, value });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", requireInfra: false });
}

test("chunked TNO replaces submerged old coastlines and refreshes coastline on visibility changes", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page, TNO_PATH, { waitUntil: "domcontentloaded" });
  await primeStateRef(page);
  await waitForAppInteractive(page, { timeout: 120000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef;
    return state?.activeScenarioId === "tno_1962"
      && globalThis.__playwrightIsScenarioRuntimeReady(state);
  }, undefined, { timeout: 120000 });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", requireInfra: false });
  await expect.poll(() => readCoastline(page), { timeout: 60000 }).toMatchObject({
    source: "scenario", object: "scenario_coastline", reason: "scenario_accepted",
    chunkManifest: true, matchesSelectedGeometry: true,
  });
  const ready = await readCoastline(page);
  expect(ready.loadedChunks).toBeGreaterThan(0);
  expect(ready.landCount).toBeGreaterThan(0);
  expect(ready.bootstrapMaskCount).toBe(0);
  expect(ready.lineCount).toBeGreaterThan(0);
  const restoredCandidates = {
    ATLPRV_18345: "ITA", ATLPRV_11905: "TUR", ATLPRV_18960: "EGY",
    ATLPRV_18349: "TUR", ATLPRV_18332: "IAL",
    ATLISL_west_med_balearics: "IBR", ATLISL_levant_cyprus: "TUR",
  };
  await expect.poll(() => page.evaluate((expected) => {
    const state = globalThis.__playwrightStateRef;
    const features = new Map((state.scenarioAtlantropaData?.features || [])
      .map(feature => [feature.properties?.id, feature]));
    return Object.fromEntries(Object.keys(expected).map(id => {
      const feature = features.get(id);
      return [id, {
        owner: feature?.properties?.owner_tag,
        layer: feature?.properties?.atl_render_layer,
        interactive: feature?.properties?.atl_interactive,
        indexed: !!state.landIndex?.has(id),
      }];
    }));
  }, restoredCandidates), { timeout: 60000 }).toEqual(Object.fromEntries(
    Object.entries(restoredCandidates).map(([id, owner]) => [id, {
      owner, layer: "land", interactive: true, indexed: true,
    }]),
  ));

  const islandCoverage = await page.evaluate(() => {
    const state = globalThis.__playwrightStateRef;
    const surface = globalThis.topojson.feature(state.runtimePoliticalTopology,
      state.runtimePoliticalTopology.objects.scenario_coastline);
    const features = new Map(state.scenarioAtlantropaData.features.map(f => [f.properties.id, f]));
    return [
      ["ATLISL_west_med_balearics", [2.25, 39.5]],
      ["ATLISL_west_med_balearics", [3.65, 40.0]],
      ["ATLISL_levant_cyprus", [32.18, 35.04]],
      ["ATLISL_levant_cyprus", [33.4706127281, 34.7775520332]],
      ["ATLISL_levant_cyprus", [33.5503970424, 34.8129702208]],
    ].map(([id, point]) => ({
      id, point, inPoliticalLand: globalThis.d3.geoContains(features.get(id), point),
      inCoastSurface: globalThis.d3.geoContains(surface, point),
      inSea: state.scenarioAtlantropaData.features.some(f =>
        f.properties.atl_render_layer === "water" && globalThis.d3.geoContains(f, point)),
    }));
  });
  for (const sample of islandCoverage) {
    expect(sample, `reclaimed island probe ${sample.id} ${sample.point}`).toMatchObject({
      inPoliticalLand: true, inCoastSurface: true, inSea: false,
    });
  }

  const geometryEvidence = await page.evaluate(() => {
    const state = globalThis.__playwrightStateRef;
    const primary = state.topologyPrimary || state.topology;
    const baseObject = primary.objects[globalThis.__mapCoastlineDiag.primaryObjectName];
    const baseSurface = globalThis.topojson.feature(primary, baseObject);
    const runtime = state.runtimePoliticalTopology;
    const scenarioSurface = globalThis.topojson.feature(runtime, runtime.objects.scenario_coastline);
    const oldLines = globalThis.topojson.mesh(primary, baseObject).coordinates;
    const newMesh = state.cachedCoastlinesHigh[0];
    globalThis.__tnoVisibleCoastlineRef = newMesh;
    globalThis.__tnoVisibleCoastlineJson = JSON.stringify(newMesh);
    const inMed = ([x, y]) => x > -6 && x < 37 && y > 29 && y < 47;
    const medSegments = lines => lines.flatMap(line => line.slice(1).map((point, i) => [line[i], point]))
      .filter(([a, b]) => inMed(a) && inMed(b));
    const newSegments = medSegments(newMesh.coordinates);
    const land = (state.scenarioAtlantropaData?.features || [])
      .filter(feature => feature.properties?.atl_render_layer === "land")
      .map(feature => ({ feature, bounds: globalThis.d3.geoBounds(feature) }));
    const insideLand = point => land.some(({ feature, bounds }) =>
      point[0] >= bounds[0][0] && point[0] <= bounds[1][0]
      && point[1] >= bounds[0][1] && point[1] <= bounds[1][1]
      && globalThis.d3.geoContains(feature, point));
    const distanceToSegment = (p, [a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const submerged = [];
    for (const [a, b] of medSegments(oldLines)) {
      const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // A correct join puts the old coast between base and reclaimed land.
      // Its neighborhood must be inside their union, with actual ATL land on
      // at least one side; ATL need not overlap the original territory.
      const neighborhood = [[0, 0], [.0002, 0], [-.0002, 0], [0, .0002], [0, -.0002]]
        .map(([dx, dy]) => [p[0] + dx, p[1] + dy]);
      if (!neighborhood.some(insideLand)
        || !neighborhood.every(point => globalThis.d3.geoContains(scenarioSurface, point))) continue;
      submerged.push({ point: p, newCoastDistance: newSegments.reduce((nearest, segment) => Math.min(nearest, distanceToSegment(p, segment)), Infinity) });
      if (submerged.length === 3) break;
    }
    const hasNewOffshoreCoast = newSegments.some(([a, b]) => !globalThis.d3.geoContains(
      baseSurface, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    ));
    return { submerged, hasNewOffshoreCoast };
  });
  expect(geometryEvidence.submerged.length, "real old coastline samples inside joined base and Atlantropa land").toBeGreaterThan(0);
  for (const sample of geometryEvidence.submerged) {
    expect(sample.newCoastDistance, `old coastline at ${sample.point} must not survive inside new land`).toBeGreaterThan(.00001);
  }
  expect(geometryEvidence.hasNewOffshoreCoast, "new outer coast remains beyond the original land surface").toBe(true);

  for (const field of ["showScenarioAtlantropa", "showWaterRegions"]) {
    await setVisibility(page, field, false);
    await expect.poll(() => readCoastline(page)).toMatchObject({
      source: "primary", matchesSelectedGeometry: true, changedSinceVisible: true, matchesVisibleMesh: false,
    });
    await setVisibility(page, field, true);
    await expect.poll(() => readCoastline(page)).toMatchObject({
      source: "scenario", object: "scenario_coastline", matchesSelectedGeometry: true, matchesVisibleMesh: true,
    });
  }
});

async function findNewLandPoint(page, id) {
  // Fixed probes from the admitted source geometry must remain land; do not
  // silently choose a different point if a future water/shore regression occurs.
  const points = {
    ATLPRV_18349: [28.91253315812773, 40.69848993243577],
    ATLPRV_18332: [5.755634918046521, 36.92663313862793],
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

test("new TNO Atlantropa coasts accept native hit, fill, and undo without water coverage", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
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

  for (const [id, owner] of [["ATLPRV_18349", "TUR"], ["ATLPRV_18332", "IAL"]]) {
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
});
