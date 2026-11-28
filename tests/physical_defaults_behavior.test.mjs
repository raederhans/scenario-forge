import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhysicalStyleConfig, getPhysicalContextLayerRequests } from "../js/core/state_defaults.js";

test("explicit imported contour modes and legacy aliases remain enabled", () => {
  for (const mode of ["atlas_and_contours", "contours_only", "atlas_soft", "contour_only"]) {
    const config = normalizePhysicalStyleConfig({ mode });
    assert.notEqual(config.mode, "atlas_only");
    assert.deepEqual(getPhysicalContextLayerRequests(config), ["physical-set", "physical-contours-set"]);
  }
});
