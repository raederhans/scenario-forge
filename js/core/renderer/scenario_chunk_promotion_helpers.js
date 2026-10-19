import { getFeatureId } from "../feature_identity.js";

const POLITICAL_DERIVED_STATE_MISSING_SAMPLE_LIMIT = 8;

function getFeatureCollectionFeatures(payload) {
  return Array.isArray(payload?.features) ? payload.features : [];
}

function* collectFeatureIdSetSteps(features = []) {
  const ids = new Set();
  for (let index = 0, length = features.length; index < length; index += 1) {
    if (!(index in features)) {
      yield;
      continue;
    }
    const feature = features[index];
    const id = String(getFeatureId(feature) || feature?.id || feature?.properties?.id || "").trim();
    if (id) ids.add(id);
    yield;
  }
  return ids;
}

function* getMissingFeatureIdSampleSteps(completeFeatureIds, candidateFeatureIds) {
  const missing = [];
  for (const featureId of completeFeatureIds) {
    if (!candidateFeatureIds.has(featureId)) missing.push(featureId);
    yield;
    if (missing.length >= POLITICAL_DERIVED_STATE_MISSING_SAMPLE_LIMIT) break;
  }
  return missing;
}

export function analyzeScenarioPoliticalDerivedStateCoverage(runtimeState, options = {}) {
  const iterator = analyzeScenarioPoliticalDerivedStateCoverageSteps(runtimeState, options);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return next.value;
}

export async function analyzeScenarioPoliticalDerivedStateCoverageChunked(runtimeState, {
  isCurrent = () => true,
  yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
  nowMs = () => globalThis.performance?.now?.() ?? Date.now(),
  ...options
} = {}) {
  const iterator = analyzeScenarioPoliticalDerivedStateCoverageSteps(runtimeState, options);
  let yieldCount = 0;
  let maxSliceMs = 0;
  let steps = 0;
  let sliceStartedAt = nowMs();
  // Authority can change across yielded tasks, not between these private
  // synchronous steps. Check at slice/publication boundaries instead of
  // re-parsing renderer policy and revisions for every feature.
  let current = isCurrent();
  while (current) {
    const next = iterator.next();
    const sliceMs = Math.max(0, nowMs() - sliceStartedAt);
    maxSliceMs = Math.max(maxSliceMs, sliceMs);
    if (next.done) {
      if (!isCurrent()) break;
      return { status: "prepared", coverage: next.value, yieldCount, maxSliceMs };
    }
    if (++steps >= 400 || sliceMs >= 6) {
      if (!isCurrent()) break;
      yieldCount += 1;
      await yieldControl();
      current = isCurrent();
      sliceStartedAt = nowMs();
      steps = 0;
    }
  }
  iterator.return();
  return { status: "cancelled", coverage: null, yieldCount, maxSliceMs };
}

