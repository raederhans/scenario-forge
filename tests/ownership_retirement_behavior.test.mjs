import test from "node:test";
import assert from "node:assert/strict";
import { MAP_EDITING_CAPABILITIES, isOwnershipEditingEnabled, normalizePaintMode } from "../js/core/map_editing_policy.js";
import { resolveImportedOwnershipState } from "../js/core/interaction_funnel/import_trust_projection.js";

test("ownership capability is immutable and all requested paint modes normalize to visual", () => {
  assert.equal(isOwnershipEditingEnabled(), false);
  assert.throws(() => { MAP_EDITING_CAPABILITIES.ownershipEditing = true; }, TypeError);
  for (const mode of [undefined, null, "visual", "sovereignty", "ownership", "developer"]) assert.equal(normalizePaintMode(mode), "visual");
});

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

