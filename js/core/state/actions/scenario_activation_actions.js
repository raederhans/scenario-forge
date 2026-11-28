import { restoreScenarioFields, validateScenarioSnapshot } from "./scenario_snapshot.js";
import { normalizeRiverPaintState } from "../../river_paint/partition_model.js";
import { applyFeaturePaintState } from "../color_state.js";
import { createReadonlyReferenceAssignments } from "../../map_data_boundary.js";
import { getParentMergedParents } from "../../renderer/parent_merged_presentation.js";
// Canonical scenario activation state authority.
// Rendering, observers, rollback orchestration, and recovery stay outside this module.

import { commitSpecialZoneLayersState } from "./special_zone_actions.js";
import { SCENARIO_BUNDLE_CACHE_LIMIT, getScenarioChunkPayloadEvictionIds } from "../../scenario/bundle_cache_policy.js";

export function applyPaletteFeatureColorState(target, featureIds, color) {
  applyFeaturePaintState(target, featureIds, color);
}

export function applyPaletteOwnerColorState(target, ownerCode, color) {
  target.sovereignBaseColors = target.sovereignBaseColors || {};
  target.sovereignBaseColors[ownerCode] = color;
}

// Only scenario countries take part: ISO aliases (DE for GER) share their
// country's color on purpose. Preferred (fixed) colors keep their value.
export function uniquifyScenarioDefaultColors(colors, { tags = null, preferred = [], deferred = new Set() } = {}) {
  const result = { ...colors };
  const normalize = color => String(color).trim().toLowerCase();
  const isHex = color => /^#[0-9a-f]{6}$/.test(normalize(color));
  const used = new Set(Object.values(colors).map(normalize));
  const seen = new Set();
  const eligible = Object.keys(colors).filter(tag => isHex(colors[tag]) && (!tags || tags.has(tag)));
  const first = new Set(preferred);
  const ordered = [
    ...eligible.filter(tag => !deferred.has(tag) && first.has(tag)).sort(),
    ...eligible.filter(tag => !deferred.has(tag) && !first.has(tag)).sort(),
    ...eligible.filter(tag => deferred.has(tag)).sort(),
  ];
  for (const tag of ordered) {
    const color = normalize(colors[tag]);
    if (!seen.has(color)) { seen.add(color); continue; }
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    let replacement;
    for (let distance = 1; !replacement; distance++) {
      for (let channel = 2; channel >= 0 && !replacement; channel--) {
        for (const delta of [distance, -distance]) {
          if (rgb[channel] + delta < 0 || rgb[channel] + delta > 255) continue;
          const candidate = rgb.map((value, index) => value + (index === channel ? delta : 0));
          const hex = `#${candidate.map(value => value.toString(16).padStart(2, '0')).join('')}`;
          if (!used.has(hex)) { replacement = hex; break; }
        }
      }
    }
    result[tag] = replacement;
    used.add(replacement);
  }
  return result;
}

export function getScenarioCountryTags(countriesByTag) {
  if (countriesByTag instanceof Map) return new Set(countriesByTag.keys());
  return countriesByTag && typeof countriesByTag === "object" ? new Set(Object.keys(countriesByTag)) : null;
}

