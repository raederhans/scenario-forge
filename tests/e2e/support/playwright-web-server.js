const path = require("path");
const {
  DEFAULT_APP_PATH,
  DEFAULT_OPEN_PATH,
  DEFAULT_TEST_SERVER_PORT,
  getAppUrl,
} = require("./playwright-app-paths");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

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
  REPO_ROOT,
  getWebServerConfig,
};
