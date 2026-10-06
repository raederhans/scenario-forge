import test from "node:test";
import assert from "node:assert/strict";
import { ensureThematicWgiData } from "../js/core/thematic_wgi_runtime.js";
import { normalizeThematicWgiStyle } from "../js/core/thematic_wgi_view_model.js";
import { createDefaultContentState } from "../js/core/state/content_state.js";
import { setThematicWgiStyleState } from "../js/core/state/actions/thematic_wgi_actions.js";
import { THEMATIC_WGI_SCENARIO_IDS } from "../js/core/thematic_wgi_data.js";
const ruleOfLawId = "wgi_rule_of_law_score_0_100";

function fixture() {
  return { ...createDefaultContentState(), activeScenarioId: "modern_world",
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } };
}

function payload(metricId) {
  const { enabled, ...identity } = normalizeThematicWgiStyle();
  return { ...identity, ...(metricId ? { metricId } : {}), year: 2024, range: [0, 100], byIsoA3: { AAA: 0, BBB: null, CCC: 67 },
    counts: { features: 3, values: 2, missing: 1 } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("content defaults contain detached transient thematic runtime", () => {
  const one = createDefaultContentState().thematicWgiRuntime;
  const two = createDefaultContentState().thematicWgiRuntime;
  assert.deepEqual(one, { status: "idle", data: null, error: "", revision: 0 });
  assert.notEqual(one, two);
});

test("restored Rule of Law selection passes the selected metric to the loader", async () => {
  const state = fixture();
  state.styleConfig.thematic.metricId = ruleOfLawId;
  const data = payload(ruleOfLawId);
  let options;
  assert.equal(await ensureThematicWgiData(state, { loadData: async (value) => { options = value; return data; } }), data);
  assert.deepEqual(options, { metricId: ruleOfLawId, scenarioId: "modern_world" });
  assert.equal(state.thematicWgiRuntime.data.metricId, ruleOfLawId);
});

test("historical requests carry their captured scenario and reject payloads without matching admission", async () => {
  for (const scenarioId of THEMATIC_WGI_SCENARIO_IDS.slice(1)) {
    const state = fixture();
    state.activeScenarioId = scenarioId;
    let options;
    const data = { ...payload(), supportedScenarios: THEMATIC_WGI_SCENARIO_IDS };
    assert.equal(await ensureThematicWgiData(state, { loadData: async (value) => { options = value; return data; } }), data);
    assert.equal(options.scenarioId, scenarioId);
    setThematicWgiStyleState(state, state.styleConfig.thematic);
    assert.equal(await ensureThematicWgiData(state, { loadData: async () => payload() }), null);
    assert.equal(state.thematicWgiRuntime.status, "failed");
  }
});

test("a scene change before fetch starts uses the captured scene and cannot publish an old completion", async () => {
  const state = fixture();
  state.activeScenarioId = "hoi4_1936";
  const selected = [];
  const data = { ...payload(), supportedScenarios: THEMATIC_WGI_SCENARIO_IDS };
  const request = ensureThematicWgiData(state, { loadData: async (options) => {
    selected.push(options.scenarioId);
    return data;
  } });
  state.activeScenarioId = "tno_1962";
  assert.equal(await request, null);
  assert.deepEqual(selected, ["hoi4_1936"]);
  assert.equal(state.thematicWgiRuntime.status, "idle");
  assert.equal(await ensureThematicWgiData(state, { loadData: async () => data }), data);
});

test("switching official metrics fences stale success and failure behind the current selection", async () => {
  for (const rejects of [false, true]) {
    const state = fixture();
    const old = deferred();
    const current = deferred();
    const selected = [];
    const loadData = ({ metricId }) => {
      selected.push(metricId);
      return metricId === ruleOfLawId ? current.promise : old.promise;
    };
    const first = ensureThematicWgiData(state, { loadData });
    await Promise.resolve();
    setThematicWgiStyleState(state, { enabled: true, metricId: ruleOfLawId });
    const second = ensureThematicWgiData(state, { loadData });
    const rl = payload(ruleOfLawId);
    current.resolve(rl);
    assert.equal(await second, rl);
    if (rejects) old.reject(new Error("stale GE failure"));
    else old.resolve(payload());
    assert.equal(await first, null);
    assert.deepEqual(selected, [normalizeThematicWgiStyle().metricId, ruleOfLawId]);
    assert.equal(state.thematicWgiRuntime.status, "ready");
    assert.equal(state.thematicWgiRuntime.data, rl);
    assert.equal(state.thematicWgiRuntime.error, "");
  }
});

test("an in-place switch before the loader starts keeps the captured metric and drops completion", async () => {
  const state = fixture();
  const selected = [];
  const first = ensureThematicWgiData(state, { loadData: async ({ metricId }) => {
    selected.push(metricId);
    return payload(metricId);
  } });
  state.styleConfig.thematic.metricId = ruleOfLawId;
  assert.equal(await first, null);
  assert.deepEqual(selected, [normalizeThematicWgiStyle().metricId]);
  assert.equal(state.thematicWgiRuntime.status, "idle");
});

test("a payload from the other supported metric becomes an explicit failure", async () => {
  const state = fixture();
  state.styleConfig.thematic.metricId = ruleOfLawId;
  assert.equal(await ensureThematicWgiData(state, { loadData: async () => payload() }), null);
  assert.equal(state.thematicWgiRuntime.status, "failed");
  assert.match(state.thematicWgiRuntime.error, /does not match/);
  assert.equal(state.styleConfig.thematic.metricId, ruleOfLawId);
});

test("restored supported selection loads once, coalesces renders and preserves zero and null", async () => {
  const state = fixture();
  const pending = deferred();
  const statuses = [];
  let calls = 0;
  const options = { loadData: () => { calls += 1; return pending.promise; },
    onChange: () => statuses.push(state.thematicWgiRuntime.status) };
  const first = ensureThematicWgiData(state, options);
  assert.equal(ensureThematicWgiData(state, options), first);
  const data = payload();
  pending.resolve(data);
  assert.equal(await first, data);
  assert.equal(await ensureThematicWgiData(state, options), data);
  assert.equal(calls, 1);
  assert.deepEqual(statuses, ["loading", "ready"]);
  assert.equal(state.thematicWgiRuntime.data.byIsoA3.AAA, 0);
  assert.equal(state.thematicWgiRuntime.data.byIsoA3.BBB, null);
  assert.equal(state.thematicWgiRuntime.revision, 2);
});

test("disabled, unsupported and other-scenario selections never fetch", async () => {
  for (const patch of [{ enabled: false }, { dataVersion: "future" }, { metricId: "unknown" }, { layerId: "unknown" }]) {
    const state = fixture();
    state.styleConfig.thematic = normalizeThematicWgiStyle({ ...state.styleConfig.thematic, ...patch });
    await ensureThematicWgiData(state, { loadData: () => assert.fail("must not fetch") });
    assert.equal(state.thematicWgiRuntime.status, "idle");
  }
  const state = fixture();
  state.activeScenarioId = "blank_base";
  await ensureThematicWgiData(state, { loadData: () => assert.fail("must not fetch") });
  assert.equal(state.styleConfig.thematic.enabled, true, "selection remains saved on unsupported maps");
  state.activeScenarioId = "modern_world";
  state.scenarioApplyInFlight = true;
  await ensureThematicWgiData(state, { loadData: () => assert.fail("must not fetch during apply") });
});

test("failures stay failed across renders until explicit retry", async () => {
  const state = fixture();
  let calls = 0;
  const loadData = async () => { calls += 1; throw new Error("offline"); };
  assert.equal(await ensureThematicWgiData(state, { loadData }), null);
  assert.equal(state.thematicWgiRuntime.status, "failed");
  assert.equal(state.thematicWgiRuntime.error, "offline");
  await ensureThematicWgiData(state, { loadData });
  assert.equal(calls, 1);
  await ensureThematicWgiData(state, { loadData: async () => payload(), retry: true });
  assert.equal(state.thematicWgiRuntime.status, "ready");
  assert.equal(state.thematicWgiRuntime.error, "");
});

test("pending success and rejection cannot publish after selection or apply ownership changes", async () => {
  const mutations = [
    (state) => { state.styleConfig.thematic.enabled = false; },
    (state) => { state.styleConfig.thematic.dataVersion = "future"; },
    (state) => { state.styleConfig.thematic.metricId = "unknown"; },
    (state) => { state.styleConfig.thematic.layerId = "unknown"; },
    (state) => { state.styleConfig.thematic = { ...state.styleConfig.thematic }; },
    (state) => { state.styleConfig = { ...state.styleConfig }; },
    (state) => { state.activeScenarioId = "tno_1962"; },
    (state) => { state.latestScenarioApplyRequestId = 2; },
    (state) => { state.currentScenarioApplyRequestId = 2; },
    (state) => { state.activeScenarioChunks = { scenarioApplyRequestId: 2 }; },
    (state) => { state.renderTransactionDiagnostics = { scenarioApplyEpoch: 2 }; },
    (state) => { state.scenarioApplyInFlight = true; },
  ];
  for (const mutate of mutations) {
    for (const reject of [false, true]) {
      const state = fixture();
      const pending = deferred();
      const promise = ensureThematicWgiData(state, { loadData: () => pending.promise });
      await Promise.resolve();
      mutate(state);
      if (reject) pending.reject(new Error("stale failure"));
      else pending.resolve(payload());
      assert.equal(await promise, null);
      assert.equal(state.thematicWgiRuntime.status, "idle");
      assert.equal(state.thematicWgiRuntime.data, null);
      assert.equal(state.thematicWgiRuntime.error, "");
    }
  }
});

test("off/on actions invalidate the old request and preserve newer completion", async () => {
  const state = fixture();
  const old = deferred();
  const recent = deferred();
  const first = ensureThematicWgiData(state, { loadData: () => old.promise });
  setThematicWgiStyleState(state, { enabled: false });
  setThematicWgiStyleState(state, { enabled: true });
  const second = ensureThematicWgiData(state, { loadData: () => recent.promise });
  const data = payload();
  recent.resolve(data);
  assert.equal(await second, data);
  old.resolve(payload());
  assert.equal(await first, null);
  assert.equal(state.thematicWgiRuntime.status, "ready");
  assert.equal(state.thematicWgiRuntime.data, data);
});

test("loaded data with an absent identity or wrong version becomes an explicit failure", async () => {
  for (const data of [{}, { ...payload(), dataVersion: "future" }]) {
    const state = fixture();
    await ensureThematicWgiData(state, { loadData: async () => data });
    assert.equal(state.thematicWgiRuntime.status, "failed");
    assert.match(state.thematicWgiRuntime.error, /does not match/);
  }
});

test("render callback reentry shares the pending request and eligibility transitions do not double load", async () => {
  const state = fixture();
  let calls = 0;
  let reentry;
  const options = { loadData: async () => { calls += 1; return payload(); }, onChange: () => {
    reentry = ensureThematicWgiData(state, options);
  } };
  await ensureThematicWgiData(state, options);
  await reentry;
  state.currentScenarioApplyRequestId = 2;
  await ensureThematicWgiData(state, options);
  await reentry;
  assert.equal(calls, 2);
});
