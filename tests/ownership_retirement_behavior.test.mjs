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

test("retirement verification adds a child-safe behavior target and a separately owned browser route", async () => {
  const { createOwnershipRetirementRecords } = await import("../tools/verification/catalog/records/ownership_retirement.mjs");
  const original = Object.freeze([Object.freeze({ selectorOrder: 900 })]);
  const [behavior, browser] = createOwnershipRetirementRecords(original);
  assert.equal(original.length, 1);
  assert.equal(behavior.selectorOrder, 901);
  assert.deepEqual(behavior.executionOwners, ["child-safe"]);
  assert.deepEqual(behavior.resourceLocks, []);
  assert.ok(behavior.sourceRefs.includes("js/core/map_data_boundary.js"));
  assert.deepEqual(browser.executionOwners, ["main-thread"]);
  assert.ok(browser.resourceLocks.includes("playwright-browser"));
});
