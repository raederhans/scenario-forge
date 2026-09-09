// Canonical strategic-overlay collection, editor, and dirty-state authority.
// Rendering, history orchestration, persistence, metrics, and UI effects stay in callers.

export const STRATEGIC_OVERLAY_COLLECTION_KEYS = Object.freeze([
  "operationalLines",
  "operationGraphics",
  "unitCounters",
]);

export const STRATEGIC_OVERLAY_DIRTY_KEYS = Object.freeze([
  "frontlineOverlayDirty",
  "operationalLinesDirty",
  "operationGraphicsDirty",
  "unitCountersDirty",
]);

export const STRATEGIC_OVERLAY_ENTITY_FIELD_KEYS = Object.freeze({
  operationalLines: Object.freeze([
    "kind", "label", "points", "stylePreset", "stroke", "width", "opacity",
    "attachedCounterIds",
  ]),
  operationGraphics: Object.freeze([
    "kind", "label", "points", "stylePreset", "stroke", "width", "opacity",
  ]),
  unitCounters: Object.freeze([
    "renderer", "label", "sidc", "symbolCode", "nationTag", "nationSource", "presetId",
    "iconId", "unitType", "echelon", "subLabel", "strengthText", "baseFillColor",
    "organizationPct", "equipmentPct", "statsPresetId", "statsSource", "size", "attachment",
    "layoutAnchor", "anchor", "facing", "zIndex",
  ]),
});

export const STRATEGIC_OVERLAY_EDITOR_FIELD_KEYS = Object.freeze({
  operationalLineEditor: Object.freeze([
    "active", "mode", "points", "kind", "label", "stylePreset", "stroke", "width",
    "opacity", "selectedId", "selectedVertexIndex", "counter",
  ]),
  operationGraphicsEditor: Object.freeze([
    "active", "mode", "collection", "points", "kind", "label", "stylePreset", "stroke",
    "width", "opacity", "selectedId", "selectedVertexIndex", "counter",
  ]),
  unitCounterEditor: Object.freeze([
    "active", "renderer", "label", "sidc", "symbolCode", "nationTag", "nationSource",
    "presetId", "iconId", "unitType", "echelon", "subLabel", "strengthText", "layoutAnchor",
    "attachment", "baseFillColor", "organizationPct", "equipmentPct", "statsPresetId",
    "statsSource", "size", "selectedId", "returnSelectionId", "counter",
  ]),
  strategicOverlayUi: Object.freeze([
    "activeMode", "modalOpen", "modalSection", "modalEntityId", "modalEntityType",
    "counterEditorModalOpen", "counterCatalogSource", "counterCatalogCategory",
    "counterCatalogQuery", "hoi4CounterCategory", "hoi4CounterQuery", "hoi4CounterVariant",
  ]),
});

const COLLECTION_DIRTY_KEY = Object.freeze({
  operationalLines: "operationalLinesDirty",
  operationGraphics: "operationGraphicsDirty",
  unitCounters: "unitCountersDirty",
});

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[strategic_overlay_actions] target must be an object");
  }
}

function assertPatch(patch, label) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError(`[strategic_overlay_actions] ${label} must be an object`);
  }
}

function cloneStateValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) return new Map(Array.from(value, ([key, entry]) => [cloneStateValue(key), cloneStateValue(entry)]));
  if (value instanceof Set) return new Set(Array.from(value, cloneStateValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneStateValue(entry)]));
  }
  return value;
}

function detachActionInputs(inputs) {
  return { ...inputs };
}

function prepareCollectionPatch(patch, cloneValue, { markDirty }) {
  assertPatch(patch, "collection patch");
  const assignments = {};
  const updatedKeys = [];
  for (const key of Object.keys(patch)) {
    if (!STRATEGIC_OVERLAY_COLLECTION_KEYS.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown collection key: ${key}`);
    }
    if (!Array.isArray(patch[key])) {
      throw new TypeError(`[strategic_overlay_actions] ${key} must be an array`);
    }
    assignments[key] = cloneValue(patch[key]);
    if (markDirty) assignments[COLLECTION_DIRTY_KEY[key]] = true;
    updatedKeys.push(key);
  }
  return { assignments, updatedKeys };
}

function prepareEntityPatch(collectionKey, patch, cloneValue) {
  const allowedFields = STRATEGIC_OVERLAY_ENTITY_FIELD_KEYS[collectionKey];
  if (!allowedFields) {
    throw new Error(`[strategic_overlay_actions] unknown entity collection key: ${collectionKey}`);
  }
  assertPatch(patch, `${collectionKey} entity patch`);
  const assignments = {};
  for (const key of Object.keys(patch)) {
    if (!allowedFields.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown ${collectionKey} entity field: ${key}`);
    }
    assignments[key] = cloneValue(patch[key]);
  }
  return assignments;
}

