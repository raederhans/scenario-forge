import { getFeatureId } from "../feature_identity.js";

const POLITICAL_DERIVED_STATE_MISSING_SAMPLE_LIMIT = 8;

function getFeatureCollectionFeatures(payload) {
  return Array.isArray(payload?.features) ? payload.features : [];
}

function collectFeatureIdSet(features = []) {
  return new Set(
    (Array.isArray(features) ? features : [])
      .map((feature) => String(getFeatureId(feature) || feature?.id || feature?.properties?.id || "").trim())
      .filter(Boolean)
  );
}

function getMissingFeatureIdSample(completeFeatureIds, candidateFeatureIds) {
  const missing = [];
  completeFeatureIds.forEach((featureId) => {
    if (missing.length >= POLITICAL_DERIVED_STATE_MISSING_SAMPLE_LIMIT) return;
    if (!candidateFeatureIds.has(featureId)) {
      missing.push(featureId);
    }
  });
  return missing;
}

export function analyzeScenarioPoliticalDerivedStateCoverage(runtimeState) {
  const completeFeatures = getFeatureCollectionFeatures(runtimeState?.scenarioPoliticalChunkData);
  const primaryVisibleFeatures = getFeatureCollectionFeatures(runtimeState?.scenarioPoliticalVisibleChunkData);
  const landDataFeatures = getFeatureCollectionFeatures(runtimeState?.landData);
  const colorIds = new Set(Object.keys(runtimeState?.colors || {}).map((featureId) => String(featureId || "").trim()).filter(Boolean));
  const completeFeatureIds = collectFeatureIdSet(completeFeatures);
  const primaryVisibleFeatureIds = collectFeatureIdSet(primaryVisibleFeatures);
  const landDataFeatureIds = collectFeatureIdSet(landDataFeatures);
  const completePoliticalFeatureCount = completeFeatures.length;
  const primaryVisibleFeatureCount = primaryVisibleFeatures.length;
  const landDataFeatureCount = landDataFeatures.length;
  const colorsCount = colorIds.size;
  const primaryVisibleFeatureSubsetActive = primaryVisibleFeatureCount > 0
    && completePoliticalFeatureCount > primaryVisibleFeatureCount
    && (
      primaryVisibleFeatureIds.size <= 0
      || Array.from(primaryVisibleFeatureIds).every((featureId) => completeFeatureIds.has(featureId))
    );
  const missingLandFeatureIdsSample = completeFeatureIds.size > 0
    ? getMissingFeatureIdSample(completeFeatureIds, landDataFeatureIds)
    : [];
  const missingColorFeatureIdsSample = completeFeatureIds.size > 0
    ? getMissingFeatureIdSample(completeFeatureIds, colorIds)
    : [];
  const landDataCoverageMissing = completePoliticalFeatureCount > 0
    && (
      landDataFeatureCount < completePoliticalFeatureCount
      || missingLandFeatureIdsSample.length > 0
    );
  const colorCoverageMissing = completePoliticalFeatureCount > 0
    && (
      colorsCount < completePoliticalFeatureCount
      || missingColorFeatureIdsSample.length > 0
    );

  return {
    completePoliticalFeatureCount,
    primaryVisibleFeatureCount,
    landDataFeatureCount,
    colorsCount,
    primaryVisibleFeatureSubsetActive,
    landDataCoverageMissing,
    colorCoverageMissing,
    missingLandFeatureIdsSample,
    missingColorFeatureIdsSample,
  };
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
