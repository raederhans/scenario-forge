// Canonical transport state mutations. Preview, render, persistence, and load effects remain with callers.

import {
  TRANSPORT_WORKBENCH_FAMILY_IDS,
  normalizeTransportOverviewStyleConfig,
  normalizeTransportWorkbenchPointDeltas,
  normalizeTransportWorkbenchUiState,
} from "../../state_defaults.js";
import { getTransportOverviewVisibilityField } from "../../transport_capability_registry.js";
import {
  ensureAppearanceStyleConfigState,
  setAppearanceStyleGroupState,
} from "./appearance_actions.js";

const TRANSPORT_VISIBILITY_FIELDS = new Set([
  "showAirports",
  "showPorts",
  "showRail",
  "showRoad",
]);

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

function isPlainRecord(value) {
  if (!isStateTarget(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneDetached(value) {
  if (!isStateTarget(value)) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getInheritedDataValue(target, fieldName) {
  for (let prototype = Object.getPrototypeOf(target); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, fieldName);
    if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  }
  return undefined;
}

function setOwnDataValue(target, fieldName, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  if (
    descriptor
    && !descriptor.configurable
    && (!Object.hasOwn(descriptor, "value") || !descriptor.writable)
  ) {
    throw new TypeError(`[transport_actions] ${fieldName} must be writable owner state`);
  }
  const attributes = {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
  };
  switch (fieldName) {
    case "transportWorkbenchUi": Object.defineProperty(target, "transportWorkbenchUi", { ...attributes, value }); break;
    case "transportWorkbenchPointDeltas": Object.defineProperty(target, "transportWorkbenchPointDeltas", { ...attributes, value }); break;
    case "showTransport": Object.defineProperty(target, "showTransport", { ...attributes, value }); break;
    case "showAirports": Object.defineProperty(target, "showAirports", { ...attributes, value }); break;
    case "showPorts": Object.defineProperty(target, "showPorts", { ...attributes, value }); break;
    case "showRail": Object.defineProperty(target, "showRail", { ...attributes, value }); break;
    case "showRoad": Object.defineProperty(target, "showRoad", { ...attributes, value }); break;
    default: throw new RangeError(`[transport_actions] unsupported owner field: ${fieldName}`);
  }
  return value;
}

function getOwnPlainRecord(target, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  return descriptor
    && Object.hasOwn(descriptor, "value")
    && isPlainRecord(descriptor.value)
    ? descriptor.value
    : null;
}

function ensureOwnPlainRecord(target, fieldName) {
  const current = getOwnPlainRecord(target, fieldName);
  if (current) return current;
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  const source = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : getInheritedDataValue(target, fieldName);
  const next = isPlainRecord(source) ? cloneDetached(source) : {};
  return setOwnDataValue(target, fieldName, next);
}

export function ensureTransportWorkbenchUiState(target) {
  if (!isStateTarget(target)) return normalizeTransportWorkbenchUiState(null);
  return commitTransportWorkbenchUiState(
    target,
    ensureOwnPlainRecord(target, "transportWorkbenchUi"),
  );
}

export function commitTransportWorkbenchUiState(target, nextUiState = null) {
  if (!isStateTarget(target)) return normalizeTransportWorkbenchUiState(null);
  const detachedUiState = isStateTarget(nextUiState)
    ? { ...nextUiState }
    : null;
  const requestedLayerOrder = Array.isArray(detachedUiState?.layerOrder)
    ? detachedUiState.layerOrder
    : [];
  const normalized = normalizeTransportWorkbenchUiState(cloneDetached(detachedUiState));
  const admittedLayerOrder = Array.from(new Set(
    requestedLayerOrder
      .map((familyId) => String(familyId || "").trim())
      .filter((familyId) => TRANSPORT_WORKBENCH_FAMILY_IDS.includes(familyId)),
  ));
  normalized.layerOrder = admittedLayerOrder.concat(
    TRANSPORT_WORKBENCH_FAMILY_IDS.filter((familyId) => !admittedLayerOrder.includes(familyId)),
  );
  ensureOwnPlainRecord(target, "transportWorkbenchUi");
  target.transportWorkbenchUi.open = normalized.open;
  target.transportWorkbenchUi.activeFamily = normalized.activeFamily;
  target.transportWorkbenchUi.activePackId = normalized.activePackId;
  target.transportWorkbenchUi.activePackIdByFamily = normalized.activePackIdByFamily;
  target.transportWorkbenchUi.activeInspectorTab = normalized.activeInspectorTab;
  target.transportWorkbenchUi.sampleCountry = normalized.sampleCountry;
  target.transportWorkbenchUi.previewCarrierId = normalized.previewCarrierId;
  target.transportWorkbenchUi.previewMode = normalized.previewMode;
  target.transportWorkbenchUi.previewAssetId = normalized.previewAssetId;
  target.transportWorkbenchUi.previewInteractionMode = normalized.previewInteractionMode;
  target.transportWorkbenchUi.previewCamera = normalized.previewCamera;
  target.transportWorkbenchUi.layerOrder = normalized.layerOrder;
  target.transportWorkbenchUi.familyConfigs = normalized.familyConfigs;
  target.transportWorkbenchUi.displayConfigs = normalized.displayConfigs;
  target.transportWorkbenchUi.sectionOpen = normalized.sectionOpen;
  target.transportWorkbenchUi.shellPhase = normalized.shellPhase;
  target.transportWorkbenchUi.restoreLeftDrawer = normalized.restoreLeftDrawer;
  target.transportWorkbenchUi.restoreRightDrawer = normalized.restoreRightDrawer;
  delete target.transportWorkbenchUi.compareHeld;
  return structuredClone(target.transportWorkbenchUi);
}

export function commitTransportWorkbenchPointDeltasState(target, nextDeltas = null) {
  const detachedDeltas = isStateTarget(nextDeltas)
    ? { ...nextDeltas }
    : null;
  const normalized = normalizeTransportWorkbenchPointDeltas(detachedDeltas);
  if (!isStateTarget(target)) return normalized;
  return setOwnDataValue(target, "transportWorkbenchPointDeltas", normalized);
}

export function applyTransportWorkbenchOverviewState(target, patch = {}) {
  if (!isStateTarget(target) || !isStateTarget(patch)) return null;
  const currentOverview = structuredClone(
    ensureTransportOverviewStyleConfigState(target),
  );
  const familyId = String(patch.familyId || "").trim().toLowerCase();
  const nextOverview = {
    ...currentOverview,
  };
  if (Object.hasOwn(patch, "visualMode")) nextOverview.visualMode = patch.visualMode;
  if (familyId) {
    nextOverview[familyId] = {
      ...(currentOverview[familyId] || {}),
      ...(isStateTarget(patch.familyConfig) ? patch.familyConfig : {}),
    };
    if (patch.activePackId) {
      nextOverview.activePackIdByFamily = {
        ...(currentOverview.activePackIdByFamily || {}),
        [familyId]: String(patch.activePackId).trim().toLowerCase(),
      };
    }
  }
  const normalizedOverview = normalizeTransportOverviewStyleConfig(nextOverview);
  setAppearanceStyleGroupState(target, "transportOverview", normalizedOverview);
  setTransportMasterVisibilityState(target, true);
  const visibilityField = String(patch.visibilityField || "");
  if (TRANSPORT_VISIBILITY_FIELDS.has(visibilityField)) {
    setOwnDataValue(target, visibilityField, true);
  }
  return normalizedOverview;
}

export function ensureTransportOverviewStyleConfigState(target) {
  if (!isStateTarget(target)) return normalizeTransportOverviewStyleConfig(null);
  const styleConfig = ensureAppearanceStyleConfigState(target);
  const current = getOwnPlainRecord(styleConfig, "transportOverview");
  const normalized = normalizeTransportOverviewStyleConfig(current);
  if (current) {
    Object.assign(current, normalized);
    setAppearanceStyleGroupState(target, "transportOverview", current);
    return current;
  }
  return setAppearanceStyleGroupState(target, "transportOverview", normalized);
}

export function setTransportMasterVisibilityState(target, visible) {
  if (!isStateTarget(target)) return false;
  return setOwnDataValue(target, "showTransport", !!visible);
}

export function setTransportFamilyVisibilityState(target, familyId, visible) {
  if (!isStateTarget(target)) return false;
  const field = getTransportOverviewVisibilityField(String(familyId || "").trim().toLowerCase());
  if (!field) return false;
  const nextVisible = !!visible;
  setOwnDataValue(target, field, nextVisible);
  if (nextVisible) setOwnDataValue(target, "showTransport", true);
  return nextVisible;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "transportWorkbenchUi")) target.transportWorkbenchUi = patch.transportWorkbenchUi;
}
