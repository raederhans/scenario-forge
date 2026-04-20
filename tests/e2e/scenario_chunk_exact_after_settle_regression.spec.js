const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { DEFAULT_OPEN_PATH, getAppUrl, waitForAppInteractive } = require("./support/playwright-app");
const { DEFAULT_APP_PATH, DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("./support/startup-paths");

test.setTimeout(120_000);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FAST_STARTUP_PATH = toRootPath(DEFAULT_FAST_APP_OPEN_PATH);

const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
  /\[physical\] global_physical_semantics\.topo\.json unavailable or deferred/i,
  /\[physical\] global_contours\.major\.topo\.json unavailable or deferred/i,
  /\[scenario\] Applying bundle without confirmed detail promotion/i,
  /\[scenario\] Detail visibility gate triggered for tno_1962/i,
  /\[map_renderer\] scenario_owner_only borders unavailable for scenario=tno_1962/i,
  /startup\.bundle\.en\.json\.gz was preloaded using link preload but not used/i,
];

async function ensureScenario(page, scenarioId, label) {
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });
  const currentScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });
  if (currentScenarioId !== scenarioId) {
    await page.selectOption("#scenarioSelect", scenarioId);
    const applyButton = page.locator("#applyScenarioBtn");
    if (await applyButton.isVisible().catch(() => false)) {
      if (await applyButton.isEnabled().catch(() => false)) {
        await applyButton.click();
      }
    }
  }
  await expect(page.locator("#scenarioStatus")).toContainText(label, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(700);
}

async function dragMap(page, { dx = 180, dy = 24, steps = 8 } = {}) {
  const box = await page.locator("#mapContainer").boundingBox();
  if (!box) {
    throw new Error("mapContainer bounding box unavailable");
  }
  const startX = box.x + (box.width * 0.5);
  const startY = box.y + (box.height * 0.5);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, {
    steps,
  });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

async function startChunkPromotionProbe(page) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const previousProbe = state.__chunkPromotionVisualStageProbe;
    if (previousProbe?.intervalId) {
      globalThis.clearInterval(previousProbe.intervalId);
    }
    const probe = {
      startedAt: Date.now(),
      sawDeferred: false,
      visualRecordedAt: 0,
      exactClearedAt: 0,
      maxSelectionVersion: Number(state.runtimeChunkLoadState?.selectionVersion || 0),
      sawPendingVisualField: false,
      sawPendingInfraField: false,
    };
    let lastDeferred = !!state.deferExactAfterSettle;
    probe.intervalId = globalThis.setInterval(() => {
      const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
        ? state.runtimeChunkLoadState
        : {};
      const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      const visualMetric = metrics.scenarioChunkPromotionVisualStage || null;
      if (state.deferExactAfterSettle) {
        probe.sawDeferred = true;
      }
      if (
        !probe.visualRecordedAt
        && visualMetric
        && Number(visualMetric.recordedAt || 0) >= probe.startedAt
      ) {
        probe.visualRecordedAt = Number(visualMetric.recordedAt || 0);
      }
      if (probe.sawDeferred && lastDeferred && !state.deferExactAfterSettle && !probe.exactClearedAt) {
        probe.exactClearedAt = Date.now();
      }
      lastDeferred = !!state.deferExactAfterSettle;
      probe.maxSelectionVersion = Math.max(
        probe.maxSelectionVersion,
        Number(loadState.selectionVersion || 0),
      );
      probe.sawPendingVisualField = probe.sawPendingVisualField
        || Object.prototype.hasOwnProperty.call(loadState, "pendingVisualPromotion");
      probe.sawPendingInfraField = probe.sawPendingInfraField
        || Object.prototype.hasOwnProperty.call(loadState, "pendingInfraPromotion");
    }, 20);
    state.__chunkPromotionVisualStageProbe = probe;
  });
}

