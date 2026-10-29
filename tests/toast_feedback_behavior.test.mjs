import assert from "node:assert/strict";
import test from "node:test";
import { initToast, showToast } from "../js/ui/toast.js";
import { resetCountryColorsWithFeedback } from "../js/ui/sidebar.js";
import { createAppearancePresetsOwner } from "../js/ui/toolbar/appearance_presets_owner.js";
import { state, createDefaultAppearancePresetsState } from "../js/core/state.js";
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
  return viewport;
}

test("action toast preserves remaining time across hover and keyboard focus", async (context) => {
  const viewport = setup(context);
  const toast = showToast("Saved", { duration: 1200, actionLabel: "Undo", onAction() {} });
  context.mock.timers.tick(400);
  await toast.dispatch("mouseenter");
  context.mock.timers.tick(2000);
  assert.equal(toast.dataset.removing, undefined);
  await toast.dispatch("focusin");
  await toast.dispatch("mouseleave");
  context.mock.timers.tick(2000);
  assert.equal(toast.dataset.removing, undefined);
  await toast.dispatch("focusout", { relatedTarget: toast.find("toast-dismiss") });
  context.mock.timers.tick(2000);
  assert.equal(toast.dataset.removing, undefined);
  await toast.dispatch("focusout", { relatedTarget: null });
  context.mock.timers.tick(799);
  assert.equal(toast.dataset.removing, undefined);
  context.mock.timers.tick(1);
  assert.equal(toast.dataset.removing, "true");
  context.mock.timers.tick(180);
  assert.equal(viewport.children.length, 0);
});

test("async actions pause expiry and resume remaining time after completion", async (context) => {
  setup(context);
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const toast = showToast("Saved", {
    duration: 1200, actionLabel: "Undo", onAction: () => pending, dismissOnAction: false,
  });
  context.mock.timers.tick(300);
  const action = toast.find("toast-action");
  const clicked = action.dispatch("click");
  assert.equal(action.disabled, true);
  context.mock.timers.tick(5000);
  assert.equal(toast.dataset.removing, undefined);
  resolve();
  await clicked;
  assert.equal(action.disabled, false);
  context.mock.timers.tick(899);
  assert.equal(toast.dataset.removing, undefined);
  context.mock.timers.tick(1);
  assert.equal(toast.dataset.removing, "true");
});

test("rejected action retains an error notification", async (context) => {
  const viewport = setup(context);
  const error = new Error("Action rejected");
  const logged = context.mock.method(console, "error", () => {});
  const toast = showToast("Saved", {
    duration: 1200, actionLabel: "Undo", onAction: async () => { throw error; },
  });
  await toast.find("toast-action").dispatch("click");
  context.mock.timers.tick(10000);
  assert.equal(viewport.children[0], toast);
  assert.equal(toast.dataset.removing, undefined);
  assert.equal(toast.attributes.role, "alert");
  assert.equal(toast.className, "toast toast-error");
  assert.equal(toast.find("toast-message").textContent, "Action failed. Please try again.");
  assert.equal(logged.mock.calls[0].arguments[1], error);
});

test("reset followed by a newer edit cannot undo that edit through the old toast", async (context) => {
  const viewport = setup(context);
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
  assert.equal(viewport.children.at(-1).find("toast-message").textContent,
    "Can't undo the reset because newer edits exist.");
});

test("reset toast undoes its own history entry", async (context) => {
  setup(context);
  clearHistory();
  state.visualOverrides = { region: "#123456" };
  let undone = false;
  const toast = resetCountryColorsWithFeedback(() => {}, () => { undone = true; });
  await toast.find("toast-action").dispatch("click");
  assert.equal(undone, true);
  assert.equal(state.visualOverrides.region, "#123456");
  assert.equal(state.historyPast.length, 0);
});

for (const [input, message] of [
  ["{", "Can't import appearance preset: invalid JSON."],
  ["{}", "Can't import appearance preset: invalid format."],
]) {
  test(`import feedback: ${message}`, async (context) => {
    const viewport = setup(context);
    context.mock.method(console, "error", () => {});
    const importInput = new Element();
    importInput.files = [{ text: async () => input }];
    importInput.value = "preset.json";
    const runtimeState = { appearancePresets: createDefaultAppearancePresetsState() };
    const before = structuredClone(runtimeState);
    const owner = createAppearancePresetsOwner({ runtimeState, nodes: { importInput } });
    owner.bindEvents();
    await importInput.dispatch("change");
    const toast = viewport.children[0];
    assert.equal(toast.className, "toast toast-error");
    assert.equal(toast.find("toast-message").textContent, message);
    assert.equal(importInput.value, "");
    assert.deepEqual(runtimeState, before);
  });
}