function* analyzeScenarioPoliticalDerivedStateCoverageSteps(runtimeState, {
  buildInteractiveLandData = null,
  coverageInputSnapshot = null,
  shouldExcludePoliticalVisualFeature = () => false,
} = {}) {
  const completeFeatures = getFeatureCollectionFeatures(runtimeState?.scenarioPoliticalChunkData);
  const primaryVisibleFeatures = getFeatureCollectionFeatures(runtimeState?.scenarioPoliticalVisibleChunkData);
  const landDataFeatures = getFeatureCollectionFeatures(runtimeState?.landData);
  const fullLandCollection = Array.isArray(runtimeState?.landDataFull?.features)
    ? runtimeState.landDataFull : runtimeState?.landData;
  const fullLandDataFeatures = getFeatureCollectionFeatures(fullLandCollection);
  const expectedInteractiveCollection = coverageInputSnapshot?.fullCollection === fullLandCollection
    && Array.isArray(coverageInputSnapshot?.expectedInteractiveCollection?.features)
    ? coverageInputSnapshot.expectedInteractiveCollection
    : (typeof buildInteractiveLandData === "function" ? buildInteractiveLandData(fullLandCollection) : null);
  const expectedInteractiveFeatures = getFeatureCollectionFeatures(expectedInteractiveCollection);
  const colorIds = new Set();
  const colors = runtimeState?.colors || {};
  for (const key in colors) {
    if (Object.hasOwn(colors, key)) {
      const id = String(key || "").trim();
      if (id) colorIds.add(id);
    }
    yield;
  }
  const completeFeatureIds = yield* collectFeatureIdSetSteps(completeFeatures);
  const requiredColorFeatures = [];
  for (let index = 0, length = completeFeatures.length; index < length; index += 1) {
    if (index in completeFeatures) {
      const feature = completeFeatures[index];
      if (!shouldExcludePoliticalVisualFeature(feature, getFeatureId(feature))) requiredColorFeatures.push(feature);
    }
    yield;
  }
  const requiredColorFeatureIds = yield* collectFeatureIdSetSteps(requiredColorFeatures);
  const primaryVisibleFeatureIds = yield* collectFeatureIdSetSteps(primaryVisibleFeatures);
  const landDataFeatureIds = yield* collectFeatureIdSetSteps(landDataFeatures);
  const fullLandDataFeatureIds = yield* collectFeatureIdSetSteps(fullLandDataFeatures);
  const expectedInteractiveFeatureIds = yield* collectFeatureIdSetSteps(expectedInteractiveFeatures);
  const completePoliticalFeatureCount = completeFeatures.length;
  const primaryVisibleFeatureCount = primaryVisibleFeatures.length;
  const landDataFeatureCount = landDataFeatures.length;
  const colorsCount = colorIds.size;
  let primaryVisibleFeatureSubsetActive = primaryVisibleFeatureCount > 0
    && completePoliticalFeatureCount > primaryVisibleFeatureCount;
  if (primaryVisibleFeatureSubsetActive) {
    for (const featureId of primaryVisibleFeatureIds) {
      if (!completeFeatureIds.has(featureId)) primaryVisibleFeatureSubsetActive = false;
      yield;
      if (!primaryVisibleFeatureSubsetActive) break;
    }
  }
  const missingFullLandFeatureIdsSample = completeFeatureIds.size > 0
    ? yield* getMissingFeatureIdSampleSteps(completeFeatureIds, fullLandDataFeatureIds)
    : [];
  const missingInteractiveFeatureIdsSample = yield* getMissingFeatureIdSampleSteps(expectedInteractiveFeatureIds, landDataFeatureIds);
  const missingLandFeatureIdsSample = [...new Set([
    ...missingFullLandFeatureIdsSample, ...missingInteractiveFeatureIdsSample,
  ])].slice(0, POLITICAL_DERIVED_STATE_MISSING_SAMPLE_LIMIT);
  const missingColorFeatureIdsSample = requiredColorFeatureIds.size > 0
    ? yield* getMissingFeatureIdSampleSteps(requiredColorFeatureIds, colorIds)
    : [];
  const fullLandDataCoverageMissing = missingFullLandFeatureIdsSample.length > 0;
  const interactiveLandDataCoverageMissing = missingInteractiveFeatureIdsSample.length > 0;
  const landDataCoverageMissing = fullLandDataCoverageMissing || interactiveLandDataCoverageMissing;
  const colorCoverageMissing = completeFeatureIds.size > 0
    && (
      colorsCount < requiredColorFeatureIds.size
      || missingColorFeatureIdsSample.length > 0
    );

  return {
    completePoliticalFeatureCount,
    primaryVisibleFeatureCount,
    landDataFeatureCount,
    fullLandDataFeatureCount: fullLandDataFeatures.length,
    expectedInteractiveFeatureCount: expectedInteractiveFeatures.length,
    interactiveCoverageChecked: !!expectedInteractiveCollection,
    colorsCount,
    requiredColorFeatureCount: requiredColorFeatureIds.size,
    primaryVisibleFeatureSubsetActive,
    landDataCoverageMissing,
    fullLandDataCoverageMissing,
    interactiveLandDataCoverageMissing,
    colorCoverageMissing,
    missingLandFeatureIdsSample,
    missingFullLandFeatureIdsSample,
    missingInteractiveFeatureIdsSample,
    missingColorFeatureIdsSample,
  };
}

function isPoliticalCoverageDiagnosticsEnabled(runtimeState) {
  if (runtimeState?.renderDiagnostics?.perfOverlayEnabled || runtimeState?.renderDiagnostics?.enabled) return true;
  if (runtimeState?.uiState?.developerMode) return true;
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    return params.has("render_diag") || params.has("perf_overlay");
  } catch (_error) {
    return false;
  }
}

