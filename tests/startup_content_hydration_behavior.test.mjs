import assert from "node:assert/strict";
import test from "node:test";
import { hydrateStartupBaseContentState } from "../js/core/state/content_state.js";

test("startup content hydration adopts the loader cache object by identity", () => {
  const startupBootCacheState = {
    enabled: true,
    baseTopology: "hit",
    localization: "hit",
    scenarioBootstrap: "probe",
  };
  const targetState = {};

  hydrateStartupBaseContentState(targetState, {
    topologyPrimary: { type: "Topology", objects: {}, arcs: [] },
    startupBootCacheState,
  });

  assert.equal(targetState.startupBootCacheState, startupBootCacheState);
});
