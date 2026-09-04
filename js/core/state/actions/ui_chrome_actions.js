// Canonical UI chrome mutations. DOM, URL, focus, and persistence effects remain with callers.

const BOOLEAN_UI_CHROME_FIELDS = Object.freeze([
  "dockCollapsed",
  "scenarioBarCollapsed",
  "scenarioGuideDismissed",
  "tutorialEntryVisible",
  "tutorialDismissed",
  "politicalEditingExpanded",
  "scenarioVisualAdjustmentsOpen",
  "developerMode",
  "devWorkspaceExpanded",
  "overlayResizeBound",
]);

const STRING_UI_CHROME_FIELDS = Object.freeze([
  "devWorkspaceCategory",
  "rightSidebarTab",
  "responsiveChromeTier",
]);

const DEFAULT_UI_CHROME_STATE = Object.freeze({
  dockCollapsed: false,
  scenarioBarCollapsed: false,
  scenarioGuideDismissed: false,
  tutorialEntryVisible: true,
  tutorialDismissed: false,
  politicalEditingExpanded: false,
  scenarioVisualAdjustmentsOpen: false,
  developerMode: false,
  devWorkspaceExpanded: false,
  overlayResizeBound: false,
  devWorkspaceCategory: "selection",
  rightSidebarTab: "inspector",
  responsiveChromeTier: "",
  paletteLibrarySections: Object.freeze({}),
});

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

function isPlainRecord(value) {
  if (!isStateTarget(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRecord(value) {
  if (!isPlainRecord(value)) return {};
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
    throw new TypeError(`[ui_chrome_actions] ${fieldName} must be writable owner state`);
  }
  Object.defineProperty(target, fieldName, {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
  return value;
}

function ensureOwnPlainRecord(target, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  if (
    descriptor
    && Object.hasOwn(descriptor, "value")
    && isPlainRecord(descriptor.value)
  ) return descriptor.value;
  const source = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : getInheritedDataValue(target, fieldName);
  return setOwnDataValue(target, fieldName, cloneRecord(source));
}

export function ensureUiChromeState(target) {
  if (!isStateTarget(target)) return {};
  const ui = ensureOwnPlainRecord(target, "ui");
  BOOLEAN_UI_CHROME_FIELDS.forEach((field) => {
    setOwnDataValue(
      ui,
      field,
      Object.hasOwn(ui, field) ? !!ui[field] : DEFAULT_UI_CHROME_STATE[field],
    );
  });
  STRING_UI_CHROME_FIELDS.forEach((field) => {
    setOwnDataValue(
      ui,
      field,
      Object.hasOwn(ui, field)
        ? String(ui[field] || "").trim()
        : DEFAULT_UI_CHROME_STATE[field],
    );
  });
  ensureOwnPlainRecord(ui, "paletteLibrarySections");
  if (Object.hasOwn(ui, "restoredSupportSurfaceViewFromUrl")) {
    setOwnDataValue(
      ui,
      "restoredSupportSurfaceViewFromUrl",
      String(ui.restoredSupportSurfaceViewFromUrl || "").trim().toLowerCase(),
    );
  }
  return ui;
}

export function patchUiChromeState(target, patch = {}) {
  const ui = ensureUiChromeState(target);
  if (!isStateTarget(target) || !isStateTarget(patch)) return ui;
  BOOLEAN_UI_CHROME_FIELDS.forEach((field) => {
    if (Object.hasOwn(patch, field)) setOwnDataValue(ui, field, !!patch[field]);
  });
  STRING_UI_CHROME_FIELDS.forEach((field) => {
    if (Object.hasOwn(patch, field)) {
      setOwnDataValue(ui, field, String(patch[field] || "").trim());
    }
  });
  if (Object.hasOwn(patch, "paletteLibrarySections")) {
    setOwnDataValue(ui, "paletteLibrarySections", cloneRecord(patch.paletteLibrarySections));
  }
  if (Object.hasOwn(patch, "restoredSupportSurfaceViewFromUrl")) {
    setRestoredSupportSurfaceViewState(target, patch.restoredSupportSurfaceViewFromUrl);
  }
  return ui;
}

export function setActiveDockPopoverState(target, nextKind = "") {
  if (!isStateTarget(target)) return "";
  return setOwnDataValue(target, "activeDockPopover", String(nextKind || "").trim());
}

export function setRestoredSupportSurfaceViewState(target, nextView = "") {
  if (!isStateTarget(target)) return "";
  const ui = ensureUiChromeState(target);
  return setOwnDataValue(
    ui,
    "restoredSupportSurfaceViewFromUrl",
    String(nextView || "").trim(),
  );
}
