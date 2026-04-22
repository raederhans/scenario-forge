const ENABLED_KEY = "mc_perf_enabled";
const MAX_RENDER_SAMPLES = 256;

const perf = globalThis.performance;
const hasPerfNow = typeof perf?.now === "function";
let enabled = readEnabledFlag();
let renderSampleSequence = 0;
const renderSamples = [];

function readEnabledFlag() {
  try {
    if (typeof location !== "undefined" && /[?&]perf=1\b/.test(location.search)) {
      return true;
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "1") {
      return true;
    }
  } catch (_error) {
    // Ignore storage and location access failures in non-browser environments.
  }
  return false;
}

function persistEnabledFlag(nextValue) {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (nextValue) {
      localStorage.setItem(ENABLED_KEY, "1");
      return;
    }
    localStorage.removeItem(ENABLED_KEY);
  } catch (_error) {
    // Ignore storage failures so perf probing never blocks runtime behavior.
  }
}

export function cloneJsonLike(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch (_error) {
      // Fall through to JSON clone fallback.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return undefined;
  }
}

function cloneMetricObject(metric) {
  const clonedMetric = cloneJsonLike(metric);
  return clonedMetric && typeof clonedMetric === "object" ? clonedMetric : {};
}

function cloneRenderSamples() {
  const clonedSamples = cloneJsonLike(renderSamples);
  return Array.isArray(clonedSamples) ? clonedSamples : [];
}

function buildRenderSampleSummary() {
  const durations = renderSamples
    .map((sample) => Number(sample.durationMs || 0))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const count = durations.length;
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const middleIndex = Math.floor(count / 2);
  const medianMs = count === 0
    ? 0
    : (count % 2 === 0
      ? (durations[middleIndex - 1] + durations[middleIndex]) / 2
      : durations[middleIndex]);
  return {
    count,
    totalMs,
    minMs: count ? durations[0] : 0,
    maxMs: count ? durations[count - 1] : 0,
    medianMs,
    samples: cloneRenderSamples(),
  };
}

export function perfEnable() {
  enabled = true;
  persistEnabledFlag(true);
  return true;
}

export function perfDisable() {
  enabled = false;
  persistEnabledFlag(false);
  return false;
}

export function perfIsEnabled() {
  return enabled;
}

export function clearRenderSamples() {
  renderSamples.length = 0;
  renderSampleSequence = 0;
}

export function recordRenderSample(durationMs, details = {}) {
  if (!enabled) {
    return null;
  }
  const sample = {
    sequence: ++renderSampleSequence,
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    nowMs: hasPerfNow ? perf.now() : 0,
    ...details,
  };
  renderSamples.push(sample);
  if (renderSamples.length > MAX_RENDER_SAMPLES) {
    renderSamples.splice(0, renderSamples.length - MAX_RENDER_SAMPLES);
  }
  return sample;
}

export function snapshot() {
  return {
    enabled,
    bootMetrics: cloneMetricObject(globalThis.__bootMetrics),
    renderPerfMetrics: cloneMetricObject(globalThis.__renderPerfMetrics),
    scenarioPerfMetrics: cloneMetricObject(globalThis.__scenarioPerfMetrics),
    renderSamples: buildRenderSampleSummary(),
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.__mc_perf__ = {
    enable: perfEnable,
    disable: perfDisable,
    isEnabled: perfIsEnabled,
    clearRenderSamples,
    snapshot,
  };
}
