// Canonical special-zone layer, editor, membership-tool, hook-registration, and dirty-state authority.
// Persistence, rendering, UI feedback, metrics, and runtime hook invocation stay in callers.

import {
  mutateSpecialZoneLayersState,
  normalizeSpecialZoneLayersState,
  normalizeSpecialZoneMembershipBrushModeState,
} from "../../special_zone_layers.js";
import { createDefaultSpecialZoneEditorState } from "../strategic_overlay_state.js";
import { commitUiVisibilityState } from "./ui_visibility_actions.js";
import { SPECIAL_ZONE_LEGEND_STYLE_KEYS } from "../../legend_csv_schema.js";

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

function cloneSpecialZoneLegendSnapshotValue(value) {
  return value !== null && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function restoreSpecialZoneLegendFieldsWithPresence(layer, patch) {
  const presence = patch.presence;
  const next = { ...layer };
  if (presence.name) next.name = cloneSpecialZoneLegendSnapshotValue(patch.name);
  else delete next.name;
  const currentStyle = layer.style && typeof layer.style === "object" && !Array.isArray(layer.style)
    ? layer.style : {};
  if (presence.style && presence.styleObject) {
    const style = { ...currentStyle };
    const presentKeys = new Set(presence.styleKeys);
    for (const key of SPECIAL_ZONE_LEGEND_STYLE_KEYS) {
      if (presentKeys.has(key)) {
        const value = patch.style && Object.hasOwn(patch.style, key) ? patch.style[key] : undefined;
        style[key] = cloneSpecialZoneLegendSnapshotValue(value);
      } else delete style[key];
    }
    next.style = style;
  } else {
    // Preserve any later unknown style metadata even when the old container was absent/null.
    const unknownStyle = Object.fromEntries(Object.entries(currentStyle)
      .filter(([key]) => !SPECIAL_ZONE_LEGEND_STYLE_KEYS.includes(key)));
    if (Object.keys(unknownStyle).length) next.style = unknownStyle;
    else if (presence.style) next.style = cloneSpecialZoneLegendSnapshotValue(patch.styleContainerValue);
    else delete next.style;
  }
  return next;
}

function applySpecialZoneLegendFieldsState(target, patchesById, restoreMissing) {
  assertStateTarget(target);
  if (!patchesById || typeof patchesById !== "object" || Array.isArray(patchesById)) return [];
  const current = target.specialZoneLayers;
  if (!current || typeof current !== "object" || !Array.isArray(current.layers)) return [];
  const counts = new Map();
  current.layers.forEach(layer => {
    if (layer && typeof layer.id === "string" && layer.id) {
      counts.set(layer.id, (counts.get(layer.id) || 0) + 1);
    }
  });
  const updatedIds = [];
  const layers = current.layers.map(layer => {
    if (!layer || counts.get(layer.id) !== 1 || !Object.hasOwn(patchesById, layer.id)) return layer;
    const patch = patchesById[layer.id];
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return layer;
    const presence = patch.presence;
    if (restoreMissing && presence && typeof presence === "object" && !Array.isArray(presence)
      && typeof presence.name === "boolean" && typeof presence.style === "boolean"
      && typeof presence.styleObject === "boolean" && Array.isArray(presence.styleKeys)) {
      updatedIds.push(layer.id);
      return restoreSpecialZoneLegendFieldsWithPresence(layer, patch);
    }
    let next = null;
    if (Object.hasOwn(patch, "name")
      && (typeof patch.name === "string" || (restoreMissing && patch.name == null))) {
      next = { ...layer };
      if (restoreMissing && patch.name == null) delete next.name;
      else next.name = patch.name;
    }
    const stylePatch = patch.style;
    if (stylePatch && typeof stylePatch === "object" && !Array.isArray(stylePatch)) {
      let style = null;
      for (const key of SPECIAL_ZONE_LEGEND_STYLE_KEYS) {
        if (!Object.hasOwn(stylePatch, key)) continue;
        const value = stylePatch[key];
        const scalar = ["fill", "stroke", "pattern"].includes(key)
          ? typeof value === "string"
          : typeof value === "number" && Number.isFinite(value);
        if (!restoreMissing && !scalar) continue;
        style ||= { ...layer.style };
        if (restoreMissing && value == null) delete style[key];
        else style[key] = restoreMissing ? cloneSpecialZoneLegendSnapshotValue(value) : value;
      }
      if (style) next = { ...(next || layer), style };
    }
    if (!next) return layer;
    updatedIds.push(layer.id);
    return next;
  });
  if (updatedIds.length) {
    target.specialZoneLayers = { ...current, layers };
    target.specialZonesOverlayDirty = true;
  }
  return updatedIds;
}

// Callers validate CSV scope, confirmation, and values before applying these fields.
// No collection normalization: memberships and unknown metadata stay untouched.
export function patchSpecialZoneLegendFieldsState(target, patchesById) {
  return applySpecialZoneLegendFieldsState(target, patchesById, false);
}

export function restoreSpecialZoneLegendSnapshotState(target, snapshotJson) {
  assertStateTarget(target);
  if (typeof snapshotJson !== "string") return [];
  let snapshotById;
  try { snapshotById = JSON.parse(snapshotJson); } catch { return []; }
  return applySpecialZoneLegendFieldsState(target, snapshotById, true);
}
