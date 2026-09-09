// Canonical special-zone layer, editor, membership-tool, hook-registration, and dirty-state authority.
// Persistence, rendering, UI feedback, metrics, and runtime hook invocation stay in callers.

import {
  mutateSpecialZoneLayersState,
  normalizeSpecialZoneLayersState,
  normalizeSpecialZoneMembershipBrushModeState,
} from "../../special_zone_layers.js";
import { createDefaultSpecialZoneEditorState } from "../strategic_overlay_state.js";
import { commitUiVisibilityState } from "./ui_visibility_actions.js";

export const SPECIAL_ZONE_EDITOR_FIELD_KEYS = Object.freeze([
  "active",
  "vertices",
  "zoneType",
  "label",
  "selectedId",
  "counter",
]);

const SPECIAL_ZONE_LAYER_STATE_FIELD_KEYS = Object.freeze([
  "version",
  "layers",
  "activeLayerId",
  "storySteps",
  "activeStoryStepId",
  "topologyFingerprint",
  "diagnostics",
  "manualSpecialZones",
  "specialRegionOverrides",
  "special_regions_url",
  "specialRegionsPayload",
]);

const SPECIAL_ZONE_LAYER_OPTION_KEYS = Object.freeze([
  "validFeatureIds",
  "topologyFingerprint",
  "defaultSource",
]);

const SPECIAL_ZONE_COMMIT_CONTROL_KEYS = Object.freeze([
  "markDirty",
  "preserveIdentity",
]);

const SPECIAL_ZONE_LAYER_MUTATION_KEYS = Object.freeze([
  "action",
  "layer",
  "presetId",
  "id",
  "name",
  "category",
  "source",
  "visible",
  "legendVisible",
  "style",
  "memberFeatureIds",
  "layerId",
  "patch",
  "newLayerId",
  "layerIds",
  "featureIds",
  "sourceLayerId",
  "operation",
  "storySteps",
  "activeStoryStepId",
  "storyStepId",
]);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[special_zone_actions] target must be an object");
  }
}

function assertPatch(patch, label) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError(`[special_zone_actions] ${label} must be an object`);
  }
}

function detachActionInputs(inputs) {
  return { ...inputs };
}

function projectFields(container, sourceKey, fieldKeys, ownOnly = false) {
  const source = container[sourceKey];
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const projected = {};
  for (const key of fieldKeys) {
    if ((ownOnly && Object.hasOwn(source, key)) || (!ownOnly && key in source)) {
      projected[key] = source[key];
    }
  }
  return projected;
}

function normalizeEditorState(editor, defaultZoneType = "custom") {
  const existing = editor && typeof editor === "object" && !Array.isArray(editor);
  const source = existing
    ? editor
    : createDefaultSpecialZoneEditorState();
  const next = { ...source };
  if (!Array.isArray(next.vertices)) next.vertices = [];
  if (!Number.isFinite(Number(next.counter)) || Number(next.counter) < 1) next.counter = 1;
  if (!next.zoneType) next.zoneType = String(defaultZoneType || "custom");
  if (typeof next.label !== "string") next.label = "";
  if (next.selectedId === undefined) next.selectedId = null;
  return next;
}

function cloneEditorVertices(vertices) {
  return Array.isArray(vertices)
    ? vertices.map((vertex) => Array.isArray(vertex) ? [...vertex] : vertex)
    : [];
}

export function ensureSpecialZoneEditorState(target, { defaultZoneType = "custom" } = {}) {
  assertStateTarget(target);
  const inputs = detachActionInputs({ defaultZoneType });
  const descriptor = Object.getOwnPropertyDescriptor(target, "specialZoneEditor");
  const descriptorValue = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
  const current = descriptorValue && typeof descriptorValue === "object" && !Array.isArray(descriptorValue)
    ? descriptorValue
    : null;
  const next = normalizeEditorState(current, inputs.defaultZoneType);
  if (current) {
    Object.assign(current, next);
    target.specialZoneEditor = current;
    return current;
  } else {
    target.specialZoneEditor = next;
    return next;
  }
}

export function patchSpecialZoneEditorState(
  target,
  patch,
  { defaultZoneType = "custom" } = {},
) {
  assertStateTarget(target);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[special_zone_actions] specialZoneEditor patch must be an object");
  }
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!SPECIAL_ZONE_EDITOR_FIELD_KEYS.includes(key)) {
      throw new Error(`[special_zone_actions] unknown specialZoneEditor field: ${key}`);
    }
  }
  const inputs = detachActionInputs({
    patch: Object.fromEntries(patchKeys.map((key) => [key, patch[key]])),
    defaultZoneType,
  });
  ensureSpecialZoneEditorState(target, { defaultZoneType: inputs.defaultZoneType });
  const editorDescriptor = Object.getOwnPropertyDescriptor(target, "specialZoneEditor");
  const current = editorDescriptor && Object.hasOwn(editorDescriptor, "value")
    ? editorDescriptor.value
    : createDefaultSpecialZoneEditorState();
  const assignments = {};
  if (Object.hasOwn(inputs.patch, "active")) assignments.active = Boolean(inputs.patch.active);
  if (Object.hasOwn(inputs.patch, "vertices")) assignments.vertices = Array.isArray(inputs.patch.vertices)
    ? inputs.patch.vertices.map((vertex) => Array.isArray(vertex) ? [...vertex] : vertex)
    : [];
  if (Object.hasOwn(inputs.patch, "zoneType")) assignments.zoneType = String(inputs.patch.zoneType || inputs.defaultZoneType || "custom");
  if (Object.hasOwn(inputs.patch, "label")) assignments.label = String(inputs.patch.label || "");
  if (Object.hasOwn(inputs.patch, "selectedId")) assignments.selectedId = String(inputs.patch.selectedId || "").trim() || null;
  if (Object.hasOwn(inputs.patch, "counter")) assignments.counter = Math.max(1, Number(inputs.patch.counter) || 1);
  Object.assign(current, assignments);
  target.specialZoneEditor = current;
  return current;
}

