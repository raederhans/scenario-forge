const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  getAppUrl,
  waitForAppInteractive,
} = require("./support/playwright-app");

const SCENARIOS = [
  { id: "blank_base", label: "Blank Map", paletteId: "hoi4_vanilla", expectedColors: {}, ownerless: true },
];

const REPORT_DIR = path.join(
  ".runtime",
  "reports",
  "generated",
  "non-1962-scenario-audit"
);
const SCREENSHOT_DIR = path.join(
  ".runtime",
  "browser",
  "mcp-artifacts",
  "non-1962-runtime-matrix"
);

const OPTIONAL_STARTUP_LOCALIZATION_RESOURCE_PATTERN = /(?:^|\/)data\/scenarios\/[a-z0-9_]+\/(?:locales|geo_aliases)\.startup\.json(?:$|\?)/;

const ALLOWED_CONSOLE_WARNING_PATTERNS = [
  /^Failed to load resource: the server responded with a status of 401 \(Unauthorized\)$/,
  // Chromium console resource errors omit the URL; response tracking below keeps URL-specific 404 enforcement.
  /^Failed to load resource: the server responded with a status of 404 \(File not found\)$/,
  /^Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true\./,
  /^Locales file missing or invalid, using defaults\.[\s\S]*data\/scenarios\/[a-z0-9_]+\/locales\.startup\.json/i,
  /^Geo alias file missing or invalid, using defaults\.[\s\S]*data\/scenarios\/[a-z0-9_]+\/geo_aliases\.startup\.json/i,
  /^\[map_renderer\] Removed 2 D3-unsafe water geometry part\(s\): marine_arctic_ocean, marine_southern_ocean$/,
  /^\[physical\] global_physical_semantics\.topo\.json unavailable or deferred; disabling physical atlas instead of using the old fallback\.$/,
  /^\[physical\] global_contours\.major\.topo\.json unavailable or deferred; skipping terrain contours\.$/,
  /^\[scenario\] Applying bundle without confirmed detail promotion; health gate will validate runtime topology\.$/,
  /^\[scenario\] Detail visibility gate triggered for [a-z0-9_]+: runtime=\d+, expected=\d+, ratio=[0-9.]+ \(min=0\.7\)\.$/,
  /^\[map_renderer\] scenario_owner_only borders unavailable for scenario=[a-z0-9_]+; canonical country-border fallback suppressed to preserve scenario integrity\.$/,
];

function isActionableConsoleIssue(issue) {
  if (ALLOWED_CONSOLE_WARNING_PATTERNS.some((pattern) => pattern.test(issue.text))) return false;
  return issue.type === "error" || issue.type === "warning";
}

function isActionableNetworkFailure(response) {
  const status = response.status();
  const url = response.url();
  if (status < 400) return false;
  if (status === 401 && /\/api\/backend\/auth\/me(?:$|\?)/.test(url)) return false;
  if (status === 404 && OPTIONAL_STARTUP_LOCALIZATION_RESOURCE_PATTERN.test(url)) return false;
  return !url.startsWith("data:");
}

const RED_SEA_WATER_ID = "marine_red_sea";
const RED_SEA_LON_LAT_CANDIDATES = [
  [39.0, 18.5],
  [39.7, 21.5],
  [41.2, 16.2],
  [37.8, 20.0],
];

