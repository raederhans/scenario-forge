import test from "node:test";
import assert from "node:assert/strict";
import { createIntensityFieldsState } from "../js/core/intensity_field.js";
import { appendIntensityFieldPointState, normalizeIntensityFieldsIntoState, setIntensityFieldToolState, updateIntensityFieldChannelState } from "../js/core/state/actions/intensity_field_actions.js";

test("intensity actions preserve runtime field identity and revision semantics", () => {
  const target = { intensityFields: createIntensityFieldsState() };
  normalizeIntensityFieldsIntoState(target);
  const identity = target.intensityFields;
  const revision = target.intensityFields.channels.urbanGlow.revision;
  updateIntensityFieldChannelState(target, "urbanGlow", (channel) => { channel.enabled = true; });
  assert.equal(target.intensityFields, identity);
  assert.equal(target.intensityFields.channels.urbanGlow.revision, revision + 1);
  const tool = { active: true, channelId: "urbanGlow" };
  assert.equal(setIntensityFieldToolState(target, tool), tool);
});

test("point append isolates input and leaves revision advancement to gesture commit", () => {
  const target = { intensityFields: createIntensityFieldsState() };
  const channel = target.intensityFields.channels.urbanGlow;
  const revision = channel.revision;
  const point = { id: "new-point", coordinates: [12, 34], value: 0.7 };
  const appended = appendIntensityFieldPointState(target, "urbanGlow", point);
  assert.equal(channel.enabled, true);
  assert.equal(channel.revision, revision);
  assert.equal(channel.points.at(-1), appended);
  point.coordinates[0] = 90;
  assert.deepEqual(appended.coordinates, [12, 34]);
  assert.throws(() => appendIntensityFieldPointState(target, "__proto__", point), RangeError);
});
