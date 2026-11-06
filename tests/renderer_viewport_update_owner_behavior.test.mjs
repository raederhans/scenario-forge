import assert from "node:assert/strict";
import test from "node:test";

import { createRendererViewportUpdateOwner } from "../js/core/renderer/renderer_viewport_update_owner.js";

const EFFECT_NAMES = Object.freeze([
  "setZoomTransform",
  "setHitCanvasDirty",
  "updateZoomUi",
  "renderPhysicalIntensityBrushPreview",
  "syncUnitCounterScalesDuringZoom",
  "syncSpecialZonePatternTransformDuringZoom",
  "drawFrame",
]);

const UPDATE_ORDER = Object.freeze([
  "setZoomTransform",
  "setHitCanvasDirty",
  "updateZoomUi",
  "applyViewportTransform",
  "renderPhysicalIntensityBrushPreview",
  "syncUnitCounterScalesDuringZoom",
  "syncSpecialZonePatternTransformDuringZoom",
  "drawFrame",
]);

function createHarness(options = {}) {
  const calls = {
    order: [],
    setZoomTransform: [],
    applyViewportTransform: [],
  };
  const group = Object.hasOwn(options, "viewportGroup")
    ? options.viewportGroup
    : {
      attr(name, value) {
        calls.order.push("applyViewportTransform");
        calls.applyViewportTransform.push({ name, value });
      },
    };
  const effects = {};
  for (const name of EFFECT_NAMES) {
    effects[name] = (transform) => {
      calls.order.push(name);
      if (name === "setZoomTransform") {
        calls.setZoomTransform.push(transform);
      }
    };
  }
  const getters = {
    getViewportGroup: () => group,
  };
  if (options.getPresentedTransform) {
    getters.getPresentedTransform = options.getPresentedTransform;
  }
  const owner = createRendererViewportUpdateOwner({ effects, getters });
  return { calls, effects, getters, owner };
}

test("updateMap runs viewport update effects in exact order", () => {
  const { calls, owner } = createHarness();
  const transform = { x: 12, y: -5, k: 3 };

  owner.updateMap(transform);

  assert.deepEqual(calls.order, [...UPDATE_ORDER]);
  assert.deepEqual(calls.setZoomTransform, [transform]);
  assert.deepEqual(calls.applyViewportTransform, [{
    name: "transform",
    value: "translate(12,-5) scale(3)",
  }]);
  assert.equal(calls.order.at(-1), "drawFrame");
  assert.equal(calls.order.filter((name) => name === "drawFrame").length, 1);
});

test("updateMap passes null and partial transforms through exactly", () => {
  const { calls, owner } = createHarness({ viewportGroup: false });
  const partialTransform = { x: 7 };

  owner.updateMap(null);
  assert.deepEqual(calls.order, EFFECT_NAMES);

  owner.updateMap(partialTransform);

  assert.deepEqual(calls.order, [...EFFECT_NAMES, ...EFFECT_NAMES]);
  assert.deepEqual(calls.setZoomTransform, [null, partialTransform]);
  assert.deepEqual(calls.applyViewportTransform, []);
});

test("frozen raster keeps the SVG on its presented transform after drawing", () => {
  const oldFrame = { x: 3, y: 4, k: 1 };
  const target = { x: 30, y: 40, k: 2 };
  const { calls, owner } = createHarness({ getPresentedTransform: () => oldFrame });

  owner.updateMap(target);

  assert.deepEqual(calls.order, [
    "setZoomTransform", "setHitCanvasDirty", "updateZoomUi", "drawFrame",
    "applyViewportTransform", "renderPhysicalIntensityBrushPreview",
    "syncUnitCounterScalesDuringZoom", "syncSpecialZonePatternTransformDuringZoom",
  ]);
  assert.deepEqual(calls.setZoomTransform, [target]);
  assert.deepEqual(calls.applyViewportTransform, [{
    name: "transform", value: "translate(3,4) scale(1)",
  }]);
  assert.equal(calls.order.filter((name) => name === "drawFrame").length, 1);
});

test("accepted raster and later commit callback synchronize the SVG", () => {
  let presented = { x: 1, y: 2, k: 1 };
  const target = { x: -12, y: 8, k: 1.5 };
  const { calls, owner } = createHarness({ getPresentedTransform: () => presented });

  owner.updateMap(target);
  assert.equal(calls.applyViewportTransform[0].value, "translate(1,2) scale(1)");
  presented = target;
  owner.applyViewportTransform(presented);
  assert.equal(calls.applyViewportTransform[1].value, "translate(-12,8) scale(1.5)");
  assert.equal(calls.order.filter((name) => name === "drawFrame").length, 1);

  const priorCalls = calls.order.length;
  owner.applyViewportTransform(null);
  assert.equal(calls.order.length, priorCalls);
});

test("missing presented frame falls back to target after the draw", () => {
  const target = { x: 7, y: -9, k: 2 };
  const { calls, owner } = createHarness({ getPresentedTransform: () => null });

  owner.updateMap(target);

  assert.equal(calls.applyViewportTransform[0].value, "translate(7,-9) scale(2)");
  assert.equal(calls.order.indexOf("drawFrame") + 1, calls.order.indexOf("applyViewportTransform"));
});

test("owner fails fast when a required effect is missing", () => {
  for (const missingName of EFFECT_NAMES) {
    const { effects, getters } = createHarness();
    delete effects[missingName];

    assert.throws(
      () => createRendererViewportUpdateOwner({ effects, getters }),
      new RegExp(`renderer viewport update owner requires effects\\.${missingName}`),
    );
  }
});

test("owner fails fast when viewport group getter is missing", () => {
  const { getters, effects } = createHarness();
  delete getters.getViewportGroup;

  assert.throws(
    () => createRendererViewportUpdateOwner({ effects, getters }),
    /renderer viewport update owner requires getters\.getViewportGroup/,
  );
});
