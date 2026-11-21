import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { t } from "../js/ui/i18n.js";
import { formatShortcut, shortcuts } from "../js/ui/command_palette.js";
import { bindProjectFileDrop } from "../js/ui/project_file_drop.js";
import { createAppearanceReferenceOwner } from "../js/ui/toolbar/appearance_reference_owner.js";

function keyboard(context) {
  class Element {
    closest() { return null; }
  }
  const listeners = {};
  const nodes = {};
  for (const [key, value] of Object.entries({
    window: { addEventListener(type, handler) { listeners[type] = handler; } },
    document: { body: { dataset: {} }, getElementById: id => nodes[id], querySelectorAll: () => [] },
    Element,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  for (const [key, value] of Object.entries({ bootBlocking: false, startupReadonly: false, currentTool: "fill", brushModeEnabled: false })) {
    const previous = state[key];
    state[key] = value;
    context.after(() => { state[key] = previous; });
  }
  const pan = context.mock.fn();
  initShortcuts({ pan });
  const map = Object.assign(new Element(), { id: "mapContainer" });
  nodes.mapContainer = map;
  return { map, nodes, listeners, pan, press(key, target, options = {}) {
    const event = { key, target, preventDefault() { this.defaultPrevented = true; }, ...options };
    listeners.keydown(event);
    return !!event.defaultPrevented;
  } };
}

test("focused map pans by screen pixels, Shift increases distance and W elsewhere selects eraser", context => {
  const h = keyboard(context);
  for (const [key, dx, dy] of [["ArrowRight", -60, 0], ["a", 60, 0], ["w", 0, 60], ["s", 0, -60]]) {
    assert.ok(h.press(key, h.map));
    assert.deepEqual(h.pan.mock.calls.at(-1).arguments, [dx, dy]);
  }
  assert.ok(h.press("ArrowDown", h.map, { shiftKey: true }));
  assert.deepEqual(h.pan.mock.calls.at(-1).arguments, [0, -240]);
  assert.equal(h.press("ArrowLeft"), false);
  assert.ok(h.press("w"));
  assert.equal(state.currentTool, "eraser");
});

test("text placement hook is optional and Escape consumes an active brush stroke first", context => {
  const h = keyboard(context);
  assert.equal(h.press("t"), false);
  const text = context.mock.fn();
  registerRuntimeHook(state, "runMapTextToolFn", text);
  registerRuntimeHook(state, "cancelBrushStrokeFn", () => true);
  context.after(() => {
    registerRuntimeHook(state, "runMapTextToolFn", null);
    registerRuntimeHook(state, "cancelBrushStrokeFn", null);
  });
  assert.ok(h.press("t"));
  assert.equal(text.mock.callCount(), 1);
  state.brushModeEnabled = true;
  assert.ok(h.press("Escape"));
  assert.equal(state.brushModeEnabled, true);
  registerRuntimeHook(state, "cancelBrushStrokeFn", null);
  assert.ok(h.press("Escape"));
  assert.equal(state.brushModeEnabled, false);
});

test("question mark follows the help entry outside inputs and Alt previews the eyedropper", context => {
  const h = keyboard(context);
  const click = context.mock.fn();
  h.nodes.editorKeyboardShortcutsBtn = { click };
  const input = Object.assign(new Element(), { closest() { return this; } });
  assert.equal(h.press("?", input), false);
  assert.ok(h.press("?"));
  assert.equal(click.mock.callCount(), 1);
  const classes = new Set();
  h.map.classList = { add: key => classes.add(key), remove: key => classes.delete(key) };
  for (const tool of ["fill", "eraser"]) {
    state.currentTool = tool;
    h.press("Alt");
    assert.ok(classes.has("tool-eyedropper"));
    h.listeners.keyup({ key: "Alt" });
    assert.equal(classes.size, 0);
  }
  assert.equal(formatShortcut(["Mod+Shift+Z"], "MacIntel"), "⌘+Shift+Z");
  assert.equal(formatShortcut(["Mod+K"], "Win32"), "Ctrl+K");
});

test("dropping an image opens the reference controls and loads the image, other files show a toast", context => {
  const state = {};
  const opened = context.mock.fn();
  const nodes = {
    referenceImageInput: Object.assign(new EventTarget(), { dataset: {} }),
    referenceImage: { dataset: {}, style: {} },
    dockReferenceBtn: { click: opened },
  };
  const documentRef = { getElementById: id => nodes[id] };
  createAppearanceReferenceOwner({
    runtimeState: state, documentRef, urlApi: { createObjectURL: file => "blob:" + file.name },
  }).bindEvents();
  const map = Object.assign(new EventTarget(), { dataset: {}, ownerDocument: documentRef });
  const toast = context.mock.fn();
  registerRuntimeHook(state, "showToastFn", toast);
  context.after(() => registerRuntimeHook(state, "showToastFn", null));
  bindProjectFileDrop(map, state, key => key);
  function drop(name, type) {
    map.dispatchEvent(Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: { files: [{ name, type }] } }));
  }
  drop("terrain.png", "image/png");
  assert.equal(opened.mock.callCount(), 1);
  assert.equal(nodes.referenceImage.src, "blob:terrain.png");
  drop("notes.txt", "text/plain");
  assert.equal(toast.mock.calls.at(-1).arguments[0], "Only .json/.zip project files can be opened");
  delete nodes.referenceImageInput;
  drop("outline.png", "image/png");
  assert.equal(toast.mock.calls.at(-1).arguments[0], "Images can be used as a reference map");
});

test("zoom aliases dispatch a step and the shortcut reference and drop hint are localized", context => {
  const h = keyboard(context);
  const zoom = context.mock.fn();
  registerRuntimeHook(state, "runZoomStepFn", zoom);
  context.after(() => registerRuntimeHook(state, "runZoomStepFn", null));
  for (const key of ["+", "=", "-", "_"]) assert.ok(h.press(key, h.map));
  assert.deepEqual(zoom.mock.calls.map(call => call.arguments), [[1], [1], [-1], [-1]]);

  const before = state.currentLanguage;
  context.after(() => { state.currentLanguage = before; });
  state.currentLanguage = "zh";
  for (const { group, label } of shortcuts) {
    assert.notEqual(t(group, "ui"), group);
    assert.notEqual(t(label, "ui"), label);
  }
  assert.equal(t("Hold Alt and click to sample a color", "ui"), "按住 Alt 点击取色");
  assert.ok(t("No file selected", "ui").includes("拖到地图上"));
  state.currentLanguage = "en";
  assert.ok(t("No file selected", "ui").includes("drop a project file"));
});
