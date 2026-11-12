// Central read-only runtime snapshot bridge for console/debug inspection.
// 这里不暴露可写 runtime owner，只聚合普通 JSON snapshot。

import { cloneJsonLike } from "./json_clone.js";
import { normalizeLoadStatusForDisplay } from "./load_status_display.js";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SECTION_NAMES = ["assets", "loadStatus", "perf", "diag", "version"];
const providerRegistry = Object.freeze(
  Object.fromEntries(SECTION_NAMES.map((sectionName) => [sectionName, new Map()]))
);

function normalizeProviderValue(value, fallback = {}) {
  const cloned = cloneJsonLike(value);
  if (cloned === undefined) return fallback;
  return cloned;
}

function readProviderValue(provider) {
  if (typeof provider !== "function") return {};
  try {
    return normalizeProviderValue(provider(), {});
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectProviderSection(sectionName) {
  const section = {};
  const registry = providerRegistry[sectionName];
  if (!(registry instanceof Map)) return section;
  Array.from(registry.entries())
    .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
    .forEach(([providerKey, provider]) => {
      section[providerKey] = readProviderValue(provider);
    });
  return section;
}

function getPerfSnapshot() {
  const perfSnapshot = typeof globalThis.__mc_perf__?.snapshot === "function"
    ? normalizeProviderValue(globalThis.__mc_perf__.snapshot(), null)
    : null;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    bootMetrics: normalizeProviderValue(globalThis.__bootMetrics, {}),
    renderPerfMetrics: normalizeProviderValue(globalThis.__renderPerfMetrics, {}),
    scenarioPerfMetrics: normalizeProviderValue(globalThis.__scenarioPerfMetrics, {}),
    perfProbe: perfSnapshot,
    providers: collectProviderSection("perf"),
  };
}

function getDiagSnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    mapRenderDiag: normalizeProviderValue(globalThis.__mapRenderDiag, {}),
    providers: collectProviderSection("diag"),
  };
}

function getAssetsSnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providers: collectProviderSection("assets"),
  };
}

function getLoadStatusSnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providers: collectProviderSection("loadStatus"),
  };
}

function getLoadStatusDisplaySnapshot() {
  return normalizeLoadStatusForDisplay(getLoadStatusSnapshot());
}

function getVersionSnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providers: collectProviderSection("version"),
  };
}

export function getMapcreatorSnapshot() {
  return {
    assets: getAssetsSnapshot(),
    loadStatus: getLoadStatusSnapshot(),
    perf: getPerfSnapshot(),
    diag: getDiagSnapshot(),
    version: getVersionSnapshot(),
  };
}

export function registerMapcreatorSnapshotProvider(sectionName, providerKey, provider) {
  const normalizedSectionName = String(sectionName || "").trim();
  const normalizedProviderKey = String(providerKey || "").trim();
  if (!SECTION_NAMES.includes(normalizedSectionName)) {
    throw new Error(`[mapcreator_snapshot] Unknown section: ${normalizedSectionName || "<empty>"}.`);
  }
  if (!normalizedProviderKey) {
    throw new Error("[mapcreator_snapshot] Provider key must be non-empty.");
  }
  if (typeof provider !== "function") {
    throw new Error(`[mapcreator_snapshot] Provider ${normalizedProviderKey} must be a function.`);
  }
  ensureMapcreatorSnapshotGlobal();
  if (
    providerRegistry[normalizedSectionName].has(normalizedProviderKey)
    && shouldWarnOnProviderReplace()
  ) {
    console.warn(
      `[mapcreator_snapshot] Replacing provider "${normalizedProviderKey}" in section "${normalizedSectionName}".`
    );
  }
  providerRegistry[normalizedSectionName].set(normalizedProviderKey, provider);
  return () => unregisterMapcreatorSnapshotProvider(normalizedSectionName, normalizedProviderKey);
}

function shouldWarnOnProviderReplace() {
  try {
    const params = typeof globalThis.URLSearchParams === "function"
      ? new globalThis.URLSearchParams(globalThis.location?.search || "")
      : null;
    const devFlag = String(params?.get("dev") || "").trim();
    if (["1", "true", "yes", "on"].includes(devFlag.toLowerCase())) {
      return true;
    }
  } catch (_error) {
    // Ignore URL parsing issues and keep fallback checks below.
  }
  const hostname = String(globalThis.location?.hostname || "").trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }
  return !!globalThis.document?.body?.classList?.contains("developer-mode");
}

export function unregisterMapcreatorSnapshotProvider(sectionName, providerKey) {
  const normalizedSectionName = String(sectionName || "").trim();
  const normalizedProviderKey = String(providerKey || "").trim();
  if (!SECTION_NAMES.includes(normalizedSectionName) || !normalizedProviderKey) return false;
  return providerRegistry[normalizedSectionName].delete(normalizedProviderKey);
}

export function ensureMapcreatorSnapshotGlobal() {
  if (typeof globalThis === "undefined") return null;
  const current = globalThis.__mapcreator__;
  if (
    current
    && typeof current === "object"
    && current.__snapshotBridgeVersion === SNAPSHOT_SCHEMA_VERSION
  ) {
    return current;
  }

  const snapshotApi = {};
  Object.defineProperties(snapshotApi, {
    __snapshotBridgeVersion: {
      value: SNAPSHOT_SCHEMA_VERSION,
      enumerable: false,
    },
    assets: {
      enumerable: true,
      get: getAssetsSnapshot,
    },
    loadStatus: {
      enumerable: true,
      get: getLoadStatusSnapshot,
    },
    loadStatusDisplay: {
      enumerable: true,
      get: getLoadStatusDisplaySnapshot,
    },
    perf: {
      enumerable: true,
      get: getPerfSnapshot,
    },
    diag: {
      enumerable: true,
      get: getDiagSnapshot,
    },
    version: {
      enumerable: true,
      get: getVersionSnapshot,
    },
    snapshot: {
      enumerable: false,
      value: getMapcreatorSnapshot,
    },
    formatLoadStatus: {
      enumerable: false,
      value: normalizeLoadStatusForDisplay,
    },
  });
  Object.freeze(snapshotApi);
  globalThis.__mapcreator__ = snapshotApi;
  return snapshotApi;
}

ensureMapcreatorSnapshotGlobal();
