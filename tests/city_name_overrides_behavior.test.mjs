import assert from "node:assert/strict";
import test from "node:test";
import { FileManager } from "../js/core/file_manager.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";
import { state } from "../js/core/state.js";

test("project import restores city names and visibility and resets them for old projects", async () => {
  const overrides = { one: { en: "New", zh: "新", hidden: true } };
  const project = FileManager.buildProjectPayload({ styleConfig: {}, cityNameOverrides: overrides });
  for (const expected of [overrides, {}]) {
    if (expected !== overrides) delete project.cityNameOverrides;
    const result = await importProjectTextThroughFunnel(JSON.stringify(project), {
      ui: { t: key => key, showToast() {}, showAppDialog: async () => false },
      hooks: { refreshColorState() {} },
    });
    assert.match(result.status, /^committed/, result.error?.stack);
    await result.completion;
    assert.deepEqual(state.cityNameOverrides, expected);
    assert.deepEqual(FileManager.buildProjectPayload(state).cityNameOverrides, expected);
  }
});