function getScenarioChunkSelectionDiagnostics(runtimeState) {
  const loadState = runtimeState?.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
    ? runtimeState.runtimeChunkLoadState
    : {};
  const lastSelection = loadState.lastSelection && typeof loadState.lastSelection === "object"
    ? loadState.lastSelection
    : {};
  return {
    selectionVersion: Math.max(0, Number(loadState.selectionVersion || lastSelection.selectionVersion || 0)),
    requiredChunkIds: Array.isArray(lastSelection.requiredChunkIds) ? Array.from(lastSelection.requiredChunkIds) : [],
    cacheOnlyChunkIds: Array.isArray(lastSelection.cacheOnlyChunkIds) ? Array.from(lastSelection.cacheOnlyChunkIds) : [],
    retainedActiveChunkIds: Array.isArray(lastSelection.retainedActiveChunkIds) ? Array.from(lastSelection.retainedActiveChunkIds) : [],
  };
}

export function recordScenarioPoliticalDerivedStateCoverage({
  runtimeState,
  recordRenderPerfMetric,
  reason = "scenario-chunk-promotion",
  stage = "check",
  coverage,
  restoredFullPoliticalChunkData = false,
} = {}) {
  if (typeof recordRenderPerfMetric !== "function" || !coverage) return null;
  const shouldRecord = isPoliticalCoverageDiagnosticsEnabled(runtimeState)
    || coverage.primaryVisibleFeatureSubsetActive
    || coverage.landDataCoverageMissing
    || coverage.colorCoverageMissing
    || restoredFullPoliticalChunkData;
  if (!shouldRecord) return null;
  return recordRenderPerfMetric("scenarioPoliticalDerivedStateCoverage", 0, {
    reason: String(reason || "scenario-chunk-promotion"),
    stage: String(stage || "check"),
    completePoliticalFeatureCount: coverage.completePoliticalFeatureCount,
    primaryVisibleFeatureCount: coverage.primaryVisibleFeatureCount,
    landDataFeatureCount: coverage.landDataFeatureCount,
    fullLandDataFeatureCount: coverage.fullLandDataFeatureCount,
    expectedInteractiveFeatureCount: coverage.expectedInteractiveFeatureCount,
    interactiveCoverageChecked: coverage.interactiveCoverageChecked,
    colorsCount: coverage.colorsCount,
    requiredColorFeatureCount: coverage.requiredColorFeatureCount,
    primaryVisibleFeatureSubsetActive: !!coverage.primaryVisibleFeatureSubsetActive,
    landDataCoverageMissing: !!coverage.landDataCoverageMissing,
    fullLandDataCoverageMissing: !!coverage.fullLandDataCoverageMissing,
    interactiveLandDataCoverageMissing: !!coverage.interactiveLandDataCoverageMissing,
    colorCoverageMissing: !!coverage.colorCoverageMissing,
    missingLandFeatureIdsSample: coverage.missingLandFeatureIdsSample,
    missingFullLandFeatureIdsSample: coverage.missingFullLandFeatureIdsSample,
    missingInteractiveFeatureIdsSample: coverage.missingInteractiveFeatureIdsSample,
    missingColorFeatureIdsSample: coverage.missingColorFeatureIdsSample,
    restoredFullPoliticalChunkData: !!restoredFullPoliticalChunkData,
    ...getScenarioChunkSelectionDiagnostics(runtimeState),
  });
}

export function resolveScenarioChunkPromotionChangeSet({
  changedLayerKeys = [],
  politicalFeatureIds = [],
  hasPoliticalPayloadChange = false,
} = {}) {
  const normalizedChangedLayerKeys = (Array.isArray(changedLayerKeys) ? changedLayerKeys : [])
    .map((layerKey) => String(layerKey || "").trim().toLowerCase())
    .filter(Boolean);
  const hasAtlantropaLayerChange = normalizedChangedLayerKeys.includes("scenario_atlantropa");
  const hasPoliticalChange = !!hasPoliticalPayloadChange
    || hasAtlantropaLayerChange
    || (Array.isArray(politicalFeatureIds) && politicalFeatureIds.length > 0);
  const effectiveChangedLayerKeys = hasAtlantropaLayerChange
    ? Array.from(new Set([
      ...(Array.isArray(changedLayerKeys) ? changedLayerKeys : []),
      "water",
    ]))
    : changedLayerKeys;
  return {
    normalizedChangedLayerKeys,
    hasAtlantropaLayerChange,
    hasPoliticalChange,
    effectiveChangedLayerKeys,
  };
}

function toNonNegativeCount(value, defaultValue = 0) {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue >= 0) {
    return Math.max(0, numberValue);
  }
  return Math.max(0, Number(defaultValue) || 0);
}

export function readFirstNonNegativeCount(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue >= 0) return Math.max(0, numberValue);
  }
  return 0;
}

