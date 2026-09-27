const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  applyScenarioAndWaitIdle,
  gotoApp,
  waitForAppInteractive,
  waitForRenderIdle,
  waitForScenarioSelectReady,
} = require("../support/playwright-app");
const { samplePoliticalFeaturePixels } = require("../support/political-pixel-probe");
const { DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("../support/startup-paths");

const SPEC_PATH = "tests/e2e/dev/full_visual_acceptance.dev.spec.js";
const ARTIFACT_DIR = path.join(".runtime", "browser", "mcp-artifacts", "stage5-visual-acceptance");
const DIAGNOSTICS_PATH = path.join(
  ".runtime",
  "output",
  "render-diagnostics",
  "stage5-visual-acceptance.json"
);
const SUMMARY_PATH = path.join(".runtime", "output", "visual-acceptance", "stage5-summary.json");
const FAST_ROOT_PATH = toRootPath(DEFAULT_FAST_APP_OPEN_PATH);
const TNO_SCENARIO_ID = "tno_1962";
const EDIT_COLOR = "#ff00aa";

const PROHIBITED_STABLE_WARNING_CODES = [
  "resolved-colors-empty-with-land",
  "political-visible-subset-empty-with-required-chunks",
  "render-reuse-across-data-generation",
  "pending-color-edit-cleared-without-render",
  "visible-required-layer-missing",
  "render-snapshot-scenario-mismatch",
  "scenario-apply-inflight-target-mismatch",
];

const KNOWN_CONSOLE_WARNING_PATTERNS = [
  /^\[map_renderer\] Removed 2 D3-unsafe water geometry part\(s\): marine_arctic_ocean, marine_southern_ocean$/,
  /^\[data_loader\] Context layer pack missing or invalid for physical_contours_(major|minor)\. Ignoring\. TypeError: Failed to fetch/i,
  /^\[physical\] global_physical_semantics\.topo\.json unavailable or deferred/i,
  /^\[physical\] global_contours\.(major|minor)\.topo\.json unavailable or deferred/i,
  /^\[scenario\] Applying bundle without confirmed detail promotion/i,
  /^\[scenario\] Detail visibility gate triggered for [a-z0-9_]+:/i,
  /^\[map_renderer\] scenario_owner_only borders unavailable for scenario=[a-z0-9_]+/i,
  /^\[map_renderer\] Rewound .* feature orientation for /i,
  /was preloaded using link preload but not used/i,
  /Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true/i,
];

const TNO_LAYER_REQUIREMENTS = {
  water: ["water"],
  atlantropa: ["scenario_atlantropa"],
  relief: ["relief"],
  tno: ["water", "scenario_atlantropa", "relief"],
};

const CANVAS_PROBES = {
  water: [
    { id: "atlantic-water", lon: -28, lat: 32 },
    { id: "central-med-water", lon: 16, lat: 35 },
  ],
  atlantropa: [
    { id: "adriatic-basin", lon: 16.5, lat: 42.5 },
    { id: "aegean-basin", lon: 24.0, lat: 36.9 },
  ],
  relief: [
    { id: "med-shoreline-west", lon: 8.5, lat: 39.5 },
    { id: "med-shoreline-east", lon: 23.5, lat: 37.2 },
  ],
};

const EDIT_PROBES = [
  { id: "west-kivu-drc", lon: 28.85, lat: -1.65 },
  { id: "france-core", lon: 2.35, lat: 46.7 },
  { id: "iberia-core", lon: -3.7, lat: 40.4 },
  { id: "turkey-west", lon: 30.0, lat: 39.0 },
];

// JUSTIFY: Stage 5 visual acceptance drives TNO, queue switching, and two non-TNO startups in one evidence bundle.
test.setTimeout(360_000);

function toRepoPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function scenarioPath(scenarioId) {
  const url = new URL(FAST_ROOT_PATH, "http://127.0.0.1");
  url.searchParams.set("render_diag", "1");
  url.searchParams.set("default_scenario", scenarioId);
  return `${url.pathname}${url.search}`;
}

async function markCaseStart(page) {
  const nodeStartedAt = Date.now();
  const browserStartedAt = await page.evaluate(() => Date.now()).catch(() => nodeStartedAt);
  return { nodeStartedAt, browserStartedAt };
}

function isAnonymousBackendProbeFailure(entry) {
  if (Number(entry?.status || 0) !== 401) return false;
  try {
    return new URL(entry.url).pathname === "/api/backend/auth/me";
  } catch (_error) {
    return false;
  }
}

function isActionableNetworkIssue(issue) {
  if (String(issue?.url || "").startsWith("data:")) return false;
  try {
    const pathname = new URL(issue.url).pathname;
    if (
      issue?.status === "failed"
      && [
        "/app/data/city_aliases.json",
        "/app/data/world_cities.geojson",
        "/app/data/global_contours.major.topo.json",
        "/app/data/global_contours.minor.topo.json",
      ].includes(pathname)
      && /net::ERR_ABORTED/i.test(String(issue?.errorText || ""))
    ) {
      return false;
    }
    if (
      Number(issue?.status || 0) === 404
      && /\/data\/scenarios\/[^/]+\/(locales|geo_aliases)\.startup\.json$/.test(pathname)
    ) {
      return false;
    }
  } catch (_error) {
    // Keep malformed URLs actionable below.
  }
  return !isAnonymousBackendProbeFailure(issue);
}

function isAllowedConsoleIssue(issue) {
  const text = String(issue?.text || "");
  if (/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i.test(text)) {
    return true;
  }
  if (/Failed to load resource: the server responded with a status of 404 \(File not found\)/i.test(text)) {
    return true;
  }
  if (/^\[data_loader\] Optional (world_cities|city_aliases) missing or invalid at data\/(world_cities\.geojson|city_aliases\.json)\. TypeError: Failed to fetch/i.test(text)) {
    return true;
  }
  if (/^(Locales|Geo alias) file missing or invalid, using defaults\. Error: \[data_loader\] Failed to fetch (locales|geo_aliases):startup at data\/scenarios\/[^/]+\/(locales|geo_aliases)\.startup\.json \(404 File not found\)\./i.test(text)) {
    return true;
  }
  if (
    issue.type === "warning"
    && PROHIBITED_STABLE_WARNING_CODES.some((code) => (
      text.startsWith(`[render-transaction] ${code} `)
    ))
  ) {
    return true;
  }
  if (issue.type === "warning") {
    return KNOWN_CONSOLE_WARNING_PATTERNS.some((pattern) => pattern.test(text));
  }
  return false;
}

function createIssueTracker(page) {
  const consoleIssues = [];
  const pageErrors = [];
  const networkIssues = [];
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "warning" && type !== "error") return;
    consoleIssues.push({ recordedAt: Date.now(), type, text: msg.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ recordedAt: Date.now(), text: String(error?.message || error) });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    networkIssues.push({ recordedAt: Date.now(), url: response.url(), status: response.status() });
  });
  page.on("requestfailed", (request) => {
    networkIssues.push({
      recordedAt: Date.now(),
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });
  return {
    snapshotSince(startedAt) {
      const consoleSince = consoleIssues.filter((issue) => issue.recordedAt >= startedAt);
      const networkSince = networkIssues.filter((issue) => issue.recordedAt >= startedAt);
      return {
        consoleIssues: consoleSince,
        actionableConsoleIssues: consoleSince.filter((issue) => !isAllowedConsoleIssue(issue)),
        pageErrors: pageErrors.filter((issue) => issue.recordedAt >= startedAt),
        networkIssues: networkSince,
        actionableNetworkIssues: networkSince.filter(isActionableNetworkIssue),
      };
    },
    all() {
      return { consoleIssues, pageErrors, networkIssues };
    },
  };
}

async function ensureScenario(page, scenarioId) {
  await waitForScenarioSelectReady(page, { scenarioId, timeout: 120_000 });
  await applyScenarioAndWaitIdle(page, scenarioId, {
    timeout: 120_000,
    renderMode: "none",
    markDirtyReason: "stage5-visual-acceptance",
    showToastOnComplete: false,
  });
  await waitForRenderIdle(page, { scenarioId, timeout: 120_000 });
}

async function gotoScenarioStartup(page, scenarioId) {
  await gotoApp(page, scenarioPath(scenarioId), { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120_000 });
  await waitForRenderIdle(page, { scenarioId, timeout: 120_000 });
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
}

async function dragMap(page, { dx = 180, dy = 24, steps = 8 } = {}) {
  const box = await page.locator("#mapContainer").boundingBox();
  if (!box) throw new Error("mapContainer bounding box unavailable");
  const startX = box.x + (box.width * 0.5);
  const startY = box.y + (box.height * 0.5);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
}

async function settleGreatLakesCongoDetailView(page) {
  await setZoomPercent(page, 175);
  await dragMap(page, { dx: 90, dy: 16, steps: 6 });
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.getViewportGeoBoundsFn = () => [12, -8, 28, 6];
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : null;
    if (loadState) {
      loadState.focusCountryOverride = "GCO";
      loadState.pendingReason = "zoom-end";
      loadState.pendingDelayMs = 0;
    }
    if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn({ reason: "zoom-end", delayMs: 0, flushPending: true });
    }
  });
  await waitForRenderIdle(page, { scenarioId: TNO_SCENARIO_ID, timeout: 120_000 });
}

