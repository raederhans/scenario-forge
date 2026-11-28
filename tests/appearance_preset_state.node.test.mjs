import assert from "node:assert/strict";
import test from "node:test";
import { buildAppearancePresetExportPayload, createAppearancePresetFromRuntimeState, createDefaultAppearancePresetsState, createIntensityFieldsState, mergeAppearancePresetImportPayload, sampleIntensityField, upsertAppearancePreset, updateIntensityFieldChannel } from "../js/core/state.js";
import { applyAppearancePresetState } from "../js/core/state/actions/appearance_preset_actions.js";

test("appearance import rejects unsupported formats with categorized errors", () => {
  for (const payload of [null, {}, 42, true, "{}", "null", "42"]) {
    assert.throws(() => mergeAppearancePresetImportPayload(null, payload), { code: "invalid-format" });
  }
  assert.throws(() => mergeAppearancePresetImportPayload(null, "{"), { code: "invalid-json" });
});

test("appearance preset bumps stale intensity revisions when channel content changes", () => {
  const targetFields = updateIntensityFieldChannel(
    createIntensityFieldsState(),
    "oceanDepth",
    (channel) => {
      channel.enabled = true;
      channel.points = [{ id: "old-depth", lon: 10, lat: 46, strength: 1.7, radiusDeg: 3 }];
    },
  );
  const presetFields = updateIntensityFieldChannel(
    createIntensityFieldsState(),
    "oceanDepth",
    (channel) => {
      channel.enabled = true;
      channel.points = [{ id: "new-depth", lon: -35, lat: 28, strength: 1.8, radiusDeg: 4 }];
    },
  );
  const targetRevision = targetFields.channels.oceanDepth.revision;
  const target = {
    styleConfig: {},
    intensityFields: targetFields,
  };
  const preset = {
    snapshot: {
      styleConfig: {},
      layerVisibility: {},
      intensityFields: presetFields,
    },
  };

  presetFields.channels.oceanDepth.revision = targetRevision - 1;
  applyAppearancePresetState(target, preset);

  assert.equal(target.intensityFields.channels.oceanDepth.revision, targetRevision + 1);
  assert.equal(sampleIntensityField(target.intensityFields, "oceanDepth", 10, 46), 1);
  assert.ok(sampleIntensityField(target.intensityFields, "oceanDepth", -35, 28) > 1.4);
});

test("an exported preset imports into an existing library", () => {
  const first = createAppearancePresetFromRuntimeState({}, {
    id: "first",
    name: "First",
    now: Date.UTC(2026, 5, 12),
  });
  const second = createAppearancePresetFromRuntimeState({ showUrban: true }, {
    id: "second",
    name: "Second",
    now: Date.UTC(2026, 5, 13),
  });

  let library = createDefaultAppearancePresetsState();
  library = upsertAppearancePreset(library, first);
  const imported = mergeAppearancePresetImportPayload(library, buildAppearancePresetExportPayload(second));

  assert.deepEqual(imported.order, ["first", "second"]);
  assert.equal(imported.byId.second.name, "Second");
});