async function readRedSeaBoundaryProbe(page) {
  return page.evaluate(async ({ waterId, candidates }) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const d3 = globalThis.d3;
    const canvas = document.getElementById("map-canvas");
    const mapContainer = document.querySelector("#mapContainer") || canvas;
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const waterFeature = state.waterRegionsById?.get?.(waterId) || null;
    const centroid = waterFeature && d3?.geoCentroid ? d3.geoCentroid(waterFeature) : null;
    const lonLatCandidates = [
      ...(Array.isArray(centroid) ? [centroid] : []),
      ...candidates,
    ].filter((point) => (
      Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1]))
    ));
    const selectedLonLat = lonLatCandidates.find((point) => (
      waterFeature && d3?.geoContains ? d3.geoContains(waterFeature, point) : false
    )) || lonLatCandidates[0] || null;
    const screenPoint = selectedLonLat && typeof projectGeoToScreen === "function"
      ? projectGeoToScreen(Number(selectedLonLat[0]), Number(selectedLonLat[1]))
      : null;
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    const rect = mapContainer?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const readPixel = () => {
      if (!canvas || !context || !Array.isArray(screenPoint)) return null;
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(Number(screenPoint[0]) * dpr)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(Number(screenPoint[1]) * dpr)));
      const pixel = context.getImageData(x, y, 1, 1).data;
      return { x, y, rgb: [pixel[0], pixel[1], pixel[2]], alpha: pixel[3] };
    };
    let landFeatureId = "";
    const landFeatures = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
      ? state.landDataFull.features
      : (Array.isArray(state.landData?.features) ? state.landData.features : []);
    if (selectedLonLat && d3?.geoContains) {
      for (const feature of landFeatures) {
        try {
          if (d3.geoContains(feature, selectedLonLat)) {
            landFeatureId = String(feature?.properties?.id || feature?.id || "").trim();
            break;
          }
        } catch (_error) {
          // Malformed unrelated geometry must not make the Red Sea probe inconclusive.
        }
      }
    }
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      waterId,
      waterFeatureExists: !!waterFeature,
      waterFeatureType: String(waterFeature?.properties?.water_type || ""),
      waterRegionGroup: String(waterFeature?.properties?.region_group || ""),
      waterContainsProbe: !!(waterFeature && selectedLonLat && d3?.geoContains && d3.geoContains(waterFeature, selectedLonLat)),
      selectedLonLat,
      screenPoint,
      clientPoint: Array.isArray(screenPoint)
        ? { x: Number(rect.left || 0) + Number(screenPoint[0]), y: Number(rect.top || 0) + Number(screenPoint[1]) }
        : null,
      landFeatureId,
      canvasPixel: readPixel(),
      showWaterRegions: !!state.showWaterRegions,
      showOpenOceanRegions: !!state.showOpenOceanRegions,
      allowOpenOceanSelect: !!state.allowOpenOceanSelect,
      allowOpenOceanPaint: !!state.allowOpenOceanPaint,
      selectedWaterRegionId: String(state.selectedWaterRegionId || ""),
      devSelectedHit: state.devSelectedHit
        ? {
          id: String(state.devSelectedHit.id || ""),
          targetType: String(state.devSelectedHit.targetType || ""),
        }
        : null,
      waterRegionsByIdSize: Number(state.waterRegionsById?.size || 0),
      waterSpatialItemsCount: Array.isArray(state.waterSpatialItems) ? state.waterSpatialItems.length : 0,
    };
  }, {
    waterId: RED_SEA_WATER_ID,
    candidates: RED_SEA_LON_LAT_CANDIDATES,
  });
}

async function selectRedSeaWithOpenOceanSelection(page, scenarioId) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.showWaterRegions = false;
    state.showOpenOceanRegions = false;
    state.allowOpenOceanSelect = true;
    state.allowOpenOceanPaint = false;
    state.selectedWaterRegionId = "";
    state.devSelectedHit = null;
    state.renderNowFn?.();
  });
  await page.waitForFunction((expectedScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state
      && String(state.activeScenarioId || "") === expectedScenarioId
      && String(state.renderPhase || "idle") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle
      && !state.zoomRenderScheduled
      && !state.pendingZoomTransform
      && !state.renderPhaseTimerId;
  }, scenarioId, { timeout: 15000 });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const probe = await readRedSeaBoundaryProbe(page);
  if (!probe.clientPoint) {
    throw new Error(`Red Sea click probe unavailable: ${JSON.stringify(probe)}`);
  }
  await page.mouse.click(probe.clientPoint.x, probe.clientPoint.y);
  const handle = await page.waitForFunction((waterId) => {
    const state = globalThis.__playwrightStateRef || null;
    const hit = state?.devSelectedHit || null;
    return String(hit?.id || "") === waterId
      && String(hit?.targetType || "") === "water"
      && String(state?.selectedWaterRegionId || "") === waterId;
  }, RED_SEA_WATER_ID, { timeout: 5000 }).catch(() => null);
  const afterClickProbe = await readRedSeaBoundaryProbe(page);
  if (!handle) {
    throw new Error(`Red Sea water selection failed: ${JSON.stringify({ beforeClick: probe, afterClick: afterClickProbe })}`);
  }
  return { beforeClick: probe, afterClick: afterClickProbe };
}