async function recordStableSnapshot(page, caseId, expectedScenarioId) {
  return page.evaluate(async ({ caseId: id, expectedScenarioId: scenarioId }) => {
    const { state } = await import("/js/core/state.js");
    const {
      exposeRenderTransactionDiagnostics,
      recordRenderTransactionSnapshot,
    } = await import("/js/core/renderer/render_transaction_diagnostics.js");
    const snapshot = recordRenderTransactionSnapshot(state, {
      phase: "visible-frame-committed",
      reason: `stage5-${id}`,
      expectedScenarioId: scenarioId,
      source: "stage5-visual-acceptance",
    });
    exposeRenderTransactionDiagnostics(state);
    return {
      sequence: Number(snapshot.sequence || 0),
      recordedAt: Number(snapshot.recordedAt || 0),
      phase: String(snapshot.phase || ""),
    };
  }, { caseId, expectedScenarioId });
}

async function readRuntimeDiagnostics(page, { caseStartedAt, prohibitedCodes }) {
  return page.evaluate(({ caseStartedAt: startedAt, prohibitedCodes: codeList }) => {
    const state = globalThis.__playwrightStateRef || {};
    const diagnostics = globalThis.__scenarioForgeRenderTransactions || {};
    const snapshots = Array.isArray(diagnostics.snapshots) ? diagnostics.snapshots : [];
    const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
    const stableSnapshots = snapshots.filter((snapshot) => snapshot?.phaseKind === "stable");
    const latestStable = stableSnapshots.length
      ? stableSnapshots[stableSnapshots.length - 1]
      : (diagnostics.latest || null);
    const latestStableWarnings = Array.isArray(latestStable?.warnings) ? latestStable.warnings : [];
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const countFeatures = (payload) => (Array.isArray(payload?.features) ? payload.features.length : 0);
    const copyLayer = (layer) => ({
      visible: !!layer?.visible,
      manifestRequired: !!layer?.manifestRequired,
      requiredByRequiredChunk: !!layer?.requiredByRequiredChunk,
      selectedAsOptionalChunk: !!layer?.selectedAsOptionalChunk,
      required: !!layer?.required,
      selected: !!layer?.selected,
      intentionallyDeferred: !!layer?.intentionallyDeferred,
      stateField: String(layer?.stateField || ""),
      stateFeatureCount: Number(layer?.stateFeatureCount || 0),
      statePayloadState: String(layer?.statePayloadState || ""),
      mergedPayloadState: String(layer?.mergedPayloadState || ""),
      mergedFeatureCount: Number(layer?.mergedFeatureCount || 0),
      sourceStatus: String(layer?.sourceStatus || ""),
      sourceKind: String(layer?.sourceKind || ""),
      coverageStatus: String(layer?.coverageStatus || ""),
      requiredReason: String(layer?.requiredReason || ""),
      missingReason: String(layer?.missingReason || ""),
      expectedChunkIds: Array.isArray(layer?.expectedChunkIds) ? layer.expectedChunkIds.map(String) : [],
      loadedChunkIds: Array.isArray(layer?.loadedChunkIds) ? layer.loadedChunkIds.map(String) : [],
      missingChunkIds: Array.isArray(layer?.missingChunkIds) ? layer.missingChunkIds.map(String) : [],
    });
    const layerStatuses = {};
    for (const key of ["water", "scenario_atlantropa", "relief"]) {
      layerStatuses[key] = copyLayer(latestStable?.layers?.[key] || {});
    }
    const serializeWarning = (warning) => ({
      code: String(warning?.code || ""),
      severity: String(warning?.severity || ""),
      phase: String(warning?.phase || ""),
      phaseKind: String(warning?.phaseKind || ""),
      reason: String(warning?.reason || ""),
      recordedAt: Number(warning?.recordedAt || 0),
      details: warning?.details || null,
    });
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      activeScenarioManifestId: String(state.activeScenarioManifest?.scenario_id || ""),
      activeScenarioChunksScenarioId: String(state.activeScenarioChunks?.scenarioId || ""),
      renderPhase: String(state.renderPhase || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
      chunkIdle: {
        pendingPromotion: !!loadState.pendingPromotion,
        promotionScheduled: !!loadState.promotionScheduled,
        refreshScheduled: !!loadState.refreshScheduled,
        promotionCommitInFlight: !!loadState.promotionCommitInFlight,
        pendingVisualPromotion: !!loadState.pendingVisualPromotion,
        pendingInfraPromotion: !!loadState.pendingInfraPromotion,
      },
      featureCounts: {
        landData: countFeatures(state.landData),
        landDataFull: countFeatures(state.landDataFull),
        politicalChunk: countFeatures(state.scenarioPoliticalChunkData),
        politicalVisibleChunk: countFeatures(state.scenarioPoliticalVisibleChunkData),
        water: countFeatures(state.scenarioWaterRegionsData),
        atlantropa: countFeatures(state.scenarioAtlantropaData),
        relief: countFeatures(state.scenarioReliefOverlaysData),
        spatialItems: Array.isArray(state.spatialItems) ? state.spatialItems.length : 0,
        resolvedColors: Object.keys(state.colors || {}).length,
      },
      layerStatuses,
      latestStable: latestStable ? {
        sequence: Number(latestStable.sequence || 0),
        recordedAt: Number(latestStable.recordedAt || 0),
        phase: String(latestStable.phase || ""),
        phaseKind: String(latestStable.phaseKind || ""),
        requestedScenarioId: String(latestStable.requestedScenarioId || ""),
        expectedScenarioId: String(latestStable.expectedScenarioId || ""),
        activeScenarioId: String(latestStable.activeScenarioId || ""),
        activeScenarioManifestId: String(latestStable.activeScenarioManifestId || ""),
        activeScenarioChunksScenarioId: String(latestStable.activeScenarioChunks?.scenarioId || latestStable.chunks?.scenarioId || ""),
        warningCodes: latestStableWarnings.map((warning) => String(warning?.code || "")),
      } : null,
      prohibitedLatestStableWarnings: latestStableWarnings
        .filter((warning) => codeList.includes(String(warning?.code || "")))
        .map(serializeWarning),
      warningsSinceStart: warnings
        .filter((warning) => Number(warning?.recordedAt || 0) >= Number(startedAt || 0))
        .map(serializeWarning),
      metrics: {
        blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
        drawScenarioReliefOverlaysLayer: metrics.drawScenarioReliefOverlaysLayer || null,
        contextScenarioLayerRelief: metrics.contextScenarioLayerRelief || null,
        scenarioChunkPromotionVisualStage: metrics.scenarioChunkPromotionVisualStage || null,
        settleExactRefreshPasses: metrics.settleExactRefreshPasses || null,
      },
    };
  }, { caseStartedAt, prohibitedCodes });
}

