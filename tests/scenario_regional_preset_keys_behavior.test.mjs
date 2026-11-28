import test from "node:test";
import assert from "node:assert/strict";

import { rebuildPresetState } from "../js/core/releasable_manager.js";
import { state } from "../js/core/state.js";

// 剧本国家显式写了 preset_lookup_code 时，它的剧本预设只属于自己；
// 没写的国家沿用旧行为，预设同时挂在 ISO 查找代码上。
test("a scenario country with its own preset key keeps its presets to itself", (context) => {
  const saved = {
    activeScenarioId: state.activeScenarioId,
    scenarioCountriesByTag: state.scenarioCountriesByTag,
    presetsState: state.presetsState,
  };
  context.after(() => {
    Object.assign(state, saved);
    rebuildPresetState();
  });

  state.activeScenarioId = "tno_1962";
  state.scenarioCountriesByTag = {
    RKM: {
      tag: "RKM", lookup_iso2: "RU", preset_lookup_code: "RKM",
      regional_presets: [{ name: "军阀割据·北方", ids: ["a", "b"] }],
    },
    RKP: {
      tag: "RKP", lookup_iso2: "PL",
      regional_presets: [{ name: "瓦尔绍行政区", ids: ["c"] }],
    },
  };
  const presets = rebuildPresetState();

  assert.deepEqual(presets.RKM.map((preset) => preset.name), ["军阀割据·北方"]);
  assert.ok(!(presets.RU || []).some((preset) => preset.name === "军阀割据·北方"),
    "other RU-lookup countries must not inherit RKM's scenario presets");
  assert.ok((presets.PL || []).some((preset) => preset.name === "瓦尔绍行政区"),
    "countries without an explicit key keep sharing presets through their ISO lookup");
});
