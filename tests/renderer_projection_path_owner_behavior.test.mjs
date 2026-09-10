import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRendererProjectionPathOwner } from "../js/core/renderer/renderer_projection_path_owner.js";
import { getProjectionGeometryGeneration } from "../js/core/renderer/projection_geometry_identity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

test("initializing projection paths advances explicit geometry generation", () => {
  const harness = createHarness();
  const before = getProjectionGeometryGeneration(harness.projection);
  harness.owner.initializeProjectionPaths();
  assert.notEqual(getProjectionGeometryGeneration(harness.projection), before);
  const initialized = getProjectionGeometryGeneration(harness.projection);
  harness.owner.initializeProjectionPaths();
  assert.notEqual(getProjectionGeometryGeneration(harness.projection), initialized);
});

function createHarness({
  context = { id: "map-context" },
  hitContext = { id: "hit-context" },
  includeClipExtent = true,
} = {}) {
  const calls = {
    clipExtent: [],
    geoEqualEarth: 0,
    geoPath: [],
    order: [],
    pointRadius: [],
    precision: [],
  };
  const handles = {
    context,
    hitContext,
    pathCanvas: null,
    pathHitCanvas: null,
    pathSvg: null,
    projection: null,
  };
  const projection = {
    precision(value) {
      calls.precision.push(value);
      calls.order.push(["precision", value]);
      return projection;
    },
  };
  if (includeClipExtent) {
    projection.clipExtent = (value) => {
      calls.clipExtent.push(value);
      calls.order.push(["clipExtent", value]);
      return projection;
    };
  }
  const d3 = {
    geoEqualEarth() {
      calls.geoEqualEarth += 1;
      calls.order.push(["geoEqualEarth"]);
      return projection;
    },
    geoPath(nextProjection, nextContext) {
      const pathHandle = {
        context: nextContext,
        pointRadius(value) {
          calls.pointRadius.push(value);
          calls.order.push(["pointRadius", value]);
          return pathHandle;
        },
        projection: nextProjection,
      };
      calls.geoPath.push({
        argCount: arguments.length,
        context: nextContext,
        pathHandle,
        projection: nextProjection,
      });
      calls.order.push(["geoPath", arguments.length, nextContext]);
      return pathHandle;
    },
  };
  const surfaceHost = {
    getContext: () => handles.context,
    getHitContext: () => handles.hitContext,
    setPathCanvas(value) {
      handles.pathCanvas = value;
      calls.order.push(["setPathCanvas"]);
      return value;
    },
    setPathHitCanvas(value) {
      handles.pathHitCanvas = value;
      calls.order.push(["setPathHitCanvas"]);
      return value;
    },
    setPathSvg(value) {
      handles.pathSvg = value;
      calls.order.push(["setPathSvg"]);
      return value;
    },
    setProjection(value) {
      handles.projection = value;
      calls.order.push(["setProjection"]);
      return value;
    },
  };
  const owner = createRendererProjectionPathOwner({
    surfaceHost,
    getters: {
      getD3: () => d3,
    },
    constants: {
      pathPointRadius: 4.5,
      projectionPrecision: 0.25,
    },
  });

  return {
    calls,
    d3,
    handles,
    owner,
    projection,
    surfaceHost,
  };
}

