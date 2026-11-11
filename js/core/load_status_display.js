import { cloneJsonLike } from "./json_clone.js";

function normalizeProviders(snapshot = {}) {
  const directProviders = snapshot?.providers;
  if (directProviders && typeof directProviders === "object") {
    return directProviders;
  }
  const nestedProviders = snapshot?.loadStatus?.providers;
  if (nestedProviders && typeof nestedProviders === "object") {
    return nestedProviders;
  }
  return {};
}

function normalizeDataServiceEntries(providerKey, providerValue = {}) {
  const resources = providerValue?.resources && typeof providerValue.resources === "object"
    ? providerValue.resources
    : {};
  return Object.entries(resources)
    .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
    .map(([entryKey, resource]) => ({
      providerKey,
      entryKey,
      label: String(resource?.id || entryKey),
      status: String(resource?.status || "unknown"),
      kind: String(resource?.kind || "resource"),
      url: String(resource?.url || ""),
      errorCode: String(resource?.errorCode || ""),
      cachePolicy: String(resource?.cachePolicy || ""),
      source: "data_service",
      details: cloneJsonLike(resource) || {},
    }));
}

function normalizeMainRuntimeEntries(providerKey, providerValue = {}) {
  const startupBootCacheState = providerValue?.startup?.startupBootCacheState || {};
  const entries = [
    {
      providerKey,
      entryKey: `${providerKey}:boot`,
      label: "boot",
      status: String(providerValue?.boot?.phase || "unknown"),
      kind: "runtime",
      url: "",
      errorCode: "",
      cachePolicy: "",
      source: "main_runtime",
      details: cloneJsonLike(providerValue?.boot) || {},
    },
    {
      providerKey,
      entryKey: `${providerKey}:startup-base-topology`,
      label: "startup-base-topology",
      status: String(startupBootCacheState?.baseTopology || "idle"),
      kind: "startup-cache",
      url: "",
      errorCode: "",
      cachePolicy: "",
      source: "main_runtime",
      details: cloneJsonLike(startupBootCacheState) || {},
    },
    {
      providerKey,
      entryKey: `${providerKey}:startup-localization`,
      label: "startup-localization",
      status: String(startupBootCacheState?.localization || "idle"),
      kind: "startup-cache",
      url: "",
      errorCode: "",
      cachePolicy: "",
      source: "main_runtime",
      details: cloneJsonLike(startupBootCacheState) || {},
    },
    {
      providerKey,
      entryKey: `${providerKey}:startup-scenario-bootstrap`,
      label: "startup-scenario-bootstrap",
      status: String(startupBootCacheState?.scenarioBootstrap || "idle"),
      kind: "startup-cache",
      url: "",
      errorCode: "",
      cachePolicy: "",
      source: "main_runtime",
      details: cloneJsonLike(startupBootCacheState) || {},
    },
  ];
  const chunkRuntime = providerValue?.chunkRuntime || {};
  if (chunkRuntime && typeof chunkRuntime === "object") {
    entries.push({
      providerKey,
      entryKey: `${providerKey}:chunk-runtime`,
      label: "chunk-runtime",
      status: String(chunkRuntime?.shellStatus || "idle"),
      kind: "chunk-runtime",
      url: "",
      errorCode: "",
      cachePolicy: "",
      source: "main_runtime",
      details: cloneJsonLike(chunkRuntime) || {},
    });
  }
  return entries;
}

function normalizeGenericProviderEntries(providerKey, providerValue = {}) {
  return [{
    providerKey,
    entryKey: providerKey,
    label: providerKey,
    status: String(providerValue?.status || providerValue?.phase || "ready"),
    kind: "provider",
    url: "",
    errorCode: String(providerValue?.errorCode || ""),
    cachePolicy: "",
    source: providerKey,
    details: cloneJsonLike(providerValue) || {},
  }];
}

export function normalizeLoadStatusForDisplay(snapshot = {}) {
  const providers = normalizeProviders(snapshot);
  const entries = [];
  Object.entries(providers)
    .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
    .forEach(([providerKey, providerValue]) => {
      if (providerKey === "data_service") {
        entries.push(...normalizeDataServiceEntries(providerKey, providerValue));
        return;
      }
      if (providerKey === "main_runtime") {
        entries.push(...normalizeMainRuntimeEntries(providerKey, providerValue));
        return;
      }
      entries.push(...normalizeGenericProviderEntries(providerKey, providerValue));
    });
  return {
    providerCount: Object.keys(providers).length,
    entries,
  };
}
