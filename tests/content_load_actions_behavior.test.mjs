import test from "node:test";
import assert from "node:assert/strict";
import { commitPhysicalContourDisplayState } from "../js/core/state/actions/content_load_actions.js";
import { commitContextLayerCollection, commitPhysicalContourDisplay } from "../js/core/state/content_state.js";
import { getContextCollectionRevision, getContextGeometryRevision } from "../js/core/state/context_layer_revision.js";

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

test("source publication metadata preserves public epochs and detects intervening unknown writes, jumps and resets", () => {
  const target = { contextLayerRevision: 7 };
  const originalFields = Object.keys(target);
  const collection = { features: [] };
  assert.equal(getContextGeometryRevision(target), 0);
  commitContextLayerCollection(target, "urban", collection, { bumpRevision: true });
  assert.equal(target.contextLayerRevision, 8);
  assert.equal(getContextGeometryRevision(target), 0);
  assert.equal(getContextCollectionRevision(target, collection), 1);
  commitContextLayerCollection(target, "urban", collection, { bumpRevision: true });
  assert.equal(target.contextLayerRevision, 9);
  assert.equal(getContextGeometryRevision(target), 0);
  assert.equal(getContextCollectionRevision(target, collection), 2);
  const replacement = { features: [] };
  commitContextLayerCollection(target, "urban", replacement, { bumpRevision: true });
  assert.equal(getContextCollectionRevision(target, replacement), 1);
  assert.equal(getContextCollectionRevision(target, collection), 2);

  target.contextLayerRevision = 50;
  assert.equal(getContextGeometryRevision(target), 1);
  target.contextLayerRevision = 2;
  assert.equal(getContextGeometryRevision(target), 2);
  target.contextLayerRevision = 2;
  assert.equal(getContextGeometryRevision(target), 2, "same-value observation does not fabricate a mutation");

  target.contextLayerRevision += 1;
  commitContextLayerCollection(target, "urban", replacement, { bumpRevision: true });
  assert.equal(target.contextLayerRevision, 4);
  assert.equal(getContextGeometryRevision(target), 3, "known publication must not hide a preceding unknown edit");
  target.contextLayerRevision = 200;
  commitPhysicalContourDisplayState(target, { major: { features: [] } });
  assert.equal(target.contextLayerRevision, 201);
  assert.equal(getContextGeometryRevision(target), 4);
  assert.deepEqual(Object.keys(target).sort(), [...originalFields, "contextLayerExternalDataByName", "urbanData", "physicalContourMajorData"].sort(),
    "cache provenance is internal metadata, not additional public runtime fields");
});