test("chunk promotion visual stage can land before exact-after-settle clears", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "warning" && type !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      return;
    }
    consoleIssues.push({ type, text });
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

  await page.goto(getAppUrl(FAST_STARTUP_PATH), { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  await setZoomPercent(page, 105);
  await waitForStableExactRender(page);
  consoleIssues.length = 0;
  networkFailures.length = 0;

  const seededState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    state.runtimeChunkLoadState = {
      ...loadState,
      selectionVersion: Number(loadState.selectionVersion || 0),
    };
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      initialSelectionVersion: Number(state.runtimeChunkLoadState?.selectionVersion || 0),
      initialVisualMetricRecordedAt: Number(metrics.scenarioChunkPromotionVisualStage?.recordedAt || 0),
    };
  });

  expect(seededState.activeScenarioId).toBe("tno_1962");
  await startChunkPromotionProbe(page);

  await setZoomPercent(page, 120);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.deferExactAfterSettle || !!state.exactAfterSettleHandle;
  }, { timeout: 20_000 });
  await waitForStableExactRender(page, { timeout: 30_000 });

  const finalState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const probe = state.__chunkPromotionVisualStageProbe && typeof state.__chunkPromotionVisualStageProbe === "object"
      ? { ...state.__chunkPromotionVisualStageProbe }
      : {};
    if (probe.intervalId) {
      globalThis.clearInterval(probe.intervalId);
      delete probe.intervalId;
    }
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    return {
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      selectionVersion: Number(loadState.selectionVersion || 0),
      hasPendingVisualPromotionField: Object.prototype.hasOwnProperty.call(loadState, "pendingVisualPromotion"),
      hasPendingInfraPromotionField: Object.prototype.hasOwnProperty.call(loadState, "pendingInfraPromotion"),
      visualMetricRecordedAt: Number(metrics.scenarioChunkPromotionVisualStage?.recordedAt || 0),
      probe,
    };
  });

  expect(finalState.renderPhase).toBe("idle");
  expect(finalState.hasPendingVisualPromotionField).toBe(true);
  expect(finalState.hasPendingInfraPromotionField).toBe(true);
  expect(finalState.visualMetricRecordedAt).toBeGreaterThanOrEqual(seededState.initialVisualMetricRecordedAt);
  expect(finalState.probe.sawDeferred).toBe(true);
  expect(finalState.probe.sawPendingVisualField).toBe(true);
  expect(finalState.probe.sawPendingInfraField).toBe(true);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

test("sync prewarm threshold completes first-frame chunk prewarm before promotion stage", async ({ page }) => {
  await page.goto(getAppUrl(FAST_STARTUP_PATH), { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "hoi4_1939", "HOI4 1939");

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const prewarmMetric = state.scenarioPerfMetrics?.chunkedFirstFramePrewarm || null;
    const visualPromotionMetric = state.renderPerfMetrics?.scenarioChunkPromotionVisualStage || null;
    return !!prewarmMetric
      && prewarmMetric.mode === "sync"
      && Number(prewarmMetric.prewarmCompletedAt || 0) > 0
      && Number(prewarmMetric.refreshScheduledAt || 0) >= Number(prewarmMetric.prewarmCompletedAt || 0)
      && !!visualPromotionMetric
      && Number(visualPromotionMetric.recordedAt || 0) >= Number(prewarmMetric.prewarmCompletedAt || 0);
  }, { timeout: 30_000 });

  const stageOrder = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const prewarmMetric = state.scenarioPerfMetrics?.chunkedFirstFramePrewarm || null;
    const visualPromotionMetric = state.renderPerfMetrics?.scenarioChunkPromotionVisualStage || null;
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      prewarmMetric,
      visualPromotionMetric,
    };
  });

  expect(stageOrder.activeScenarioId).toBe("hoi4_1939");
  expect(stageOrder.prewarmMetric).toBeTruthy();
  expect(stageOrder.prewarmMetric.mode).toBe("sync");
  expect(stageOrder.prewarmMetric.synchronous).toBe(true);
  expect(Number(stageOrder.prewarmMetric.prewarmCompletedAt || 0)).toBeGreaterThan(0);
  expect(Number(stageOrder.prewarmMetric.refreshScheduledAt || 0))
    .toBeGreaterThanOrEqual(Number(stageOrder.prewarmMetric.prewarmCompletedAt || 0));
  expect(Number(stageOrder.visualPromotionMetric?.recordedAt || 0))
    .toBeGreaterThanOrEqual(Number(stageOrder.prewarmMetric.prewarmCompletedAt || 0));
});

test("tno drag interaction settles cleanly without black-frame regression", async ({ page }) => {
  await page.goto(getAppUrl(FAST_STARTUP_PATH), { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const beforeDrag = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
    };
  });

  expect(beforeDrag.activeScenarioId).toBe("tno_1962");

  await dragMap(page);
  await waitForStableExactRender(page, { timeout: 30_000 });

  const afterDrag = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      isInteracting: !!state.isInteracting,
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
    };
  });

  expect(afterDrag.activeScenarioId).toBe("tno_1962");
  expect(afterDrag.renderPhase).toBe("idle");
  expect(afterDrag.isInteracting).toBe(false);
  expect(afterDrag.blackFrameCount).toBe(beforeDrag.blackFrameCount);
});

