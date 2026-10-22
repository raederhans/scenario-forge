import assert from "node:assert/strict";
import test from "node:test";
import { setPopulationRuntimeState } from "../js/core/state/actions/population_spatial_actions.js";
import { setThematicWgiRuntimeState } from "../js/core/state/actions/thematic_wgi_actions.js";

test("thematic and population runtimes reject unknown statuses without changing targets or valid behavior", () => {
  for (const [setRuntime, field] of [[setPopulationRuntimeState, "populationRuntime"], [setThematicWgiRuntimeState, "thematicWgiRuntime"]]) {
    for (const status of [undefined, null, "unknown", "READY", 0, {}, ["ready"]]) {
      const runtime = Object.freeze({ status: "ready", data: Object.freeze({ value: 42 }), error: "", revision: 7 });
      const target = Object.freeze({ [field]: runtime, marker: "preserved" });
      assert.throws(() => setRuntime(target, { status }), { name: "RangeError" });
      assert.equal(target[field], runtime);
      assert.deepEqual(target, { [field]: runtime, marker: "preserved" });
    }
    for (const status of ["idle", "loading", "ready", "failed"]) {
      const data = Object.freeze({ value: 42 });
      const target = { [field]: { revision: 7 } };
      const next = setRuntime(target, { status, data, error: "example" });
      assert.equal(next, target[field]);
      assert.deepEqual(next, { status, data, error: "example", revision: 8 });
      assert.equal(next.data, data);
    }
  }
});
