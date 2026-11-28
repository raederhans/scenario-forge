import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioOceanFillRestoreRuntime } from "../js/core/scenario/presentation_ocean_fill_restore.js";

test("scenario ocean defaults merge their keys and restore explicit user choices", () => {
  const target = {
    styleConfig: { ocean: { fillColor: "#123456", experimentalAdvancedStyles: false, preset: "flat" } },
    scenarioOceanFillBeforeActivate: null,
  };
  const before = structuredClone(target.styleConfig.ocean);
  const runtime = createScenarioOceanFillRestoreRuntime({ state: target });
  runtime.syncScenarioOceanFillForActivation({ style_defaults: { ocean: { fillColor: "#abcdef" } } });
  assert.equal(target.styleConfig.ocean.fillColor, "#abcdef");
  assert.equal(target.styleConfig.ocean.experimentalAdvancedStyles, false);
  assert.equal(target.styleConfig.ocean.preset, "flat");
  runtime.restoreScenarioOceanFillAfterExit();
  assert.deepEqual(target.styleConfig.ocean, before);
});