async function captureMapScreenshot(page, caseId) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const screenshotPath = path.join(ARTIFACT_DIR, `${caseId}.png`);
  const map = page.locator("#mapContainer");
  if (await map.count()) {
    await map.screenshot({ path: screenshotPath });
  } else {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  return toRepoPath(screenshotPath);
}

async function sampleCanvasPoints(page, probes, { radius = 9 } = {}) {
  return page.evaluate(async ({ probes: entries, radius: sampleRadius }) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!canvas || !context || typeof projectGeoToScreen !== "function") {
      return entries.map((entry) => ({ ...entry, error: "canvas-unavailable" }));
    }
    const isNearBlack = (red, green, blue, alpha) => (
      red < 8 && green < 8 && blue < 8 && alpha > 200
    );
    return entries.map((entry) => {
      const point = projectGeoToScreen(Number(entry.lon), Number(entry.lat));
      if (!Array.isArray(point) || !point.every(Number.isFinite)) {
        return { ...entry, error: "projection-miss" };
      }
      const cx = point[0] * dpr;
      const cy = point[1] * dpr;
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) {
        return {
          ...entry,
          canvasPoint: { x: cx, y: cy },
          error: "offscreen",
        };
      }
      const radiusPx = Math.max(2, Number(sampleRadius || 9) * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = maxX - minX;
      const height = maxY - minY;
      if (width <= 0 || height <= 0) {
        return {
          ...entry,
          canvasPoint: { x: cx, y: cy },
          sampleBox: { minX, minY, width, height },
          error: "sample-box-empty",
        };
      }
      const data = context.getImageData(minX, minY, width, height).data;
      let opaquePixelCount = 0;
      let nearBlackOpaquePixelCount = 0;
      let opaqueNonBlackPixelCount = 0;
      let firstOpaqueRgb = null;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (alpha <= 16) continue;
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        opaquePixelCount += 1;
        if (!firstOpaqueRgb) firstOpaqueRgb = [red, green, blue];
        if (isNearBlack(red, green, blue, alpha)) {
          nearBlackOpaquePixelCount += 1;
        } else if (alpha > 200) {
          opaqueNonBlackPixelCount += 1;
        }
      }
      return {
        ...entry,
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        opaquePixelCount,
        nearBlackOpaquePixelCount,
        opaqueNonBlackPixelCount,
        firstOpaqueRgb,
      };
    });
  }, { probes, radius });
}

