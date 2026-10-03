const { test, expect } = require("@playwright/test");
const {
  waitForShellReady,
  waitForScenarioApplyIdle,
  readSmokeFailureSnapshot,
  writeFailureContextArtifact,
} = require("../support/playwright-app");
const {
  RELEASE_SMOKE_PHASES,
  RELEASE_SMOKE_MAX_ATTEMPTS,
  RELEASE_SMOKE_RETRY_DELAY_MS,
  runReleaseSmokePreflight,
  tagReleaseSmokeError,
  getReleaseSmokeRetryDecision,
  isRetryableSameOriginModulePropagationFailure,
  isRetryablePublicPagesShellPropagationStall,
  sleep,
} = require("../support/release-smoke");

// JUSTIFY: public Pages deploy smoke waits for CDN network idle plus full TNO startup, one propagation retry, and export UI readiness.
test.setTimeout(420000);

const DEFAULT_DEPLOYED_PAGES_URL = "https://raederhans.github.io/scenario-forge/";
const EXPLICIT_PUBLIC_BASE_URL = String(
  process.env.SCENARIO_FORGE_PAGES_URL
  || process.env.PLAYWRIGHT_TEST_BASE_URL
  || ""
).trim();
const ALLOW_DEFAULT_DEPLOYED_URL = process.env.SCENARIO_FORGE_ALLOW_DEFAULT_PAGES_URL === "1"
  || process.env.npm_lifecycle_event === "test:e2e:pages-public-release-gate:deployed";
const PUBLIC_BASE_URL = EXPLICIT_PUBLIC_BASE_URL
  || (ALLOW_DEFAULT_DEPLOYED_URL ? DEFAULT_DEPLOYED_PAGES_URL : "");

if (!PUBLIC_BASE_URL) {
  throw new Error(
    "Set SCENARIO_FORGE_PAGES_URL or PLAYWRIGHT_TEST_BASE_URL before running the Pages release gate. "
    + "Use npm run test:e2e:pages-public-release-gate:deployed to validate the default deployed Pages URL."
  );
}

function publicUrl(pathname = "") {
  const baseUrl = PUBLIC_BASE_URL.endsWith("/") ? PUBLIC_BASE_URL : `${PUBLIC_BASE_URL}/`;
  const relativePath = String(pathname || "").replace(/^\/+/, "");
  return new URL(relativePath, baseUrl).toString();
}

async function readPublicReleaseGateState(page) {
  return page.evaluate(async () => {
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const { state } = await import(stateModuleUrl);
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      bootBlocking: state.bootBlocking === false ? false : !!state.bootBlocking,
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      postReadyScheduler: state.renderPerfMetrics?.postReadySchedulerState || null,
      interactionInfrastructureBuildInFlight: !!state.interactionInfrastructureBuildInFlight,
      hitCanvasBuildScheduled: !!state.hitCanvasBuildScheduled,
      renderPhase: String(state.renderPhase || ""),
      optionValues: Array.from(scenarioSelect?.options || []).map((option) => option.value),
      hgoPreviewEnabled: !!state.hgoRuntimePreview?.enabled,
      hasHgoRuntimeAssets: !!state.dataManifest?.assets?.hgo_runtime_manifest,
      sampleProjectDeeplink: {
        status: String(state.sampleProjectDeeplink?.status || ""),
        sampleId: String(state.sampleProjectDeeplink?.sampleId || ""),
        scenarioId: String(state.sampleProjectDeeplink?.scenarioId || ""),
      },
    };
  });
}

function isExpectedAnonymousBackendProbe(failure) {
  try {
    const url = new URL(String(failure?.url || ""));
    return url.pathname === "/api/backend/auth/me"
      && (failure.status === 401 || failure.status === 404);
  } catch {
    return false;
  }
}

function isExpectedNavigationAbort(failure) {
  return failure?.status === "failed"
    && String(failure?.errorText || "") === "net::ERR_ABORTED"
    && failure?.resourceType === "document"
    && failure?.isNavigationRequest === true;
}

