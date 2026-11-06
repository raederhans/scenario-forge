import assert from "node:assert/strict";
import test from "node:test";

import {
  INTENSITY_FIELD_CHANNELS,
  INTENSITY_FIELD_GRID,
  bakeIntensityComposite,
  createIntensityFieldsState,
  extractFieldRectPatch,
  getIntensityFieldTargetPasses,
  sampleIntensityField,
  stampIntensityBrush,
} from "../js/core/intensity_field.js";
import {
  normalizeIntensityFieldsState,
  serializeIntensityFieldsState,
  updateIntensityFieldChannel,
} from "../js/core/state/intensity_field_state.js";

test("intensity field samples neutral when disabled and weighted when enabled", () => {
  let fields = createIntensityFieldsState();

  assert.equal(sampleIntensityField(fields, "physicalAtlas", 0, 0), 1);

  fields = updateIntensityFieldChannel(fields, "physicalAtlas", (channel) => {
    channel.enabled = true;
    channel.points = [
      { id: "alps", lon: 10, lat: 46, strength: 1.8, radiusDeg: 8, falloff: "smooth" },
    ];
  });

  assert.ok(sampleIntensityField(fields, "physicalAtlas", 10, 46) > 1.5);
  assert.equal(sampleIntensityField(fields, "physicalAtlas", -120, -30), 1);
});

test("intensity field channel registry exposes urban glow target passes", () => {
  const fields = createIntensityFieldsState();
  const passes = getIntensityFieldTargetPasses("urbanGlow");

  assert.deepEqual(passes, ["contextBase", "dayNight", "contextScenario"]);
  passes.push("mutated");
  assert.deepEqual(getIntensityFieldTargetPasses("urbanGlow"), ["contextBase", "dayNight", "contextScenario"]);
  assert.equal(INTENSITY_FIELD_CHANNELS.urbanGlow.applyMode, "featureMultiplier");
  assert.equal(fields.channels.urbanGlow.enabled, false);
  assert.equal(fields.channels.urbanGlow.revision, 0);
  assert.deepEqual(fields.channels.urbanGlow.points, []);
});

test("intensity field channel registry exposes ocean depth pass mask", () => {
  const fields = createIntensityFieldsState();
  const passes = getIntensityFieldTargetPasses("oceanDepth");

  assert.deepEqual(passes, ["background"]);
  passes.push("mutated");
  assert.deepEqual(getIntensityFieldTargetPasses("oceanDepth"), ["background"]);
  assert.equal(INTENSITY_FIELD_CHANNELS.oceanDepth.applyMode, "passMask");
  assert.equal(fields.channels.oceanDepth.enabled, false);
  assert.equal(fields.channels.oceanDepth.revision, 0);
  assert.deepEqual(fields.channels.oceanDepth.points, []);
});

test("intensity brush writes grid values and patch extraction captures the dirty rect", () => {
  const fields = createIntensityFieldsState();
  const channel = fields.channels.physicalContour;

  const rect = stampIntensityBrush(channel, {
    lon: 0,
    lat: 0,
    radiusDeg: 2,
    strength: 1.6,
  });
  bakeIntensityComposite(channel);

  assert.ok(rect.width > 0);
  assert.ok(rect.height > 0);
  assert.ok(rect.width < INTENSITY_FIELD_GRID.columns / 8);
  assert.ok(rect.height < INTENSITY_FIELD_GRID.rows / 8);
  assert.ok(sampleIntensityField({ channels: { physicalContour: { ...channel, enabled: true } } }, "physicalContour", 0, 0) > 1.2);

  const patch = extractFieldRectPatch(channel, rect);
  assert.equal(patch.values.length, rect.width * rect.height);
});

test("intensity brush incremental bake matches full bake", () => {
  const fields = createIntensityFieldsState();
  const channel = fields.channels.physicalAtlas;
  channel.enabled = true;
  channel.points = [
    { id: "peak", lon: 8, lat: 46, strength: 1.35, radiusDeg: 5, falloff: "smooth" },
  ];

  const rect = stampIntensityBrush(channel, {
    lon: 10,
    lat: 45,
    radiusDeg: 3,
    strength: 0.55,
  });
  const incrementalComposite = new Float32Array(channel.grid.composite);
  bakeIntensityComposite(channel);

  assert.ok(rect.width > 0);
  for (let index = 0; index < incrementalComposite.length; index += 1) {
    assert.equal(channel.grid.composite[index], incrementalComposite[index]);
  }
});

test("intensity brush handles wrapped longitude windows", () => {
  const fields = createIntensityFieldsState();
  const channel = fields.channels.physicalAtlas;
  channel.enabled = true;

  const rect = stampIntensityBrush(channel, {
    lon: 179.7,
    lat: 0,
    radiusDeg: 2,
    strength: 1.8,
  });

  assert.ok(rect.width > 0);
  assert.ok(sampleIntensityField(fields, "physicalAtlas", -179.7, 0) > 1.2);
});

test("intensity field serialization roundtrips enabled channels and points", () => {
  const fields = updateIntensityFieldChannel(createIntensityFieldsState(), "physicalAtlas", (channel) => {
    channel.enabled = true;
    channel.points = [
      { id: "ridge", lon: 4, lat: 44, strength: 0.65, radiusDeg: 6, falloff: "linear" },
    ];
  });

  const serialized = serializeIntensityFieldsState(fields);
  const restored = normalizeIntensityFieldsState(serialized);

  assert.equal(restored.channels.physicalAtlas.enabled, true);
  assert.equal(restored.channels.physicalAtlas.points[0].id, "ridge");
  assert.ok(sampleIntensityField(restored, "physicalAtlas", 4, 44) < 0.9);
});

test("intensity field serialization preserves zero-strength grid cells", () => {
  const fields = updateIntensityFieldChannel(createIntensityFieldsState(), "physicalAtlas", (channel) => {
    channel.enabled = true;
    channel.grid.base[0] = 0;
  });

  const restored = normalizeIntensityFieldsState(serializeIntensityFieldsState(fields));

  assert.equal(restored.channels.physicalAtlas.grid.base[0], 0);
  assert.equal(restored.channels.physicalAtlas.grid.composite[0], 0);
});

test("intensity field serialization keeps neutral grid cells exact", () => {
  const restored = normalizeIntensityFieldsState(serializeIntensityFieldsState(createIntensityFieldsState()));

  assert.equal(restored.channels.physicalAtlas.grid.base[0], 1);
  assert.equal(restored.channels.physicalAtlas.grid.composite[0], 1);
  assert.ok(restored.channels.physicalAtlas.grid.base.every((value) => value === 1));
});
