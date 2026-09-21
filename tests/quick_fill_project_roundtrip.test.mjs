import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { state } from "../js/core/state.js";

test("project JSON roundtrip preserves explicit quick-fill levels", () => {
  for (const scope of ["parent", "country", "level:department", "level:prefecture", "level:province"]) {
    const payload = FileManager.buildProjectPayload({ ...state, batchFillScope: scope });
    assert.equal(payload.batchFillScope, scope);
    const restored = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload)));
    assert.equal(restored.batchFillScope, scope);
  }
});

test("project imports retain legacy defaults and reject malformed fill scopes", () => {
  const payload = FileManager.buildProjectPayload({ ...state, batchFillScope: "parent" });
  assert.equal(FileManager.normalizeImportedProjectData({ ...payload, batchFillScope: " COUNTRY " }).batchFillScope, "country");
  for (const invalid of [undefined, null, "", "level:../../country", "level:", "unexpected"]) {
    const restored = FileManager.normalizeImportedProjectData({ ...payload, batchFillScope: invalid });
    assert.equal(restored.batchFillScope, "parent");
  }
});