function isExpectedLandingImageAbort(failure) {
  if (
    failure?.status !== "failed"
    || String(failure?.errorText || "") !== "net::ERR_ABORTED"
    || failure?.resourceType !== "image"
  ) {
    return false;
  }
  try {
    const failedUrl = new URL(String(failure?.url || ""));
    const baseUrl = new URL(PUBLIC_BASE_URL.endsWith("/") ? PUBLIC_BASE_URL : `${PUBLIC_BASE_URL}/`);
    return failedUrl.origin === baseUrl.origin
      && failedUrl.pathname.startsWith(`${baseUrl.pathname.replace(/\/$/, "")}/assets/`.replace(/\/{2,}/g, "/"));
  } catch {
    return false;
  }
}

function filterUnexpectedConsoleIssues(consoleIssues, { ignoredAnonymousBackendProbeCount }) {
  return consoleIssues.filter((issue) => {
    const text = String(issue?.text || "");
    if (/preload/i.test(text)) return false;
    if (/^\[map_renderer\] Removed \d+ D3-unsafe water geometry part\(s\): /i.test(text)) return false;
    if (
      ignoredAnonymousBackendProbeCount > 0
      && /^Failed to load resource: the server responded with a status of (401|404)/i.test(text)
    ) {
      return false;
    }
    return true;
  });
}

function summarizeReleaseSmokeIssues(consoleIssues, networkFailures) {
  const unexpectedNetworkFailures = networkFailures.filter((failure) => (
    !isExpectedAnonymousBackendProbe(failure)
    && !isExpectedNavigationAbort(failure)
    && !isExpectedLandingImageAbort(failure)
  ));
  const ignoredAnonymousBackendProbeCount = networkFailures.length - unexpectedNetworkFailures.length;
  const unexpectedConsoleIssues = filterUnexpectedConsoleIssues(consoleIssues, { ignoredAnonymousBackendProbeCount });
  return {
    unexpectedNetworkFailures,
    unexpectedConsoleIssues,
    ignoredAnonymousBackendProbeCount,
  };
}

function createReleaseSmokeAttemptDiagnostics(page) {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      consoleIssues.push({ type, text: msg.text() });
    }
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
      errorText: request.failure()?.errorText || "requestfailed",
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
    });
  });

  return {
    consoleIssues,
    networkFailures,
  };
}

async function withReleaseSmokePhase(phase, action) {
  try {
    return await action();
  } catch (error) {
    throw tagReleaseSmokeError(error, phase);
  }
}

const FAILURE_CONTEXT_SELECTORS = [
  "body",
  "#scenarioGuidePopover",
  "[data-sample-guide-choice]",
  "[data-sample-guide-recommendation]",
  "[data-sample-guide-status-message]",
  "#sampleProjectBanner",
  "#scenarioStatus",
  "#scenarioSelect",
  "#exportWorkbenchOverlay",
  "#exportWorkbenchPanel",
  "[data-export-workbench-sample-context]",
];

function serializeReleaseSmokeError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error),
    phase: String(error?.releaseSmokePhase || RELEASE_SMOKE_PHASES.ASSERTIONS),
    retryable: error?.releaseSmokeRetryable,
    details: error?.releaseSmokeDetails || null,
    stack: String(error?.stack || "").split("\n").slice(0, 12),
  };
}

function readCurrentPageUrl(page) {
  try {
    return page.url();
  } catch {
    return "";
  }
}

async function readReleaseSmokeFailureContext({
  page,
  error,
  attempt,
  maxAttempts,
  preflightResults,
  consoleIssues,
  networkFailures,
  decision,
  retryAttempted,
}) {
  const snapshot = await readSmokeFailureSnapshot(page, FAILURE_CONTEXT_SELECTORS);
  const issueSummary = summarizeReleaseSmokeIssues(consoleIssues, networkFailures);
  return {
    ...snapshot,
    releaseSmoke: {
      baseUrl: PUBLIC_BASE_URL,
      currentUrl: readCurrentPageUrl(page),
      attempt,
      maxAttempts,
      phase: decision.phase,
      retryable: decision.retryable,
      willRetry: decision.shouldRetry,
      retryAttempted,
      retryDelayMs: decision.retryDelayMs,
      preflightResults,
      error: serializeReleaseSmokeError(error),
      consoleIssues,
      networkFailures,
      unexpectedConsoleIssues: issueSummary.unexpectedConsoleIssues,
      unexpectedNetworkFailures: issueSummary.unexpectedNetworkFailures,
      ignoredAnonymousBackendProbeCount: issueSummary.ignoredAnonymousBackendProbeCount,
    },
  };
}