async function sampleRuntimeFeatureCentroids(page, stateField, { limit = 8, radius = 11 } = {}) {
  return page.evaluate(async ({ stateField: targetField, limit: sampleLimit, radius: sampleRadius }) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const d3 = globalThis.d3;
    const payload = state?.[targetField] || {};
    const features = Array.isArray(payload.features) ? payload.features.slice(0, sampleLimit) : [];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!canvas || !context || !d3 || typeof projectGeoToScreen !== "function") {
      return features.map((_feature, index) => ({ index, error: "runtime-unavailable" }));
    }
    const isNearBlack = (red, green, blue, alpha) => (
      red < 8 && green < 8 && blue < 8 && alpha > 200
    );
    return features.map((feature, index) => {
      let lonLat = null;
      try {
        lonLat = d3.geoCentroid(feature);
      } catch (_error) {
        lonLat = null;
      }
      if (!Array.isArray(lonLat) || !lonLat.every(Number.isFinite)) {
        return { index, featureId: String(feature?.id || feature?.properties?.id || ""), error: "centroid-miss" };
      }
      const point = projectGeoToScreen(Number(lonLat[0]), Number(lonLat[1]));
      if (!Array.isArray(point) || !point.every(Number.isFinite)) {
        return { index, featureId: String(feature?.id || feature?.properties?.id || ""), lonLat, error: "projection-miss" };
      }
      const cx = point[0] * dpr;
      const cy = point[1] * dpr;
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) {
        return {
          index,
          featureId: String(feature?.id || feature?.properties?.id || ""),
          lonLat,
          canvasPoint: { x: cx, y: cy },
          error: "offscreen",
        };
      }
      const radiusPx = Math.max(2, Number(sampleRadius || 11) * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = maxX - minX;
      const height = maxY - minY;
      if (width <= 0 || height <= 0) {
        return {
          index,
          featureId: String(feature?.id || feature?.properties?.id || ""),
          lonLat,
          canvasPoint: { x: cx, y: cy },
          sampleBox: { minX, minY, width, height },
          error: "sample-box-empty",
        };
      }
      const data = context.getImageData(minX, minY, width, height).data;
      let opaquePixelCount = 0;
      let nearBlackOpaquePixelCount = 0;
      let opaqueNonBlackPixelCount = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = data[offset + 3];
        if (alpha <= 16) continue;
        opaquePixelCount += 1;
        if (isNearBlack(data[offset], data[offset + 1], data[offset + 2], alpha)) {
          nearBlackOpaquePixelCount += 1;
        } else if (alpha > 200) {
          opaqueNonBlackPixelCount += 1;
        }
      }
      return {
        index,
        featureId: String(feature?.id || feature?.properties?.id || ""),
        lonLat,
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        opaquePixelCount,
        nearBlackOpaquePixelCount,
        opaqueNonBlackPixelCount,
      };
    });
  }, { stateField, limit, radius });
}

