// Canonical renderer diagnostics-state mutations.
// Time sampling, global mirrors, hooks, and metrics orchestration stay in callers.

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[renderer_diagnostics_actions] target must be an object");
  }
}

function getOwnDataPropertyValue(target, key) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function hasSameStateValue(left, right) {
  return left === right || (left !== left && right !== right);
}

function assertOwnDataPropertyWritable(target, key, value, label) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    if (!descriptor.writable && !hasSameStateValue(descriptor.value, value)) {
      throw new TypeError(`[renderer_diagnostics_actions] ${label} must be writable`);
    }
    return descriptor;
  }
  if (descriptor && !descriptor.configurable) {
    throw new TypeError(`[renderer_diagnostics_actions] ${label} accessor must be configurable`);
  }
  if (!descriptor && !Object.isExtensible(target)) {
    throw new TypeError(`[renderer_diagnostics_actions] ${label} target must be extensible`);
  }
  return descriptor;
}

function writeRenderPerfMetricsOwnDataProperty(target, value) {
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "renderPerfMetrics",
    value,
    "renderPerfMetrics",
  );
  if (
    descriptor
    && Object.hasOwn(descriptor, "value")
    && hasSameStateValue(descriptor.value, value)
  ) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target, "renderPerfMetrics", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  target.renderPerfMetrics = value;
  return value;
}

function writeRenderPerfMetricSequenceOwnDataProperty(target, value) {
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "renderPerfMetricSequence",
    value,
    "renderPerfMetricSequence",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && hasSameStateValue(descriptor.value, value)) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target, "renderPerfMetricSequence", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  target.renderPerfMetricSequence = value;
  return value;
}

function writeFirstVisibleFramePaintedOwnDataProperty(target, value) {
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "firstVisibleFramePainted",
    value,
    "firstVisibleFramePainted",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && hasSameStateValue(descriptor.value, value)) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target, "firstVisibleFramePainted", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  target.firstVisibleFramePainted = value;
  return value;
}

function writeProjectedBoundsDiagnosticsOwnDataProperty(target, value) {
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "projectedBoundsDiagnostics",
    value,
    "projectedBoundsDiagnostics",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && hasSameStateValue(descriptor.value, value)) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target, "projectedBoundsDiagnostics", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  target.projectedBoundsDiagnostics = value;
  return value;
}

function writeDebugCountryCoverageOwnDataProperty(target, value) {
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "debugCountryCoverage",
    value,
    "debugCountryCoverage",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && hasSameStateValue(descriptor.value, value)) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target, "debugCountryCoverage", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  target.debugCountryCoverage = value;
  return value;
}

function writeRenderPerfContextBreakdownOwnDataProperty(metrics, value) {
  const descriptor = assertOwnDataPropertyWritable(
    metrics,
    "contextBreakdown",
    value,
    "renderPerfMetrics.contextBreakdown",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && hasSameStateValue(descriptor.value, value)) {
    return value;
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(metrics, "contextBreakdown", {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  metrics.contextBreakdown = value;
  return value;
}

function getOwnObjectPropertyValue(target, key) {
  const value = getOwnDataPropertyValue(target, key);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function cloneDiagnosticValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    value.forEach((entry) => clone.push(cloneDiagnosticValue(entry, seen)));
    return clone;
  }
  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);
    value.forEach((entry, key) => {
      clone.set(cloneDiagnosticValue(key, seen), cloneDiagnosticValue(entry, seen));
    });
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);
    value.forEach((entry) => clone.add(cloneDiagnosticValue(entry, seen)));
    return clone;
  }
  const clone = {};
  seen.set(value, clone);
  Object.keys(value).forEach((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return;
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneDiagnosticValue(descriptor.value, seen),
      writable: true,
    });
  });
  return clone;
}

function createRejectedRenderSnapshotRecordCarrier() {
  return Object.create(Object.freeze({ rejectedRenderSnapshotRecord: true }));
}

function cloneRenderSnapshotRecord(target, key) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) {
    return key in target ? createRejectedRenderSnapshotRecordCarrier() : {};
  }
  if (!Object.hasOwn(descriptor, "value")) {
    return createRejectedRenderSnapshotRecordCarrier();
  }
  const value = descriptor.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  for (const ownKey of Reflect.ownKeys(value)) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    if (
      typeof ownKey !== "string"
      || !ownDescriptor?.enumerable
      || !Object.hasOwn(ownDescriptor, "value")
    ) {
      return createRejectedRenderSnapshotRecordCarrier();
    }
  }
  return cloneDiagnosticValue(value);
}

