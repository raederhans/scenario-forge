export function getSearchParams(search = null) {
  try {
    const source = typeof search === "string" ? search : (globalThis.location?.search || "");
    return new URLSearchParams(source);
  } catch (_error) {
    return new URLSearchParams();
  }
}

export function parseToggleParam(value, fallback = null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
