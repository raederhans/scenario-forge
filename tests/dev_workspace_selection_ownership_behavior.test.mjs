import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import {
  getFeatureIdsForOwner,
  ensureSovereigntyState,
  getFeatureOwnerCode,
} from "../js/core/sovereignty_manager.js";

test("read-only scenario assignments preserve digit-prefixed HGO tags", () => {
  const feature = {
    id: "HGO-S1",
    properties: {
      id: "HGO-S1",
      country_code: "AAA",
    },
  };

  const initial = {
    landIndex: new Map([["HGO-S1", feature]]), landData: { features: [feature] },
    activeScenarioId: "hgo_1936", scenarioBaselineOwnersByFeatureId: Object.freeze({ "HGO-S1": "2RA" }),
    scenarioBaselineHash: "hgo-baseline", sovereigntyByFeatureId: { "HGO-S1": "STALE" },
    ownerToFeatureIds: new Map(), sovereigntyInitialized: false, mapSemanticMode: "ownership",
  };
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  try {
    Object.assign(state, initial);
    ensureSovereigntyState();

    assert.equal(getFeatureOwnerCode("HGO-S1"), "2RA");
    assert.deepEqual(getFeatureIdsForOwner("2RA"), ["HGO-S1"]);
    assert.deepEqual(getFeatureIdsForOwner("RA"), []);
  } finally {
    Object.assign(state, saved);
  }
});
