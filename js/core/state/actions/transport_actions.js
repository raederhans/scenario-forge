// Canonical transport state mutations. Preview, render, persistence, and load effects remain with callers.

import {
  TRANSPORT_WORKBENCH_FAMILY_IDS,
  normalizeTransportOverviewStyleConfig,
  normalizeTransportWorkbenchPointDeltas,
  normalizeTransportWorkbenchUiState,
} from "../../state_defaults.js";
import { getTransportOverviewVisibilityField } from "../../transport_capability_registry.js";

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
  if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) {
    target[fieldName] = value;
    return value;
  }
  if (descriptor && !descriptor.configurable) {
    throw new TypeError(`[transport_actions] ${fieldName} must be writable owner state`);
  }
  Object.defineProperty(target, fieldName, {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
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
  const requestedLayerOrder = Array.isArray(nextUiState?.layerOrder)
    ? nextUiState.layerOrder
    : [];
  const normalized = normalizeTransportWorkbenchUiState(cloneDetached(nextUiState));
  const admittedLayerOrder = Array.from(new Set(
    requestedLayerOrder
      .map((familyId) => String(familyId || "").trim())
      .filter((familyId) => TRANSPORT_WORKBENCH_FAMILY_IDS.includes(familyId)),
  ));
  normalized.layerOrder = admittedLayerOrder.concat(
    TRANSPORT_WORKBENCH_FAMILY_IDS.filter((familyId) => !admittedLayerOrder.includes(familyId)),
  );
  const current = getOwnPlainRecord(target, "transportWorkbenchUi")
    ? target.transportWorkbenchUi
    : normalized;
  if (current !== normalized) Object.assign(current, normalized);
  delete current.compareHeld;
  return setOwnDataValue(target, "transportWorkbenchUi", current);
}

export function commitTransportWorkbenchPointDeltasState(target, nextDeltas = null) {
  const normalized = normalizeTransportWorkbenchPointDeltas(nextDeltas);
  if (!isStateTarget(target)) return normalized;
  return setOwnDataValue(target, "transportWorkbenchPointDeltas", normalized);
}

export function applyTransportWorkbenchOverviewState(target, patch = {}) {
  if (!isStateTarget(target) || !isStateTarget(patch)) return null;
  const currentOverview = ensureTransportOverviewStyleConfigState(target);
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
  setOwnDataValue(
    target.styleConfig,
    "transportOverview",
    normalizeTransportOverviewStyleConfig(nextOverview),
  );
  setTransportMasterVisibilityState(target, true);
  const visibilityField = String(patch.visibilityField || "");
  if (TRANSPORT_VISIBILITY_FIELDS.has(visibilityField)) {
    setOwnDataValue(target, visibilityField, true);
  }
  return target.styleConfig.transportOverview;
}

export function ensureTransportOverviewStyleConfigState(target) {
  if (!isStateTarget(target)) return normalizeTransportOverviewStyleConfig(null);
  const styleConfig = ensureOwnPlainRecord(target, "styleConfig");
  const current = getOwnPlainRecord(styleConfig, "transportOverview");
  const normalized = normalizeTransportOverviewStyleConfig(current);
  if (current) {
    Object.assign(current, normalized);
    setOwnDataValue(styleConfig, "transportOverview", current);
    return current;
  }
  return setOwnDataValue(styleConfig, "transportOverview", normalized);
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
