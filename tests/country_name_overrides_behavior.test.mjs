import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";

test("project import restores both languages and clears overrides for older documents", async () => {
  const overrides = { GER: { en: "New Germany", zh: "新德国" } };
  const project = FileManager.buildProjectPayload({ styleConfig: {}, countryNameOverrides: overrides });
  for (const expected of [overrides, {}]) {
    if (!Object.keys(expected).length) delete project.countryNameOverrides;
    const result = await importProjectTextThroughFunnel(JSON.stringify(project), {
      ui: { t: key => key, showToast() {}, showAppDialog: async () => false },
      hooks: { refreshColorState() {} },
    });
    assert.match(result.status, /^committed/, result.error?.stack);
    await result.completion;
    assert.deepEqual(state.countryNameOverrides, expected);
    assert.deepEqual(FileManager.buildProjectPayload(state).countryNameOverrides, expected);
  }
});
