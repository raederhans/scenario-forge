import test from "node:test";
import assert from "node:assert/strict";
import {
  patchAppearanceVisibilityState,
  setAppearanceVisibilitySnapshotState,
  setAppearanceVisibilityState,
} from "../js/core/state/actions/appearance_visibility_actions.js";

test("appearance visibility actions enforce whitelist and boolean values", () => {
  const target = { showUrban: false, showPhysical: true, showTransport: true };
  assert.equal(setAppearanceVisibilityState(target, "showUrban", 1), true);
  assert.equal(target.showUrban, true);
  assert.equal(
    setAppearanceVisibilityState(
      target,
      "strategicChoroplethMetric",
      " resources ",
    ),
    " resources ",
  );
  assert.equal(target.strategicChoroplethMetric, " resources ");
  patchAppearanceVisibilityState(target, { showRivers: 0, parentBordersVisible: "" });
  assert.equal(target.showRivers, false);
  assert.equal(target.parentBordersVisible, false);
  assert.equal(target.showTransport, true);
  assert.throws(() => setAppearanceVisibilityState(target, "unknownVisibility", false), /unknown key/);
});

test("appearance visibility patch validates the whole batch before committing", () => {
  const target = { showUrban: false, showPhysical: true };

  assert.throws(
    () => patchAppearanceVisibilityState(target, {
      showUrban: true,
      unsupportedVisibility: false,
    }),
    /unknown key/,
  );

  assert.deepEqual(target, { showUrban: false, showPhysical: true });
});

test("appearance visibility snapshot setter preserves exact parent-border values", () => {
  const sentinel = { exact: true };
  const target = {};

  assert.equal(
    setAppearanceVisibilitySnapshotState(target, "parentBordersVisible", sentinel),
    sentinel,
  );
  assert.equal(target.parentBordersVisible, sentinel);
  assert.throws(
    () => setAppearanceVisibilitySnapshotState(target, "showUrban", sentinel),
    /unknown snapshot key: showUrban/,
  );
});