function normalizeStringSet(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizeLayerKeySet(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function normalizeResourceDescriptors(targetResources = [], resourceDescriptors = [], reason = "scenario-chunk-promotion") {
  if (Array.isArray(resourceDescriptors) && resourceDescriptors.length) {
    return resourceDescriptors
      .filter((descriptor) => descriptor && typeof descriptor === "object")
      .map((descriptor) => ({
        resource: String(descriptor.resource || descriptor.name || "").trim(),
        reason: String(descriptor.reason || reason || "scenario-chunk-promotion"),
      }))
      .filter((descriptor) => descriptor.resource);
  }
  return normalizeStringSet(targetResources).map((resource) => ({
    resource,
    reason: String(reason || "scenario-chunk-promotion"),
  }));
}

function normalizePayloadRef(payloadRef = null) {
  if (!payloadRef || typeof payloadRef !== "object") return null;
  return {
    kind: String(payloadRef.kind || "payload"),
    id: String(payloadRef.id || payloadRef.key || ""),
    featureCount: toNonNegativeCount(payloadRef.featureCount),
    byteCount: toNonNegativeCount(payloadRef.byteCount),
    pathCost: toNonNegativeCount(payloadRef.pathCost),
  };
}

function normalizePayloadRefs(payloadRefs = []) {
  return (Array.isArray(payloadRefs) ? payloadRefs : [])
    .map((payloadRef) => normalizePayloadRef(payloadRef))
    .filter(Boolean);
}

function normalizeMetricValue(value, key = "metric") {
  if (value == null) return 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value !== "number") {
    throw new TypeError(`promotionDelta.metrics.${key} must be a primitive metric value`);
  }
  return toNonNegativeCount(value);
}

function normalizeMetricObject(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics && typeof metrics === "object" ? metrics : {})
    .map(([key, value]) => [String(key || "").trim(), normalizeMetricValue(value, key)])
    .filter(([key]) => key));
}

function isPlainPromotionDeltaObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPromotionDeltaPureValue(value, path = "promotionDelta") {
  if (value == null) return true;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return true;
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`);
    }
    return true;
  }
  if (valueType === "function" || valueType === "symbol" || valueType === "bigint" || valueType === "undefined") {
    throw new TypeError(`${path} must be a JSON-like value`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPromotionDeltaPureValue(entry, `${path}[${index}]`));
    return true;
  }
  if (!isPlainPromotionDeltaObject(value)) {
    throw new TypeError(`${path} must contain only plain objects, arrays, and primitives`);
  }
  Object.entries(value).forEach(([key, entry]) => {
    assertPromotionDeltaPureValue(entry, `${path}.${key}`);
  });
  return true;
}

export function createScenarioChunkPromotionDelta({
  kind = "scenario-chunk-promotion",
  scenarioId = "",
  selectionVersion = 0,
  reason = "scenario-chunk-promotion",
  runId = 0,
  changedLayerKeys = [],
  targetResources = [],
  resourceDescriptors = [],
  dataRevisionLayers = changedLayerKeys,
  renderVisibleLayers = changedLayerKeys,
  interactionAuthorityLayers = changedLayerKeys,
  politicalPayloadRef = null,
  primaryPoliticalPayloadRef = null,
  optionalLayerPayloadRefs = [],
  infraTasks = [],
  visualTasks = [],
  metrics = {},
} = {}) {
  const normalizedTargetResources = normalizeStringSet(targetResources);
  const delta = {
    kind: String(kind || "scenario-chunk-promotion"),
    identity: {
      kind: String(kind || "scenario-chunk-promotion"),
      scenarioId: String(scenarioId || ""),
      selectionVersion: toNonNegativeCount(selectionVersion),
      reason: String(reason || "scenario-chunk-promotion"),
      runId: toNonNegativeCount(runId),
    },
    resources: {
      targetResources: normalizedTargetResources,
      resourceDescriptors: normalizeResourceDescriptors(normalizedTargetResources, resourceDescriptors, reason),
    },
    domainLayers: {
      dataRevisionLayers: normalizeLayerKeySet(dataRevisionLayers),
      renderVisibleLayers: normalizeLayerKeySet(renderVisibleLayers),
      interactionAuthorityLayers: normalizeLayerKeySet(interactionAuthorityLayers),
    },
    payloadRefs: {
      politicalPayloadRef: normalizePayloadRef(politicalPayloadRef),
      primaryPoliticalPayloadRef: normalizePayloadRef(primaryPoliticalPayloadRef),
      optionalLayerPayloadRefs: normalizePayloadRefs(optionalLayerPayloadRefs),
    },
    sideEffects: {
      infraTasks: normalizeStringSet(infraTasks),
      visualTasks: normalizeStringSet(visualTasks),
    },
    metrics: normalizeMetricObject(metrics),
  };
  assertPromotionDeltaPureValue(delta);
  return delta;
}

export function createDrawSubsetIndex({
  scenarioId = "",
  scenarioDataGeneration = 0,
  subsetSignature = "",
  primaryDrawFeatureIds = null,
  visibleFeatureIndexesByChunkId = null,
  knownFeatureIds = null,
  chunkFeatureCounts = null,
} = {}) {
  const knownFeatureSet = knownFeatureIds instanceof Set
    ? knownFeatureIds
    : (Array.isArray(knownFeatureIds) ? new Set(normalizeStringSet(knownFeatureIds)) : null);
  const rawFeatureIds = Array.isArray(primaryDrawFeatureIds) ? primaryDrawFeatureIds : null;
  let duplicateFeatureIdCount = 0;
  let unknownFeatureIdCount = 0;
  const seenFeatureIds = new Set();
  const normalizedFeatureIds = [];
  if (rawFeatureIds) {
    rawFeatureIds.forEach((value) => {
      const featureId = String(value || "").trim();
      if (!featureId) return;
      if (seenFeatureIds.has(featureId)) {
        duplicateFeatureIdCount += 1;
        return;
      }
      seenFeatureIds.add(featureId);
      if (knownFeatureSet && !knownFeatureSet.has(featureId)) {
        unknownFeatureIdCount += 1;
        return;
      }
      normalizedFeatureIds.push(featureId);
    });
  }

  const normalizedIndexesByChunkId = {};
  let duplicateIndexCount = 0;
  let outOfRangeIndexCount = 0;
  const rawIndexesByChunkId = visibleFeatureIndexesByChunkId && typeof visibleFeatureIndexesByChunkId === "object"
    ? visibleFeatureIndexesByChunkId
    : null;
  if (rawIndexesByChunkId) {
    Object.entries(rawIndexesByChunkId).forEach(([chunkId, rawIndexes]) => {
      const normalizedChunkId = String(chunkId || "").trim();
      if (!normalizedChunkId || !Array.isArray(rawIndexes)) return;
      const hasKnownFeatureCount = Object.hasOwn(chunkFeatureCounts || {}, normalizedChunkId);
      const maxFeatureCount = hasKnownFeatureCount
        ? Math.max(0, Number(chunkFeatureCounts?.[normalizedChunkId] || 0))
        : 0;
      const seenIndexes = new Set();
      const indexes = [];
      rawIndexes.forEach((value) => {
        const index = Number(value);
        if (!Number.isInteger(index) || index < 0 || (hasKnownFeatureCount && index >= maxFeatureCount)) {
          outOfRangeIndexCount += 1;
          return;
        }
        if (seenIndexes.has(index)) {
          duplicateIndexCount += 1;
          return;
        }
        seenIndexes.add(index);
        indexes.push(index);
      });
      if (indexes.length) {
        normalizedIndexesByChunkId[normalizedChunkId] = indexes;
      }
    });
  }

  const hasFeatureIds = normalizedFeatureIds.length > 0;
  const hasChunkIndexes = Object.keys(normalizedIndexesByChunkId).length > 0;
  if (!hasFeatureIds && !hasChunkIndexes) return null;
  return {
    scenarioId: String(scenarioId || ""),
    scenarioDataGeneration: Math.max(0, Number(scenarioDataGeneration || 0)),
    subsetSignature: String(subsetSignature || ""),
    ...(hasFeatureIds ? { primaryDrawFeatureIds: normalizedFeatureIds } : {}),
    ...(hasChunkIndexes ? { visibleFeatureIndexesByChunkId: normalizedIndexesByChunkId } : {}),
    diagnostics: {
      duplicateFeatureIdCount,
      unknownFeatureIdCount,
      duplicateIndexCount,
      outOfRangeIndexCount,
    },
  };
}

export function isDrawSubsetIndexCurrent(drawSubsetIndex, {
  scenarioId = "",
  scenarioDataGeneration = 0,
} = {}) {
  if (!drawSubsetIndex || typeof drawSubsetIndex !== "object") return false;
  return String(drawSubsetIndex.scenarioId || "") === String(scenarioId || "")
    && Math.max(0, Number(drawSubsetIndex.scenarioDataGeneration || 0)) === Math.max(0, Number(scenarioDataGeneration || 0));
}

export function buildScenarioChunkPromotionVisualMetricDetails({
  activeScenarioId = "",
  reason = "scenario-chunk-promotion",
  runtimeChunkLoadState = null,
  pendingVisualPromotion = null,
  pendingPromotion = null,
  promotionQueuedAt = 0,
  startedAt = 0,
  suppressRender = false,
  hasPoliticalChange = false,
  promotedTotalFeatureCount = 0,
  promotedPrimaryFeatureCount = 0,
  promotedVisibleFeatureCount = 0,
  effectiveChangedLayerKeys = [],
  promotionVersion = 0,
  synchronizedSecondaryRegionIndexes = false,
} = {}) {
  const primaryTotalFeatureCount = toNonNegativeCount(
    pendingVisualPromotion?.primaryTotalFeatureCount ?? pendingPromotion?.primaryTotalFeatureCount,
    promotedTotalFeatureCount,
  );
  const primaryVisibleFeatureCount = toNonNegativeCount(
    pendingVisualPromotion?.primaryVisibleFeatureCount ?? pendingPromotion?.primaryVisibleFeatureCount,
    promotedPrimaryFeatureCount,
  );
  const fullPoliticalPayloadFeatureCount = toNonNegativeCount(promotedTotalFeatureCount);
  const viewportVisibleSubsetFeatureCount = toNonNegativeCount(primaryVisibleFeatureCount, promotedVisibleFeatureCount);
  return {
    activeScenarioId: String(activeScenarioId || ""),
    reason: String(reason || "scenario-chunk-promotion"),
    selectionVersion: Math.max(0, Number(pendingVisualPromotion?.selectionVersion || pendingPromotion?.selectionVersion || runtimeChunkLoadState?.selectionVersion || 0)),
    requiredPoliticalChunkCount: Math.max(0, Number(pendingPromotion?.requiredPoliticalChunkCount || 0)),
    requiredChunkCount: Array.isArray(pendingVisualPromotion?.requiredChunkIds)
      ? pendingVisualPromotion.requiredChunkIds.length
      : 0,
    queuedAt: promotionQueuedAt,
    queueMs: promotionQueuedAt > 0 ? Math.max(0, startedAt - promotionQueuedAt) : 0,
    promotionRetryCount: Math.max(0, Number(runtimeChunkLoadState?.promotionRetryCount || 0)),
    renderNow: !suppressRender,
    hasPoliticalGeometryChange: hasPoliticalChange,
    suppressRender: !!suppressRender,
    promotedFeatureCount: promotedTotalFeatureCount,
    promotedPrimaryFeatureCount,
    promotedVisibleFeatureCount,
    promotedTotalFeatureCount,
    selectedVisibleFeatureCountSum: Math.max(0, Number(pendingVisualPromotion?.selectedVisibleFeatureCountSum || pendingPromotion?.selectedVisibleFeatureCountSum || 0)),
    selectedPoliticalFeatureCountSum: Math.max(0, Number(pendingVisualPromotion?.selectedPoliticalFeatureCountSum || pendingPromotion?.selectedPoliticalFeatureCountSum || 0)),
    selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(pendingVisualPromotion?.selectedPoliticalVisibleFeatureCountSum || pendingPromotion?.selectedPoliticalVisibleFeatureCountSum || 0)),
    primaryTotalFeatureCount,
    primaryVisibleFeatureCount,
    fullPoliticalPayloadFeatureCount,
    viewportVisibleSubsetFeatureCount,
    primaryVisibleIsSubset: primaryTotalFeatureCount > 0 && primaryVisibleFeatureCount < primaryTotalFeatureCount,
    promotedVisibleIsSubset: fullPoliticalPayloadFeatureCount > 0 && toNonNegativeCount(promotedVisibleFeatureCount) < fullPoliticalPayloadFeatureCount,
    selectedByteCountSum: Math.max(0, Number(pendingVisualPromotion?.selectedByteCountSum || pendingPromotion?.selectedByteCountSum || 0)),
    selectedEstimatedPathCostSum: Math.max(0, Number(pendingVisualPromotion?.selectedEstimatedPathCostSum || pendingPromotion?.selectedEstimatedPathCostSum || 0)),
    changedLayerCount: Array.isArray(effectiveChangedLayerKeys) ? effectiveChangedLayerKeys.length : 0,
    promotionVersion,
    synchronizedSecondaryRegionIndexes,
  };
}

export {
  assertPromotionDeltaPureValue,
};