export function trimScenarioBundleCacheState(target, recencyOrder, targetId) {
  // The caller retains its Map identity; only a short string-ID order crosses
  // this write boundary. Published bundles are never copied.
  const recency = new Map(JSON.parse(JSON.stringify(recencyOrder)).map(id => [String(id), true]));
  const cache = target.scenarioBundleCacheById || {};
  let cacheSize = Object.keys(cache).length;
  for (const id of recency.keys()) if (!cache[id]) recency.delete(id);
  for (const id of Object.keys(cache)) if (!recency.has(id)) recency.set(id, true);
  recency.delete(String(targetId));
  recency.set(String(targetId), true);
  // An apply can still need the outgoing bundle for rollback. Defer trimming
  // until a subsequent load/cache hit outside that transaction.
  if (target.scenarioApplyInFlight) return Array.from(recency.keys());
  for (const id of recency.keys()) {
    const bundle = cache[id];
    if (id === targetId || id === String(target.activeScenarioId || "").trim()) continue;
    if ((bundle?.deferredMetadataLoadPromise && !bundle.deferredMetadataLoadSettled)
      || Object.values(bundle?.optionalLayerPromises || {}).some(Boolean)
      || Object.values(bundle?.chunkPayloadPromisesById || {}).some(Boolean)) continue;
    if (!bundle) continue;
    clearScenarioBundleChunkProtectionState(target, id);
    for (const chunkId of getScenarioChunkPayloadEvictionIds(target.scenarioBundleCacheById[id], [], { preferPoliticalBase: true })) {
      removeScenarioBundleChunkPayloadState(target, id, chunkId);
    }
    if (cacheSize <= SCENARIO_BUNDLE_CACHE_LIMIT) continue;
    removeScenarioBundleCacheEntryState(target, id);
    cacheSize -= 1;
    recency.delete(id);
  }
  return Array.from(recency.keys());
}

// Published cache writes share the authority used for bundle payload publication.
export function clearScenarioBundleChunkProtectionState(target, scenarioId) {
  assertStateTarget(target);
  const id = String(scenarioId || "");
  if (!Object.hasOwn(target.scenarioBundleCacheById || {}, id)) return false;
  target.scenarioBundleCacheById[id].chunkPayloadProtectedIds = [];
  return true;
}

export function removeScenarioBundleChunkPayloadState(target, scenarioId, chunkId) {
  assertStateTarget(target);
  const id = String(scenarioId || "");
  const key = String(chunkId || "");
  if (!Object.hasOwn(target.scenarioBundleCacheById || {}, id)
    || !Object.hasOwn(target.scenarioBundleCacheById[id].chunkPayloadCacheById || {}, key)) return false;
  delete target.scenarioBundleCacheById[id].chunkPayloadCacheById[key];
  return true;
}

export function removeScenarioBundleCacheEntryState(target, scenarioId) {
  assertStateTarget(target);
  const id = String(scenarioId || "");
  if (!Object.hasOwn(target.scenarioBundleCacheById || {}, id)) return false;
  delete target.scenarioBundleCacheById[id];
  return true;
}

// Request timing stays in the loader; published bundle payloads use this authority.
export function commitScenarioOptionalLayerPayloadState(target, scenarioId, layerKey, payloadField, payload, settled = true) {
  assertStateTarget(target);
  const id = String(scenarioId || "");
  const key = String(layerKey || "");
  const field = String(payloadField || "");
  const cache = target.scenarioBundleCacheById;
  if (!cache || !Object.hasOwn(cache, id)) return false;
  const bundle = cache[id];
  if (!bundle || typeof bundle !== "object") return false;
  const fields = {
    water: "waterRegionsPayload", special: "specialRegionsPayload",
    scenario_atlantropa: "scenarioAtlantropaPayload", specialzonelayers: "specialZoneLayersPayload",
    relief: "reliefOverlaysPayload", cities: "cityOverridesPayload", strategicvalues: "strategicValuesPayload",
    erarailways: "eraRailwaysPayload",
  };
  if (!Object.hasOwn(fields, key) || fields[key] !== field) return false;
  target.scenarioBundleCacheById[id][field] = payload;
  if (settled) target.scenarioBundleCacheById[id].optionalLayerSettledByKey[key] = true;
  else delete target.scenarioBundleCacheById[id].optionalLayerSettledByKey[key];
  return true;
}

