import assert from "node:assert/strict";
import test from "node:test";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { state } from "../js/core/state.js";
import { shortcutLabel } from "../js/ui/command_palette.js";
import { bindHistoryPanel } from "../js/ui/history_panel.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { Element } from "./helpers/legend_element.mjs";

class FocusElement extends Element {
  matches(selector) {
    return selector === this.tagName || selector === "#" + this.id
      || (selector === '[role="button"]' && this.attributes.role === "button")
      || super.matches(selector);
  }
  focus() { document.activeElement = this; }
}

function keyboard(ctx) {
  const body = new FocusElement("body");
  const map = body.appendChild(new FocusElement());
  map.id = "mapContainer";
  const doc = Object.assign(new EventTarget(), { body, querySelectorAll: () => [] });
  for (const [key, value] of Object.entries({ document: doc, window: new EventTarget(), Element: FocusElement })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    ctx.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  for (const [key, value] of Object.entries({ bootBlocking: false, startupReadonly: false,
    brushModeEnabled: false, brushPanModifierActive: false, currentTool: "fill" })) {
    const previous = state[key];
    state[key] = value;
    ctx.after(() => { state[key] = previous; });
  }
  const pan = ctx.mock.fn();
  initShortcuts({ pan });
  function send(type, key, target) {
    const event = Object.assign(new Event(type, { cancelable: true }), { key });
    Object.defineProperty(event, "target", { value: target });
    doc.dispatchEvent(event);
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  return { body, map, pan, send };
}

test("Space preserves control activation and only suppresses scrolling on the map or body", ctx => {
  const { body, map, send } = keyboard(ctx);
  const outside = body.appendChild(new FocusElement());
  const controls = ["button", "summary", "a", "div"].map(tag => map.appendChild(new FocusElement(tag)));
  controls.at(-1).setAttribute("role", "button");
  const icon = controls[0].appendChild(new FocusElement("span"));
  for (const [targets, prevent] of [[[...controls, icon, outside], false],
    [[body, map, map.appendChild(new FocusElement("svg"))], true]]) {
    for (const target of targets) {
      const down = send("keydown", " ", target);
      assert.equal(state.brushPanModifierActive, true);
      const up = send("keyup", " ", target);
      assert.equal(state.brushPanModifierActive, false);
      assert.deepEqual([down, up], [prevent, prevent], target.tagName);
    }
  }
});

test("W selects the eraser on the map and the reference only lists arrows for panning", ctx => {
  const { map, pan, send } = keyboard(ctx);
  for (const key of ["w", "a", "s", "d"]) send("keydown", key, map);
  assert.equal(state.currentTool, "eraser");
  assert.equal(pan.mock.callCount(), 0);
  for (const direction of ["Up", "Down", "Left", "Right"]) {
    assert.equal(shortcutLabel(direction.toLowerCase()), "Arrow" + direction);
  }
  assert.equal(shortcutLabel("toolEraserBtn"), "E / W");
});

test("Escape closes history and returns focus without exiting brush mode", ctx => {
  const { body, send } = keyboard(ctx);
  const dropdown = body.appendChild(new FocusElement("details"));
  const summary = dropdown.appendChild(new FocusElement("summary"));
  dropdown.ownerDocument = document;
  dropdown.open = true;
  bindHistoryPanel(dropdown);
  state.brushModeEnabled = true;
  send("keydown", "Escape", summary);
  assert.equal(dropdown.open, false);
  assert.equal(document.activeElement, summary);
  assert.equal(state.brushModeEnabled, true);
});

test("city, title, legend and annotation edits have distinct localized history labels", ctx => {
  const previous = state.currentLanguage;
  ctx.after(() => { state.currentLanguage = previous; });
  for (const [kind, en, zh] of [
    ["city-name", "Rename city", "重命名城市"],
    ["map-title", "Edit map title", "编辑地图标题"],
    ["legend-appearance", "Change legend appearance", "修改图例外观"],
    ["annotation-visibility", "Change annotation visibility", "修改注记可见性"],
  ]) {
    for (const [language, label, undo] of [["en", en, "Undo: "], ["zh", zh, "撤销："]]) {
      state.currentLanguage = language;
      assert.equal(getHistoryActionLabel(null, { kind }), label);
      assert.equal(getHistoryActionLabel("Undo", { kind }), undo + label);
    }
  }
});
