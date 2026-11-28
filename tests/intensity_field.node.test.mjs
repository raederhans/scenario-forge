import assert from "node:assert/strict";
import test from "node:test";
import { bakeIntensityComposite, createIntensityFieldsState, sampleIntensityField, stampIntensityBrush } from "../js/core/intensity_field.js";
import {
  normalizeIntensityFieldsState,
  serializeIntensityFieldsState,
  updateIntensityFieldChannel,
} from "../js/core/state/intensity_field_state.js";

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