function cloneRenderSnapshotState(target, getters) {
  for (const name of [
    "getViewportRenderSignature",
    "getProjectionRenderSignature",
    "getViewportGeoBounds",
  ]) {
    if (typeof getters?.[name] !== "function") {
      throw new TypeError(
        `[renderer_diagnostics_actions] getters.${name} must be a function`,
      );
    }
  }
  const transform = getOwnDataPropertyValue(target, "zoomTransform");
  const transformRecord = transform && typeof transform === "object"
    ? transform
    : {};
  return Object.freeze({
    sovereignBaseColors: cloneRenderSnapshotRecord(target, "sovereignBaseColors"),
    sovereigntyByFeatureId: cloneRenderSnapshotRecord(target, "sovereigntyByFeatureId"),
    viewportTransform: Object.freeze({
      x: Number(getOwnDataPropertyValue(transformRecord, "x") ?? 0),
      y: Number(getOwnDataPropertyValue(transformRecord, "y") ?? 0),
      k: Number(getOwnDataPropertyValue(transformRecord, "k") ?? 1),
    }),
    viewportRenderSignature: getters.getViewportRenderSignature(),
    projectionRenderSignature: getters.getProjectionRenderSignature(),
    viewportGeoBounds: cloneDiagnosticValue(getters.getViewportGeoBounds()),
  });
}

export function captureRenderPerfMetricsState(target) {
  assertStateTarget(target);
  const metrics = getOwnDataPropertyValue(target, "renderPerfMetrics");
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return undefined;
  }
  return cloneDiagnosticValue(metrics);
}

export function captureRenderPerfContextBreakdownState(target) {
  assertStateTarget(target);
  const metrics = getOwnDataPropertyValue(target, "renderPerfMetrics");
  const breakdown = metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? getOwnDataPropertyValue(metrics, "contextBreakdown")
    : undefined;
  return breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)
    ? cloneDiagnosticValue(breakdown)
    : {};
}

export function captureRenderPerfMetricEntryState(target, name) {
  assertStateTarget(target);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new TypeError("[renderer_diagnostics_actions] name must be a non-empty string");
  }
  const metrics = getOwnDataPropertyValue(target, "renderPerfMetrics");
  const entry = metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? getOwnDataPropertyValue(metrics, normalizedName)
    : undefined;
  if (entry === undefined) return undefined;
  return cloneDiagnosticValue(entry);
}

export function captureProjectedBoundsDiagnosticsState(target) {
  assertStateTarget(target);
  const diagnostics = getOwnDataPropertyValue(target, "projectedBoundsDiagnostics");
  if (
    !diagnostics
    || typeof diagnostics !== "object"
    || Array.isArray(diagnostics)
  ) {
    return {
      total: 0,
      byGeometryType: {},
      byReason: {},
    };
  }
  return cloneDiagnosticValue(diagnostics);
}

export function captureRenderSnapshotState(target, getters) {
  assertStateTarget(target);
  return cloneRenderSnapshotState(target, getters);
}

export function ensureRenderPerfMetricsState(target) {
  assertStateTarget(target);
  if (!getOwnObjectPropertyValue(target, "renderPerfMetrics")) {
    writeRenderPerfMetricsOwnDataProperty(target, {});
  }
  return true;
}

export function replaceRenderPerfMetricsState(target, metrics) {
  assertStateTarget(target);
  if (
    metrics !== undefined
    && (
      !metrics
      || typeof metrics !== "object"
      || Array.isArray(metrics)
    )
  ) {
    throw new TypeError("[renderer_diagnostics_actions] metrics must be an object or undefined");
  }
  writeRenderPerfMetricsOwnDataProperty(target, metrics);
  return metrics;
}

export function setRenderPerfMetricEntryState(
  target,
  { name, entry } = {},
) {
  assertStateTarget(target);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new TypeError("[renderer_diagnostics_actions] name must be a non-empty string");
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("[renderer_diagnostics_actions] entry must be an object");
  }
  ensureRenderPerfMetricsState(target);
  const descriptor = assertOwnDataPropertyWritable(
    target.renderPerfMetrics,
    normalizedName,
    entry,
    `renderPerfMetrics.${normalizedName}`,
  );
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    Object.defineProperty(target.renderPerfMetrics, normalizedName, {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value") || !hasSameStateValue(descriptor.value, entry)) {
    target.renderPerfMetrics[normalizedName] = entry;
  }
  return entry;
}

