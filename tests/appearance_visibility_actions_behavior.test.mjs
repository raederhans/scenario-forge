import test from "node:test";
import assert from "node:assert/strict";
import { patchAppearanceVisibilityState } from "../js/core/state/actions/appearance_visibility_actions.js";

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
