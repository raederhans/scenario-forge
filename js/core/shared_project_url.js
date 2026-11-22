export const SHARED_PROJECT_ERRORS = Object.freeze({
  "invalid-url": "The project link is invalid.",
  "not-https": "Only HTTPS project links are supported.",
  "fetch-failed": "Could not download the project file.",
  redirect: "This link redirects elsewhere. Use the final raw file link.",
  "cors-blocked": "The server does not allow this app to read the file across origins (CORS).",
  "too-large": "The project file is too large.",
  timeout: "The project download timed out.",
  "not-project": "This file is not a project file.",
  "unsafe-project-keys": "The project contains unsafe fields.",
  "hgo-project": "Open this HGO project in the HGO editor.",
  "import-failed": "Could not import the project.",
});

export function sharedProjectError(code) {
  return Object.assign(new Error(SHARED_PROJECT_ERRORS[code]), { code });
}

export function validateSharedProjectUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) throw sharedProjectError("invalid-url");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw sharedProjectError("invalid-url");
  }
  if (url.protocol !== "https:") throw sharedProjectError("not-https");
  const host = url.hostname.replace(/\.+$/, "");
  if (url.username || url.password || !host || /(^|\.)(localhost|local)$/.test(host)
    || host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || url.href.length > 2048) {
    throw sharedProjectError("invalid-url");
  }
  return url;
}

export function getSharedProjectLinkFromUrl(search = globalThis.location?.search) {
  return new URLSearchParams(search).get("project");
}

export function buildShareLink(raw, scenarioId = "", pageHref = globalThis.location.href) {
  const project = validateSharedProjectUrl(raw);
  const url = new URL(pageHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("project", project.href);
  if (scenarioId) url.searchParams.set("default_scenario", scenarioId);
  return url.href;
}

export function clearSharedProjectUrlState(keys = ["project", "default_scenario"]) {
  const url = new URL(globalThis.location.href);
  if (!keys.some(key => url.searchParams.has(key))) return;
  for (const key of keys) url.searchParams.delete(key);
  globalThis.history.replaceState(globalThis.history.state, "", url.href);
}
