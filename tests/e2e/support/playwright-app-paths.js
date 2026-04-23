const {
  DEFAULT_APP_PATH,
  DEFAULT_FAST_APP_OPEN_PATH,
} = require("./startup-paths");

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

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_OPEN_PATH,
  DEFAULT_APP_ORIGIN,
  DEFAULT_TEST_SERVER_PORT,
  normalizeAppOrigin,
  getConfiguredAppOrigin,
  normalizeAppPath,
  getAppUrl,
};