export function commitStrategicOverlayCollectionsState(
  target,
  patch,
  { cloneValue = cloneStateValue, markDirty = true } = {},
) {
  assertStateTarget(target);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[strategic_overlay_actions] collection patch must be an object");
  }
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!STRATEGIC_OVERLAY_COLLECTION_KEYS.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown collection key: ${key}`);
    }
  }
  for (const key of patchKeys) {
    if (!Array.isArray(patch[key])) {
      throw new TypeError(`[strategic_overlay_actions] ${key} must be an array`);
    }
  }
  if (typeof cloneValue !== "function") {
    throw new TypeError("[strategic_overlay_actions] cloneValue must be a function");
  }
  const detachedPatch = Object.fromEntries(patchKeys.map((key) => [key, patch[key]]));
  const inputs = detachActionInputs({ patch: detachedPatch, cloneValue, markDirty });
  const prepared = prepareCollectionPatch(
    inputs.patch,
    inputs.cloneValue,
    { markDirty: inputs.markDirty !== false },
  );
  if (Object.hasOwn(prepared.assignments, "operationalLines")) {
    target.operationalLines = prepared.assignments.operationalLines;
  }
  if (Object.hasOwn(prepared.assignments, "operationalLinesDirty")) {
    target.operationalLinesDirty = prepared.assignments.operationalLinesDirty;
  }
  if (Object.hasOwn(prepared.assignments, "operationGraphics")) {
    target.operationGraphics = prepared.assignments.operationGraphics;
  }
  if (Object.hasOwn(prepared.assignments, "operationGraphicsDirty")) {
    target.operationGraphicsDirty = prepared.assignments.operationGraphicsDirty;
  }
  if (Object.hasOwn(prepared.assignments, "unitCounters")) {
    target.unitCounters = prepared.assignments.unitCounters;
  }
  if (Object.hasOwn(prepared.assignments, "unitCountersDirty")) {
    target.unitCountersDirty = prepared.assignments.unitCountersDirty;
  }
  return Object.freeze({ updatedKeys: Object.freeze([...prepared.updatedKeys]) });
}

export function restoreStrategicOverlaySnapshotState(
  target,
  snapshot,
  { cloneValue = cloneStateValue, markDirty = true } = {},
) {
  assertStateTarget(target);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("[strategic_overlay_actions] snapshot must be an object");
  }
  const collectionPatch = {};
  for (const key of STRATEGIC_OVERLAY_COLLECTION_KEYS) {
    if (Object.hasOwn(snapshot, key) && Array.isArray(snapshot[key])) {
      collectionPatch[key] = snapshot[key];
    }
  }
  const inputs = detachActionInputs({ collectionPatch, options: { cloneValue, markDirty } });
  return commitStrategicOverlayCollectionsState(target, inputs.collectionPatch, inputs.options);
}

export function patchStrategicOverlayEntityGroupState(
  target,
  collectionKey,
  entityPatches,
  { cloneValue = cloneStateValue, markDirty = true } = {},
) {
  assertStateTarget(target);
  const allowedFields = STRATEGIC_OVERLAY_ENTITY_FIELD_KEYS[collectionKey];
  if (!allowedFields) {
    throw new Error(`[strategic_overlay_actions] unknown entity collection key: ${collectionKey}`);
  }
  const normalizedCollectionKey = detachActionInputs({ collectionKey }).collectionKey;
  const sourceCollection = normalizedCollectionKey === "operationalLines"
    ? target.operationalLines
    : normalizedCollectionKey === "operationGraphics"
      ? target.operationGraphics
      : target.unitCounters;
  if (!Array.isArray(sourceCollection)) {
    throw new TypeError(`[strategic_overlay_actions] ${normalizedCollectionKey} must be an array`);
  }
  if (!Array.isArray(entityPatches)) {
    throw new TypeError("[strategic_overlay_actions] entity patches must be an array");
  }
  for (const entry of entityPatches) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("[strategic_overlay_actions] entity patch entry must be an object");
    }
    if (!entry.patch || typeof entry.patch !== "object" || Array.isArray(entry.patch)) {
      throw new TypeError(`[strategic_overlay_actions] ${normalizedCollectionKey} entity patch must be an object`);
    }
    for (const key of Object.keys(entry.patch)) {
      if (!allowedFields.includes(key)) {
        throw new Error(`[strategic_overlay_actions] unknown ${normalizedCollectionKey} entity field: ${key}`);
      }
    }
  }
  if (typeof cloneValue !== "function") {
    throw new TypeError("[strategic_overlay_actions] cloneValue must be a function");
  }
  const detachedEntityPatches = Array.from(entityPatches, (entry) => ({
    entityId: entry.entityId,
    patch: { ...entry.patch },
  }));
  const inputs = detachActionInputs({
    collectionKey: normalizedCollectionKey,
    entityPatches: detachedEntityPatches,
    cloneValue,
    markDirty,
  });
  const patchById = new Map();
  for (const entry of inputs.entityPatches) {
    assertPatch(entry, "entity patch entry");
    const entityId = String(entry.entityId || "").trim();
    if (!entityId) {
      throw new Error("[strategic_overlay_actions] entityId is required");
    }
    if (patchById.has(entityId)) {
      throw new Error(`[strategic_overlay_actions] duplicate entityId: ${entityId}`);
    }
    const assignments = prepareEntityPatch(inputs.collectionKey, entry.patch, inputs.cloneValue);
    if (Object.keys(assignments).length) patchById.set(entityId, assignments);
  }
  if (!patchById.size) {
    return Object.freeze({
      changedEntityIds: Object.freeze([]),
      collectionKey: inputs.collectionKey,
    });
  }

  const changedEntityIds = [];
  const nextCollection = Array.from(sourceCollection, (entity) => {
    const entityId = String(entity?.id || "").trim();
    const assignments = patchById.get(entityId);
    if (!assignments) return entity;
    changedEntityIds.push(entityId);
    return { ...entity, ...assignments };
  });
  if (changedEntityIds.length) {
    if (inputs.collectionKey === "operationalLines") {
      target.operationalLines = nextCollection;
      if (inputs.markDirty !== false) target.operationalLinesDirty = true;
    } else if (inputs.collectionKey === "operationGraphics") {
      target.operationGraphics = nextCollection;
      if (inputs.markDirty !== false) target.operationGraphicsDirty = true;
    } else {
      target.unitCounters = nextCollection;
      if (inputs.markDirty !== false) target.unitCountersDirty = true;
    }
  }
  return Object.freeze({
    changedEntityIds: Object.freeze(changedEntityIds),
    collectionKey: inputs.collectionKey,
  });
}

export function patchStrategicOverlayEntityState(
  target,
  collectionKey,
  entityId,
  patch,
  { cloneValue = cloneStateValue, markDirty = true } = {},
) {
  assertStateTarget(target);
  const allowedFields = STRATEGIC_OVERLAY_ENTITY_FIELD_KEYS[collectionKey];
  if (!allowedFields) {
    throw new Error(`[strategic_overlay_actions] unknown entity collection key: ${collectionKey}`);
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError(`[strategic_overlay_actions] ${collectionKey} entity patch must be an object`);
  }
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!allowedFields.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown ${collectionKey} entity field: ${key}`);
    }
  }
  const normalizedEntityId = String(detachActionInputs({ entityId }).entityId || "").trim();
  if (!normalizedEntityId) {
    throw new Error("[strategic_overlay_actions] entityId is required");
  }
  const inputs = detachActionInputs({
    collectionKey,
    patch: Object.fromEntries(patchKeys.map((key) => [key, patch[key]])),
    options: { cloneValue, markDirty },
  });
  const result = patchStrategicOverlayEntityGroupState(
    target,
    inputs.collectionKey,
    [{ entityId: normalizedEntityId, patch: inputs.patch }],
    inputs.options,
  );
  return Object.freeze({
    changed: result.changedEntityIds.length === 1,
    entityId: normalizedEntityId,
    collectionKey: inputs.collectionKey,
  });
}

