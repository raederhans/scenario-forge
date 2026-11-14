import assert from "node:assert/strict";
import test from "node:test";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";

test("owner fails fast for missing explicit dependencies", () => {
  assert.throws(() => createMapHoverInteractionOwner(), /getters.nowMs must be a function/);
});
