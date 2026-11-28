import test from "node:test";
import assert from "node:assert/strict";
import { resolveImportedOwnershipState } from "../js/core/interaction_funnel/import_trust_projection.js";

test("project input cannot overwrite scenario reference assignments or enable blank-map ownership", () => {
  const baseline = Object.freeze({ a: "2RA", unloaded: "GB" });
  const data = { sovereigntyByFeatureId: { a: "OTHER" }, paintMode: "sovereignty" };
  const result = resolveImportedOwnershipState(data, { activeScenarioId: "scene", scenarioBaselineOwnersByFeatureId: baseline });
  assert.deepEqual(result.sovereigntyByFeatureId, baseline);
  assert.notEqual(result.sovereigntyByFeatureId, baseline);
  result.sovereigntyByFeatureId.a = "X";
  assert.equal(baseline.a, "2RA");
  assert.deepEqual(resolveImportedOwnershipState(data, { activeScenarioId: "" }).sovereigntyByFeatureId, {});
});