export function patchStrategicOverlayEditorState(
  target,
  editorKey,
  patch,
  { cloneValue = cloneStateValue } = {},
) {
  assertStateTarget(target);
  const allowedFields = STRATEGIC_OVERLAY_EDITOR_FIELD_KEYS[editorKey];
  if (!allowedFields) {
    throw new Error(`[strategic_overlay_actions] unknown editor key: ${editorKey}`);
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError(`[strategic_overlay_actions] ${editorKey} patch must be an object`);
  }
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!allowedFields.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown ${editorKey} field: ${key}`);
    }
  }
  if (typeof cloneValue !== "function") {
    throw new TypeError("[strategic_overlay_actions] cloneValue must be a function");
  }
  const inputs = detachActionInputs({
    editorKey,
    patch: Object.fromEntries(patchKeys.map((key) => [key, patch[key]])),
    cloneValue,
  });
  const descriptor = Object.getOwnPropertyDescriptor(target, inputs.editorKey);
  const descriptorValue = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
  const current = descriptorValue && typeof descriptorValue === "object" && !Array.isArray(descriptorValue)
    ? descriptorValue
    : {};
  const assignments = {};
  for (const key of Object.keys(inputs.patch)) {
    if (!allowedFields.includes(key)) {
      throw new Error(`[strategic_overlay_actions] unknown ${inputs.editorKey} field: ${key}`);
    }
    assignments[key] = inputs.cloneValue(inputs.patch[key]);
  }
  Object.assign(current, assignments);
  if (inputs.editorKey === "operationalLineEditor") {
    target.operationalLineEditor = current;
  } else if (inputs.editorKey === "operationGraphicsEditor") {
    target.operationGraphicsEditor = current;
  } else if (inputs.editorKey === "unitCounterEditor") {
    target.unitCounterEditor = current;
  } else {
    target.strategicOverlayUi = current;
  }
  return current;
}

export function setStrategicOverlayDirtyState(target, dirtyKey, value = true) {
  assertStateTarget(target);
  if (
    dirtyKey !== "frontlineOverlayDirty"
    && dirtyKey !== "operationalLinesDirty"
    && dirtyKey !== "operationGraphicsDirty"
    && dirtyKey !== "unitCountersDirty"
  ) {
    throw new Error(`[strategic_overlay_actions] unknown dirty key: ${dirtyKey}`);
  }
  const inputs = detachActionInputs({ dirtyKey, value });
  const nextValue = Boolean(inputs.value);
  if (inputs.dirtyKey === "frontlineOverlayDirty") {
    target.frontlineOverlayDirty = nextValue;
  } else if (inputs.dirtyKey === "operationalLinesDirty") {
    target.operationalLinesDirty = nextValue;
  } else if (inputs.dirtyKey === "operationGraphicsDirty") {
    target.operationGraphicsDirty = nextValue;
  } else {
    target.unitCountersDirty = nextValue;
  }
  return nextValue;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "operationGraphics")) target.operationGraphics = patch.operationGraphics;
  if (Object.hasOwn(patch, "operationGraphicsDirty")) target.operationGraphicsDirty = patch.operationGraphicsDirty;
  if (Object.hasOwn(patch, "operationGraphicsEditor")) target.operationGraphicsEditor = patch.operationGraphicsEditor;
  if (Object.hasOwn(patch, "operationalLineEditor")) target.operationalLineEditor = patch.operationalLineEditor;
  if (Object.hasOwn(patch, "operationalLines")) target.operationalLines = patch.operationalLines;
  if (Object.hasOwn(patch, "operationalLinesDirty")) target.operationalLinesDirty = patch.operationalLinesDirty;
  if (Object.hasOwn(patch, "strategicOverlayUi")) target.strategicOverlayUi = patch.strategicOverlayUi;
  if (Object.hasOwn(patch, "unitCounterEditor")) target.unitCounterEditor = patch.unitCounterEditor;
  if (Object.hasOwn(patch, "unitCounters")) target.unitCounters = patch.unitCounters;
  if (Object.hasOwn(patch, "unitCountersDirty")) target.unitCountersDirty = patch.unitCountersDirty;
}
