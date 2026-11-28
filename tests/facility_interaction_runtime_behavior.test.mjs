import assert from "node:assert/strict";
import test from "node:test";
import { createFacilityInteractionRuntime } from "../js/core/renderer/facility_interaction_runtime.js";

test("visible entries deduplicate semantic identities and prefer regional packs", () => {
  const runtime = createFacilityInteractionRuntime({
    getScenarioProjectMarkerEntries: () => [],
    getMapHoverInteractionOwner: () => ({ getHoveredFacilityEntry: () => null }),
  });
  const base = { familyId: "airport", stableId: "same", packId: "global" };
  runtime.setVisibleFacilityHoverEntries("airport", [base, { ...base, name: "latest global" }]);
  assert.equal(runtime.listVisibleFacilityHoverEntries().length, 1);
  assert.equal(runtime.listVisibleFacilityHoverEntries()[0].name, "latest global");
  runtime.setVisibleFacilityHoverEntries("airport", [{ ...base, packId: " Regional ", name: "regional" }], { append: true });
  runtime.setVisibleFacilityHoverEntries("airport", [base], { append: true });
  assert.deepEqual(runtime.listVisibleFacilityHoverEntries(), [{ ...base, packId: "regional", name: "regional" }]);
  runtime.setVisibleFacilityHoverEntries("rail", [
    { familyId: "rail", coordinates: [1, 2], packId: "global" },
    { familyId: "rail", coordinates: [1, 2], packId: "regional" },
  ]);
  assert.equal(runtime.listVisibleFacilityHoverEntries().length, 2);
  assert.equal(runtime.listVisibleFacilityHoverEntries()[1].packId, "regional");
});
