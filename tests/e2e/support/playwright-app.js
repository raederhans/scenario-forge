const path = require("path");
const {
  DEFAULT_APP_PATH,
  DEFAULT_FAST_APP_OPEN_PATH,
} = require("./startup-paths");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_TEST_SERVER_PORT = String(
  process.env.PLAYWRIGHT_TEST_SERVER_PORT
  || process.env.MAPCREATOR_DEV_PORT
  || "8810"
).trim();
const DEFAULT_APP_ORIGIN = `http://127.0.0.1:${DEFAULT_TEST_SERVER_PORT}`;
const DEFAULT_OPEN_PATH = DEFAULT_FAST_APP_OPEN_PATH;

function normalizeAppOrigin(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return DEFAULT_APP_ORIGIN;
  }
  return normalized.replace(/\/+$/, "");
}

function getConfiguredAppOrigin() {
  return normalizeAppOrigin(
    process.env.PLAYWRIGHT_TEST_BASE_URL
    || process.env.MAPCREATOR_BASE_URL
    || process.env.MAPCREATOR_APP_URL
    || DEFAULT_APP_ORIGIN
  );
}

function shouldReuseExistingServer() {
  const normalized = String(process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER || "").trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  if (process.env.CODEX_CI) {
    return false;
  }
  return !process.env.CI;
}

function normalizeAppPath(targetPath = DEFAULT_APP_PATH) {
  const normalizedTarget = String(targetPath || DEFAULT_APP_PATH).trim() || DEFAULT_APP_PATH;
  if (normalizedTarget === "/") {
    return DEFAULT_APP_PATH;
  }
  if (normalizedTarget.startsWith("/app/")) {
    return normalizedTarget;
  }
  if (normalizedTarget === "/app") {
    return DEFAULT_APP_PATH;
  }
  if (normalizedTarget.startsWith("/?") || normalizedTarget.startsWith("/#")) {
    return `/app${normalizedTarget}`;
  }
  return normalizedTarget.startsWith("/") ? normalizedTarget : `/${normalizedTarget}`;
}

function getAppUrl(targetPath = DEFAULT_APP_PATH) {
  const pathname = normalizeAppPath(targetPath);
  return new URL(pathname, `${getConfiguredAppOrigin()}/`).toString();
}

async function primeStateRef(page) {
  // Playwright `waitForFunction(async ...)` only waits on the returned Promise object itself,
  // so shared ready gates pin the live singleton state onto `globalThis` first and then poll
  // it synchronously inside `waitForFunction`.
  await page.evaluate(async () => {
    if (globalThis.__playwrightStateRef) {
      return true;
    }
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    globalThis.__playwrightStateRef = stateModule?.state || null;
    return !!globalThis.__playwrightStateRef;
  });
}

async function primeInteractionFunnelDebugRef(page) {
  await page.evaluate(async () => {
    if (globalThis.__playwrightInteractionFunnelDebugRef) {
      return true;
    }
    const funnelModuleUrl = new URL("./js/core/interaction_funnel.js", globalThis.location.href).toString();
    const funnelModule = await import(funnelModuleUrl);
    globalThis.__playwrightInteractionFunnelDebugRef = funnelModule?.getInteractionFunnelDebugState || null;
    return !!globalThis.__playwrightInteractionFunnelDebugRef;
  });
}

async function gotoApp(page, targetPath = DEFAULT_APP_PATH, options = {}) {
  return page.goto(getAppUrl(targetPath), options);
}

async function readBootStateSnapshot(page) {
  try {
    return await page.evaluate(async () => {
      const overlay = document.querySelector("#bootOverlay");
      const scenarioStatus = document.querySelector("#scenarioStatus");
      const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
      const stateModule = await import(stateModuleUrl);
      const state = stateModule?.state || {};
      return {
        bootPhase: String(state.bootPhase || ""),
        bootBlocking: state.bootBlocking === false ? false : !!state.bootBlocking,
        startupReadonly: !!state.startupReadonly,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        detailDeferred: !!state.detailDeferred,
        detailPromotionInFlight: !!state.detailPromotionInFlight,
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        activeScenarioId: String(state.activeScenarioId || ""),
        bodyAppBooting: !!document.body?.classList?.contains("app-booting"),
        overlayHidden: !!overlay?.classList?.contains("hidden"),
        overlayAriaBusy: String(overlay?.getAttribute("aria-busy") || ""),
        bootError: String(state.bootError || ""),
        scenarioStatus: String(scenarioStatus?.textContent || ""),
      };
    });
  } catch (error) {
    return {
      snapshotError: String(error?.message || error),
    };
  }
}

