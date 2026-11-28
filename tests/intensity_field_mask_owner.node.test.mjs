import assert from "node:assert/strict";
import test from "node:test";
import { createIntensityFieldsState, INTENSITY_FIELD_GRID, updateIntensityFieldChannel } from "../js/core/state.js";
import { createIntensityFieldMaskOwner, mapIntensityToMaskGrayByte } from "../js/core/renderer/intensity_field_mask_owner.js";

test("mask groups adjacent non-neutral cells into distinct gray runs", () => {
  const fields = updateIntensityFieldChannel(createIntensityFieldsState(), "oceanDepth", (channel) => {
    channel.enabled = true;
    const rowOffset = 10 * INTENSITY_FIELD_GRID.columns;
    channel.grid.base.fill(1.5, rowOffset + 20, rowOffset + 23);
    channel.grid.base[rowOffset + 24] = 0.5;
  });
  const fills = [];
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this.fillStyle); },
  };
  const owner = createIntensityFieldMaskOwner({
    getFieldsState: () => fields,
    getProjection: () => ([lon, lat]) => [lon + 180, 90 - lat],
    createCanvas: (width, height) => ({ width, height, getContext: () => context }),
  });

  const first = owner.getMaskCanvas("oceanDepth", {
    transform: { x: 0, y: 0, k: 1 },
    widthPx: 360, heightPx: 180, dpr: 1,
    grayMap: { min: 28, neutral: 128, max: 232 },
  });

  assert.equal(first.renderedRunCount, 2);
  assert.equal(first.renderedCellCount, 4);
  assert.deepEqual(fills, ["rgb(180, 180, 180)", "rgb(78, 78, 78)"]);
});

test("intensity field mask gray map keeps neutral stable", () => {
  const grayMap = { min: 28, neutral: 128, max: 232 };

  assert.equal(mapIntensityToMaskGrayByte(1, grayMap), 128);
  assert.equal(mapIntensityToMaskGrayByte(0, grayMap), 28);
  assert.equal(mapIntensityToMaskGrayByte(2, grayMap), 232);
  assert.ok(mapIntensityToMaskGrayByte(0.5, grayMap) < 128);
  assert.ok(mapIntensityToMaskGrayByte(1.5, grayMap) > 128);
});
