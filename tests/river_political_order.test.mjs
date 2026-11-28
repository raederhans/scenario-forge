import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";

const feature = (id, properties = {}) => ({ properties: { id, ...properties } });
const idOf = (entry) => (entry?.feature || entry)?.properties?.id || entry?.id || "";

function fixture(features) {
  const state = { landData: { features }, topologyRevision: 1, scenarioDataGeneration: 1,
    activeScenarioId: "river", visualOverrides: {} };
  const cache = { pendingPoliticalColorEditIds: new Set() };
  let stable = true;
  let pending = false;
  let classifications = 0;
  const policy = createPoliticalFeaturePolicy(state, {
    getFeatureId: (item) => { classifications++; return idOf(item); },
    getFeatureCountryCodeNormalized: () => "",
    getSafeCanvasColor: (color, fallback) => color || fallback,
    hasPendingPoliticalColorEdit: () => pending,
    getRenderPassCacheState: () => cache,
    isAtlantropaFieldDrivenFeature: () => false,
    isInteractiveAtlantropaBooleanWeldIslandFeature: () => false,
    isScenarioAtlantropaVisible: () => true,
    isBaseGeographyScenarioFeature: () => false,
    isStablePaintOrderEnabled: () => stable,
  });
  return { state, cache, policy, setStable: (value) => { stable = value; },
    setPending: (value) => { pending = value; }, getClassifications: () => classifications };
}

test("river subsets retain complete source ranks including unpartitioned covering parents", () => {
  const lower = feature("lower"), upper = feature("upper"), third = feature("third");
  const primary = feature("primary", { __source: "primary" });
  const shell = feature("shell", { scenario_helper_kind: "shell_fallback", render_as_base_geography: false });
  const h = fixture([lower, primary, upper, shell, third]);
  assert.deepEqual([primary, shell, lower, upper, third].map(h.policy.getStablePoliticalDrawRank), [0, 1, 2, 3, 4]);
  const wrapped = (item, drawOrder) => ({ feature: item, id: idOf(item), drawOrder });
  for (const entries of [[third, lower, primary], [wrapped(third, 0), wrapped(primary, 1), wrapped(lower, 2)]]) {
    const original = [...entries];
    assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries).map(idOf), ["primary", "lower", "third"]);
    assert.deepEqual(entries, original, "input subset stays intact");
  }
  assert.equal(h.policy.getStablePoliticalDrawRank(wrapped(upper, 0)), 3);
  assert.equal(h.policy.getStablePoliticalDrawRank(feature("upper")), 3, "same-id derived entries inherit the source rank");
});

test("unknown parents use conservative tier fallback and deterministic id order", () => {
  const knownUnderlay = feature("primary", { __source: "primary" }), knownDetail = feature("detail");
  const a = feature("unknown-a"), z = feature("unknown-z");
  const unknownUnderlay = feature("unknown-primary", { __source: "primary" });
  const h = fixture([knownDetail, knownUnderlay]);
  const expected = [unknownUnderlay, knownUnderlay, a, z, knownDetail];
  for (const entries of [[knownDetail, z, unknownUnderlay, a, knownUnderlay], [...expected].reverse()]) {
    assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries), expected);
  }
});