export function setRenderPerfContextBreakdownState(target, breakdown = {}) {
  assertStateTarget(target);
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) {
    throw new TypeError("[renderer_diagnostics_actions] breakdown must be an object");
  }
  ensureRenderPerfMetricsState(target);
  const metrics = getOwnObjectPropertyValue(target, "renderPerfMetrics");
  writeRenderPerfContextBreakdownOwnDataProperty(metrics, breakdown);
  return breakdown;
}

export function commitRenderPerfMetricState(
  target,
  { name, entry, sequence } = {},
) {
  assertStateTarget(target);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new TypeError("[renderer_diagnostics_actions] name must be a non-empty string");
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("[renderer_diagnostics_actions] entry must be an object");
  }
  const nextSequence = Math.max(0, Number(sequence || 0));
  const existingMetrics = getOwnObjectPropertyValue(target, "renderPerfMetrics");
  const metrics = existingMetrics || {};
  if (existingMetrics) {
    const prototype = Object.getPrototypeOf(metrics);
    const metricDescriptor = Object.getOwnPropertyDescriptor(metrics, normalizedName);
    const sequenceDescriptor = Object.getOwnPropertyDescriptor(target, "renderPerfMetricSequence");
    if (
      (prototype === Object.prototype || prototype === null)
      && (metricDescriptor?.writable === true
        || (!(normalizedName in metrics) && Object.isExtensible(metrics)))
      && (sequenceDescriptor?.writable === true
        || (!("renderPerfMetricSequence" in target) && Object.isExtensible(target)))
    ) {
      metrics[normalizedName] = entry;
      target.renderPerfMetricSequence = nextSequence;
      return nextSequence;
    }
  }
  if (!existingMetrics) {
    assertOwnDataPropertyWritable(
      target,
      "renderPerfMetrics",
      metrics,
      "renderPerfMetrics",
    );
  }
  const metricDescriptor = assertOwnDataPropertyWritable(
    metrics,
    normalizedName,
    entry,
    `renderPerfMetrics.${normalizedName}`,
  );
  assertOwnDataPropertyWritable(target, "renderPerfMetricSequence", nextSequence, "renderPerfMetricSequence");
  if (!existingMetrics) {
    writeRenderPerfMetricsOwnDataProperty(target, metrics);
  }
  if (!metricDescriptor || !Object.hasOwn(metricDescriptor, "value")) {
    Object.defineProperty(target.renderPerfMetrics, normalizedName, {
      configurable: metricDescriptor?.configurable ?? true,
      enumerable: metricDescriptor?.enumerable ?? true,
      value: undefined,
      writable: true,
    });
  }
  if (
    !metricDescriptor
    || !Object.hasOwn(metricDescriptor, "value")
    || !hasSameStateValue(metricDescriptor.value, entry)
  ) {
    target.renderPerfMetrics[normalizedName] = entry;
  }
  writeRenderPerfMetricSequenceOwnDataProperty(target, nextSequence);
  return nextSequence;
}

export function setFirstVisibleFramePaintedState(target, painted) {
  assertStateTarget(target);
  const nextPainted = Boolean(painted);
  writeFirstVisibleFramePaintedOwnDataProperty(target, nextPainted);
  return nextPainted;
}

export function resetProjectedBoundsDiagnosticsState(
  target,
  diagnostics = {
    total: 0,
    byGeometryType: {},
    byReason: {},
  },
) {
  return setProjectedBoundsDiagnosticsState(target, diagnostics);
}

export function setProjectedBoundsDiagnosticsState(
  target,
  diagnostics,
) {
  assertStateTarget(target);
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    throw new TypeError("[renderer_diagnostics_actions] diagnostics must be an object");
  }
  writeProjectedBoundsDiagnosticsOwnDataProperty(target, diagnostics);
  return true;
}

export function setDebugCountryCoverageState(target, coverage = null) {
  assertStateTarget(target);
  writeDebugCountryCoverageOwnDataProperty(target, coverage);
  return coverage;
}