async function samplePoliticalFeatureByIdPixels(page, probes, { radius = 7 } = {}) {
  return page.evaluate(async ({ probes: entries, radius: sampleRadius }) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!canvas || !context || typeof projectGeoToScreen !== "function") {
      return entries.map((entry) => ({ ...entry, error: "canvas-unavailable" }));
    }
    const parseRgb = (value) => {
      const text = String(value || "").trim();
      const hex = /^#?([0-9a-f]{6})$/i.exec(text);
      if (hex) {
        const number = Number.parseInt(hex[1], 16);
        return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
      }
      return null;
    };
    const distance = (left, right) => {
      if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(Number(left[0] || 0) - Number(right[0] || 0))
        + Math.abs(Number(left[1] || 0) - Number(right[1] || 0))
        + Math.abs(Number(left[2] || 0) - Number(right[2] || 0))
      ) / 3;
    };
    return entries.map((entry) => {
      const featureId = String(entry.featureId || "").trim();
      const resolvedColor = String(state.colors?.[featureId] || "");
      const resolvedRgb = parseRgb(resolvedColor);
      if (!featureId || !resolvedRgb) {
        return { ...entry, resolvedColor, error: featureId ? "missing-resolved-color" : "missing-feature-id" };
      }
      const point = projectGeoToScreen(Number(entry.lon), Number(entry.lat));
      if (!Array.isArray(point) || !point.every(Number.isFinite)) {
        return { ...entry, featureId, resolvedColor, resolvedRgb, error: "projection-miss" };
      }
      const cx = point[0] * dpr;
      const cy = point[1] * dpr;
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) {
        return {
          ...entry,
          featureId,
          resolvedColor,
          resolvedRgb,
          canvasPoint: { x: cx, y: cy },
          error: "offscreen",
        };
      }
      const radiusPx = Math.max(2, Number(sampleRadius || 7) * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const data = context.getImageData(minX, minY, width, height).data;
      let pixelCount = 0;
      let nonLandPixelCount = 0;
      let bestRgb = null;
      let bestResolvedDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (!alpha) continue;
        const rgb = [data[index], data[index + 1], data[index + 2]];
        pixelCount += 1;
        if (rgb.some((channel) => Math.abs(Number(channel || 0) - 240) > 16)) {
          nonLandPixelCount += 1;
        }
        const nextDistance = distance(rgb, resolvedRgb);
        if (nextDistance < bestResolvedDistance) {
          bestResolvedDistance = nextDistance;
          bestRgb = rgb;
        }
      }
      return {
        ...entry,
        featureId,
        resolvedColor,
        resolvedRgb,
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        pixelCount,
        nonLandPixelCount,
        bestRgb,
        bestResolvedDistance,
      };
    });
  }, { probes, radius });
}

async function applyPoliticalFillEdit(page) {
  const editResult = await page.evaluate(async ({ probes, color }) => {
    const { state } = await import("/js/core/state.js");
    const {
      refreshMapDataForScenarioChunkPromotion,
      refreshResolvedColorsForFeatures,
    } = await import("/js/core/map_renderer.js");
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    const getFeatureId = (feature) => String(
      feature?.properties?.id || feature?.properties?.NUTS_ID || feature?.id || ""
    ).trim();
    let selected = null;
    for (const probe of probes) {
      for (const feature of features) {
        try {
          if (feature?.geometry && d3.geoContains(feature, [probe.lon, probe.lat])) {
            const featureId = getFeatureId(feature);
            if (featureId && state.colors?.[featureId]) {
              const props = feature?.properties || {};
              selected = {
                ...probe,
                featureId,
                countryCode: String(props.cntr_code || "").trim(),
              };
              break;
            }
          }
        } catch (_error) {
          // Keep this focused on stable land probes.
        }
      }
      if (selected) break;
    }
    if (!selected) return { error: "no-edit-probe" };
    state.visualOverrides = state.visualOverrides || {};
    state.visualOverrides[selected.featureId] = color;
    refreshResolvedColorsForFeatures([selected.featureId], { renderNow: false });
    refreshMapDataForScenarioChunkPromotion({
      reason: "stage5-fill-edit",
      changedLayerKeys: ["political"],
      politicalFeatureIds: [selected.featureId],
      hasPoliticalPayloadChange: true,
      suppressRender: false,
    });
    return {
      selected,
      resolvedColor: String(state.colors?.[selected.featureId] || ""),
      activeScenarioId: String(state.activeScenarioId || ""),
    };
  }, { probes: EDIT_PROBES, color: EDIT_COLOR });
  if (editResult.error) {
    throw new Error(`Stage 5 fill edit failed: ${JSON.stringify(editResult)}`);
  }
  await waitForRenderIdle(page, { scenarioId: TNO_SCENARIO_ID, timeout: 120_000 });
  const pixelSamples = await samplePoliticalFeaturePixels(page, [editResult.selected], { radius: 7 });
  return { editResult, pixelSamples };
}

