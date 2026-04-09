const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_TEST_SERVER_PORT = String(
  process.env.PLAYWRIGHT_TEST_SERVER_PORT
  || process.env.MAPCREATOR_DEV_PORT
  || "8810"
).trim();
const DEFAULT_APP_ORIGIN = `http://127.0.0.1:${DEFAULT_TEST_SERVER_PORT}`;
const DEFAULT_OPEN_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1";

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
  return !process.env.CI;
}

function getAppUrl(targetPath = "/") {
  const normalizedTarget = String(targetPath || "/").trim() || "/";
  const pathname = normalizedTarget.startsWith("/") ? normalizedTarget : `/${normalizedTarget}`;
  return new URL(pathname, `${getConfiguredAppOrigin()}/`).toString();
}

async function gotoApp(page, targetPath = "/", options = {}) {
  return page.goto(getAppUrl(targetPath), options);
}

async function readBootStateSnapshot(page) {
  try {
    return await page.evaluate(async () => {
      const overlay = document.querySelector("#bootOverlay");
      const scenarioStatus = document.querySelector("#scenarioStatus");
      const stateModule = await import("/js/core/state.js");
      const state = stateModule?.state || {};
      return {
        bootPhase: String(state.bootPhase || ""),
        bootBlocking: !!state.bootBlocking,
        startupReadonly: !!state.startupReadonly,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        detailDeferred: !!state.detailDeferred,
        detailPromotionInFlight: !!state.detailPromotionInFlight,
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        activeScenarioId: String(state.activeScenarioId || ""),
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
    await page.waitForFunction(() => {
      const overlay = document.querySelector("#bootOverlay");
      if (!overlay) {
        return true;
      }
      return overlay.classList.contains("hidden") && overlay.getAttribute("aria-busy") === "false";
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

function getWebServerConfig() {
  if (
    process.env.PLAYWRIGHT_TEST_BASE_URL
    || process.env.MAPCREATOR_BASE_URL
    || process.env.MAPCREATOR_APP_URL
  ) {
    return undefined;
  }

  const command = "python tools/dev_server.py";

  return {
    command,
    cwd: REPO_ROOT,
    url: getAppUrl("/"),
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
  DEFAULT_APP_ORIGIN,
  getAppUrl,
  getConfiguredAppOrigin,
  getWebServerConfig,
  gotoApp,
  readBootStateSnapshot,
  waitForAppInteractive,
};