export const SCENARIO_ACTIVATION_STATE_KEYS = Object.freeze([
  "activeScenarioId",
  "scenarioBorderMode",
  "activeScenarioManifest",
  "mapSemanticMode",
  "scenarioCountriesByTag",
  "activeScenarioMeshPack",
  "scenarioRuntimeTopologyData",
  "runtimePoliticalTopology",
  "runtimePoliticalMetaSeed",
  "runtimePoliticalFeatureCollectionSeed",
  "scenarioLandMaskData",
  "scenarioContextLandMaskData",
  "scenarioWaterRegionsData",
  "scenarioAtlantropaData",
  "scenarioRuntimeTopologyVersionTag",
  "scenarioLandMaskVersionTag",
  "scenarioContextLandMaskVersionTag",
  "scenarioWaterOverlayVersionTag",
  "scenarioSpecialRegionsData",
  "scenarioReliefOverlaysData",
  "scenarioEraRailwaysData",
  "scenarioReliefOverlayRevision",
  "scenarioEraRailwaysRevision",
  "scenarioStrategicValuesData",
  "scenarioStrategicValuesRevision",
  "scenarioDistrictGroupsData",
  "scenarioDistrictGroupByFeatureId",
  "releasableCatalog",
  "scenarioReleasableIndex",
  "scenarioAudit",
  "scenarioImportAudit",
  "scenarioBaselineHash",
  "scenarioBaselineOwnersByFeatureId",
  "scenarioAutoShellOwnerByFeatureId",
  "scenarioBaselineCoresByFeatureId",
  "scenarioShellOverlayRevision",
  "countryNames",
  "sovereigntyByFeatureId",
  "sovereigntyInitialized",
  "visualOverrides",
  "capitalOverrides",
  "politicalOverrides",
  "politicalAlliances",
  "projectCities",
  "cityNameOverrides",
  "riverPaint",
  "scenarioGeneratedColorTags",
  "scenarioFixedOwnerColors",
  "sovereignBaseColors",
]);

export const SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS = Object.freeze({
  water: Object.freeze({ stateField: "scenarioWaterRegionsData", revisionField: "" }),
  special: Object.freeze({ stateField: "scenarioSpecialRegionsData", revisionField: "" }),
  scenario_atlantropa: Object.freeze({ stateField: "scenarioAtlantropaData", revisionField: "scenarioAtlantropaRevision" }),
  specialzonelayers: Object.freeze({ stateField: "specialZoneLayers", revisionField: "" }),
  relief: Object.freeze({ stateField: "scenarioReliefOverlaysData", revisionField: "scenarioReliefOverlayRevision" }),
  erarailways: Object.freeze({ stateField: "scenarioEraRailwaysData", revisionField: "scenarioEraRailwaysRevision" }),
  cities: Object.freeze({ stateField: "scenarioCityOverridesData", revisionField: "cityLayerRevision" }),
  strategicvalues: Object.freeze({ stateField: "scenarioStrategicValuesData", revisionField: "scenarioStrategicValuesRevision" }),
});

const hasOwn = (target, key) =>
  Object.hasOwn(target, key);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[scenario_activation_actions] target must be an object");
  }
}

export function removeClickCountryColorsState(target, countryCode) {
  assertStateTarget(target);
  const normalizedCode = String(countryCode || "").trim();
  if (!normalizedCode) return false;
  const nextSovereignColors = structuredClone(target.sovereignBaseColors || {});
  const removedSovereign = Object.hasOwn(nextSovereignColors, normalizedCode);
  delete nextSovereignColors[normalizedCode];
  target.sovereignBaseColors = nextSovereignColors;
  return removedSovereign;
}

export function setClickCountryColorsState(target, countryCode, color) {
  assertStateTarget(target);
  const normalizedCode = String(countryCode || "").trim();
  if (!normalizedCode) return false;
  const nextSovereignColors = structuredClone(target.sovereignBaseColors || {});
  nextSovereignColors[normalizedCode] = color;
  target.sovereignBaseColors = nextSovereignColors;
  return true;
}

function getOptionalLayerConfig(layerKey) {
  const normalizedLayerKey = String(layerKey || "").trim();
  const config = SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS[normalizedLayerKey];
  if (!config) throw new Error(`unknown scenario chunk optional layer: ${normalizedLayerKey}`);
  return { layerKey: normalizedLayerKey, config };
}