test("exact-after-settle keeps scenario overlays on the contextScenario reuse path", async ({ page }) => {
  await page.goto(getAppUrl(FAST_STARTUP_PATH), { waitUntil: "domcontentloaded" });

  const contract = await page.evaluate(async () => {
    const rendererSourceUrl = new URL("js/core/map_renderer.js", document.baseURI).href;
    const rendererSource = await fetch(rendererSourceUrl).then((response) => response.text());

    return {
      drawContextScenarioPassKeepsScenarioOverlayBoundary:
        /function drawContextScenarioPass\(k, \{ interactive = false \} = \{\}\) \{[\s\S]*?drawScenarioRegionOverlaysPass\(k\);[\s\S]*?drawScenarioReliefOverlaysLayer\(k\);[\s\S]*?recordRenderPerfMetric\("drawContextScenarioPass"/.test(rendererSource),
      signatureOnlyContextScenarioInvalidationUsesTransformReuse:
        /passName === "contextScenario"[\s\S]*?shouldEnableContextScenarioTransformReuse\(\)[\s\S]*?cache\.dirty\[passName\] = false;[\s\S]*?recordRenderPerfMetric\("contextScenarioReuseSkipped", 0, \{/.test(rendererSource),
      exactAfterSettleRefreshLeavesContextScenarioOutsidePhysicalRefreshPasses:
        /function getPhysicalExactRefreshPasses\(\) \{[\s\S]*?\["physicalBase", "political", "contextBase", "borders"\][\s\S]*?\["political", "contextBase", "borders"\][\s\S]*?return passes;[\s\S]*?\}/.test(rendererSource)
        && /scheduleExactAfterSettleRefresh[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);[\s\S]*?invalidateRenderPasses\(getPhysicalExactRefreshPasses\(\), reuseDecision\.reason \|\| "context-base-exact"\);/.test(rendererSource),
    };
  });

  expect(contract.drawContextScenarioPassKeepsScenarioOverlayBoundary).toBe(true);
  expect(contract.signatureOnlyContextScenarioInvalidationUsesTransformReuse).toBe(true);
  expect(contract.exactAfterSettleRefreshLeavesContextScenarioOutsidePhysicalRefreshPasses).toBe(true);
});

test("perf contracts keep coarse first frame and benchmark app-path fallback boundaries", async () => {
  const rendererSource = fs.readFileSync(path.join(REPO_ROOT, "js", "core", "map_renderer.js"), "utf8");
  const scenarioManagerSource = fs.readFileSync(path.join(REPO_ROOT, "js", "core", "scenario_manager.js"), "utf8");
  const benchmarkSource = fs.readFileSync(path.join(REPO_ROOT, "ops", "browser-mcp", "editor-performance-benchmark.py"), "utf8");
  const playwrightAppSource = fs.readFileSync(path.join(REPO_ROOT, "tests", "e2e", "support", "playwright-app.js"), "utf8");

  const rendererChecks = {
    politicalPassStartsWithBackgroundFills:
      /function drawPoliticalPass\(k\) \{[\s\S]*?const visibleItems = debugMode === "PROD" \? collectVisibleLandSpatialItems\(\) : null;[\s\S]*?drawPoliticalBackgroundFills\(\{[\s\S]*?returnSummary: true,[\s\S]*?\}\);[\s\S]*?if \(!state\.landData\?\.features\?\.length\) return;/.test(rendererSource),
    backgroundFillHelperKeepsScenarioMergeSplit:
      /function drawPoliticalBackgroundFills\(options = \{\}\) \{[\s\S]*?if \(shouldUseScenarioPoliticalBackgroundMerge\(\)\) \{[\s\S]*?return drawScenarioPoliticalBackgroundFills\(options\);[\s\S]*?\}[\s\S]*?drawAdmin0BackgroundFills\(options\);/.test(rendererSource),
    backgroundFullPassCacheBuildsAndReplays:
      /function getScenarioPoliticalBackgroundFullPassGroups\([\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheReplay"[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheBuild"/.test(rendererSource),
  };

  const scenarioChecks = {
    chunkedRuntimeSkipsBlockingDetailPromotion:
      /const supportsChunkedPoliticalRuntime = scenarioSupportsChunkedRuntime\(bundle\)[\s\S]*?const detailPromoted = \(startupReadonly \|\| supportsChunkedPoliticalRuntime\)\s*\?\s*false\s*:\s*await ensureScenarioDetailTopologyLoaded\(\{ applyMapData: false \}\);/.test(scenarioManagerSource),
    unconfirmedDetailPromotionStillWarnsBeforeHealthGate:
      /if \(!detailReady && state\.topologyBundleMode !== "composite"\) \{[\s\S]*?console\.warn\("\[scenario\] Applying bundle without confirmed detail promotion; health gate will validate runtime topology\."\);/.test(scenarioManagerSource),
    coarseInteractiveMetricRecordedAfterPostApplyEffects:
      /const \{ dataHealth, scenarioMapRefreshMode, hasChunkedRuntime \} = await runPostScenarioApplyEffects\([\s\S]*?recordScenarioPerfMetric\(\s*"timeToInteractiveCoarseFrame",[\s\S]*?hasChunkedRuntime,[\s\S]*?mapRefreshMode: scenarioMapRefreshMode,/.test(scenarioManagerSource),
  };

  const benchmarkChecks = {
    ensureAppPathUrlRewritesRootAndNestedPaths:
      /def ensure_app_path_url\(url: str\) -> str:[\s\S]*?if path\.startswith\("\/app\/"\) or path == "\/app":[\s\S]*?elif path == "\/":[\s\S]*?normalized_path = "\/app\/"[\s\S]*?else:[\s\S]*?normalized_path = f"\/app\{path\}" if path\.startswith\("\/"\) else f"\/app\/\{path\}"/.test(benchmarkSource),
    buildScenarioOpenUrlsAddsPerfOverlayAndScenarioCandidate:
      /def build_scenario_open_urls\([\s\S]*?perf_url = with_query_overrides\(ensure_app_path_url\(base_url\), perf_overlay="1"\)[\s\S]*?if normalized_scenario_id and normalized_scenario_id != "none":[\s\S]*?scenario_perf_url = with_query_overrides\(perf_url, default_scenario=normalized_scenario_id\)[\s\S]*?urls\.append\(scenario_perf_url\)[\s\S]*?urls\.append\(perf_url\)/.test(benchmarkSource),
    openPageKeepsWrapperThenLocalFallbackAcrossCandidates:
      /def open_page\(urls: list\[str\] \| tuple\[str, \.\.\.\] \| str\) -> dict:[\s\S]*?if PWCLI\.exists\(\):[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_wrapper_pw\("open", candidate_url, "--browser", browser_name,[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_local_pw\(\s*"open",\s*candidate_url,\s*"--browser",\s*browser_name,/.test(benchmarkSource),
    suiteBaseUrlsKeepOriginalAndAppVariants:
      /suite_base_urls = unique_strings\(\[[\s\S]*?effective_url,[\s\S]*?ensure_app_path_url\(effective_url\),[\s\S]*?args\.url,[\s\S]*?ensure_app_path_url\(args\.url\),/.test(benchmarkSource),
    sameScenarioFreshMetricSelectionIsExplicit:
      /def is_same_scenario_fresh_metric_entry\([\s\S]*?def summarize_freshest_same_scenario_metric_entry\(/.test(benchmarkSource),
  };

  const playwrightAppChecks = {
    e2eHarnessDefaultsToAppPath:
      DEFAULT_APP_PATH === "/app/"
      && DEFAULT_OPEN_PATH === DEFAULT_FAST_APP_OPEN_PATH
      && playwrightAppSource.includes("const DEFAULT_OPEN_PATH = DEFAULT_FAST_APP_OPEN_PATH;"),
    normalizeAppPathKeepsRootQueryAndHashOnAppRoute:
      playwrightAppSource.includes('if (normalizedTarget === "/") {')
      && playwrightAppSource.includes('if (normalizedTarget.startsWith("/app/")) {')
      && playwrightAppSource.includes('if (normalizedTarget === "/app") {')
      && playwrightAppSource.includes('if (normalizedTarget.startsWith("/?") || normalizedTarget.startsWith("/#")) {')
      && playwrightAppSource.includes('return `/app${normalizedTarget}`;'),
  };

  const checks = {
    ...rendererChecks,
    ...scenarioChecks,
    ...benchmarkChecks,
    ...playwrightAppChecks,
  };

  Object.entries(checks).forEach(([label, ok]) => {
    expect(ok, label).toBe(true);
  });
});
