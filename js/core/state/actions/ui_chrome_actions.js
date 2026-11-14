import { getInheritedDataValue } from "./appearance_actions.js";
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

function setOwnDataValue(target, fieldName, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, fieldName);
  if (
    descriptor
    && !descriptor.configurable
    && (!Object.hasOwn(descriptor, "value") || !descriptor.writable)
  ) {
    throw new TypeError(`[ui_chrome_actions] ${fieldName} must be writable owner state`);
  }
  const attributes = {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
  };
  switch (fieldName) {
    case "ui": Object.defineProperty(target, "ui", { ...attributes, value }); break;
    case "activeDockPopover": Object.defineProperty(target, "activeDockPopover", { ...attributes, value }); break;
    default: throw new RangeError(`[ui_chrome_actions] unsupported owner field: ${fieldName}`);
  }
  return value;
}

function setUiBooleanField(target, field, value) {
  switch (field) {
    case "dockCollapsed": target.ui.dockCollapsed = value; break;
    case "scenarioBarCollapsed": target.ui.scenarioBarCollapsed = value; break;
    case "scenarioGuideDismissed": target.ui.scenarioGuideDismissed = value; break;
    case "tutorialEntryVisible": target.ui.tutorialEntryVisible = value; break;
    case "tutorialDismissed": target.ui.tutorialDismissed = value; break;
    case "politicalEditingExpanded": target.ui.politicalEditingExpanded = value; break;
    case "scenarioVisualAdjustmentsOpen": target.ui.scenarioVisualAdjustmentsOpen = value; break;
    case "developerMode": target.ui.developerMode = value; break;
    case "devWorkspaceExpanded": target.ui.devWorkspaceExpanded = value; break;
    case "overlayResizeBound": target.ui.overlayResizeBound = value; break;
    default: break;
  }
}

function setUiStringField(target, field, value) {
  switch (field) {
    case "devWorkspaceCategory": target.ui.devWorkspaceCategory = value; break;
    case "rightSidebarTab": target.ui.rightSidebarTab = value; break;
    case "responsiveChromeTier": target.ui.responsiveChromeTier = value; break;
    default: break;
  }
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
    setUiBooleanField(
      target,
      field,
      Object.hasOwn(ui, field) ? !!ui[field] : DEFAULT_UI_CHROME_STATE[field],
    );
  });
  STRING_UI_CHROME_FIELDS.forEach((field) => {
    setUiStringField(
      target,
      field,
      Object.hasOwn(ui, field)
        ? String(ui[field] || "").trim()
        : DEFAULT_UI_CHROME_STATE[field],
    );
  });
  if (!isPlainRecord(ui.paletteLibrarySections)) {
    target.ui.paletteLibrarySections = {};
  } else {
    target.ui.paletteLibrarySections = cloneRecord(ui.paletteLibrarySections);
  }
  if (Object.hasOwn(ui, "restoredSupportSurfaceViewFromUrl")) {
    target.ui.restoredSupportSurfaceViewFromUrl = String(
      ui.restoredSupportSurfaceViewFromUrl || "",
    ).trim().toLowerCase();
  }
  return ui;
}

export function setUiChromeState(target, value) {
  if (!isStateTarget(target)) return value;
  return setOwnDataValue(target, "ui", value);
}

export function patchUiChromeState(
  target,
  patch = {},
  { normalizeExisting = true } = {},
) {
  const ui = !isStateTarget(target)
    ? {}
    : normalizeExisting
      ? ensureUiChromeState(target)
      : ensureOwnPlainRecord(target, "ui");
  if (!isStateTarget(target) || !isStateTarget(patch)) return ui;
  const detachedPatch = { ...patch };
  BOOLEAN_UI_CHROME_FIELDS.forEach((field) => {
    if (Object.hasOwn(detachedPatch, field)) {
      setUiBooleanField(target, field, !!detachedPatch[field]);
    }
  });
  STRING_UI_CHROME_FIELDS.forEach((field) => {
    if (Object.hasOwn(detachedPatch, field)) {
      setUiStringField(target, field, String(detachedPatch[field] || "").trim());
    }
  });
  if (Object.hasOwn(detachedPatch, "paletteLibrarySections")) {
    const sections = cloneRecord(detachedPatch.paletteLibrarySections);
    target.ui.paletteLibrarySections = sections;
  }
  if (Object.hasOwn(detachedPatch, "restoredSupportSurfaceViewFromUrl")) {
    const restoredView = String(
      detachedPatch.restoredSupportSurfaceViewFromUrl || "",
    ).trim();
    setRestoredSupportSurfaceViewState(target, restoredView);
  }
  return ui;
}

export function setActiveDockPopoverState(target, nextKind = "") {
  if (!isStateTarget(target)) return "";
  return setOwnDataValue(target, "activeDockPopover", String(nextKind || "").trim());
}

export function setRestoredSupportSurfaceViewState(target, nextView = "") {
  if (!isStateTarget(target)) return "";
  ensureUiChromeState(target);
  const normalizedView = String(nextView || "").trim();
  target.ui.restoredSupportSurfaceViewFromUrl = normalizedView;
  return normalizedView;
}