async function runQueuedScenarioSwitch(page) {
  await waitForScenarioSelectReady(page, { scenarioId: "hoi4_1939", timeout: 120_000 });
  await waitForScenarioSelectReady(page, { scenarioId: "modern_world", timeout: 120_000 });
  const queueResult = await page.evaluate(async () => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    const options = {
      renderMode: "none",
      markDirtyReason: "stage5-visual-acceptance",
      showToastOnComplete: false,
    };
    const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
    const first = applyScenarioByIdCommand("hoi4_1939", options);
    await sleep(30);
    const second = applyScenarioByIdCommand("modern_world", options);
    const results = await Promise.allSettled([first, second]);
    return {
      requestedScenarioIds: ["hoi4_1939", "modern_world"],
      gapMs: 30,
      results: results.map((result) => ({
        status: String(result.status || ""),
        valueScenarioId: String(result.value?.manifest?.scenario_id || result.value?.meta?.scenario_id || ""),
        reason: String(result.reason?.message || result.reason || ""),
      })),
    };
  });
  await waitForRenderIdle(page, { scenarioId: "modern_world", timeout: 180_000 });
  return queueResult;
}

function layerFailures(runtime, requiredLayers) {
  const failures = [];
  for (const layerKey of requiredLayers || []) {
    const layer = runtime.layerStatuses?.[layerKey] || {};
    if (layer.coverageStatus !== "present") {
      failures.push(`${layerKey} coverageStatus=${layer.coverageStatus || "missing"}`);
    }
    if (layer.sourceKind !== "runtime-state") {
      failures.push(`${layerKey} sourceKind=${layer.sourceKind || "missing"}`);
    }
    if (Number(layer.stateFeatureCount || 0) <= 0) {
      failures.push(`${layerKey} stateFeatureCount=${layer.stateFeatureCount || 0}`);
    }
  }
  return failures;
}

function sampleEntryFailures(entry, label) {
  const id = entry.id || entry.featureId || entry.index || "";
  const prefix = `${label} probe ${id}`.trim();
  const failures = [];
  if (entry.error) failures.push(`${prefix} error=${entry.error}`);
  if (Number(entry.opaquePixelCount || 0) <= 0) failures.push(`${prefix} has no opaque pixels`);
  if (Number(entry.opaqueNonBlackPixelCount || 0) <= 0) failures.push(`${prefix} is opaque but near-black only`);
  return failures;
}

function sampleFailures(samples, label, options = {}) {
  const entries = Array.isArray(samples) ? samples : [];
  if (!entries.length) return [`${label} has no samples`];
  if (options.requireEveryEntry) {
    return entries.flatMap((entry) => sampleEntryFailures(entry, label));
  }
  const passingEntries = entries.filter((entry) => (
    !entry.error
    && Number(entry.opaquePixelCount || 0) > 0
    && Number(entry.opaqueNonBlackPixelCount || 0) > 0
  ));
  const minPassingEntries = Number.isFinite(Number(options.minPassingEntries))
    ? Number(options.minPassingEntries)
    : 1;
  if (passingEntries.length < minPassingEntries) {
    return [
      `${label} visible samples=${passingEntries.length}, expected>=${minPassingEntries}`,
      ...entries.flatMap((entry) => sampleEntryFailures(entry, label)),
    ];
  }
  return [];
}

function politicalSampleFailures(pixelSamples, label) {
  const entries = Array.isArray(pixelSamples) ? pixelSamples : [];
  if (!entries.length) return [`${label} has no political pixel sample`];
  return entries.flatMap((sample) => {
    const failures = [];
    if (sample.error) failures.push(`${label} probe ${sample.id || ""} error=${sample.error}`);
    if (Number(sample.nonLandPixelCount || 0) <= 0) failures.push(`${label} probe ${sample.id || ""} has no non-land pixels`);
    const bestResolvedDistance = Number.isFinite(Number(sample.bestResolvedDistance))
      ? Number(sample.bestResolvedDistance)
      : Number.POSITIVE_INFINITY;
    if (bestResolvedDistance >= 55) {
      failures.push(`${label} probe ${sample.id || ""} bestResolvedDistance=${sample.bestResolvedDistance}`);
    }
    const rgb = Array.isArray(sample.bestRgb) ? sample.bestRgb : [];
    if (rgb.length === 3 && rgb.every((channel) => Number(channel || 0) < 8)) {
      failures.push(`${label} probe ${sample.id || ""} is near-black`);
    }
    return failures;
  });
}

