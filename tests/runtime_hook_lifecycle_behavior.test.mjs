import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import {
  callRequiredRuntimeHook, callRuntimeHook, registerRuntimeHook,
  registerOwnedRuntimeHook, readRuntimeHook, subscribeStateBusEvent, off, STATE_BUS_EVENTS,
} from "../js/core/state/index.js";

for (const name of ["updateScenarioUIFn", "setHgoRuntimePreviewEnabledFn"]) {
  test(`${name}: old cleanup preserves replacement, including reused callbacks`, () => {
    const target = {};
    let calls = 0;
    const fn = () => ++calls;
    const old = registerOwnedRuntimeHook(target, name, fn);
    const next = registerOwnedRuntimeHook(target, name, fn);
    old(); old();
    callRuntimeHook(target, name);
    assert.equal(calls, 1);
    next();
    assert.equal(readRuntimeHook(target, name), null);
    const replaced = registerOwnedRuntimeHook(target, name, fn);
    const latest = registerRuntimeHook(target, name, fn);
    replaced();
    next();
    assert.equal(readRuntimeHook(target, name), latest);
    registerRuntimeHook(target, name, null);
  });
}

test("notification disposal leaves independent observers and absent notifications are safe", () => {
  const name = "updateScenarioUIFn";
  const event = STATE_BUS_EVENTS[name];
  let observed = 0;
  const observer = subscribeStateBusEvent(event, () => ++observed);
  const dispose = registerOwnedRuntimeHook({}, name, () => "owner");
  dispose();
  assert.deepEqual(callRuntimeHook({}, name), [1]);
  off(event, observer);
  assert.deepEqual(callRuntimeHook({}, name), []);
});

test("required commands fail when absent, preserve arguments/results/errors, and reject notifications", () => {
  const target = {};
  const name = "setHgoRuntimePreviewEnabledFn";
  assert.throws(() => callRequiredRuntimeHook(target, name), /not registered/);
  assert.throws(() => callRequiredRuntimeHook(target, "updateScenarioUIFn"), /must be a handler/);
  assert.throws(() => registerOwnedRuntimeHook(target, "unknown", () => {}), /Unknown/);
  assert.throws(() => registerOwnedRuntimeHook(target, name, null), /requires a function/);
  const result = {};
  const dispose = registerOwnedRuntimeHook(target, name, (...args) => {
    assert.deepEqual(args, [true, "reason"]);
    return result;
  });
  assert.equal(callRequiredRuntimeHook(target, name, true, "reason"), result);
  dispose();
  const failure = new Error("failed");
  const release = registerOwnedRuntimeHook(target, name, () => { throw failure; });
  assert.throws(() => callRequiredRuntimeHook(target, name), error => error === failure);
  release();
});