export function commitSpecialZoneLayersState(
  target,
  nextState,
  options = {},
  control = {},
) {
  assertStateTarget(target);
  const preserveIdentity = control?.preserveIdentity === true;
  if (preserveIdentity) {
    target.specialZoneLayers = nextState;
    if (control?.markDirty !== false) {
      target.specialZonesOverlayDirty = true;
    }
    return nextState;
  }
  const inputs = detachActionInputs({
    nextState: projectFields({ nextState }, "nextState", SPECIAL_ZONE_LAYER_STATE_FIELD_KEYS),
    options: projectFields({ options }, "options", SPECIAL_ZONE_LAYER_OPTION_KEYS) || {},
    control: projectFields({ control }, "control", SPECIAL_ZONE_COMMIT_CONTROL_KEYS) || {},
  });
  const normalized = normalizeSpecialZoneLayersState(inputs.nextState, inputs.options);
  target.specialZoneLayers = normalized;
  if (inputs.control.markDirty !== false) {
    target.specialZonesOverlayDirty = true;
  }
  return normalized;
}

export function mutateSpecialZoneLayersStateAction(target, mutation, options = {}) {
  assertStateTarget(target);
  const inputs = detachActionInputs({
    mutation: projectFields({ mutation }, "mutation", SPECIAL_ZONE_LAYER_MUTATION_KEYS),
    options: projectFields({ options }, "options", SPECIAL_ZONE_LAYER_OPTION_KEYS) || {},
  });
  const current = normalizeSpecialZoneLayersState(
    structuredClone(target.specialZoneLayers),
    inputs.options,
  );
  const nextState = mutateSpecialZoneLayersState(current, inputs.mutation);
  return commitSpecialZoneLayersState(target, nextState, inputs.options);
}

export function restoreSpecialZoneSnapshotState(
  target,
  snapshot,
  { layerOptions = {}, defaultZoneType = "custom" } = {},
) {
  assertStateTarget(target);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("[special_zone_actions] snapshot must be an object");
  }
  const inputs = detachActionInputs({
    snapshot: projectFields(
      { snapshot },
      "snapshot",
      ["specialZoneLayers", "specialZoneMembershipBrushMode", "specialZoneEditor"],
      true,
    ),
    layerOptions: projectFields(
      { layerOptions },
      "layerOptions",
      SPECIAL_ZONE_LAYER_OPTION_KEYS,
    ) || {},
    defaultZoneType,
  });
  const assignments = {};
  const updatedKeys = [];
  if (
    Object.hasOwn(inputs.snapshot, "specialZoneLayers")
    && inputs.snapshot.specialZoneLayers
    && typeof inputs.snapshot.specialZoneLayers === "object"
    && !Array.isArray(inputs.snapshot.specialZoneLayers)
  ) {
    assignments.specialZoneLayers = normalizeSpecialZoneLayersState(
      inputs.snapshot.specialZoneLayers,
      inputs.layerOptions,
    );
    assignments.specialZonesOverlayDirty = true;
    updatedKeys.push("specialZoneLayers");
  }
  if (Object.hasOwn(inputs.snapshot, "specialZoneMembershipBrushMode") && typeof inputs.snapshot.specialZoneMembershipBrushMode === "string") {
    assignments.specialZoneMembershipBrushMode = normalizeSpecialZoneMembershipBrushModeState(
      inputs.snapshot.specialZoneMembershipBrushMode,
    );
    updatedKeys.push("specialZoneMembershipBrushMode");
  }
  if (
    Object.hasOwn(inputs.snapshot, "specialZoneEditor")
    && inputs.snapshot.specialZoneEditor
    && typeof inputs.snapshot.specialZoneEditor === "object"
    && !Array.isArray(inputs.snapshot.specialZoneEditor)
  ) {
    const normalizedEditor = normalizeEditorState(
      inputs.snapshot.specialZoneEditor,
      inputs.defaultZoneType,
    );
    assignments.specialZoneEditor = {
      ...normalizedEditor,
      vertices: cloneEditorVertices(normalizedEditor.vertices),
    };
    updatedKeys.push("specialZoneEditor");
  }
  if (Object.hasOwn(assignments, "specialZoneLayers")) {
    target.specialZoneLayers = assignments.specialZoneLayers;
    target.specialZonesOverlayDirty = true;
  }
  if (Object.hasOwn(assignments, "specialZoneMembershipBrushMode")) {
    target.specialZoneMembershipBrushMode = assignments.specialZoneMembershipBrushMode;
  }
  if (Object.hasOwn(assignments, "specialZoneEditor")) {
    target.specialZoneEditor = assignments.specialZoneEditor;
  }
  return Object.freeze({ updatedKeys: Object.freeze(updatedKeys) });
}