test("initializes and registers projection/path handles", () => {
  const harness = createHarness();

  const result = harness.owner.initializeProjectionPaths();

  assert.equal(harness.calls.geoEqualEarth, 1);
  assert.deepEqual(harness.calls.precision, [0.25]);
  assert.deepEqual(harness.calls.clipExtent, [null]);
  assert.deepEqual(harness.calls.pointRadius, [4.5, 4.5, 4.5]);
  assert.equal(harness.calls.geoPath.length, 3);
  assert.equal(harness.calls.geoPath[0].argCount, 1);
  assert.equal(harness.calls.geoPath[0].projection, harness.projection);
  assert.equal(harness.calls.geoPath[1].context, harness.handles.context);
  assert.equal(harness.calls.geoPath[2].context, harness.handles.hitContext);
  assert.equal(harness.handles.projection, harness.projection);
  assert.equal(harness.handles.pathSvg, harness.calls.geoPath[0].pathHandle);
  assert.equal(harness.handles.pathCanvas, harness.calls.geoPath[1].pathHandle);
  assert.equal(harness.handles.pathHitCanvas, harness.calls.geoPath[2].pathHandle);
  assert.deepEqual(result, {
    context: harness.handles.context,
    hitContext: harness.handles.hitContext,
    pathCanvas: harness.handles.pathCanvas,
    pathHitCanvas: harness.handles.pathHitCanvas,
    pathSvg: harness.handles.pathSvg,
    projection: harness.projection,
  });
  assert.deepEqual(
    harness.calls.order.map((entry) => entry[0]),
    [
      "geoEqualEarth",
      "precision",
      "setProjection",
      "clipExtent",
      "geoPath",
      "pointRadius",
      "setPathSvg",
      "geoPath",
      "pointRadius",
      "setPathCanvas",
      "geoPath",
      "pointRadius",
      "setPathHitCanvas",
    ],
  );
});

test("fails fast when d3 or d3 projection/path factories are missing", () => {
  const harness = createHarness();

  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: harness.surfaceHost,
      getters: {},
      constants: { pathPointRadius: 4.5, projectionPrecision: 0.25 },
    }),
    /getters\.getD3/,
  );
  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: harness.surfaceHost,
      getters: { getD3: () => null },
      constants: { pathPointRadius: 4.5, projectionPrecision: 0.25 },
    }).initializeProjectionPaths(),
    /requires d3/,
  );
  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: harness.surfaceHost,
      getters: { getD3: () => ({ geoPath() {} }) },
      constants: { pathPointRadius: 4.5, projectionPrecision: 0.25 },
    }).initializeProjectionPaths(),
    /d3\.geoEqualEarth/,
  );
  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: harness.surfaceHost,
      getters: { getD3: () => ({ geoEqualEarth() { return {}; } }) },
      constants: { pathPointRadius: 4.5, projectionPrecision: 0.25 },
    }).initializeProjectionPaths(),
    /d3\.geoPath/,
  );
});

test("fails fast when canvas contexts are missing", () => {
  assert.throws(
    () => createHarness({ context: null }).owner.initializeProjectionPaths(),
    /surfaceHost\.context/,
  );
  assert.throws(
    () => createHarness({ hitContext: null }).owner.initializeProjectionPaths(),
    /surfaceHost\.hitContext/,
  );
});

test("fails fast when the registered projection lacks clipExtent", () => {
  assert.throws(
    () => createHarness({ includeClipExtent: false }).owner.initializeProjectionPaths(),
    /surfaceHost\.setProjection\(projection\)\.clipExtent/,
  );
});

test("fails fast when required host API or constants are missing", () => {
  const harness = createHarness();

  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: { ...harness.surfaceHost, setPathCanvas: null },
      getters: { getD3: () => harness.d3 },
      constants: { pathPointRadius: 4.5, projectionPrecision: 0.25 },
    }),
    /surfaceHost\.setPathCanvas/,
  );
  assert.throws(
    () => createRendererProjectionPathOwner({
      surfaceHost: harness.surfaceHost,
      getters: { getD3: () => harness.d3 },
      constants: { pathPointRadius: 4.5 },
    }),
    /constants\.projectionPrecision/,
  );
});

test("projection/path owner stays independent from renderer runtime state", () => {
  const ownerSource = fs.readFileSync(
    path.join(REPO_ROOT, "js", "core", "renderer", "renderer_projection_path_owner.js"),
    "utf8",
  );

  for (const token of [
    "runtimeState",
    "from \"../state.js\"",
    "from \"./state.js\"",
    "map_renderer.js",
  ]) {
    assert.equal(ownerSource.includes(token), false, `owner source must avoid ${token}`);
  }
});
