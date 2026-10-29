import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppearancePresetExportPayload,
  createAppearancePresetFromRuntimeState,
  createDefaultAppearancePresetsState,
  createIntensityFieldsState,
  deleteAppearancePreset,
  mergeAppearancePresetImportPayload,
  sampleIntensityField,
  upsertAppearancePreset,
  updateIntensityFieldChannel,
} from "../js/core/state.js";
import { applyAppearancePresetState } from "../js/core/state/actions/appearance_preset_actions.js";

test("appearance import rejects unsupported formats with categorized errors", () => {
  for (const payload of [null, {}, 42, true, "{}", "null", "42"]) {
    assert.throws(() => mergeAppearancePresetImportPayload(null, payload), { code: "invalid-format" });
  }
  assert.throws(() => mergeAppearancePresetImportPayload(null, "{"), { code: "invalid-json" });
});

test("appearance import retains supported containers and accepts their JSON representation", () => {
  const preset = { id: "imported", name: "Imported", snapshot: { styleConfig: {} } };
  for (const payload of [
    { kind: "appearance-preset", preset }, { preset }, { presets: [preset] },
    [preset], { byId: { imported: preset }, order: ["imported"] }, preset,
  ]) {
    for (const input of [payload, JSON.stringify(payload)]) {
      const result = mergeAppearancePresetImportPayload(null, input);
      assert.deepEqual(result.order, ["imported"]);
      assert.equal(result.byId.imported.name, "Imported");
      assert.equal(result.selectedPresetId, "imported");
    }
  }
  for (const payload of [[], { presets: [] }, { byId: {}, order: [] }]) {
    assert.deepEqual(mergeAppearancePresetImportPayload(null, payload), createDefaultAppearancePresetsState());
  }
});

function createRuntimeAppearanceState({
  pointLon = 139.7,
  pointLat = 35.7,
  pointStrength = 1.65,
} = {}) {
  const intensityFields = updateIntensityFieldChannel(
    createIntensityFieldsState(),
    "urbanGlow",
    (channel) => {
      channel.enabled = true;
      channel.revision = 3;
      channel.points = [{
        id: "metro-glow",
        lon: pointLon,
        lat: pointLat,
        strength: pointStrength,
        radiusDeg: 6,
        falloff: "smooth",
      }];
    },
  );
  return {
    styleConfig: {
      ocean: {
        fillColor: "#123456",
        opacity: 0.66,
      },
      urban: {
        mode: "manual",
        color: "#445566",
        fillOpacity: 0.48,
      },
    },
    showUrban: false,
    showPhysical: true,
    showRivers: false,
    showTransport: true,
    showAirports: true,
    showStrategicResourceMarkers: true,
    strategicChoroplethMetric: "steel",
    referenceImageState: {
      dataUrl: "data:image/png;base64,private",
    },
    intensityFields,
  };
}

test("appearance preset snapshots style, layer visibility, and intensity fields without private reference image data", () => {
  const preset = createAppearancePresetFromRuntimeState(createRuntimeAppearanceState(), {
    id: "night-glow",
    name: "Night Glow",
    now: Date.UTC(2026, 5, 12),
  });

  assert.equal(preset.id, "night-glow");
  assert.equal(preset.name, "Night Glow");
  assert.equal(preset.snapshot.styleConfig.ocean.fillColor, "#123456");
  assert.equal(preset.snapshot.layerVisibility.showUrban, false);
  assert.equal(preset.snapshot.layerVisibility.showAirports, true);
  assert.equal(preset.snapshot.layerVisibility.showStrategicResourceMarkers, true);
  assert.equal(preset.snapshot.layerVisibility.strategicChoroplethMetric, "steel");
  assert.ok(sampleIntensityField(preset.snapshot.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);
  assert.equal(Object.hasOwn(preset.snapshot, "referenceImageState"), false);
});

test("appearance preset applies a full appearance snapshot to runtime state", () => {
  const preset = createAppearancePresetFromRuntimeState(createRuntimeAppearanceState(), {
    id: "night-glow",
    name: "Night Glow",
    now: Date.UTC(2026, 5, 12),
  });
  const target = {
    styleConfig: {},
    showUrban: true,
    showPhysical: false,
    showRivers: true,
    showAirports: false,
    showStrategicResourceMarkers: false,
    strategicChoroplethMetric: "",
    intensityFields: createIntensityFieldsState(),
  };

  applyAppearancePresetState(target, preset);

  assert.equal(target.styleConfig.ocean.fillColor, "#123456");
  assert.equal(target.styleConfig.urban.color, "#445566");
  assert.equal(target.showUrban, false);
  assert.equal(target.showPhysical, true);
  assert.equal(target.showRivers, false);
  assert.equal(target.showAirports, true);
  assert.equal(target.showStrategicResourceMarkers, true);
  assert.equal(target.strategicChoroplethMetric, "steel");
  assert.ok(sampleIntensityField(target.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);
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

  const matchingRevisionTarget = {
    styleConfig: {},
    intensityFields: targetFields,
  };
  presetFields.channels.oceanDepth.revision = targetRevision;

  applyAppearancePresetState(matchingRevisionTarget, preset);

  assert.equal(matchingRevisionTarget.intensityFields.channels.oceanDepth.revision, targetRevision + 1);
});

test("appearance preset apply bumps intensity revisions beyond the current runtime state", () => {
  const first = createAppearancePresetFromRuntimeState(createRuntimeAppearanceState(), {
    id: "first-glow",
    name: "First Glow",
    now: Date.UTC(2026, 5, 12),
  });
  const second = createAppearancePresetFromRuntimeState(createRuntimeAppearanceState({
    pointLon: -73.9,
    pointLat: 40.7,
    pointStrength: 0.45,
  }), {
    id: "second-glow",
    name: "Second Glow",
    now: Date.UTC(2026, 5, 13),
  });
  assert.equal(
    first.snapshot.intensityFields.channels.urbanGlow.revision,
    second.snapshot.intensityFields.channels.urbanGlow.revision,
  );
  const target = {
    styleConfig: {},
    intensityFields: createIntensityFieldsState(),
  };

  applyAppearancePresetState(target, first);
  const firstAppliedRevision = target.intensityFields.channels.urbanGlow.revision;
  applyAppearancePresetState(target, second);

  assert.equal(target.intensityFields.channels.urbanGlow.revision, firstAppliedRevision + 1);
  assert.ok(sampleIntensityField(target.intensityFields, "urbanGlow", -73.9, 40.7) < 0.8);
});

test("appearance preset library upserts, deletes, and imports exported presets", () => {
  const first = createAppearancePresetFromRuntimeState(createRuntimeAppearanceState(), {
    id: "first",
    name: "First",
    now: Date.UTC(2026, 5, 12),
  });
  const second = createAppearancePresetFromRuntimeState({
    ...createRuntimeAppearanceState(),
    showUrban: true,
  }, {
    id: "second",
    name: "Second",
    now: Date.UTC(2026, 5, 13),
  });

  let library = createDefaultAppearancePresetsState();
  library = upsertAppearancePreset(library, first);
  library = upsertAppearancePreset(library, second);

  assert.deepEqual(library.order, ["first", "second"]);
  assert.equal(library.selectedPresetId, "second");

  library = deleteAppearancePreset(library, "second");

  assert.deepEqual(library.order, ["first"]);
  assert.equal(library.selectedPresetId, "first");

  const imported = mergeAppearancePresetImportPayload(library, buildAppearancePresetExportPayload(second));

  assert.deepEqual(imported.order, ["first", "second"]);
  assert.equal(imported.byId.second.name, "Second");
});