export function setSpecialZoneMembershipBrushModeState(target, mode = "add") {
  assertStateTarget(target);
  const inputs = detachActionInputs({ mode });
  const nextMode = normalizeSpecialZoneMembershipBrushModeState(inputs.mode);
  target.specialZoneMembershipBrushMode = nextMode;
  return nextMode;
}

export function setSpecialZonePresetCategoryState(target, category = "all") {
  assertStateTarget(target);
  const nextCategory = String(category || "all").trim() || "all";
  target.specialZonePresetCategory = nextCategory;
  return nextCategory;
}

export function setSpecialZonePresetCategoryOpenState(
  target,
  category,
  isOpen,
) {
  assertStateTarget(target);
  const normalizedCategory = String(category || "").trim();
  const categoryDescriptor = Object.getOwnPropertyDescriptor(
    target,
    "specialZonePresetOpenCategories",
  );
  const descriptorValue = categoryDescriptor && Object.hasOwn(categoryDescriptor, "value")
    ? categoryDescriptor.value
    : null;
  if (!normalizedCategory) return Array.isArray(descriptorValue)
    ? descriptorValue
    : [];
  const openCategories = new Set(
    Array.isArray(descriptorValue)
      ? descriptorValue
      : descriptorValue instanceof Set
        ? descriptorValue
        : [],
  );
  if (isOpen) openCategories.add(normalizedCategory);
  else openCategories.delete(normalizedCategory);
  const nextOpenCategories = [...openCategories];
  target.specialZonePresetOpenCategories = nextOpenCategories;
  return nextOpenCategories;
}

export function ensureManualSpecialZonesState(target) {
  assertStateTarget(target);
  const descriptor = Object.getOwnPropertyDescriptor(target, "manualSpecialZones");
  const current = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
  if (
    !current
    || typeof current !== "object"
    || Array.isArray(current)
    || current.type !== "FeatureCollection"
  ) {
    const next = { type: "FeatureCollection", features: [] };
    target.manualSpecialZones = next;
    return next;
  } else if (!Array.isArray(current.features)) {
    const next = {
      ...current,
      features: [],
    };
    target.manualSpecialZones = next;
    return next;
  }
  target.manualSpecialZones = current;
  return current;
}

export function setSpecialZonesVisibilityState(target, value = true) {
  assertStateTarget(target);
  const nextVisible = Boolean(value);
  commitUiVisibilityState(target, { showSpecialZones: nextVisible });
  return nextVisible;
}

export function setSpecialZonesOverlayDirtyState(target, value = true) {
  assertStateTarget(target);
  const nextDirty = Boolean(value);
  target.specialZonesOverlayDirty = nextDirty;
  return nextDirty;
}

export function activateSpecialZoneMembershipToolState(target, tool = "multi") {
  if (!target || typeof target !== "object") return null;
  const normalizedTool = String(tool || "multi").trim() || "multi";
  target.specialZoneMembershipTool = normalizedTool;
  if (target.currentTool !== "special-zone-membership") {
    target.specialZonePreviousTool = String(target.currentTool || "fill");
  }
  target.currentTool = "special-zone-membership";
  target.brushModeEnabled = false;
  patchSpecialZoneEditorState(target, { active: false });
  return normalizedTool;
}

export function exitSpecialZoneMembershipToolState(target) {
  if (!target || typeof target !== "object") return "";
  const previousTool = String(target.specialZonePreviousTool || "fill");
  target.currentTool = previousTool;
  target.specialZonePreviousTool = "";
  return previousTool;
}

export function registerSpecialZonesWorkbenchRuntimeHooks(target, hooks = {}) {
  if (!target || typeof target !== "object") return;
  if (typeof hooks.renderWorkbench === "function") {
    target.updateSpecialZonesWorkbenchUIFn = hooks.renderWorkbench;
  }
  if (typeof hooks.renderCurrentTarget === "function") {
    target.updateSpecialZonesWorkbenchCurrentTargetUIFn = hooks.renderCurrentTarget;
  }
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "manualSpecialZones")) target.manualSpecialZones = patch.manualSpecialZones;
  if (Object.hasOwn(patch, "specialZoneEditor")) target.specialZoneEditor = patch.specialZoneEditor;
  if (Object.hasOwn(patch, "specialZoneLayers")) target.specialZoneLayers = patch.specialZoneLayers;
  if (Object.hasOwn(patch, "specialZoneMembershipBrushMode")) target.specialZoneMembershipBrushMode = patch.specialZoneMembershipBrushMode;
}
