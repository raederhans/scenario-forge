import assert from "node:assert/strict";
import test from "node:test";
import { callRuntimeHook, registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { createIndexUiRefreshScheduler } from "../js/core/renderer/index_ui_refresh_scheduler.js";

function harness(t) {
  const jobs = [], calls = [], metrics = [], countryLookups = [];
  const state = {};
  const hookNames = ["refreshWaterRegionListRowsFn", "refreshSpecialRegionListRowsFn",
    "refreshCountryListRowsFn", "renderCountryListFn", "renderWaterRegionListFn",
    "renderSpecialRegionListFn", "renderPresetTreeFn"];
  const previousHooks = hookNames.map(name => [name, readRegisteredRuntimeHookSource(state, name)]);
  t.after(() => previousHooks.forEach(([name, hook]) => registerRuntimeHook(state, name, hook)));
  hookNames.forEach(name => registerRuntimeHook(state, name, null));
  for (const [hook, scope] of [
    ["refreshWaterRegionListRowsFn", "water"],
    ["refreshSpecialRegionListRowsFn", "special"],
    ["refreshCountryListRowsFn", "country"],
  ]) {
    registerRuntimeHook(state, hook, options => { calls.push([scope, options]); return { refreshMode: "row" }; });
  }
  const owner = createIndexUiRefreshScheduler({
    runtimeState: state,
    callRuntimeHook,
    scheduleAfterPaint(callback, options) {
      assert.deepEqual(options, { withoutFrame: "timer" });
      const job = { callback, cancellations: 0 };
      jobs.push(job);
      return () => { job.cancellations++; };
    },
    canonicalCountryCode: value => String(value || "").trim().toUpperCase(),
    collectCountryCodesForFeatureIds(ids) {
      countryLookups.push(ids);
      return ids.map(id => ({ f1: "AA", f2: "BB" })[id]).filter(Boolean);
    },
    hasSelectedOrActiveCountryImpact: codes => codes.includes("AA"),
    unwrapRuntimeHookResult: result => Array.isArray(result) ? result.at(-1) : result,
    recordUiRefreshMetric: (name, details) => metrics.push({ name, ...details }),
  });
  return { owner, state, jobs, calls, metrics, countryLookups,
    run() { const job = jobs.shift(); assert.ok(job); job.callback(); } };
}

test("row requests merge normalized IDs and owner codes in insertion order", (t) => {
  const h = harness(t);
  h.owner.scheduleSidebarRefresh({ featureIds: [" f1 ", "", "f1"], waterRegionIds: [" water1 "],
    ownerCodes: [" aa "], refreshPresetTree: true });
  h.owner.scheduleSidebarRefresh({ featureIds: ["f2", "f1"], waterRegionIds: ["water1", "water2"],
    specialRegionIds: [" special1 ", "special1"], ownerCodes: ["bb", "CC", ""] });
  assert.equal(h.jobs.length, 1);
  assert.deepEqual(h.calls, []);
  h.run();
  assert.deepEqual(h.countryLookups, [["f1", "f2"]]);
  assert.deepEqual(h.calls, [
    ["water", { regionIds: ["water1", "water2"], refreshInspector: true }],
    ["special", { regionIds: ["special1"], refreshInspector: true }],
    ["country", { countryCodes: ["AA", "BB", "CC"], refreshInspector: true, refreshPresetTree: true }],
  ]);
  assert.deepEqual(h.metrics.map(metric => [metric.name, metric.scope]), [
    ["uiSidebarRowRefresh", "water"], ["uiSidebarRowRefresh", "special"], ["uiSidebarRowRefresh", "country"],
  ]);
  assert.equal(h.jobs.length, 0);
});

test("cancel calls the after-paint cancel function once and a later request starts a fresh queue", (t) => {
  const h = harness(t);
  h.owner.scheduleSidebarRefresh({ waterRegionIds: ["old"] });
  const stale = h.jobs.shift();
  h.owner.cancelPendingSidebarRefresh();
  h.owner.cancelPendingSidebarRefresh();
  assert.equal(stale.cancellations, 1);
  stale.callback();
  assert.deepEqual(h.calls, []);
  h.owner.scheduleSidebarRefresh({ specialRegionIds: ["new"] });
  assert.equal(h.jobs.length, 1);
  h.run();
  assert.deepEqual(h.calls, [
    ["special", { regionIds: ["new"], refreshInspector: true }],
    ["country", { countryCodes: [], refreshInspector: false, refreshPresetTree: false }],
  ]);
});

test("row callbacks can enqueue merged later work without loss or duplicate execution", (t) => {
  const h = harness(t);
  registerRuntimeHook(h.state, "refreshWaterRegionListRowsFn", options => {
    h.calls.push(["water", options]);
    h.owner.scheduleSidebarRefresh({ specialRegionIds: ["next"], ownerCodes: ["aa"] });
    h.owner.scheduleSidebarRefresh({ specialRegionIds: ["next", "later"] });
  });
  h.owner.scheduleSidebarRefresh({ waterRegionIds: ["first"] });
  const first = h.jobs[0];
  h.run();
  assert.equal(h.jobs.length, 1);
  assert.deepEqual(h.calls.map(([scope]) => scope), ["water", "country"]);
  h.run();
  assert.deepEqual(h.calls.slice(2), [
    ["special", { regionIds: ["next", "later"], refreshInspector: true }],
    ["country", { countryCodes: ["AA"], refreshInspector: true, refreshPresetTree: false }],
  ]);
  assert.equal(h.jobs.length, 0);
});

test("preset tree refresh requires country impact and full-list fallbacks retain their metrics", (t) => {
  const h = harness(t);
  registerRuntimeHook(h.state, "refreshCountryListRowsFn", null);
  registerRuntimeHook(h.state, "refreshWaterRegionListRowsFn", null);
  registerRuntimeHook(h.state, "renderCountryListFn", () => h.calls.push(["country-full"]));
  registerRuntimeHook(h.state, "renderWaterRegionListFn", () => h.calls.push(["water-full"]));
  registerRuntimeHook(h.state, "renderPresetTreeFn", () => h.calls.push(["preset"]));
  h.owner.scheduleSidebarRefresh({ ownerCodes: ["bb"], refreshPresetTree: true });
  h.run();
  assert.deepEqual(h.calls, [["country-full"]]);
  h.calls.length = 0;
  h.owner.scheduleSidebarRefresh({ ownerCodes: ["aa"], waterRegionIds: ["water"], refreshPresetTree: true });
  h.run();
  assert.deepEqual(h.calls, [["water-full"], ["country-full"], ["preset"]]);
  assert.ok(h.metrics.every(metric => metric.name === "uiSidebarFullRefresh" && metric.fullRefreshReason === "hook-unavailable"));
  assert.equal(h.metrics.at(-1).refreshPresetTree, true);
});

for (const [scope, method, rowHook, fullHook] of [
  ["water", "refreshWaterRegionSidebarRowsNow", "refreshWaterRegionListRowsFn", "renderWaterRegionListFn"],
  ["special", "refreshSpecialRegionSidebarRowsNow", "refreshSpecialRegionListRowsFn", "renderSpecialRegionListFn"],
]) {
  test(`${scope} immediate rows preserve inspector options and full-refresh reporting`, (t) => {
    const h = harness(t);
    h.owner[method]([" region ", ""], { refreshInspector: false });
    assert.deepEqual(h.calls, [[scope, { regionIds: ["region"], refreshInspector: false }]]);
    assert.equal(h.jobs.length, 0);
    registerRuntimeHook(h.state, rowHook, () => ({ refreshMode: "full", fullRefreshReason: "changed-owner" }));
    h.owner[method](["region"]);
    assert.equal(h.metrics.at(-1).name, "uiSidebarFullRefresh");
    assert.equal(h.metrics.at(-1).fullRefreshReason, "changed-owner");
    registerRuntimeHook(h.state, fullHook, () => h.calls.push(["full"]));
    h.owner[method]([]);
    assert.equal(h.metrics.at(-1).fullRefreshReason, "missing-changed-ids");
    registerRuntimeHook(h.state, rowHook, null);
    h.owner[method](["region"]);
    assert.equal(h.metrics.at(-1).fullRefreshReason, "hook-unavailable");
  });
}
