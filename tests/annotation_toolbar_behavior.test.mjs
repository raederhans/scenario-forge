import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { state } from "../js/core/state.js";

const flags = ["showMapLabels", "showOperationalLines", "showOperationGraphics", "showUnitCounters"];

test("hidden annotations survive project save/import and older projects show all four categories", () => {
  const annotationView = Object.fromEntries(flags.map(key => [key, false]));
  const payload = FileManager.buildProjectPayload({ ...state, annotationView });
  const imported = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload)));
  for (const key of flags) assert.equal(imported.annotationView[key], false);
  delete payload.annotationView;
  const legacy = FileManager.normalizeImportedProjectData(payload);
  for (const key of flags) assert.equal(legacy.annotationView[key], true);
});
