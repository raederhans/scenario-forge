// Canonical scenario activation state authority.
// Rendering, observers, rollback orchestration, and recovery stay outside this module.

import { commitSpecialZoneLayersState } from "./special_zone_actions.js";

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
  "scenarioReliefOverlayRevision",
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
  "featureOverrides",
  "scenarioGeneratedColorTags",
  "scenarioFixedOwnerColors",
  "sovereignBaseColors",
  "countryBaseColors",
]);

export const SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS = Object.freeze({
  water: Object.freeze({ stateField: "scenarioWaterRegionsData", revisionField: "" }),
  special: Object.freeze({ stateField: "scenarioSpecialRegionsData", revisionField: "" }),
  scenario_atlantropa: Object.freeze({ stateField: "scenarioAtlantropaData", revisionField: "scenarioAtlantropaRevision" }),
  specialzonelayers: Object.freeze({ stateField: "specialZoneLayers", revisionField: "" }),
  relief: Object.freeze({ stateField: "scenarioReliefOverlaysData", revisionField: "scenarioReliefOverlayRevision" }),
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
  const nextCountryColors = structuredClone(target.countryBaseColors || {});
  const removedSovereign = Object.hasOwn(nextSovereignColors, normalizedCode);
  const removedCountry = Object.hasOwn(nextCountryColors, normalizedCode);
  delete nextSovereignColors[normalizedCode];
  delete nextCountryColors[normalizedCode];
  target.sovereignBaseColors = nextSovereignColors;
  target.countryBaseColors = nextCountryColors;
  return removedSovereign || removedCountry;
}

export function setClickCountryColorsState(target, countryCode, color) {
  assertStateTarget(target);
  const normalizedCode = String(countryCode || "").trim();
  if (!normalizedCode) return false;
  const nextSovereignColors = structuredClone(target.sovereignBaseColors || {});
  const nextCountryColors = structuredClone(target.countryBaseColors || {});
  nextSovereignColors[normalizedCode] = color;
  nextCountryColors[normalizedCode] = color;
  target.sovereignBaseColors = nextSovereignColors;
  target.countryBaseColors = nextCountryColors;
  return true;
}

function getOptionalLayerConfig(layerKey) {
  const normalizedLayerKey = String(layerKey || "").trim();
  const config = SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS[normalizedLayerKey];
  if (!config) throw new Error(`unknown scenario chunk optional layer: ${normalizedLayerKey}`);
  return { layerKey: normalizedLayerKey, config };
}

function readOptionalLayerValue(target, layerKey) {
  switch (layerKey) {
    case "water": return target.scenarioWaterRegionsData;
    case "special": return target.scenarioSpecialRegionsData;
    case "scenario_atlantropa": return target.scenarioAtlantropaData;
    case "specialzonelayers": return target.specialZoneLayers;
    case "relief": return target.scenarioReliefOverlaysData;
    case "cities": return target.scenarioCityOverridesData;
    case "strategicvalues": return target.scenarioStrategicValuesData;
  }
}

function hasOptionalLayerValue(target, layerKey) {
  switch (layerKey) {
    case "water": return hasOwn(target, "scenarioWaterRegionsData");
    case "special": return hasOwn(target, "scenarioSpecialRegionsData");
    case "scenario_atlantropa": return hasOwn(target, "scenarioAtlantropaData");
    case "specialzonelayers": return hasOwn(target, "specialZoneLayers");
    case "relief": return hasOwn(target, "scenarioReliefOverlaysData");
    case "cities": return hasOwn(target, "scenarioCityOverridesData");
    case "strategicvalues": return hasOwn(target, "scenarioStrategicValuesData");
  }
}

function readOptionalLayerRevision(target, layerKey) {
  switch (layerKey) {
    case "scenario_atlantropa": return target.scenarioAtlantropaRevision;
    case "relief": return target.scenarioReliefOverlayRevision;
    case "cities": return target.cityLayerRevision;
    case "strategicvalues": return target.scenarioStrategicValuesRevision;
  }
}

function hasOptionalLayerRevision(target, layerKey) {
  switch (layerKey) {
    case "scenario_atlantropa": return hasOwn(target, "scenarioAtlantropaRevision");
    case "relief": return hasOwn(target, "scenarioReliefOverlayRevision");
    case "cities": return hasOwn(target, "cityLayerRevision");
    case "strategicvalues": return hasOwn(target, "scenarioStrategicValuesRevision");
    default: return false;
  }
}

export function getScenarioChunkOptionalLayerState(target, layerKey) {
  assertStateTarget(target);
  const { layerKey: normalizedLayerKey } = getOptionalLayerConfig(layerKey);
  return readOptionalLayerValue(target, normalizedLayerKey);
}

export function applyScenarioChunkOptionalLayerState(target, layerKey, payload) {
  assertStateTarget(target);
  const { layerKey: normalizedLayerKey } = getOptionalLayerConfig(layerKey);
  if (normalizedLayerKey === "cities") {
    return {
      changed: target.scenarioCityOverridesData !== payload,
      externalEffect: {
        type: "scenario-city-overrides",
        payload,
        finalizerToken: null,
      },
    };
  }
  let changed = false;
  switch (normalizedLayerKey) {
    case "water":
      changed = target.scenarioWaterRegionsData !== payload;
      if (!changed) break;
      target.scenarioWaterRegionsData = payload;
      break;
    case "special":
      changed = target.scenarioSpecialRegionsData !== payload;
      if (!changed) break;
      target.scenarioSpecialRegionsData = payload;
      break;
    case "scenario_atlantropa":
      changed = target.scenarioAtlantropaData !== payload;
      if (!changed) break;
      target.scenarioAtlantropaData = payload;
      target.scenarioAtlantropaRevision =
        Math.max(0, Number(target.scenarioAtlantropaRevision) || 0) + 1;
      break;
    case "specialzonelayers":
      changed = target.specialZoneLayers !== payload;
      if (!changed) break;
      commitSpecialZoneLayersState(
        target,
        payload,
        {},
        { markDirty: false, preserveIdentity: true },
      );
      break;
    case "relief":
      changed = target.scenarioReliefOverlaysData !== payload;
      if (!changed) break;
      target.scenarioReliefOverlaysData = payload;
      target.scenarioReliefOverlayRevision =
        Math.max(0, Number(target.scenarioReliefOverlayRevision) || 0) + 1;
      break;
    case "strategicvalues":
      changed = target.scenarioStrategicValuesData !== payload;
      if (!changed) break;
      target.scenarioStrategicValuesData = payload;
      target.scenarioStrategicValuesRevision =
        Math.max(0, Number(target.scenarioStrategicValuesRevision) || 0) + 1;
      break;
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
  const specialZoneLayersReferencePresent = capturesSpecialZoneLayers
    && hasOptionalLayerValue(target, "specialzonelayers");
  const specialZoneLayersReference = capturesSpecialZoneLayers
    ? readOptionalLayerValue(target, "specialzonelayers")
    : undefined;
  const entries = requestedLayers.map(({ layerKey: normalizedLayerKey, config }) => {
    const statePresent = normalizedLayerKey === "specialzonelayers"
      ? specialZoneLayersReferencePresent
      : hasOptionalLayerValue(target, normalizedLayerKey);
    const stateValue = normalizedLayerKey === "specialzonelayers"
      ? specialZoneLayersReference
      : readOptionalLayerValue(target, normalizedLayerKey);
    const entry = {
      layerKey: normalizedLayerKey,
      statePresent,
      stateValue,
      revisionPresent: !!config.revisionField && hasOptionalLayerRevision(target, normalizedLayerKey),
      revisionValue: config.revisionField ? readOptionalLayerRevision(target, normalizedLayerKey) : undefined,
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
    switch (layerKey) {
      case "water":
        if (entry.statePresent) target.scenarioWaterRegionsData = entry.stateValue;
        else delete target.scenarioWaterRegionsData;
        break;
      case "special":
        if (entry.statePresent) target.scenarioSpecialRegionsData = entry.stateValue;
        else delete target.scenarioSpecialRegionsData;
        break;
      case "scenario_atlantropa":
        if (entry.statePresent) target.scenarioAtlantropaData = entry.stateValue;
        else delete target.scenarioAtlantropaData;
        if (entry.revisionPresent) target.scenarioAtlantropaRevision = entry.revisionValue;
        else delete target.scenarioAtlantropaRevision;
        break;
      case "specialzonelayers":
        if (entry.statePresent) {
          if (specialZoneLayersReferencePresent) {
            commitSpecialZoneLayersState(
              target,
              specialZoneLayersReference,
              {},
              { markDirty: false, preserveIdentity: true },
            );
          } else {
            commitSpecialZoneLayersState(
              target,
              structuredClone(entry.stateValue),
              {},
              { markDirty: false, preserveIdentity: true },
            );
          }
        }
        else delete target.specialZoneLayers;
        break;
      case "relief":
        if (entry.statePresent) target.scenarioReliefOverlaysData = entry.stateValue;
        else delete target.scenarioReliefOverlaysData;
        if (entry.revisionPresent) target.scenarioReliefOverlayRevision = entry.revisionValue;
        else delete target.scenarioReliefOverlayRevision;
        break;
      case "strategicvalues":
        if (entry.statePresent) target.scenarioStrategicValuesData = entry.stateValue;
        else delete target.scenarioStrategicValuesData;
        if (entry.revisionPresent) target.scenarioStrategicValuesRevision = entry.revisionValue;
        else delete target.scenarioStrategicValuesRevision;
        break;
      default:
        throw new Error(`unknown scenario chunk optional layer: ${layerKey || ""}`);
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
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("[scenario_activation_actions] snapshot must be an object");
  }
  const values = snapshot.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("[scenario_activation_actions] snapshot.values must be an object");
  }
  for (const key of SCENARIO_ACTIVATION_STATE_KEYS) {
    if (!hasOwn(values, key)) {
      throw new Error(
        `[scenario_activation_actions] restoreScenarioActivationState missing snapshot key: ${key}`,
      );
    }
  }
  if (
    !Array.isArray(snapshot.presentKeys)
    && !(snapshot.presentKeys instanceof Set)
  ) {
    throw new TypeError(
      "[scenario_activation_actions] snapshot.presentKeys must be an array or Set",
    );
  }
  const presentKeys = Array.from(snapshot.presentKeys);
  const allowedKeys = new Set(SCENARIO_ACTIVATION_STATE_KEYS);
  for (const key of presentKeys) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `[scenario_activation_actions] restoreScenarioActivationState contains unknown present key: ${key}`,
      );
    }
  }
  return { values, presentKeys: new Set(presentKeys) };
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
  target.scenarioReliefOverlayRevision =
    patch.scenarioReliefOverlayRevision;
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
    { ...(patch.scenarioBaselineOwnersByFeatureId || {}) };
  target.scenarioAutoShellOwnerByFeatureId =
    { ...(patch.scenarioAutoShellOwnerByFeatureId || {}) };
  target.scenarioBaselineCoresByFeatureId =
    { ...(patch.scenarioBaselineCoresByFeatureId || {}) };
  target.scenarioShellOverlayRevision =
    patch.scenarioShellOverlayRevision;
  target.countryNames = { ...(patch.countryNames || {}) };
  target.sovereigntyByFeatureId =
    { ...(patch.sovereigntyByFeatureId || {}) };
  target.sovereigntyInitialized = patch.sovereigntyInitialized;
  target.visualOverrides = { ...(patch.visualOverrides || {}) };
  target.featureOverrides = { ...(patch.featureOverrides || {}) };
  target.scenarioGeneratedColorTags =
    Array.isArray(patch.scenarioGeneratedColorTags)
      ? [...patch.scenarioGeneratedColorTags]
      : [];
  target.scenarioFixedOwnerColors =
    { ...(patch.scenarioFixedOwnerColors || {}) };
  target.sovereignBaseColors = { ...(patch.sovereignBaseColors || {}) };
  target.countryBaseColors = { ...(patch.countryBaseColors || {}) };
  return true;
}

function restoreScenarioActivationBeforeAuditStateFromValidated(
  target,
  { values, presentKeys },
) {
  if (presentKeys.has("activeScenarioId")) {
    target.activeScenarioId = values.activeScenarioId;
  } else {
    delete target.activeScenarioId;
  }
  if (presentKeys.has("scenarioBorderMode")) {
    target.scenarioBorderMode = values.scenarioBorderMode;
  } else {
    delete target.scenarioBorderMode;
  }
  if (presentKeys.has("activeScenarioManifest")) {
    target.activeScenarioManifest = values.activeScenarioManifest;
  } else {
    delete target.activeScenarioManifest;
  }
  if (presentKeys.has("scenarioCountriesByTag")) {
    target.scenarioCountriesByTag = values.scenarioCountriesByTag;
  } else {
    delete target.scenarioCountriesByTag;
  }
  if (presentKeys.has("activeScenarioMeshPack")) {
    target.activeScenarioMeshPack = values.activeScenarioMeshPack;
  } else {
    delete target.activeScenarioMeshPack;
  }
  if (presentKeys.has("scenarioRuntimeTopologyData")) {
    target.scenarioRuntimeTopologyData = values.scenarioRuntimeTopologyData;
  } else {
    delete target.scenarioRuntimeTopologyData;
  }
  if (presentKeys.has("runtimePoliticalTopology")) {
    target.runtimePoliticalTopology = values.runtimePoliticalTopology;
  } else {
    delete target.runtimePoliticalTopology;
  }
  if (presentKeys.has("runtimePoliticalMetaSeed")) {
    target.runtimePoliticalMetaSeed = values.runtimePoliticalMetaSeed;
  } else {
    delete target.runtimePoliticalMetaSeed;
  }
  if (presentKeys.has("runtimePoliticalFeatureCollectionSeed")) {
    target.runtimePoliticalFeatureCollectionSeed =
      values.runtimePoliticalFeatureCollectionSeed;
  } else {
    delete target.runtimePoliticalFeatureCollectionSeed;
  }
  if (presentKeys.has("scenarioLandMaskData")) {
    target.scenarioLandMaskData = values.scenarioLandMaskData;
  } else {
    delete target.scenarioLandMaskData;
  }
  if (presentKeys.has("scenarioContextLandMaskData")) {
    target.scenarioContextLandMaskData = values.scenarioContextLandMaskData;
  } else {
    delete target.scenarioContextLandMaskData;
  }
  if (presentKeys.has("scenarioWaterRegionsData")) {
    target.scenarioWaterRegionsData = values.scenarioWaterRegionsData;
  } else {
    delete target.scenarioWaterRegionsData;
  }
  if (presentKeys.has("scenarioAtlantropaData")) {
    target.scenarioAtlantropaData = values.scenarioAtlantropaData;
  } else {
    delete target.scenarioAtlantropaData;
  }
  if (presentKeys.has("scenarioRuntimeTopologyVersionTag")) {
    target.scenarioRuntimeTopologyVersionTag =
      values.scenarioRuntimeTopologyVersionTag;
  } else {
    delete target.scenarioRuntimeTopologyVersionTag;
  }
  if (presentKeys.has("scenarioLandMaskVersionTag")) {
    target.scenarioLandMaskVersionTag = values.scenarioLandMaskVersionTag;
  } else {
    delete target.scenarioLandMaskVersionTag;
  }
  if (presentKeys.has("scenarioContextLandMaskVersionTag")) {
    target.scenarioContextLandMaskVersionTag =
      values.scenarioContextLandMaskVersionTag;
  } else {
    delete target.scenarioContextLandMaskVersionTag;
  }
  if (presentKeys.has("scenarioWaterOverlayVersionTag")) {
    target.scenarioWaterOverlayVersionTag =
      values.scenarioWaterOverlayVersionTag;
  } else {
    delete target.scenarioWaterOverlayVersionTag;
  }
  if (presentKeys.has("scenarioSpecialRegionsData")) {
    target.scenarioSpecialRegionsData = values.scenarioSpecialRegionsData;
  } else {
    delete target.scenarioSpecialRegionsData;
  }
  if (presentKeys.has("scenarioReliefOverlaysData")) {
    target.scenarioReliefOverlaysData = values.scenarioReliefOverlaysData;
  } else {
    delete target.scenarioReliefOverlaysData;
  }
  if (presentKeys.has("scenarioReliefOverlayRevision")) {
    target.scenarioReliefOverlayRevision =
      values.scenarioReliefOverlayRevision;
  } else {
    delete target.scenarioReliefOverlayRevision;
  }
  if (presentKeys.has("scenarioStrategicValuesData")) {
    target.scenarioStrategicValuesData = values.scenarioStrategicValuesData;
  } else {
    delete target.scenarioStrategicValuesData;
  }
  if (presentKeys.has("scenarioStrategicValuesRevision")) {
    target.scenarioStrategicValuesRevision =
      values.scenarioStrategicValuesRevision;
  } else {
    delete target.scenarioStrategicValuesRevision;
  }
  if (presentKeys.has("scenarioDistrictGroupsData")) {
    target.scenarioDistrictGroupsData = values.scenarioDistrictGroupsData;
  } else {
    delete target.scenarioDistrictGroupsData;
  }
  if (presentKeys.has("scenarioDistrictGroupByFeatureId")) {
    target.scenarioDistrictGroupByFeatureId =
      values.scenarioDistrictGroupByFeatureId;
  } else {
    delete target.scenarioDistrictGroupByFeatureId;
  }
  if (presentKeys.has("releasableCatalog")) {
    target.releasableCatalog = values.releasableCatalog;
  } else {
    delete target.releasableCatalog;
  }
  if (presentKeys.has("scenarioReleasableIndex")) {
    target.scenarioReleasableIndex = values.scenarioReleasableIndex;
  } else {
    delete target.scenarioReleasableIndex;
  }
  if (presentKeys.has("scenarioAudit")) {
    target.scenarioAudit = values.scenarioAudit;
  } else {
    delete target.scenarioAudit;
  }
  if (presentKeys.has("scenarioGeneratedColorTags")) {
    target.scenarioGeneratedColorTags = values.scenarioGeneratedColorTags;
  } else {
    delete target.scenarioGeneratedColorTags;
  }
  if (presentKeys.has("scenarioFixedOwnerColors")) {
    target.scenarioFixedOwnerColors = values.scenarioFixedOwnerColors;
  } else {
    delete target.scenarioFixedOwnerColors;
  }
}

function restoreScenarioActivationBeforeColorDirtyStateFromValidated(
  target,
  { values, presentKeys },
) {
  if (presentKeys.has("mapSemanticMode")) {
    target.mapSemanticMode = values.mapSemanticMode;
  } else {
    delete target.mapSemanticMode;
  }
  if (presentKeys.has("scenarioImportAudit")) {
    target.scenarioImportAudit = values.scenarioImportAudit;
  } else {
    delete target.scenarioImportAudit;
  }
  if (presentKeys.has("scenarioBaselineHash")) {
    target.scenarioBaselineHash = values.scenarioBaselineHash;
  } else {
    delete target.scenarioBaselineHash;
  }
  if (presentKeys.has("scenarioBaselineOwnersByFeatureId")) {
    target.scenarioBaselineOwnersByFeatureId =
      values.scenarioBaselineOwnersByFeatureId;
  } else {
    delete target.scenarioBaselineOwnersByFeatureId;
  }
  if (presentKeys.has("scenarioAutoShellOwnerByFeatureId")) {
    target.scenarioAutoShellOwnerByFeatureId =
      values.scenarioAutoShellOwnerByFeatureId;
  } else {
    delete target.scenarioAutoShellOwnerByFeatureId;
  }
  if (presentKeys.has("scenarioBaselineCoresByFeatureId")) {
    target.scenarioBaselineCoresByFeatureId =
      values.scenarioBaselineCoresByFeatureId;
  } else {
    delete target.scenarioBaselineCoresByFeatureId;
  }
  if (presentKeys.has("scenarioShellOverlayRevision")) {
    target.scenarioShellOverlayRevision =
      values.scenarioShellOverlayRevision;
  } else {
    delete target.scenarioShellOverlayRevision;
  }
  if (presentKeys.has("countryNames")) {
    target.countryNames = values.countryNames;
  } else {
    delete target.countryNames;
  }
  if (presentKeys.has("sovereigntyByFeatureId")) {
    target.sovereigntyByFeatureId = values.sovereigntyByFeatureId;
  } else {
    delete target.sovereigntyByFeatureId;
  }
  if (presentKeys.has("sovereigntyInitialized")) {
    target.sovereigntyInitialized = values.sovereigntyInitialized;
  } else {
    delete target.sovereigntyInitialized;
  }
  if (presentKeys.has("visualOverrides")) {
    target.visualOverrides = values.visualOverrides;
  } else {
    delete target.visualOverrides;
  }
  if (presentKeys.has("featureOverrides")) {
    target.featureOverrides = values.featureOverrides;
  } else {
    delete target.featureOverrides;
  }
  if (presentKeys.has("sovereignBaseColors")) {
    target.sovereignBaseColors = values.sovereignBaseColors;
  } else {
    delete target.sovereignBaseColors;
  }
  if (presentKeys.has("countryBaseColors")) {
    target.countryBaseColors = values.countryBaseColors;
  } else {
    delete target.countryBaseColors;
  }
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
