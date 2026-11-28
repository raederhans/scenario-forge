import assert from "node:assert/strict";
import test from "node:test";
import { initToast } from "../js/ui/components/toast.js";
import { resetCountryColorsWithFeedback } from "../js/ui/sidebar.js";
import { state } from "../js/core/state.js";
import { clearHistory, captureHistoryState, pushHistoryEntry } from "../js/core/history_manager.js";

class Element {
  children = [];
  dataset = {};
  attributes = {};
  listeners = new Map();
  className = "";
  textContent = "";
  classList = { add: (name) => { this.className += ` ${name}`; } };
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), handler]);
  }
  async dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) await handler({ target: this, ...event });
  }
  find(className) {
    if (this.className.split(" ").includes(className)) return this;
    return this.children.map((child) => child.find(className)).find(Boolean);
  }
}

function setup(context) {
  const viewport = new Element();
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => id === "toastViewport" ? viewport : null,
    createElement: () => new Element(),
  };
  context.after(() => { globalThis.document = previousDocument; });
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  initToast();
}

test("reset followed by a newer edit cannot undo that edit through the old toast", async (context) => {
  setup(context);
  clearHistory();
  state.visualOverrides = { region: "#123456" };
  const toast = resetCountryColorsWithFeedback(() => {}, () => assert.fail("Unexpected undo"));
  assert.deepEqual(state.visualOverrides, {});
  const resetEntry = state.historyPast.at(-1);
  const before = captureHistoryState({ featureIds: ["region"] });
  state.visualOverrides.region = "#abcdef";
  pushHistoryEntry({ before, after: captureHistoryState({ featureIds: ["region"] }) });
  const editEntry = state.historyPast.at(-1);
  assert.notEqual(editEntry, resetEntry);
  await toast.find("toast-action").dispatch("click");
  assert.equal(state.historyPast.at(-1), editEntry);
  assert.equal(state.visualOverrides.region, "#abcdef");
});
