import assert from "node:assert/strict";
import test from "node:test";
import { setCityNameOverride } from "../js/core/city_name_overrides.js";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import { createRenderPassSignaturePolicy } from "../js/core/renderer/render_pass_signature_policy.js";
import { FileManager } from "../js/core/file_manager.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";
import { captureHistoryState, pushHistoryEntry, redoHistory, undoHistory } from "../js/core/history_manager.js";
import { state } from "../js/core/state.js";

test("project names take precedence per language and clearing restores the scenario name", () => {
  const runtime = { currentLanguage: "en", showModernPlaceNames: true };
  const model = createCityLabelTextModel(runtime, { getStrictGeoLabel: () => "", getPreferredGeoLabel: () => "" });
  const city = { properties: { __city_id: "one", __city_stable_key: "id::one", __city_has_display_name_override: true,
    __city_display_name_override: { en: "Scenario", zh: "剧本" }, __city_base_display_name: { en: "Base", zh: "原名" } } };
  const original = model.getCityDisplayLabel(city);
  assert.ok(setCityNameOverride(runtime, "one", "en", "  Project  "));
  assert.equal(model.getCityDisplayLabel(city), "Project");
  runtime.currentLanguage = "zh";
  assert.equal(model.getCityDisplayLabel(city), "剧本（今原名）");
  assert.ok(setCityNameOverride(runtime, "one", "zh", "项目"));
  assert.equal(model.getCityDisplayLabel(city), "项目");
  runtime.currentLanguage = "en";
  assert.ok(setCityNameOverride(runtime, "one", "en", ""));
  assert.equal(model.getCityDisplayLabel(city), original);
  assert.deepEqual(runtime.cityNameOverrides, { one: { zh: "项目" } });
});

test("hide and unhide preserve history and remove empty records", () => {
  Object.assign(state, { cityNameOverrides: {}, historyPast: [], historyFuture: [] });
  const snapshot = () => captureHistoryState({ cityNameOverrides: true });
  const before = snapshot();
  assert.ok(setCityNameOverride(state, "one", "hidden", true));
  const overrides = state.cityNameOverrides;
  assert.equal(setCityNameOverride(state, "one", "hidden", true), false);
  assert.equal(state.cityNameOverrides, overrides);
  pushHistoryEntry({ kind: "city-name", before, after: snapshot() });
  assert.ok(undoHistory());
  assert.deepEqual(state.cityNameOverrides, {});
  assert.ok(redoHistory());
  assert.deepEqual(state.cityNameOverrides, { one: { hidden: true } });
  assert.ok(setCityNameOverride(state, "one", "hidden", false));
  assert.deepEqual(state.cityNameOverrides, {});
});

test("editing city overrides invalidates both label and marker passes", () => {
  const runtime = {};
  const policy = createRenderPassSignaturePolicy(runtime, {
    stableJson: JSON.stringify, getTransformSignature: () => "", shouldEnableContextBaseTransformReuse: () => false,
  });
  const labels = policy.getRenderPassSignature("labels");
  setCityNameOverride(runtime, "one", "en", "New name");
  assert.notEqual(policy.getRenderPassSignature("labels"), labels);
  const markers = policy.getRenderPassSignature("contextMarkers");
  setCityNameOverride(runtime, "one", "hidden", true);
  assert.notEqual(policy.getRenderPassSignature("contextMarkers"), markers);
});

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