test.describe("non-1962 scenario runtime matrix", () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.id} starts active without startup asset gaps`, async ({ page }) => {
      test.setTimeout(120000);
      const consoleIssues = [];
      const networkFailures = [];

      page.on("console", (msg) => {
        const type = msg.type();
        if (type === "error" || type === "warning") {
          consoleIssues.push({ type, text: msg.text() });
        }
      });
      page.on("response", (response) => {
        if (isActionableNetworkFailure(response)) {
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

      await page.goto(getAppUrl(`/?default_scenario=${scenario.id}`), {
        waitUntil: "domcontentloaded",
      });
      await waitForAppInteractive(page, { timeout: 90000 });
      await expect(page.locator("#scenarioStatus")).toContainText(scenario.label, {
        timeout: 30000,
      });
      await page.waitForFunction(() => {
        const statusText = String(document.querySelector("#scenarioStatus")?.textContent || "");
        const auditText = String(document.querySelector("#scenarioAuditHint")?.textContent || "");
        return !statusText.includes("coarse mode") && !auditText.includes("coarse mode");
      }, { timeout: 90000 });

      const runtimeState = await page.evaluate(async () => {
        const { state } = await import("/js/core/state.js");
        return {
          activeScenarioId: String(state.activeScenarioId || ""),
          scenarioStatusText: String(document.querySelector("#scenarioStatus")?.textContent || "").trim(),
          scenarioAuditHintText: String(document.querySelector("#scenarioAuditHint")?.textContent || "").trim(),
          runtimeFeatureCount: Number(
            state.runtimePoliticalTopology?.objects?.political?.geometries?.length || 0
          ),
          activePaletteId: String(state.activePaletteId || ""),
          scenarioGeneratedColorTags: [...(state.scenarioGeneratedColorTags || [])].sort(),
          healthGeneratedColorTags: [...(state.scenarioDataHealth?.generatedColorTags || [])].sort(),
          scenarioFixedOwnerColors: Object.fromEntries(
            Object.keys(state.scenarioFixedOwnerColors || {})
              .sort()
              .map((tag) => [tag, state.scenarioFixedOwnerColors[tag]])
          ),
          health: state.scenarioDataHealth || null,
        };
      });

      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const screenshotPath = path.join(SCREENSHOT_DIR, `${scenario.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      let redSeaBoundary = null;
      if (scenario.id === "hoi4_1936" || scenario.id === "hoi4_1939") {
        const beforeSelection = await readRedSeaBoundaryProbe(page);
        let selection = null;
        let selectionError = "";
        try {
          selection = await selectRedSeaWithOpenOceanSelection(page, scenario.id);
        } catch (error) {
          selectionError = error?.stack || error?.message || String(error);
        }
        redSeaBoundary = {
          beforeSelection,
          selection,
          selectionError,
        };
      }
      const report = {
        scenario,
        runtimeState,
        consoleIssues,
        actionableConsoleIssues: consoleIssues.filter(isActionableConsoleIssue),
        networkFailures,
        redSeaBoundary,
        screenshotPath,
      };
      fs.writeFileSync(
        path.join(REPORT_DIR, `${scenario.id}.runtime_matrix.json`),
        JSON.stringify(report, null, 2)
      );

      expect(runtimeState.activeScenarioId).toBe(scenario.id);
      expect(runtimeState.activePaletteId).toBe(scenario.paletteId);
      expect(runtimeState.healthGeneratedColorTags).toEqual(runtimeState.scenarioGeneratedColorTags);
      for (const generatedTag of runtimeState.scenarioGeneratedColorTags) {
        expect(runtimeState.scenarioFixedOwnerColors[generatedTag]).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(runtimeState.runtimeFeatureCount).toBeGreaterThan(0);
      for (const [tag, color] of Object.entries(scenario.expectedColors || {})) {
        expect(runtimeState.scenarioFixedOwnerColors[tag]).toBe(color);
      }
      if (scenario.ownerless) {
        expect(Object.keys(runtimeState.scenarioFixedOwnerColors || {}).length).toBeGreaterThan(0);
      }
      if (redSeaBoundary) {
        const beforeSelection = redSeaBoundary.beforeSelection || {};
        const pixel = beforeSelection.canvasPixel?.rgb || [];
        expect(beforeSelection.waterFeatureExists, JSON.stringify(redSeaBoundary, null, 2)).toBe(true);
        expect(beforeSelection.waterContainsProbe, JSON.stringify(redSeaBoundary, null, 2)).toBe(true);
        expect(pixel[2], JSON.stringify(redSeaBoundary, null, 2)).toBeGreaterThan((pixel[0] || 0) + 20);
        expect(pixel[1], JSON.stringify(redSeaBoundary, null, 2)).toBeGreaterThanOrEqual(pixel[0] || 0);
        expect(redSeaBoundary.selectionError, JSON.stringify(redSeaBoundary, null, 2)).toBe("");
        expect(redSeaBoundary.selection?.afterClick?.devSelectedHit?.targetType, JSON.stringify(redSeaBoundary, null, 2)).toBe("water");
        expect(redSeaBoundary.selection?.afterClick?.devSelectedHit?.id, JSON.stringify(redSeaBoundary, null, 2)).toBe(RED_SEA_WATER_ID);
        expect(redSeaBoundary.selection?.afterClick?.selectedWaterRegionId, JSON.stringify(redSeaBoundary, null, 2)).toBe(RED_SEA_WATER_ID);
      }
      expect(runtimeState.scenarioStatusText).not.toContain("coarse mode");
      expect(runtimeState.scenarioAuditHintText).not.toContain("coarse mode");
      expect(consoleIssues.filter(isActionableConsoleIssue)).toEqual([]);
      expect(networkFailures).toEqual([]);
    });
  }
});
