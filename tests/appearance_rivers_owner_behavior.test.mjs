import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRiversStyleConfig } from "../js/ui/toolbar/appearance_rivers_owner.js";

test("rivers owner normalizes imported style config", () => {
  const normalized = normalizeRiversStyleConfig({
    color: "#ABCDEF",
    opacity: 3,
    width: 0,
    outlineColor: "#FEDCBA",
    outlineWidth: -1,
    dashStyle: "",
  }, {
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    normalizeOceanFillColor: (value) => String(value || "").toLowerCase(),
  });

  assert.deepEqual(normalized, {
    color: "#abcdef",
    opacity: 1,
    width: 0.2,
    outlineColor: "#fedcba",
    outlineWidth: 0,
    dashStyle: "solid",
  });
});