async function writeReleaseSmokeFailureContext(testInfo, snapshot, { attempt, final }) {
  const suffix = final ? "" : `-attempt-${attempt}`;
  return writeFailureContextArtifact(testInfo, snapshot, {
    fileName: `pages-public-release-gate${suffix}-failure-context.json`,
    attachmentName: `pages-public-release-gate${suffix}-failure-context`,
  });
}

async function readLandingSampleDownloadState(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-sample-project-downloads] .sample-project-downloads__card[data-sample-project-id]"));
    const openLinks = Array.from(document.querySelectorAll("[data-sample-project-downloads] [data-sample-project-open-link]"));
    const downloadLinks = Array.from(document.querySelectorAll("[data-sample-project-downloads] [data-sample-project-list-link]"));
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const overflow = [
      "[data-sample-project-downloads]",
      ".sample-project-downloads__card",
      ".sample-project-downloads__actions a",
    ].flatMap((selector) => (
      Array.from(document.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: rect.left,
          right: rect.right,
          viewportWidth,
        };
      })
    )).filter((entry) => (
      entry.clientWidth > 0
      && (
        entry.scrollWidth > entry.clientWidth + 2
        || entry.left < -2
        || entry.right > entry.viewportWidth + 2
      )
    ));
    return {
      cardIds: cards.map((card) => String(card.getAttribute("data-sample-project-id") || "")),
      openHrefs: openLinks.map((link) => String(link.getAttribute("href") || "")),
      downloadHrefs: downloadLinks.map((link) => String(link.getAttribute("href") || "")),
      overflow,
    };
  });
}

