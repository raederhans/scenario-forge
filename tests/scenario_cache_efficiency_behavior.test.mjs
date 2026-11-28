import assert from "node:assert/strict";
import test from "node:test";
import { state as appState } from "../js/core/state.js";
import { captureScenarioApplyRollbackSnapshot } from "../js/core/scenario/scenario_rollback.js";

test("actual rollback capture isolates topology coordinates from active state", () => {
  const topology = { arcs: [[1, 2]] };

  const fixture = {
    scenarioRuntimeTopologyData: topology, runtimePoliticalTopology: topology,
    defaultRuntimePoliticalTopology: topology,
    activeScenarioChunks: { payloadByChunkId: { a: { payload: topology } } },
    styleConfig: { ...appState.styleConfig, ocean: { color: "blue" } },
  };
  const savedState = { ...appState };
  try {
    Object.assign(appState, fixture);
    const first = captureScenarioApplyRollbackSnapshot();

    first.runtimePoliticalTopology.arcs[0][0] = 99;
    const next = captureScenarioApplyRollbackSnapshot();

    assert.deepEqual(next.runtimePoliticalTopology.arcs, [[1, 2]]);
    assert.notEqual(first.styleConfigOcean, appState.styleConfig.ocean);
  } finally {
    for (const key of Object.keys(appState)) {
      if (!Object.hasOwn(savedState, key)) delete appState[key];
    }
    Object.assign(appState, savedState);
  }
});