function validateCase(record, {
  expectedScenarioId,
  requiredLayers = [],
  samples = [],
  politicalSamples = [],
  issueSnapshot,
  extraFailures = [],
}) {
  const runtime = record.runtime || {};
  const failures = [];
  if (runtime.activeScenarioId !== expectedScenarioId) {
    failures.push(`activeScenarioId=${runtime.activeScenarioId}, expected=${expectedScenarioId}`);
  }
  if (runtime.activeScenarioManifestId && runtime.activeScenarioManifestId !== expectedScenarioId) {
    failures.push(`activeScenarioManifestId=${runtime.activeScenarioManifestId}, expected=${expectedScenarioId}`);
  }
  if (runtime.activeScenarioChunksScenarioId && runtime.activeScenarioChunksScenarioId !== expectedScenarioId) {
    failures.push(`activeScenarioChunksScenarioId=${runtime.activeScenarioChunksScenarioId}, expected=${expectedScenarioId}`);
  }
  if (runtime.renderPhase !== "idle") failures.push(`renderPhase=${runtime.renderPhase}`);
  if (runtime.scenarioApplyInFlight) failures.push("scenarioApplyInFlight=true");
  if (runtime.startupReadonlyUnlockInFlight) failures.push("startupReadonlyUnlockInFlight=true");
  if (runtime.prohibitedLatestStableWarnings?.length) {
    failures.push(`latest stable prohibited warnings=${runtime.prohibitedLatestStableWarnings.map((warning) => warning.code).join(",")}`);
  }
  const prohibitedWarningsSinceStart = Array.isArray(runtime.warningsSinceStart)
    ? runtime.warningsSinceStart.filter((warning) => (
      PROHIBITED_STABLE_WARNING_CODES.includes(String(warning?.code || ""))
      && String(warning?.phaseKind || "") === "stable"
    ))
    : [];
  if (prohibitedWarningsSinceStart.length) {
    failures.push(`prohibited warnings since start=${prohibitedWarningsSinceStart.map((warning) => warning.code).join(",")}`);
  }
  if (Number(runtime.featureCounts?.landData || 0) <= 0) failures.push("landData feature count is zero");
  if (Number(runtime.featureCounts?.resolvedColors || 0) <= 0) failures.push("resolved color count is zero");
  failures.push(...layerFailures(runtime, requiredLayers));
  for (const sampleGroup of samples) {
    failures.push(...sampleFailures(sampleGroup.entries, sampleGroup.label, {
      requireEveryEntry: !!sampleGroup.requireEveryEntry,
      minPassingEntries: sampleGroup.minPassingEntries,
    }));
  }
  for (const sampleGroup of politicalSamples) {
    failures.push(...politicalSampleFailures(sampleGroup.entries, sampleGroup.label));
  }
  if (issueSnapshot?.pageErrors?.length) failures.push(`pageErrors=${issueSnapshot.pageErrors.length}`);
  if (issueSnapshot?.actionableConsoleIssues?.length) {
    failures.push(`actionableConsoleIssues=${issueSnapshot.actionableConsoleIssues.length}`);
  }
  if (issueSnapshot?.actionableNetworkIssues?.length) {
    failures.push(`actionableNetworkIssues=${issueSnapshot.actionableNetworkIssues.length}`);
  }
  failures.push(...extraFailures);
  return failures;
}