const source = fs.readFileSync(new URL("../js/ui/scenario_controls.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "")
  .replace("export function initScenarioControls", "function initScenarioControls");

function createControlsFixture() {
  class Element extends EventTarget {
    value = "";
    dataset = {};
    children = [];
    textContent = "";
    closed = 0;
    classList = { toggle() {}, add: () => { this.closed++; }, contains() { return true; } };
    setAttribute() {}
    focus() {}
    contains(target) { return target === this; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); }
  }
  const nodes = Object.fromEntries(["scenarioSelect", "scenarioSelectButton", "scenarioSelectButtonText", "scenarioSelectMenu", "applyScenarioBtn", "clearScenarioBtn", "scenarioStatus", "toggleBlankFeatureLabels"]
    .map(name => [name, new Element()]));
  const state = { bootBlocking: false, activeScenarioId: "", scenarioApplyInFlight: false };
  const pending = [];
  const applied = [];
  const toasts = [];
  let renders = 0;
  let cleared = 0;
  const document = Object.assign(new EventTarget(), {
    getElementById: name => nodes[name] || null, createElement: () => new Element(),
  });
  const context = vm.createContext({
    runtimeState: state, AbortController, Event, console: { error() {}, warn() {} },
    document,
    callRequiredRuntimeHook, callRuntimeHook, readRuntimeHook, registerOwnedRuntimeHook,
    normalizeScenarioId: value => String(value || "").trim(),
    getScenarioRegistryEntries: () => [{ scenario_id: "alpha" }, { scenario_id: "beta" }],
    getScenarioDisplayName: (_, id) => id,
    getScenarioFatalRecoveryState: () => null,
    formatScenarioFatalRecoveryMessage: () => "",
    formatScenarioStatusText: () => { renders++; return "ready"; },
    formatScenarioAuditText: () => "", areHgoRuntimePreviewAssetsAvailable: () => true,
    t: value => value, showToast: (...args) => toasts.push(args), resetZoomToFit() {},
    clearActiveScenarioCommand() { cleared++; state.activeScenarioId = ""; }, resetScenarioToBaselineCommand() {},
    applyScenarioByIdCommand: async id => { applied.push(id); state.activeScenarioId = id; },
    loadScenarioRegistry: () => new Promise(resolve => pending.push(resolve)),
  });
  vm.runInContext(source, context);
  return { init: context.initScenarioControls, state, nodes, document, pending, applied, toasts, cleared: () => cleared, renders: () => renders };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("real scenario owner reinitializes DOM listeners and old release cannot detach the new hook", async () => {
  const f = createControlsFixture();
  const old = f.init();
  callRuntimeHook(f.state, "updateScenarioUIFn");
  const next = f.init();
  old();
  callRuntimeHook(f.state, "updateScenarioUIFn");
  assert.equal(f.renders(), 2);
  f.document.dispatchEvent(new Event("click"));
  assert.equal(f.nodes.scenarioSelectMenu.closed, 1, "one live document listener");
  f.nodes.scenarioSelect.value = "beta";
  f.nodes.scenarioSelect.dispatchEvent(new Event("change"));
  assert.equal(f.renders(), 3, "one live DOM callback after reinitialization");
  f.nodes.applyScenarioBtn.dispatchEvent(new Event("click"));
  await flush();
  assert.deepEqual(f.applied, ["beta"]);
  next();
  const closed = f.nodes.scenarioSelectMenu.closed;
  f.document.dispatchEvent(new Event("click"));
  assert.equal(f.nodes.scenarioSelectMenu.closed, closed, "document listener released");
  const before = f.renders();
  f.nodes.scenarioSelect.dispatchEvent(new Event("change"));
  callRuntimeHook(f.state, "updateScenarioUIFn");
  f.pending.forEach(resolve => resolve());
  await flush();
  assert.equal(f.renders(), before, "disposed owner ignores DOM, hooks, and late registry completion");
});

test("real scenario owner reports missing required preview command instead of claiming success", async () => {
  const f = createControlsFixture();
  const dispose = f.init();
  f.state.activeScenarioId = "alpha";
  f.nodes.scenarioSelect.value = "__hgo_runtime_preview__";
  f.nodes.applyScenarioBtn.dispatchEvent(new Event("click"));
  await flush();
  assert.equal(f.toasts.length, 1);
  assert.match(f.toasts[0][0], /Required runtime hook is not registered/);
  assert.deepEqual(f.applied, []);
  assert.equal(f.cleared(), 0);
  assert.equal(f.state.activeScenarioId, "alpha");
  dispose();
  f.pending.forEach(resolve => resolve());
  await flush();
});

test("disposed scenario owner does not resume a pending preview command into a scenario apply", async () => {
  const f = createControlsFixture();
  f.state.hgoRuntimePreview = { enabled: true };
  let resolvePreview;
  const release = registerOwnedRuntimeHook(f.state, "setHgoRuntimePreviewEnabledFn",
    () => new Promise(resolve => { resolvePreview = resolve; }));
  const dispose = f.init();
  f.nodes.scenarioSelect.value = "beta";
  f.nodes.applyScenarioBtn.dispatchEvent(new Event("click"));
  assert.equal(typeof resolvePreview, "function");
  dispose();
  resolvePreview();
  f.pending.forEach(resolve => resolve());
  await flush();
  assert.deepEqual(f.applied, []);
  assert.equal(f.renders(), 0);
  release();
});

test("scenario exit reports missing required preview handler and preserves current scenario", async () => {
  const f = createControlsFixture();
  f.state.activeScenarioId = "alpha";
  f.state.hgoRuntimePreview = { enabled: true };
  const dispose = f.init();
  f.nodes.clearScenarioBtn.dispatchEvent(new Event("click"));
  await flush();
  assert.equal(f.toasts.length, 1);
  assert.match(f.toasts[0][0], /Required runtime hook is not registered/);
  assert.equal(f.cleared(), 0);
  assert.equal(f.state.activeScenarioId, "alpha");
  dispose();
  f.pending.forEach(resolve => resolve());
  await flush();
});
