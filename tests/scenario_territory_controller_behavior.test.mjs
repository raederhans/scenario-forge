import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createScenarioTerritoryController } from "../js/ui/sidebar/scenario_territory_controller.js";

const country = { code: "CORE" };
function harness({ preset = { preset: { ids: ["core", "unloaded"] } }, result = { applied: true, matchedCount: 1, requestedCount: 2 } } = {}) {
  const calls = [];
  const render = () => {};
  const currentCountry = { code: "CORE", color: "#445566" };
  const controller = createScenarioTerritoryController({
    t: value => value,
    getPrimaryReleasablePresetRef: value => { assert.equal(value, country); return preset; },
    getCountryState: code => { assert.equal(code, "CORE"); return currentCountry; },
    getResolvedCountryColor: value => { assert.equal(value, currentCountry); return value.color; },
    applyPresetReference: (ref, options) => { calls.push({ ref, options }); return result; },
    showToast: (message, options) => calls.push({ message, options }),
    render, renderList: () => calls.push("list"),
    get applyScenarioOwnerControllerAssignments() { throw new Error("retired ownership capability read"); },
    get setReleasableBoundaryVariant() { throw new Error("retired boundary capability read"); },
    get activateCoreOwner() { throw new Error("retired activation capability read"); },
    get applyScenarioAutoCompanionActions() { throw new Error("retired companion capability read"); },
  });
  return { controller, calls, render, currentCountry, preset };
}

test("core territory applies visual paint by default using current country color and visual history", () => {
  const { controller, calls, render, currentCountry, preset } = harness();
  currentCountry.color = "#aabbcc";
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), true);
  assert.deepEqual(calls, [
    { ref: preset, options: { color: "#aabbcc", render,
      visualHistoryKind: "scenario-core-apply-visual", visualDirtyReason: "scenario-core-apply-visual" } },
    { message: "Applied 1/2 features", options: { title: "Visual color applied", tone: "success", duration: 2800 } },
    "list",
  ]);
  assert.deepEqual(Object.keys(controller), ["applyScenarioReleasableCoreTerritory"]);
});

test("obsolete action options cannot select an ownership or boundary mutation", () => {
  const { controller, calls } = harness();
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country, { actionMode: "ownership", forceSovereignty: true }), true);
  assert.equal(calls[0].options.visualHistoryKind, "scenario-core-apply-visual");
});

test("missing core preset fails before any paint or success UI", () => {
  const { controller, calls } = harness({ preset: null });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(controller.applyScenarioReleasableCoreTerritory(country), false); }
  finally { console.warn = warn; }
  assert.deepEqual(calls, []);
});

test("failed visual transaction refreshes the list without success feedback", () => {
  for (const reason of ["incomplete-targets", "no-visible-features"]) {
    const { controller, calls } = harness({ result: { applied: false, reason } });
    assert.equal(controller.applyScenarioReleasableCoreTerritory(country), false);
    assert.equal(calls.at(-1), "list");
    const toasts = calls.filter(value => value?.message);
    assert.equal(toasts.length, reason === "no-visible-features" ? 0 : 1);
    if (toasts.length) assert.equal(toasts[0].options.tone, "warning");
  }
});


test("sidebar hierarchy uses only visual paint, deduplicates targets and preserves transaction options", () => {
  const source = readFileSync(new URL("../js/ui/sidebar.js", import.meta.url), "utf8");
  const fn = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.find(node => node.id?.name === "applyHierarchyGroupWithMode");
  const events = [];
  const context = vm.createContext({
    runtimeState: { selectedColor: "#abcdef", paintMode: "sovereignty", activeSovereignCode: "STALE" },
    previewHierarchyGroupHighlight: (_group, ids) => events.push(["preview", Array.from(ids)]),
    applyVisualOverridesToFeatureIds: (ids, color, options) => { events.push(["paint", Array.from(ids), color, options]); return { applied: true, mode: "visual" }; },
  });
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const result = context.applyHierarchyGroupWithMode({ children: [" a ", "a", "b", ""] }, { mode: "ownership", ownerCode: "OLD", visualHistoryKind: "custom" });
  assert.equal(result.applied, true);
  assert.deepEqual(events[0], ["preview", ["a", "b"]]);
  assert.deepEqual(events[1].slice(0, 3), ["paint", ["a", "b"], "#abcdef"]);
  assert.equal(events[1][3].historyKind, "custom");
  assert.equal(context.applyHierarchyGroupWithMode(null).mode, "visual");
  assert.equal(source.includes("scenario_transfer_controller.js"), false);
});