export function getScenarioChunkOptionalLayerState(target, layerKey) {
  assertStateTarget(target);
  const { config: { stateField } } = getOptionalLayerConfig(layerKey);
  return stateField ? target[stateField] : undefined;
}

export function applyScenarioChunkOptionalLayerState(target, layerKey, payload) {
  assertStateTarget(target);
  const { layerKey: normalizedLayerKey, config } = getOptionalLayerConfig(layerKey);
  const { stateField, revisionField } = config;
  const changed = !!stateField && target[stateField] !== payload;
  if (normalizedLayerKey === "cities") {
    return {
      changed,
      externalEffect: {
        type: "scenario-city-overrides",
        payload,
        finalizerToken: null,
      },
    };
  }
  if (changed) {
    if (normalizedLayerKey === "specialzonelayers") {
      commitSpecialZoneLayersState(target, payload, {}, { markDirty: false, preserveIdentity: true });
    } else {
      target[stateField] = payload;
      if (revisionField) {
        target[revisionField] = Math.max(0, Number(target[revisionField]) || 0) + 1;
      }
    }
  }
  return { changed, externalEffect: null };
}

export function captureScenarioChunkPromotionState(target, layerKeys = []) {
  assertStateTarget(target);
  const requestedLayers = (Array.isArray(layerKeys) ? layerKeys : [])
    .map((layerKey) => getOptionalLayerConfig(layerKey));
  const capturesSpecialZoneLayers = requestedLayers.some(
    ({ layerKey }) => layerKey === "specialzonelayers",
  );
  const specialZoneField = SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS.specialzonelayers.stateField;
  const specialZoneLayersReferencePresent = capturesSpecialZoneLayers
    && hasOwn(target, specialZoneField);
  const specialZoneLayersReference = capturesSpecialZoneLayers
    ? target[specialZoneField]
    : undefined;
  const entries = requestedLayers.map(({ layerKey: normalizedLayerKey, config }) => {
    const { stateField, revisionField } = config;
    const statePresent = normalizedLayerKey === "specialzonelayers"
      ? specialZoneLayersReferencePresent
      : stateField && hasOwn(target, stateField);
    const stateValue = normalizedLayerKey === "specialzonelayers"
      ? specialZoneLayersReference
      : stateField && target[stateField];
    const entry = {
      layerKey: normalizedLayerKey,
      statePresent,
      stateValue,
      revisionPresent: !!revisionField && hasOwn(target, revisionField),
      revisionValue: revisionField ? target[revisionField] : undefined,
    };
    Object.defineProperties(entry, {
      specialZoneLayersReference: {
        value: specialZoneLayersReference,
      },
      specialZoneLayersReferencePresent: {
        value: specialZoneLayersReferencePresent,
      },
    });
    return Object.freeze(entry);
  });
  return Object.freeze(entries);
}

export function restoreScenarioChunkPromotionState(target, snapshot) {
  assertStateTarget(target);
  const externalEffects = [];
  const specialZoneLayersReference = snapshot?.[0]?.specialZoneLayersReference;
  const specialZoneLayersReferencePresent =
    snapshot?.[0]?.specialZoneLayersReferencePresent === true;
  for (const entry of Array.isArray(snapshot) ? snapshot : []) {
    const layerKey = entry?.layerKey;
    if (layerKey === "cities") {
      externalEffects[externalEffects.length] = {
        type: "scenario-city-overrides",
        payload: entry.statePresent ? entry.stateValue : null,
        finalizerToken: {
          type: "scenario-city-restore-finalizer",
          statePresent: entry.statePresent === true,
          stateValue: entry.stateValue,
          revisionPresent: entry.revisionPresent === true,
          revisionValue: entry.revisionValue,
        },
      };
      continue;
    }
    if (typeof layerKey !== "string" || !hasOwn(SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS, layerKey)) {
      throw new Error(`unknown scenario chunk optional layer: ${layerKey || ""}`);
    }
    const { stateField, revisionField } = SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS[layerKey];
    if (!entry.statePresent) {
      delete target[stateField];
    } else if (layerKey === "specialzonelayers") {
      commitSpecialZoneLayersState(
        target,
        specialZoneLayersReferencePresent ? specialZoneLayersReference : structuredClone(entry.stateValue),
        {},
        { markDirty: false, preserveIdentity: true },
      );
    } else {
      target[stateField] = entry.stateValue;
    }
    if (revisionField) {
      if (entry.revisionPresent) target[revisionField] = entry.revisionValue;
      else delete target[revisionField];
    }
  }
  return { externalEffects };
}

function validateCompletePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[scenario_activation_actions] patch must be an object");
  }
  for (const key of SCENARIO_ACTIVATION_STATE_KEYS) {
    if (!hasOwn(patch, key)) {
      throw new Error(
        `[scenario_activation_actions] commitScenarioActivationState missing required key: ${key}`,
      );
    }
  }
  if (!hasOwn(patch, "useDefaultRuntimePoliticalTopology")) {
    throw new Error(
      "[scenario_activation_actions] commitScenarioActivationState missing required key: useDefaultRuntimePoliticalTopology",
    );
  }
  if (typeof patch.useDefaultRuntimePoliticalTopology !== "boolean") {
    throw new TypeError(
      "[scenario_activation_actions] useDefaultRuntimePoliticalTopology must be a boolean",
    );
  }
}

function validateSnapshot(snapshot) {
  return validateScenarioSnapshot(snapshot, SCENARIO_ACTIVATION_STATE_KEYS,
    "scenario_activation_actions", "restoreScenarioActivationState");
}

export function captureScenarioActivationState(target) {
  assertStateTarget(target);
  const presentKeys = SCENARIO_ACTIVATION_STATE_KEYS.filter((key) =>
    hasOwn(target, key)
  );
  const values = Object.fromEntries(
    SCENARIO_ACTIVATION_STATE_KEYS.map((key) => [key, target[key]]),
  );
  return Object.freeze({
    values: Object.freeze(values),
    presentKeys: Object.freeze(presentKeys),
  });
}

