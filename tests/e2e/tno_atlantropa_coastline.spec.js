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
