// Canonical appearance style state mutations. UI/render effects stay in callers.

export const APPEARANCE_STYLE_GROUP_KEYS = Object.freeze([
  "ocean", "lakes", "internalBorders", "empireBorders", "coastlines",
  "parentBorders", "physical", "urban", "cityPoints", "rivers",
  "texture", "dayNight", "transportOverview",
]);

function assertTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[appearance_actions] target must be an object");
  }
}
function normalizeGroup(group) {
  const normalizedGroup = APPEARANCE_STYLE_GROUP_KEYS.find(
    (candidate) => candidate === group,
  );
  if (!normalizedGroup) {
    throw new RangeError(`[appearance_actions] unknown style group: ${group}`);
  }
  return normalizedGroup;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneDetached(value) {
  if (!value || typeof value !== "object") return value;
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

function assertOwnDataValueWritable(target, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  if (
    descriptor
    && Object.hasOwn(descriptor, "value")
    && !descriptor.writable
    && !descriptor.configurable
  ) {
    throw new TypeError(`[appearance_actions] ${fieldName} must be writable owner state`);
  }
  if (descriptor && !Object.hasOwn(descriptor, "value") && !descriptor.configurable) {
    throw new TypeError(`[appearance_actions] ${fieldName} must be writable owner state`);
  }
  if (!descriptor && !Object.isExtensible(target)) {
    throw new TypeError(`[appearance_actions] ${fieldName} target must be extensible`);
  }
  return descriptor;
}

function writeStyleConfigOwnDataValue(target, value) {
  const descriptor = assertOwnDataValueWritable(target, "styleConfig");
  if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) {
    target.styleConfig = value;
    return value;
  }
  Object.defineProperty(target, "styleConfig", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
  return value;
}

function writeParentBorderEnabledMapOwnDataValue(target, value) {
  const descriptor = assertOwnDataValueWritable(
    target,
    "parentBorderEnabledByCountry",
  );
  if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) {
    target.parentBorderEnabledByCountry = value;
    return value;
  }
  Object.defineProperty(target, "parentBorderEnabledByCountry", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
  return value;
}

function setStylePathOwnDataValue(target, fieldName, value) {
  const descriptor = assertOwnDataValueWritable(target, fieldName);
  if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) {
    target[fieldName] = value;
    return value;
  }
  Object.defineProperty(target, fieldName, {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
  return value;
}

function ensureOwnStylePathRecord(target, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  if (
    descriptor
    && Object.hasOwn(descriptor, "value")
    && isPlainRecord(descriptor.value)
  ) return descriptor.value;
  const source = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : getInheritedDataValue(target, fieldName);
  const next = isPlainRecord(source) ? cloneDetached(source) : {};
  return setStylePathOwnDataValue(target, fieldName, next);
}

function normalizeBooleanRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`[appearance_actions] ${label} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, enabled]) => [key, Boolean(enabled)]),
  );
}

export function ensureAppearanceStyleConfigState(target) {
  assertTarget(target);
  const descriptor = Object.getOwnPropertyDescriptor(target, "styleConfig");
  if (
    descriptor
    && Object.hasOwn(descriptor, "value")
    && isPlainRecord(descriptor.value)
  ) return descriptor.value;
  const source = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : getInheritedDataValue(target, "styleConfig");
  const next = isPlainRecord(source) ? cloneDetached(source) : {};
  return writeStyleConfigOwnDataValue(target, next);
}

export function setAppearanceStyleConfigState(
  target,
  value,
  { validate = true } = {},
) {
  assertTarget(target);
  if (
    validate
    && (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    throw new TypeError("[appearance_actions] style config must be an object");
  }
  return writeStyleConfigOwnDataValue(target, value);
}

export function setAppearanceStyleGroupState(target, group, value) {
  assertTarget(target);
  const normalizedGroup = normalizeGroup(group);
  const styleConfig = ensureAppearanceStyleConfigState(target);
  return setStylePathOwnDataValue(styleConfig, normalizedGroup, value);
}

export function patchAppearanceStyleGroupState(
  target,
  group,
  patch,
  { preserveGroupIdentity = false } = {},
) {
  assertTarget(target);
  const normalizedGroup = normalizeGroup(group);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[appearance_actions] patch must be an object");
  }
  const styleConfig = ensureAppearanceStyleConfigState(target);
  const descriptor = Object.getOwnPropertyDescriptor(styleConfig, normalizedGroup);
  const current = descriptor
    && Object.hasOwn(descriptor, "value")
    && isPlainRecord(descriptor.value)
    ? descriptor.value
    : {};
  if (preserveGroupIdentity && current === descriptor?.value) {
    Object.assign(current, { ...patch });
    return current;
  }
  return setStylePathOwnDataValue(styleConfig, normalizedGroup, { ...current, ...patch });
}

export function applyAppearanceStylePathPatchState(target, stylePatch) {
  assertTarget(target);
  if (!stylePatch || typeof stylePatch !== "object" || Array.isArray(stylePatch)) {
    return ensureAppearanceStyleConfigState(target);
  }
  const styleConfig = ensureAppearanceStyleConfigState(target);
  Object.entries(stylePatch).forEach(([path, value]) => {
    const segments = String(path || "").split(".").filter(Boolean);
    if (!segments.length) return;
    let cursor = styleConfig;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      cursor = ensureOwnStylePathRecord(cursor, segment);
    }
    const last = segments[segments.length - 1];
    if (value === null || value === undefined) {
      delete cursor[last];
    } else {
      setStylePathOwnDataValue(cursor, last, value);
    }
  });
  return styleConfig;
}

export function setAppearanceParentBorderEnabledMapState(
  target,
  value,
  { normalize = true } = {},
) {
  assertTarget(target);
  if (!normalize) {
    const descriptor = assertOwnDataValueWritable(
      target,
      "parentBorderEnabledByCountry",
    );
    if (!(descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable)) {
      Object.defineProperty(target, "parentBorderEnabledByCountry", {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        value: undefined,
        writable: true,
      });
    }
    target.parentBorderEnabledByCountry = value;
    return value;
  }
  return writeParentBorderEnabledMapOwnDataValue(
    target,
    normalizeBooleanRecord(value, "enabled map"),
  );
}

export function patchAppearanceParentBorderEnabledMapState(target, patch) {
  assertTarget(target);
  const currentDescriptor = Object.getOwnPropertyDescriptor(target, "parentBorderEnabledByCountry");
  const current = currentDescriptor
    && Object.hasOwn(currentDescriptor, "value")
    && isPlainRecord(currentDescriptor.value)
    ? currentDescriptor.value
    : {};
  const nextPatch = normalizeBooleanRecord(patch, "enabled-map patch");
  return setAppearanceParentBorderEnabledMapState(target, { ...current, ...nextPatch });
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "parentBorderEnabledByCountry")) target.parentBorderEnabledByCountry = patch.parentBorderEnabledByCountry;
  if (Object.hasOwn(patch, "styleConfig")) target.styleConfig = patch.styleConfig;
}