async function runPublicReleaseGateAttempt(page, { consoleIssues, networkFailures }) {
  await withReleaseSmokePhase(RELEASE_SMOKE_PHASES.LANDING_PREFLIGHT, async () => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto(publicUrl(""), { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect.poll(async () => page.locator("a[href*='app']").count()).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle", { timeout: 30000 });
  });
  await expect.poll(() => readLandingSampleDownloadState(page), { timeout: 30000 }).toMatchObject({
    cardIds: [
      "blank-base-starter",
      "modern-world-japan-corridor",
      "hoi4-1936-europe-briefing",
      "hoi4-1939-europe-switch",
      "tno-1962-atlantropa-briefing",
    ],
    overflow: [],
  });
  const landingSampleState = await readLandingSampleDownloadState(page);
  expect(landingSampleState.cardIds.some((id) => /hgo/i.test(id))).toBe(false);
  expect(landingSampleState.openHrefs).toHaveLength(5);
  expect(landingSampleState.downloadHrefs).toHaveLength(5);
  for (const href of landingSampleState.openHrefs) {
    expect(href).toMatch(/\.\/app\/\?sample=[a-z0-9-]+&view=guide$/);
  }
  for (const href of landingSampleState.downloadHrefs) {
    expect(href).toMatch(/\.\/assets\/sample-projects\/[a-z0-9-]+\.project\.json$/);
  }

  await withReleaseSmokePhase(RELEASE_SMOKE_PHASES.SHELL_READY, async () => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(publicUrl("app/?sample=tno-1962-atlantropa-briefing&view=guide"), { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
  });
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#scenarioGuideTitle")).toContainText(/Scenario Quick Start/i);

  await withReleaseSmokePhase(RELEASE_SMOKE_PHASES.SCENARIO_APPLY, async () => {
    await waitForScenarioApplyIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
  });
  await expect(page.locator("#scenarioStatus")).toContainText("TNO 1962", { timeout: 30000 });
  await expect.poll(() => readPublicReleaseGateState(page), { timeout: 30000 }).toMatchObject({
    activeScenarioId: "tno_1962",
    scenarioApplyInFlight: false,
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
    },
  });

  const releaseState = await readPublicReleaseGateState(page);
  expect(releaseState.optionValues).toContain("tno_1962");
  expect(releaseState.optionValues).not.toContain("hgo_1936");
  expect(releaseState.optionValues).not.toContain("__hgo_runtime_preview__");
  expect(releaseState.hgoPreviewEnabled).toBe(false);
  expect(releaseState.hasHgoRuntimeAssets).toBe(false);

  const sampleGuideCard = page.locator("[data-sample-guide-helper]");
  await expect(sampleGuideCard).toBeVisible({ timeout: 30000 });
  await expect(sampleGuideCard).toHaveAttribute("data-sample-guide-status", "success");
  await expect(page.locator("[data-sample-guide-title]")).toContainText(/TNO 1962 Atlantropa briefing/i);
  await expect(page.locator("[data-sample-guide-recommendation]")).toContainText(/Recommended export: 2x PNG briefing map/i);
  await expect(page.locator("[data-sample-guide-download-original]")).toHaveAttribute(
    "href",
    /\.\.\/assets\/sample-projects\/tno-1962-atlantropa-briefing\.project\.json$/,
  );
  const sampleChoices = page.locator("[data-sample-guide-choice]");
  await expect(sampleChoices).toHaveCount(5, { timeout: 30000 });
  await expect(page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator("[data-sample-guide-choice='modern-world-japan-corridor']")).toBeVisible();
  await expect(page.locator("[data-sample-guide-choice*='hgo']")).toHaveCount(0);
  await page.locator("[data-sample-guide-open-export]").click();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#exportWorkbenchPanel")).toBeVisible();
  await expect(page.locator("[data-export-workbench-sample-context]")).toBeVisible();
  await expect(page.locator("[data-export-workbench-sample-title]")).toContainText(/Exporting sample: TNO 1962 Atlantropa briefing/i);
  await expect(page.locator("[data-export-workbench-sample-recommendation]")).toContainText(/Recommended: PNG · 2x · Composite image/i);
  await expect(page.locator("#exportWorkbenchSnapshotBtn")).toBeVisible();
  await page.locator("#exportWorkbenchCloseBtn").click();
  await expect(page.locator("#exportWorkbenchOverlay")).toBeHidden({ timeout: 30000 });

  await expect(page.locator("#scenarioGuidePopover")).toBeHidden({ timeout: 30000 });
  const projectTab = page.locator("#inspectorSidebarTabProject");
  await expect(projectTab).toBeVisible({ timeout: 30000 });
  await projectTab.click();
  await expect(projectTab).toHaveAttribute("aria-pressed", "true", { timeout: 30000 });
  const sampleProjectBanner = page.locator("#sampleProjectBanner");
  await expect(sampleProjectBanner).toBeVisible({ timeout: 30000 });
  await expect(sampleProjectBanner).toContainText(/Sample loaded: TNO 1962 Atlantropa briefing/i);
  await expect(sampleProjectBanner).toContainText(/export your own image/i);
  await expect(page.locator("#sampleProjectBannerDownloadOriginalLink")).toHaveAttribute(
    "href",
    /\.\.\/assets\/sample-projects\/tno-1962-atlantropa-briefing\.project\.json$/,
  );

  const issueSummary = summarizeReleaseSmokeIssues(consoleIssues, networkFailures);
  expect(issueSummary.unexpectedNetworkFailures).toEqual([]);
  expect(issueSummary.unexpectedConsoleIssues).toEqual([]);

  return {
    releaseState,
    issueSummary,
  };
}

test("public Pages release gate", async ({ browser, request }, testInfo) => {
  const attemptSummaries = [];
  let retryAttempted = false;

  for (let attempt = 1; attempt <= RELEASE_SMOKE_MAX_ATTEMPTS; attempt += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = createReleaseSmokeAttemptDiagnostics(page);
    let preflightResults = [];

    try {
      preflightResults = await runReleaseSmokePreflight({ request, publicUrl });
      const result = await runPublicReleaseGateAttempt(page, diagnostics);
      attemptSummaries.push({
        attempt,
        result: "passed",
        preflightResults,
        consoleIssueCount: diagnostics.consoleIssues.length,
        networkFailureCount: diagnostics.networkFailures.length,
      });
      console.log(JSON.stringify({
        baseUrl: PUBLIC_BASE_URL,
        activeScenarioId: result.releaseState.activeScenarioId,
        sampleProjectDeeplink: result.releaseState.sampleProjectDeeplink,
        optionValues: result.releaseState.optionValues,
        hgoPreviewEnabled: result.releaseState.hgoPreviewEnabled,
        hasHgoRuntimeAssets: result.releaseState.hasHgoRuntimeAssets,
        consoleIssueCount: diagnostics.consoleIssues.length,
        networkFailureCount: diagnostics.networkFailures.length,
        ignoredAnonymousBackendProbeCount: result.issueSummary.ignoredAnonymousBackendProbeCount,
        releaseSmokeAttempts: attemptSummaries,
      }, null, 2));
      await context.close().catch(() => {});
      return;
    } catch (error) {
      preflightResults = preflightResults.length
        ? preflightResults
        : (Array.isArray(error?.releaseSmokeDetails?.probes) ? error.releaseSmokeDetails.probes : []);
      const issueSummary = summarizeReleaseSmokeIssues(diagnostics.consoleIssues, diagnostics.networkFailures);
      const isPropagationRetry = (
        isRetryableSameOriginModulePropagationFailure(error, { publicBaseUrl: PUBLIC_BASE_URL })
        || isRetryablePublicPagesShellPropagationStall(error, { publicBaseUrl: PUBLIC_BASE_URL })
      );
      if (
        !isPropagationRetry
        && (issueSummary.unexpectedNetworkFailures.length > 0 || issueSummary.unexpectedConsoleIssues.length > 0)
      ) {
        tagReleaseSmokeError(error, RELEASE_SMOKE_PHASES.ASSERTIONS, {
          retryable: false,
          details: {
            originalPhase: error?.releaseSmokePhase || RELEASE_SMOKE_PHASES.ASSERTIONS,
            unexpectedNetworkFailures: issueSummary.unexpectedNetworkFailures,
            unexpectedConsoleIssues: issueSummary.unexpectedConsoleIssues,
          },
        });
      }
      const decision = getReleaseSmokeRetryDecision({
        error,
        attempt,
        maxAttempts: RELEASE_SMOKE_MAX_ATTEMPTS,
        retryDelayMs: RELEASE_SMOKE_RETRY_DELAY_MS,
      });
      const retryAttemptedForFailure = retryAttempted || decision.shouldRetry;
      const snapshot = await readReleaseSmokeFailureContext({
        page,
        error,
        attempt,
        maxAttempts: RELEASE_SMOKE_MAX_ATTEMPTS,
        preflightResults,
        consoleIssues: diagnostics.consoleIssues,
        networkFailures: diagnostics.networkFailures,
        decision,
        retryAttempted: retryAttemptedForFailure,
      });
      await writeReleaseSmokeFailureContext(testInfo, snapshot, {
        attempt,
        final: !decision.shouldRetry,
      });
      attemptSummaries.push({
        attempt,
        result: "failed",
        phase: decision.phase,
        retryable: decision.retryable,
        willRetry: decision.shouldRetry,
        retryDelayMs: decision.retryDelayMs,
      });
      await context.close().catch(() => {});

      if (decision.shouldRetry) {
        retryAttempted = true;
        await sleep(decision.retryDelayMs);
        continue;
      }

      error.releaseSmokeAttempts = attemptSummaries;
      if (retryAttempted || attempt > 1) {
        error.message = `[release-smoke] failed after ${attempt} attempt(s); retryAttempted=${retryAttempted}; phase=${decision.phase}. ${error.message}`;
      }
      throw error;
    }
  }
});
