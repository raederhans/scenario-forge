const { test, expect } = require("@playwright/test");
const { getAppUrl, primeStateRef, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(120000);

const IGNORED_CONSOLE_ERROR_PATTERNS = [
  /Failed to boot application: ReferenceError: ui is not defined/i,
  /Stack trace: ReferenceError: ui is not defined/i,
];

async function waitForScenarioUiReady(page) {
  await page.waitForFunction(() => !!document.getElementById("map-canvas"), { timeout: 120000 });
  await page.waitForTimeout(1200);
}

async function dismissStartupBlocker(page) {
  const continueButton = page.getByRole("button", { name: "Continue without scenario" });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
    await page.waitForTimeout(1000);
  }
}

async function ensureScenario(page, scenarioId) {
  await primeStateRef(page);
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state && !state.scenarioApplyInFlight;
  }, { timeout: 120000 });
  const scenarioReady = await page.evaluate(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    const openingOwnerMesh = state.activeScenarioMeshPack?.meshes?.opening_owner_borders;
    const cachedOpeningOwnerMesh = state.cachedScenarioOpeningOwnerBorders;
    return state.activeScenarioId === expectedScenarioId
      && !state.scenarioApplyInFlight
      && Array.isArray(openingOwnerMesh?.coordinates)
      && openingOwnerMesh.coordinates.length > 0
      && cachedOpeningOwnerMesh === openingOwnerMesh
      && Array.isArray(cachedOpeningOwnerMesh?.coordinates)
      && cachedOpeningOwnerMesh.coordinates.length > 0;
  }, scenarioId);
  if (!scenarioReady) {
    const initialScenarioId = await page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      return String(state.activeScenarioId || "");
    });
    if (initialScenarioId === scenarioId) {
      try {
        await page.waitForFunction((expectedScenarioId) => {
          const state = globalThis.__playwrightStateRef || null;
          const openingOwnerMesh = state?.activeScenarioMeshPack?.meshes?.opening_owner_borders;
          const cachedOpeningOwnerMesh = state?.cachedScenarioOpeningOwnerBorders;
          return state.activeScenarioId === expectedScenarioId
            && !state.scenarioApplyInFlight
            && Array.isArray(openingOwnerMesh?.coordinates)
            && openingOwnerMesh.coordinates.length > 0
            && cachedOpeningOwnerMesh === openingOwnerMesh
            && Array.isArray(cachedOpeningOwnerMesh?.coordinates)
            && cachedOpeningOwnerMesh.coordinates.length > 0;
        }, scenarioId, { timeout: 20000 });
        return;
      } catch (_error) {
        await page.evaluate(async (expectedScenarioId) => {
          const { loadScenarioBundle, hydrateActiveScenarioBundle } = await import("/js/core/scenario_resources.js");
          const bundle = await loadScenarioBundle(expectedScenarioId, {
            bundleLevel: "full",
            forceReload: true,
          });
          hydrateActiveScenarioBundle(bundle, { renderNow: false });
        }, scenarioId);
      }
    } else {
      await page.evaluate((expectedScenarioId) => {
        const select = document.querySelector("#scenarioSelect");
        if (select instanceof HTMLSelectElement) {
          select.value = expectedScenarioId;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, scenarioId);
      await page.evaluate(async (expectedScenarioId) => {
        const { applyScenarioById } = await import("/js/core/scenario_manager.js");
        await applyScenarioById(expectedScenarioId, {
          renderNow: true,
          markDirtyReason: "scenario-boundary-regression",
          showToastOnComplete: false,
        });
      }, scenarioId);
    }
  }
  await page.waitForFunction((expectedScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    const openingOwnerMesh = state?.activeScenarioMeshPack?.meshes?.opening_owner_borders;
    const cachedOpeningOwnerMesh = state?.cachedScenarioOpeningOwnerBorders;
    return state.activeScenarioId === expectedScenarioId
      && !state.scenarioApplyInFlight
      && Array.isArray(openingOwnerMesh?.coordinates)
      && openingOwnerMesh.coordinates.length > 0
      && cachedOpeningOwnerMesh === openingOwnerMesh
      && Array.isArray(cachedOpeningOwnerMesh?.coordinates)
      && cachedOpeningOwnerMesh.coordinates.length > 0;
  }, scenarioId, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(600);
}

async function readBoundaryRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const helperPrefixes = ["RU_ARCTIC_FB_", "ATLSHL_", "ATLWLD_", "ATLSEA_FILL_"];
    const countHelpers = (collection) => {
      const features = Array.isArray(collection?.features) ? collection.features : [];
      return features.filter((feature, index) => {
        const props = feature?.properties || {};
        const id = String(props.id || feature?.id || `feature-${index}`).trim().toUpperCase();
        const helperKind = String(props.scenario_helper_kind || "").trim().toLowerCase();
        const geometryRole = String(props.atl_geometry_role || "").trim().toLowerCase();
        const joinMode = String(props.atl_join_mode || "").trim().toLowerCase();
        return helperKind === "shell_fallback"
          || helperPrefixes.some((prefix) => id.startsWith(prefix))
          || geometryRole === "shore_seal"
          || geometryRole === "sea_completion"
          || geometryRole === "donor_sea"
          || joinMode === "gap_fill"
          || joinMode === "boolean_weld";
      }).length;
    };

    const localByCountry = state.cachedLocalBordersByCountry instanceof Map
      ? Array.from(state.cachedLocalBordersByCountry.entries())
      : [];
    const provinceByCountry = state.cachedProvinceBordersByCountry instanceof Map
      ? state.cachedProvinceBordersByCountry
      : new Map();
    const localOnlyCountryCount = localByCountry.filter(([countryCode, meshes]) => {
      const provinceMeshes = provinceByCountry.get(countryCode);
      return Array.isArray(meshes) && meshes.length > 0 && (!Array.isArray(provinceMeshes) || !provinceMeshes.length);
    }).length;

    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioBorderMode: String(state.scenarioBorderMode || ""),
      topologyRevision: Number(state.topologyRevision || 0),
      zoomScale: Number(state.zoomTransform?.k || 1),
      landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
      fullLandCount: Array.isArray(state.landDataFull?.features) ? state.landDataFull.features.length : 0,
      interactiveHelperCount: countHelpers(state.landData),
      fullHelperCount: countHelpers(state.landDataFull),
      chunkFeatureCount: Array.isArray(state.scenarioPoliticalChunkData?.features) ? state.scenarioPoliticalChunkData.features.length : 0,
      coastlineMeshCount: Array.isArray(state.cachedCoastlines) ? state.cachedCoastlines.length : 0,
      openingOwnerSegmentCount: Array.isArray(state.cachedScenarioOpeningOwnerBorders?.coordinates)
        ? state.cachedScenarioOpeningOwnerBorders.coordinates.length
        : 0,
      meshPackOpeningOwnerSegmentCount: Array.isArray(state.activeScenarioMeshPack?.meshes?.opening_owner_borders?.coordinates)
        ? state.activeScenarioMeshPack.meshes.opening_owner_borders.coordinates.length
        : 0,
      coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
      localOnlyCountryCount,
    };
  });
}

