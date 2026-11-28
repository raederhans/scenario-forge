import test from "node:test";
import assert from "node:assert/strict";
import { createIntensityFieldsState } from "../js/core/intensity_field.js";
import { appendIntensityFieldPointState } from "../js/core/state/actions/intensity_field_actions.js";

test("appended points isolate coordinates and reject unknown channels", () => {
  const target = { intensityFields: createIntensityFieldsState() };
  const point = { id: "new-point", coordinates: [12, 34], value: 0.7 };
  const appended = appendIntensityFieldPointState(target, "urbanGlow", point);
  point.coordinates[0] = 90;
  assert.deepEqual(appended.coordinates, [12, 34]);
  assert.throws(() => appendIntensityFieldPointState(target, "__proto__", point), RangeError);
});
