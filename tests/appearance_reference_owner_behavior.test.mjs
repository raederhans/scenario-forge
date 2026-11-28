import assert from "node:assert/strict";
import test from "node:test";
import { createAppearanceReferenceOwner } from "../js/ui/toolbar/appearance_reference_owner.js";

test("reference owner clears imported stale object URL without dirtying project", () => {
  const runtimeState = { referenceImageUrl: "blob:stale-import" };
  const dirtyReasons = [];
  const revokedUrls = [];
  const owner = createAppearanceReferenceOwner({
    runtimeState,
    documentRef: { getElementById: () => null },
    markDirty: reason => dirtyReasons.push(reason),
    urlApi: { revokeObjectURL: url => revokedUrls.push(url) },
  });
  owner.clearReferenceImage({ markDirty: false });
  assert.deepEqual(revokedUrls, ["blob:stale-import"]);
  assert.equal(runtimeState.referenceImageUrl, null);
  assert.deepEqual(dirtyReasons, []);
});
