const DEFAULT_APP_PATH = "/app/";
const DEFAULT_FAST_APP_OPEN_PATH = "/app/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1";
const DEFAULT_FRESH_APP_OPEN_PATH = "/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0";

function stripAppPrefix(pathname = "") {
  if (pathname === "/app" || pathname === "/app/") {
    return "/";
  }
  if (pathname.startsWith("/app/")) {
    return pathname.slice("/app".length);
  }
  return pathname || "/";
}

function toRootPath(appPath = DEFAULT_FAST_APP_OPEN_PATH) {
  const url = new URL(appPath, "http://127.0.0.1");
  const pathname = stripAppPrefix(url.pathname);
  return `${pathname}${url.search}${url.hash}`;
}

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_FAST_APP_OPEN_PATH,
  DEFAULT_FRESH_APP_OPEN_PATH,
  toRootPath,
};
