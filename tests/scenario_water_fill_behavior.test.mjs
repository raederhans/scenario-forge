import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { parse } from "acorn";

const rendererSource = readFileSync(
  new URL("../js/core/renderer/scenario_region_overlay_render_owner.js", import.meta.url),
  "utf8",
);

function extractFunctionSource(source, functionName) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const factory = ast.body.find((node) => node.type === "ExportNamedDeclaration").declaration;
  const declaration = factory.body.body.find((node) => (
    node.type === "FunctionDeclaration" && node.id?.name === functionName
  ));
  assert.ok(declaration, `scenario region overlay owner must define ${functionName}`);
  return source.slice(declaration.start, declaration.end);
}

const drawScenarioWaterFillLayerSource = extractFunctionSource(
  rendererSource,
  "drawScenarioWaterFillLayer",
);

function part(id, { visible = true } = {}) {
  return { id, bounds: { id, visible } };
}

function feature(id, {
  opacity = 1,
  renderable = true,
  parts = [part(`${id}-part`)],
} = {}) {
  return { id, opacity, renderable, parts };
}

function createHarness({
  hasPath2D = true,
  featurePath = null,
  partPaths = new Map(),
  pathCanvas = null,
} = {}) {
  const calls = {
    beginPath: 0,
    fill: [],
    pathCanvas: [],
    restore: 0,
    save: 0,
  };
  const metrics = [];
  const drawingContext = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath() {
      calls.beginPath += 1;
    },
    fill(pathValue) {
      calls.fill.push(arguments.length ? pathValue : "current-path");
    },
    restore() {
      calls.restore += 1;
    },
    save() {
      calls.save += 1;
    },
  };
  const resolvedPathCanvas = typeof pathCanvas === "function"
    ? (candidate) => {
        calls.pathCanvas.push(candidate.id);
        pathCanvas(candidate);
      }
    : null;
  const context = vm.createContext({
    Path2D: hasPath2D ? function Path2D() {} : undefined,
    collectContextMetric: (name, duration, payload) => metrics.push({ name, duration, payload }),
    collectSafeWaterRegionGeometryParts: (candidate) => candidate.parts,
    computeProjectedGeoBounds: (candidate) => candidate.bounds,
    getFeatureId: (candidate) => candidate.id,
    getScenarioWaterFeaturePath: () => featurePath,
    getScenarioWaterPartPath: (candidate) => partPaths.get(candidate.id) || null,
    getWaterRegionColor: () => "#123456",
    getWaterRegionDefaultStyle: (candidate) => ({ opacity: candidate.opacity }),
    isWaterRegionRenderable: (candidate) => candidate.renderable,
    nowMs: () => 10,
    projectedGeoBoundsInScreen: (candidateBounds) => candidateBounds?.visible !== false,
    rendererSurfaceHost: {
      getContext: () => drawingContext,
      getPathCanvas: () => resolvedPathCanvas,
    },
  });
  vm.runInContext(
    `${drawScenarioWaterFillLayerSource}\n`
      + "globalThis.__drawScenarioWaterFillLayer = drawScenarioWaterFillLayer;",
    context,
  );
  return {
    calls,
    metrics,
    draw: (waterFeatures) => context.__drawScenarioWaterFillLayer(1, { waterFeatures }),
  };
}

test("scenario water fill counts a feature drawn through its complete Path2D", () => {
  const wholePath = { name: "whole-path" };
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ featurePath: wholePath });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.fill, [wholePath]);
  assert.equal(harness.calls.save, 1);
  assert.equal(harness.calls.restore, 1);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("scenario water fill counts multiple visible part paths as one rendered feature", () => {
  const firstPath = { name: "first-path" };
  const secondPath = { name: "second-path" };
  const water = feature("water", { parts: [part("a"), part("b"), part("offscreen", { visible: false })] });
  const harness = createHarness({
    partPaths: new Map([
      ["a", firstPath],
      ["b", secondPath],
    ]),
  });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.fill, [firstPath, secondPath]);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("scenario water fill counts a canvas-path fallback only after it is filled", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ pathCanvas: () => {} });

  assert.equal(harness.draw([water]), 1);
  assert.deepEqual(harness.calls.pathCanvas, ["a", "b"]);
  assert.deepEqual(harness.calls.fill, ["current-path", "current-path"]);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 1);
});

test("scenario water fill does not count a Path2D feature when no valid path exists", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ hasPath2D: true });

  assert.equal(harness.draw([water]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
  assert.equal(harness.metrics.at(-1).payload.skipped, true);
});

test("scenario water fill does not fill or count an empty legacy canvas path", () => {
  const water = feature("water", { parts: [part("a"), part("b")] });
  const harness = createHarness({ hasPath2D: false, pathCanvas: null });

  assert.equal(harness.draw([water]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
});

test("scenario water fill excludes transparent, disabled, and offscreen features from its count", () => {
  const transparent = feature("transparent", { opacity: 0 });
  const disabled = feature("disabled", { renderable: false });
  const offscreen = feature("offscreen", { parts: [part("offscreen-part", { visible: false })] });
  const harness = createHarness({ featurePath: { name: "unused" } });

  assert.equal(harness.draw([transparent, disabled, offscreen]), 0);
  assert.deepEqual(harness.calls.fill, []);
  assert.equal(harness.calls.save, 0);
  assert.equal(harness.calls.restore, 0);
  assert.equal(harness.metrics.at(-1).payload.featureCount, 3);
  assert.equal(harness.metrics.at(-1).payload.renderedCount, 0);
});