async function waitForAppInteractive(page, { timeout = 90_000 } = {}) {
  try {
    await primeStateRef(page);
    await page.waitForFunction(() => {
      const state = globalThis.__playwrightStateRef || null;
      if (!state) return false;
      if (String(state.bootError || "").trim()) {
        throw new Error(`[playwright-app] bootError=${state.bootError}`);
      }
      return (
        state.bootBlocking === false
        && !state.scenarioApplyInFlight
        && !state.startupReadonlyUnlockInFlight
      );
    }, { timeout });
  } catch (error) {
    const snapshot = await readBootStateSnapshot(page);
    const detail = JSON.stringify(snapshot);
    const wrapped = new Error(
      `[playwright-app] waitForAppInteractive timed out after ${timeout}ms. Boot snapshot: ${detail}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function waitForScenarioSelectReady(page, { scenarioId = "tno_1962", timeout = 90_000 } = {}) {
  await primeStateRef(page);
  await page.waitForFunction((expectedScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return !!state
      && typeof state.renderCountryListFn === "function"
      && !!scenarioSelect
      && !!scenarioSelect.querySelector(`option[value="${expectedScenarioId}"]`);
  }, String(scenarioId || "").trim(), { timeout });
}

async function applyScenarioAndWaitIdle(page, scenarioId, {
  timeout = 120_000,
  markDirtyReason = "playwright-apply-scenario",
  showToastOnComplete = false,
} = {}) {
  const expectedScenarioId = String(scenarioId || "").trim();
  await page.evaluate(async ({ expectedScenarioId, markDirtyReason, showToastOnComplete }) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
    }
    const { applyScenarioById } = await import("/js/core/scenario_manager.js");
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await applyScenarioById(expectedScenarioId, {
          renderNow: true,
          markDirtyReason,
          showToastOnComplete,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (lastError) {
      throw lastError;
    }
  }, {
    expectedScenarioId,
    markDirtyReason,
    showToastOnComplete,
  });
  await primeStateRef(page);
  await page.waitForFunction((targetScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    if (!state) return false;
    return state.activeScenarioId === targetScenarioId && !state.scenarioApplyInFlight;
  }, expectedScenarioId, { timeout });
}

async function waitForProjectImportSettled(page, {
  timeout = 30_000,
  minOperationalLines = 0,
  minOperationGraphics = 0,
  minUnitCounters = 0,
} = {}) {
  await primeStateRef(page);
  await page.waitForFunction((expected) => {
    const state = globalThis.__playwrightStateRef || null;
    if (!state) return false;
    const operationalLineCount = Array.isArray(state.operationalLines) ? state.operationalLines.length : 0;
    const operationGraphicCount = Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0;
    const unitCounterCount = Array.isArray(state.unitCounters) ? state.unitCounters.length : 0;
    return (
      !state.projectImportInFlight
      && operationalLineCount >= expected.minOperationalLines
      && operationGraphicCount >= expected.minOperationGraphics
      && unitCounterCount >= expected.minUnitCounters
    );
  }, {
    minOperationalLines: Math.max(0, Number(minOperationalLines) || 0),
    minOperationGraphics: Math.max(0, Number(minOperationGraphics) || 0),
    minUnitCounters: Math.max(0, Number(minUnitCounters) || 0),
  }, { timeout });
}

async function beginProjectImportWatch(page, { expectedFileName = "" } = {}) {
  await primeInteractionFunnelDebugRef(page);
  const baseline = await page.evaluate(() => {
    const getDebugState = globalThis.__playwrightInteractionFunnelDebugRef || null;
    return typeof getDebugState === "function" ? getDebugState() : null;
  });
  return {
    expectedFileName: String(expectedFileName || "").trim(),
    initialImportStartCount: Number(baseline?.importStartCount || 0),
    initialImportApplyCount: Number(baseline?.importApplyCount || 0),
  };
}

async function waitForProjectImportCompletion(page, importWatchState, { timeout = 120_000 } = {}) {
  const watchState = importWatchState && typeof importWatchState === "object" ? importWatchState : {};
  const expectedFileName = String(watchState.expectedFileName || "").trim();
  await primeInteractionFunnelDebugRef(page);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const debug = await page.evaluate(() => {
      const getDebugState = globalThis.__playwrightInteractionFunnelDebugRef || null;
      return typeof getDebugState === "function" ? getDebugState() : null;
    });
    const importStarted = Number(debug?.importStartCount || 0) > Number(watchState.initialImportStartCount || 0);
    if (importStarted) {
      const importError = String(debug?.lastImportError || "").trim();
      if (importError) {
        throw new Error(`Project import failed: ${importError}`);
      }
      const importApplied = Number(debug?.importApplyCount || 0) > Number(watchState.initialImportApplyCount || 0);
      const phaseComplete = String(debug?.importPhase || "") === "complete";
      const fileMatches = !expectedFileName || String(debug?.lastImportFileName || "") === expectedFileName;
      if (importApplied && phaseComplete && fileMatches) {
        return;
      }
    }
    await page.waitForTimeout(200);
  }
  const snapshot = await readBootStateSnapshot(page);
  throw new Error(
    `[playwright-app] waitForProjectImportCompletion timed out after ${timeout}ms. Boot snapshot: ${JSON.stringify(snapshot)}`
  );
}

async function openProjectFrontlineSection(page, { timeout = 30_000 } = {}) {
  await page.evaluate(async () => {
    const sidebarModule = await import("/js/ui/sidebar.js");
    const mapRendererModule = await import("/js/core/map_renderer.js");
    if (
      !document.querySelector("#frontlineProjectSection")
      || !document.querySelector("#frontlineOverlayPanel")
      || !document.querySelector("#strategicOverlayPanel")
    ) {
      sidebarModule.initSidebar({ render: mapRendererModule.render });
    }
    const projectTab = document.querySelector("#inspectorSidebarTabProject");
    if (projectTab instanceof HTMLElement) {
      projectTab.click();
    }
    const section = document.querySelector("#frontlineProjectSection");
    if (section instanceof HTMLDetailsElement) {
      section.open = true;
    }
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    const state = stateModule?.state || null;
    if (state && (!state.ui || typeof state.ui !== "object")) {
      state.ui = {};
    }
    if (state) {
      state.ui.rightSidebarTab = "project";
      state.updateScenarioUIFn?.();
      state.updateStrategicOverlayUIFn?.();
    }
  });
  await page.waitForFunction(() => {
    const projectPanel = document.querySelector("#projectSidebarPanel");
    const section = document.querySelector("#frontlineProjectSection");
    return !!projectPanel
      && !projectPanel.hidden
      && !!section
      && !!section.open
      && !!document.querySelector("#frontlineOverlayPanel")
      && !!document.querySelector("#strategicOverlayPanel");
  }, { timeout });
}

function getWebServerConfig() {
  if (
    process.env.PLAYWRIGHT_TEST_BASE_URL
    || process.env.MAPCREATOR_BASE_URL
    || process.env.MAPCREATOR_APP_URL
  ) {
    return undefined;
  }

  const command = process.platform === "win32"
    ? "py tools/dev_server.py"
    : "python tools/dev_server.py";

  return {
    command,
    cwd: REPO_ROOT,
    url: getAppUrl(DEFAULT_APP_PATH),
    timeout: 120_000,
    reuseExistingServer: shouldReuseExistingServer(),
    env: {
      ...process.env,
      MAPCREATOR_DEV_PORT: process.env.MAPCREATOR_DEV_PORT || DEFAULT_TEST_SERVER_PORT,
      MAPCREATOR_OPEN_PATH: process.env.MAPCREATOR_OPEN_PATH || DEFAULT_OPEN_PATH,
      MAPCREATOR_OPEN_BROWSER: "0",
      MAPCREATOR_DEV_CACHE_MODE: process.env.MAPCREATOR_DEV_CACHE_MODE || "revalidate-static",
      MAPCREATOR_RUNTIME_ROOT: process.env.MAPCREATOR_RUNTIME_ROOT || path.join(REPO_ROOT, ".runtime"),
    },
  };
}

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_OPEN_PATH,
  DEFAULT_APP_ORIGIN,
  getAppUrl,
  getConfiguredAppOrigin,
  getWebServerConfig,
  gotoApp,
  readBootStateSnapshot,
  primeStateRef,
  primeInteractionFunnelDebugRef,
  waitForScenarioSelectReady,
  applyScenarioAndWaitIdle,
  waitForProjectImportSettled,
  beginProjectImportWatch,
  waitForProjectImportCompletion,
  openProjectFrontlineSection,
  waitForAppInteractive,
};