test("scenario boundary regressions stay fixed", async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(text))) {
      return;
    }
    consoleErrors.push(text);
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
  await dismissStartupBlocker(page);
  await waitForScenarioUiReady(page);
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962");
  await setZoomPercent(page, 100);

  const runtimeBefore = await readBoundaryRuntime(page);
  expect(runtimeBefore.activeScenarioId).toBe("tno_1962");
  expect(runtimeBefore.scenarioBorderMode).toBe("scenario_owner_only");
  expect(runtimeBefore.interactiveHelperCount).toBe(0);
  expect(runtimeBefore.localOnlyCountryCount).toBeGreaterThan(0);
  expect(runtimeBefore.openingOwnerSegmentCount).toBeGreaterThan(0);
  expect(runtimeBefore.coastlineMeshCount).toBeGreaterThan(0);
  expect(runtimeBefore.coastlineSource).not.toBe("scenario_political_outline");

  const chunkPromotionRuntime = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { refreshMapDataForScenarioChunkPromotion } = await import("/js/core/map_renderer.js");
    const { loadScenarioBundle } = await import("/js/core/scenario_resources.js");
    const beforeMesh = state.cachedScenarioOpeningOwnerBorders;
    const beforeRevision = Number(state.topologyRevision || 0);
    const bundle = await loadScenarioBundle("tno_1962", { bundleLevel: "full", forceReload: true });
    state.activeScenarioMeshPack = bundle.meshPackPayload || state.activeScenarioMeshPack || null;
    const firstPoliticalChunk = Array.isArray(bundle?.chunkRegistry?.byLayer?.political)
      ? bundle.chunkRegistry.byLayer.political.find((entry) => !!entry?.url)
      : null;
    if (!firstPoliticalChunk?.url) {
      throw new Error("Missing political chunk url for TNO boundary regression test.");
    }
    const payload = await fetch(firstPoliticalChunk.url).then((response) => {
      if (!response.ok) {
        throw new Error(`Political chunk fetch failed: ${response.status}`);
      }
      return response.json();
    });
    state.scenarioPoliticalChunkData = payload;
    state.cachedScenarioOpeningOwnerBorders = null;
    refreshMapDataForScenarioChunkPromotion({
      suppressRender: true,
      hasPoliticalPayloadChange: true,
    });
    return {
      beforeRevision,
      afterRevision: Number(state.topologyRevision || 0),
      meshRebuilt: beforeMesh !== state.cachedScenarioOpeningOwnerBorders,
      openingOwnerSegmentCount: Array.isArray(state.cachedScenarioOpeningOwnerBorders?.coordinates)
        ? state.cachedScenarioOpeningOwnerBorders.coordinates.length
        : 0,
      meshPackSegmentCount: Array.isArray(bundle?.meshPackPayload?.meshes?.opening_owner_borders?.coordinates)
        ? bundle.meshPackPayload.meshes.opening_owner_borders.coordinates.length
        : 0,
      openingOwnerMatchesMeshPack:
        state.cachedScenarioOpeningOwnerBorders === bundle?.meshPackPayload?.meshes?.opening_owner_borders,
    };
  });
  expect(chunkPromotionRuntime.afterRevision).toBeGreaterThan(chunkPromotionRuntime.beforeRevision);
  expect(chunkPromotionRuntime.meshPackSegmentCount).toBeGreaterThan(0);
  expect(chunkPromotionRuntime.meshRebuilt).toBe(true);
  expect(chunkPromotionRuntime.openingOwnerSegmentCount).toBeGreaterThan(0);
  expect(chunkPromotionRuntime.openingOwnerMatchesMeshPack).toBe(true);

  expect(networkFailures).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
