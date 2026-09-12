import test from "node:test";
import assert from "node:assert/strict";
import { commitPhysicalContourDisplayState } from "../js/core/state/actions/content_load_actions.js";
import { commitPhysicalContourDisplay } from "../js/core/state/content_state.js";

test("contour display publication keeps cache identity and advances one revision per batch", () => {
  const major = Object.freeze({ features: Object.freeze([]) });
  const minor = Object.freeze({ features: Object.freeze([]) });
  const packs = Object.freeze({ major, minor });
  const target = { physicalContourMajorData: null, physicalContourMinorData: null,
    contextLayerRevision: "7", contextLayerExternalDataByName: packs };
  assert.deepEqual(commitPhysicalContourDisplay(target, { major, minor }),
    ["physical_contours_major", "physical_contours_minor"]);
  assert.equal(target.physicalContourMajorData, major);
  assert.equal(target.physicalContourMinorData, minor);
  assert.equal(target.contextLayerExternalDataByName, packs);
  assert.equal(target.contextLayerRevision, 8);
  assert.deepEqual(commitPhysicalContourDisplayState(target, { major, minor }), []);
  assert.equal(target.contextLayerRevision, 8);
});

test("contour display omission and already empty values are no-ops", () => {
  const target = Object.freeze({ physicalContourMajorData: undefined, physicalContourMinorData: null });
  assert.deepEqual(commitPhysicalContourDisplay(target), []);
  assert.deepEqual(commitPhysicalContourDisplay(target, { major: null, minor: null }), []);
});

test("contour display clears only requested aliases and initializes an invalid revision", () => {
  const minor = Object.freeze({ features: Object.freeze([]) });
  const target = { physicalContourMajorData: {}, physicalContourMinorData: minor, contextLayerRevision: "invalid" };
  assert.deepEqual(commitPhysicalContourDisplay(target, { major: null }), ["physical_contours_major"]);
  assert.equal(target.physicalContourMajorData, null);
  assert.equal(target.physicalContourMinorData, minor);
  assert.equal(target.contextLayerRevision, 1);
});