export function commitScenarioActivationState(target, patch) {
  assertStateTarget(target);
  validateCompletePatch(patch);
  const riverPaint = normalizeRiverPaintState(structuredClone(patch.riverPaint));
  target.activeScenarioId = patch.activeScenarioId;
  target.scenarioBorderMode = patch.scenarioBorderMode;
  target.activeScenarioManifest = patch.activeScenarioManifest;
  target.mapSemanticMode = patch.mapSemanticMode;
  target.scenarioCountriesByTag = patch.scenarioCountriesByTag;
  target.activeScenarioMeshPack = patch.activeScenarioMeshPack;
  target.scenarioRuntimeTopologyData = patch.scenarioRuntimeTopologyData;
  target.runtimePoliticalTopology = patch.useDefaultRuntimePoliticalTopology
    ? (target.defaultRuntimePoliticalTopology || null)
    : patch.runtimePoliticalTopology;
  target.runtimePoliticalMetaSeed = patch.runtimePoliticalMetaSeed;
  target.runtimePoliticalFeatureCollectionSeed =
    patch.runtimePoliticalFeatureCollectionSeed;
  target.scenarioLandMaskData = patch.scenarioLandMaskData;
  target.scenarioContextLandMaskData = patch.scenarioContextLandMaskData;
  target.scenarioWaterRegionsData = patch.scenarioWaterRegionsData;
  target.scenarioAtlantropaData = patch.scenarioAtlantropaData;
  target.scenarioRuntimeTopologyVersionTag =
    patch.scenarioRuntimeTopologyVersionTag;
  target.scenarioLandMaskVersionTag = patch.scenarioLandMaskVersionTag;
  target.scenarioContextLandMaskVersionTag =
    patch.scenarioContextLandMaskVersionTag;
  target.scenarioWaterOverlayVersionTag =
    patch.scenarioWaterOverlayVersionTag;
  target.scenarioSpecialRegionsData = patch.scenarioSpecialRegionsData;
  target.scenarioReliefOverlaysData = patch.scenarioReliefOverlaysData;
  target.scenarioEraRailwaysData = patch.scenarioEraRailwaysData;
  target.scenarioReliefOverlayRevision =
    patch.scenarioReliefOverlayRevision;
  target.scenarioEraRailwaysRevision =
    patch.scenarioEraRailwaysRevision;
  target.scenarioStrategicValuesData = patch.scenarioStrategicValuesData;
  target.scenarioStrategicValuesRevision =
    patch.scenarioStrategicValuesRevision;
  target.scenarioDistrictGroupsData = patch.scenarioDistrictGroupsData;
  target.scenarioDistrictGroupByFeatureId =
    patch.scenarioDistrictGroupByFeatureId;
  target.releasableCatalog = patch.releasableCatalog;
  target.scenarioReleasableIndex = patch.scenarioReleasableIndex;
  target.scenarioAudit = patch.scenarioAudit;
  target.scenarioImportAudit = patch.scenarioImportAudit;
  target.scenarioBaselineHash = patch.scenarioBaselineHash;
  target.scenarioBaselineOwnersByFeatureId =
    createReadonlyReferenceAssignments(patch.scenarioBaselineOwnersByFeatureId);
  target.scenarioAutoShellOwnerByFeatureId =
    { ...(patch.scenarioAutoShellOwnerByFeatureId || {}) };
  target.scenarioBaselineCoresByFeatureId =
    { ...(patch.scenarioBaselineCoresByFeatureId || {}) };
  target.scenarioShellOverlayRevision =
    patch.scenarioShellOverlayRevision;
  target.countryNames = { ...(patch.countryNames || {}) };
  target.sovereigntyByFeatureId =
    createReadonlyReferenceAssignments(patch.sovereigntyByFeatureId);
  target.sovereigntyInitialized = patch.sovereigntyInitialized;
  target.visualOverrides = { ...(patch.visualOverrides || {}) };
  target.riverPaint = riverPaint;
  target.capitalOverrides = patch.capitalOverrides;
  target.politicalOverrides = patch.politicalOverrides;
  target.politicalAlliances = patch.politicalAlliances;
  target.projectCities = patch.projectCities;
  target.cityNameOverrides = patch.cityNameOverrides;
  target.scenarioGeneratedColorTags =
    Array.isArray(patch.scenarioGeneratedColorTags)
      ? [...patch.scenarioGeneratedColorTags]
      : [];
  // Border identity is read from exact base colors, so equal defaults are split
  // once over the complete palette; fixed colors follow the same replacement.
  const baseColors = patch.sovereignBaseColors || {};
  const fixedColors = patch.scenarioFixedOwnerColors || {};
  target.sovereignBaseColors = uniquifyScenarioDefaultColors(baseColors, {
    tags: getScenarioCountryTags(patch.scenarioCountriesByTag), preferred: Object.keys(fixedColors),
    deferred: new Set(getParentMergedParents(patch.scenarioCountriesByTag).keys()),
  });
  target.scenarioFixedOwnerColors = Object.fromEntries(Object.entries(fixedColors).map(([tag, color]) => [tag,
    String(color).trim().toLowerCase() === String(baseColors[tag] ?? "").trim().toLowerCase()
      ? target.sovereignBaseColors[tag] : color]));
  return true;
}