test("Stage 5 full visual regression and acceptance evidence", async ({ page }) => {
  const issueTracker = createIssueTracker(page);
  const cases = [];
  let fatalError = null;

  async function captureCase(caseId, expectedScenarioId, options = {}) {
    await waitForRenderIdle(page, { scenarioId: expectedScenarioId, timeout: options.timeout || 120_000 });
    await recordStableSnapshot(page, caseId, expectedScenarioId);
    const screenshotPath = await captureMapScreenshot(page, caseId);
    const runtime = await readRuntimeDiagnostics(page, {
      caseStartedAt: options.caseStart.browserStartedAt,
      prohibitedCodes: PROHIBITED_STABLE_WARNING_CODES,
    });
    const issueSnapshot = issueTracker.snapshotSince(options.caseStart.nodeStartedAt);
    const samples = [];
    if (options.canvasProbeGroup) {
      samples.push({
        label: options.canvasProbeGroup.label,
        entries: await sampleCanvasPoints(page, options.canvasProbeGroup.probes, {
          radius: options.canvasProbeGroup.radius || 9,
        }),
        requireEveryEntry: true,
        minPassingEntries: options.canvasProbeGroup.probes.length,
      });
    }
    if (options.layerCentroidGroup) {
      const centroidLimit = options.layerCentroidGroup.limit || 8;
      samples.push({
        label: options.layerCentroidGroup.label,
        entries: await sampleRuntimeFeatureCentroids(page, options.layerCentroidGroup.stateField, {
          limit: centroidLimit,
          radius: options.layerCentroidGroup.radius || 11,
        }),
        minPassingEntries: options.layerCentroidGroup.minPassingEntries || Math.min(3, centroidLimit),
      });
    }
    const politicalSamples = options.politicalSamples || [];
    const record = {
      caseId,
      expectedScenarioId,
      screenshotPath,
      runtime,
      samples,
      politicalSamples,
      issues: issueSnapshot,
      extra: options.extra || {},
      failures: [],
      pass: false,
    };
    record.failures = validateCase(record, {
      expectedScenarioId,
      requiredLayers: options.requiredLayers || [],
      samples,
      politicalSamples,
      issueSnapshot,
      extraFailures: options.extraFailures || [],
    });
    record.pass = record.failures.length === 0;
    cases.push(record);
    return record;
  }

  try {
    await gotoScenarioStartup(page, TNO_SCENARIO_ID);

    await captureCase("tno_startup_idle", TNO_SCENARIO_ID, {
      caseStart: await markCaseStart(page),
      requiredLayers: TNO_LAYER_REQUIREMENTS.tno,
    });

    await captureCase("tno_atlantropa_mediterranean", TNO_SCENARIO_ID, {
      caseStart: await markCaseStart(page),
      requiredLayers: TNO_LAYER_REQUIREMENTS.atlantropa,
      canvasProbeGroup: { label: "atlantropa-mediterranean", probes: CANVAS_PROBES.atlantropa },
      layerCentroidGroup: { label: "scenario-atlantropa-centroids", stateField: "scenarioAtlantropaData" },
    });

    await captureCase("tno_water_regions", TNO_SCENARIO_ID, {
      caseStart: await markCaseStart(page),
      requiredLayers: TNO_LAYER_REQUIREMENTS.water,
      canvasProbeGroup: { label: "water-region-probes", probes: CANVAS_PROBES.water },
      layerCentroidGroup: { label: "water-centroids", stateField: "scenarioWaterRegionsData" },
    });

    await captureCase("relief_overlay_visible", TNO_SCENARIO_ID, {
      caseStart: await markCaseStart(page),
      requiredLayers: TNO_LAYER_REQUIREMENTS.relief,
      canvasProbeGroup: { label: "relief-overlay-probes", probes: CANVAS_PROBES.relief, radius: 13 },
      layerCentroidGroup: { label: "relief-centroids", stateField: "scenarioReliefOverlaysData", radius: 15 },
    });

    const fillCaseStart = await markCaseStart(page);
    const fillBefore = await applyPoliticalFillEdit(page);
    await captureCase("fill_before_zoom", TNO_SCENARIO_ID, {
      caseStart: fillCaseStart,
      requiredLayers: TNO_LAYER_REQUIREMENTS.tno,
      politicalSamples: [{ label: "fill-before-zoom", entries: fillBefore.pixelSamples }],
      extra: { editResult: fillBefore.editResult },
      extraFailures: fillBefore.editResult.resolvedColor.toLowerCase() === EDIT_COLOR
        ? []
        : [`edited resolvedColor=${fillBefore.editResult.resolvedColor}`],
    });

    const fillAfterCaseStart = await markCaseStart(page);
    await settleGreatLakesCongoDetailView(page);
    const fillAfterSamples = await samplePoliticalFeatureByIdPixels(page, [fillBefore.editResult.selected], { radius: 7 });
    await captureCase("fill_after_zoom_pan", TNO_SCENARIO_ID, {
      caseStart: fillAfterCaseStart,
      politicalSamples: [{ label: "fill-after-zoom-pan", entries: fillAfterSamples }],
      extra: { selected: fillBefore.editResult.selected },
      extraFailures: fillAfterSamples[0]?.resolvedColor?.toLowerCase() === EDIT_COLOR
        ? []
        : [`post-zoom resolvedColor=${fillAfterSamples[0]?.resolvedColor || ""}`],
    });

    await ensureScenario(page, TNO_SCENARIO_ID);
    const switchCaseStart = await markCaseStart(page);
    const queueResult = await runQueuedScenarioSwitch(page);
    await captureCase("scenario_switch_final", "modern_world", {
      caseStart: switchCaseStart,
      extra: { queueResult },
      extraFailures: (
        queueResult.results.length === 2
        && queueResult.results.every((result) => result.status === "fulfilled")
        && queueResult.results[0]?.valueScenarioId === "hoi4_1939"
        && queueResult.results[1]?.valueScenarioId === "modern_world"
      )
        ? []
        : [`queueResult=${JSON.stringify(queueResult.results)}`],
      timeout: 180_000,
    });

    const hoi4CaseStart = await markCaseStart(page);
    await gotoScenarioStartup(page, "hoi4_1939");
    await captureCase("non_tno_startup_1", "hoi4_1939", {
      caseStart: hoi4CaseStart,
    });

    const modernCaseStart = await markCaseStart(page);
    await gotoScenarioStartup(page, "modern_world");
    await captureCase("non_tno_startup_2", "modern_world", {
      caseStart: modernCaseStart,
    });
  } catch (error) {
    fatalError = error;
  } finally {
    const failedCases = cases.filter((entry) => !entry.pass).map((entry) => ({
      caseId: entry.caseId,
      failures: entry.failures,
      screenshotPath: entry.screenshotPath,
    }));
    const diagnosticsReport = {
      schemaVersion: 1,
      source: SPEC_PATH,
      createdAt: new Date().toISOString(),
      prohibitedStableWarningCodes: PROHIBITED_STABLE_WARNING_CODES,
      cases: cases.map((entry) => ({
        caseId: entry.caseId,
        expectedScenarioId: entry.expectedScenarioId,
        pass: entry.pass,
        failures: entry.failures,
        screenshotPath: entry.screenshotPath,
        runtime: entry.runtime,
        samples: entry.samples,
        politicalSamples: entry.politicalSamples,
        issues: entry.issues,
        extra: entry.extra,
      })),
      fatalError: fatalError ? String(fatalError?.stack || fatalError?.message || fatalError) : "",
    };
    const summary = {
      schemaVersion: 1,
      source: SPEC_PATH,
      createdAt: diagnosticsReport.createdAt,
      pass: !fatalError && failedCases.length === 0 && cases.length === 9,
      expectedCaseCount: 9,
      caseCount: cases.length,
      failedCaseCount: failedCases.length,
      failedCases,
      screenshotDir: toRepoPath(ARTIFACT_DIR),
      diagnosticsPath: toRepoPath(DIAGNOSTICS_PATH),
      prohibitedStableWarningCodes: PROHIBITED_STABLE_WARNING_CODES,
      browserIssues: issueTracker.all(),
      fatalError: diagnosticsReport.fatalError,
    };
    writeJson(DIAGNOSTICS_PATH, diagnosticsReport);
    writeJson(SUMMARY_PATH, summary);
  }

  if (fatalError) {
    throw fatalError;
  }
  expect(cases.map((entry) => entry.caseId)).toEqual([
    "tno_startup_idle",
    "tno_atlantropa_mediterranean",
    "tno_water_regions",
    "relief_overlay_visible",
    "fill_before_zoom",
    "fill_after_zoom_pan",
    "scenario_switch_final",
    "non_tno_startup_1",
    "non_tno_startup_2",
  ]);
  expect(cases.filter((entry) => !entry.pass).map((entry) => ({
    caseId: entry.caseId,
    failures: entry.failures,
  }))).toEqual([]);
});
