import { createDeferredPromise as deferred } from "./helpers/deferred_promise.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { ensureThematicWgiData } from "../js/core/thematic/thematic_wgi_runtime.js";
import { normalizeThematicWgiStyle } from "../js/core/thematic/thematic_wgi_view_model.js";
import { createDefaultContentState } from "../js/core/state/content_state.js";
import { setThematicWgiStyleState } from "../js/core/state/actions/thematic_wgi_actions.js";

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

for (const rejects of [false, true]) {
  test(`stale metric ${rejects ? "failure" : "success"} cannot replace the current selection`, async () => {
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
  });
}