function restoreScenarioActivationBeforeAuditStateFromValidated(
  target,
  { values, presentKeys },
) {
  restoreScenarioFields(target, values, presentKeys, [
    "activeScenarioId", "scenarioBorderMode", "activeScenarioManifest",
    "scenarioCountriesByTag", "activeScenarioMeshPack", "scenarioRuntimeTopologyData",
    "runtimePoliticalTopology", "runtimePoliticalMetaSeed",
    "runtimePoliticalFeatureCollectionSeed", "scenarioLandMaskData",
    "scenarioContextLandMaskData", "scenarioWaterRegionsData", "scenarioAtlantropaData",
    "scenarioRuntimeTopologyVersionTag", "scenarioLandMaskVersionTag",
    "scenarioContextLandMaskVersionTag", "scenarioWaterOverlayVersionTag",
    "scenarioSpecialRegionsData", "scenarioReliefOverlaysData", "scenarioEraRailwaysData",
    "scenarioReliefOverlayRevision", "scenarioEraRailwaysRevision",
    "scenarioStrategicValuesData", "scenarioStrategicValuesRevision",
    "scenarioDistrictGroupsData", "scenarioDistrictGroupByFeatureId", "releasableCatalog",
    "scenarioReleasableIndex", "scenarioAudit", "scenarioGeneratedColorTags",
    "scenarioFixedOwnerColors",
  ]);
}

function restoreScenarioActivationBeforeColorDirtyStateFromValidated(
  target,
  { values, presentKeys },
) {
  restoreScenarioFields(target, values, presentKeys, [
    "mapSemanticMode", "scenarioImportAudit", "scenarioBaselineHash",
    "scenarioBaselineOwnersByFeatureId", "scenarioAutoShellOwnerByFeatureId",
    "scenarioBaselineCoresByFeatureId", "scenarioShellOverlayRevision", "countryNames",
    "sovereigntyByFeatureId", "sovereigntyInitialized", "capitalOverrides",
    "politicalOverrides", "politicalAlliances", "projectCities", "cityNameOverrides",
    "riverPaint", "visualOverrides", "sovereignBaseColors",
  ]);
}

export function restoreScenarioActivationBeforeAuditState(target, snapshot) {
  assertStateTarget(target);
  const validatedSnapshot = validateSnapshot(snapshot);
  restoreScenarioActivationBeforeAuditStateFromValidated(
    target,
    validatedSnapshot,
  );
  return true;
}

export function restoreScenarioActivationBeforeColorDirtyState(
  target,
  snapshot,
) {
  assertStateTarget(target);
  const validatedSnapshot = validateSnapshot(snapshot);
  restoreScenarioActivationBeforeColorDirtyStateFromValidated(
    target,
    validatedSnapshot,
  );
  return true;
}

export function restoreScenarioActivationAfterColorDirtyState(
  target,
  snapshot,
) {
  assertStateTarget(target);
  validateSnapshot(snapshot);
  return true;
}

export function restoreScenarioActivationState(target, snapshot) {
  assertStateTarget(target);
  const validatedSnapshot = validateSnapshot(snapshot);
  restoreScenarioActivationBeforeAuditStateFromValidated(
    target,
    validatedSnapshot,
  );
  restoreScenarioActivationBeforeColorDirtyStateFromValidated(
    target,
    validatedSnapshot,
  );
  return true;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "mapSemanticMode")) target.mapSemanticMode = patch.mapSemanticMode;
  if (Object.hasOwn(patch, "scenarioCountriesByTag")) target.scenarioCountriesByTag = patch.scenarioCountriesByTag;
  if (Object.hasOwn(patch, "scenarioReleasableIndex")) target.scenarioReleasableIndex = patch.scenarioReleasableIndex;
  if (Object.hasOwn(patch, "sovereignBaseColors")) target.sovereignBaseColors = patch.sovereignBaseColors;
  if (Object.hasOwn(patch, "sovereigntyByFeatureId")) target.sovereigntyByFeatureId = patch.sovereigntyByFeatureId;
  if (Object.hasOwn(patch, "sovereigntyInitialized")) target.sovereigntyInitialized = patch.sovereigntyInitialized;
  if (Object.hasOwn(patch, "visualOverrides")) target.visualOverrides = patch.visualOverrides;
  if (Object.hasOwn(patch, "riverPaint")) target.riverPaint = patch.riverPaint;
}
