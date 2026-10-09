import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRendererViewportUpdateOwner } from "../js/core/renderer/renderer_viewport_update_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

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

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected end marker ${JSON.stringify(endMarker)}`);
  return source.slice(start, end);
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
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

test("map_renderer imports wires and delegates viewport updates through the owner", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const updateMapWrapperSource = sliceBetween(
    rendererSource,
    "function updateMap(transform)",
    "function getProjectedRenderableContentBounds()",
  );
  const zoomLifecycleFactorySource = sliceBetween(
    rendererSource,
    "function getZoomInteractionLifecycleOwner()",
    "function getMapInteractionEventBindingOwner()",
  );

  for (const token of [
    "import { createRendererViewportUpdateOwner } from \"./renderer/renderer_viewport_update_owner.js\";",
    "let rendererViewportUpdateOwner = null;",
    "function getRendererViewportUpdateOwner()",
    "const runtime = runtimeState;",
    "rendererViewportUpdateOwner = createRendererViewportUpdateOwner({",
    "getters: {",
    "setZoomTransform: (transform) => {",
    "setHitCanvasDirty: () => {",
    "updateZoomUi: () => {",
    "renderPhysicalIntensityBrushPreview,",
    "syncUnitCounterScalesDuringZoom: () => {",
    "syncSpecialZonePatternTransformDuringZoom,",
    "drawFrame: () => {",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must wire viewport update owner");
  }

  assertIncludes(
    updateMapWrapperSource,
    "return getRendererViewportUpdateOwner().updateMap(transform);",
    "updateMap wrapper must delegate to viewport update owner",
  );
  assertIncludes(
    zoomLifecycleFactorySource,
    "updateMap,",
    "zoom lifecycle owner must still receive updateMap as an injected effect",
  );

  for (const tokenParts of [
    ["runtimeState.", "zoomTransform = transform;"],
    ["runtimeState.", "hitCanvasDirty = true;"],
    ["rendererSurfaceHost.getViewportGroup().attr("],
    ["rendererSurfaceHost.getViewportGroup()"],
    ["renderPhysicalIntensityBrushPreview();"],
    ["getStrategicOverlayRenderOwner().syncUnitCounterScalesDuringZoom();"],
    ["syncSpecialZonePatternTransformDuringZoom();"],
    ["draw", "Canvas();"],
  ]) {
    assertExcludes(
      updateMapWrapperSource,
      tokenParts.join(""),
      "updateMap wrapper must keep raw update work in the owner wiring",
    );
  }
});

test("viewport update owner avoids forbidden renderer semantics", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_viewport_update_owner.js");

  for (const tokenParts of [
    ["map_", "renderer.js"],
    ["runtime", "State"],
    ["draw", "Canvas"],
    ["renderPass", "ToCache"],
    ["build", "HitCanvas"],
    ["set", "MapData"],
    ["fit", "Projection"],
    ["exactAfter", "Settle"],
    ["scenario", " refresh"],
    ["scenario", " chunk"],
    ["strategicOverlay", "Runtime"],
    ["selection", "fill"],
  ]) {
    assertExcludes(
      ownerSource,
      tokenParts.join(""),
      "viewport update owner must avoid forbidden semantic token",
    );
  }
});
