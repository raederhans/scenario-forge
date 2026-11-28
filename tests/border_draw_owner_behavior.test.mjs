import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";
import { sanitizePolyline } from "../js/core/renderer/polyline_simplification_helpers.js";
import { createPaintContourMesh, getPackedPaintContourMesh } from "../js/core/renderer/paint_contour_mesh.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

class RecordingBoundaryPath {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath(...args) { this.commands.push(["closePath", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
  addPath(path) { this.commands.push(...path.commands); }
}

function installBoundaryPath(t) {
  const original = globalThis.Path2D;
  globalThis.Path2D = RecordingBoundaryPath;
  t.after(() => { if (original === undefined) delete globalThis.Path2D; else globalThis.Path2D = original; });
}

function createPreparedBorderHarness({ paintMesh }) {
  const projection = d3.geoEqualEarth().scale(170).translate([200, 160]).clipExtent([[0, 0], [400, 320]]).precision(0.08);
  const makeMesh = (coordinates) => ({ type: "MultiLineString", coordinates });
  const political = makeMesh([[[20, -10], [80, 5]]]);
  const state = {
    activeScenarioId: "tno", sceneGeneration: 1, currentScenarioApplyRequestId: 1,
    renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
    styleConfig: { internalBorders: { width: 1.2, opacity: 0.7, color: "#112233" },
      empireBorders: { width: 1.7, opacity: 0.8, color: "#223344" }, coastlines: { width: 1.3, opacity: 0.6, color: "#334455" },
      parentBorders: { width: 1.1, opacity: 0.75, color: "#445566" } },
  };
  const context = createContextRecorder();
  let currentPath = new RecordingBoundaryPath();
  context.beginPath = () => { currentPath = new RecordingBoundaryPath(); };
  for (const method of ["moveTo", "lineTo", "closePath", "arc"]) context[method] = (...args) => currentPath[method](...args);
  context.stroke = (path) => context.strokes.push({ alpha: context.globalAlpha, strokeStyle: context.strokeStyle,
    lineWidth: context.lineWidth, lineJoin: context.lineJoin, lineCap: context.lineCap, miterLimit: context.miterLimit,
    path: [...(path || currentPath).commands] });
  const path = d3.geoPath(projection).context(context);
  const owner = createBorderDrawOwner({ state, getters: {
    getContext: () => context, getProjection: () => projection,
    getPathCanvas: () => path,
  }, helpers: {
    createBoundaryPath: () => new RecordingBoundaryPath(),
    sanitizePolyline, isUsableMesh: value => !!value?.coordinates?.length,
    getPaintContourMeshes: () => [paintMesh],
    getPoliticalBorderMeshes: () => [political],
    getCoastlineCollectionForZoom: () => [],
  } });
  return { owner, context };
}

test("screen-space decluttering removes straight vertices and preserves cusps", () => {
  const owner = createBorderDrawOwner({
    state: {},
    getters: { getProjection: () => (point) => point },
    helpers: { sanitizePolyline: (line) => line },
  });
  const straight = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const cusp = [[0, 0], [1, 0], [0, 0], [3, 0]];

  assert.deepEqual(owner.declutterProjectedPolyline(straight, 3.6, 4), [[0, 0], [3, 0]]);
  assert.deepEqual(owner.declutterProjectedPolyline(cusp, 3.6, 4), cusp);
});

test("boundary length, span, and area filters use zoom-scaled screen thresholds", () => {
  const owner = createBorderDrawOwner({
    state: {},
    getters: { getProjection: () => (point) => point },
    helpers: { isUsableMesh: (value) => !!value?.coordinates?.length },
  });
  const boundary = {
    type: "MultiLineString",
    coordinates: [
      [[0, 0], [1.29, 0]],
      [[0, 0], [3, 0]],
    ],
  };
  const localAt3 = mesh => owner.buildRenderableBoundaryMesh(mesh, { minLengthPx: 4, k: 3 });
  const localAt32 = mesh => owner.buildRenderableBoundaryMesh(mesh, { minLengthPx: 4, k: 3.2 });
  const boundaryAt3 = localAt3(boundary);
  const boundaryAt32 = localAt32(boundary);
  assert.deepEqual(boundaryAt3.coordinates, [[[0, 0], [3, 0]]]);
  assert.deepEqual(boundaryAt32.coordinates, boundary.coordinates);
  assert.notEqual(boundaryAt32, boundaryAt3);

  const smallArea = {
    type: "MultiLineString",
    coordinates: [[[0, 0], [0.99, 0], [0.99, 0.99], [0, 0.99], [0, 0]]],
  };
  const filterOptions = { minSpanPx: 3, minAreaPx: 10, k: 3 };
  assert.equal(owner.buildRenderableBoundaryMesh(smallArea, filterOptions), null);
  assert.deepEqual(
    owner.buildRenderableBoundaryMesh(smallArea, { ...filterOptions, k: 3.2 }).coordinates,
    smallArea.coordinates,
  );
});

function createContextRecorder() {
  const stack = [];
  return {
    globalAlpha: 1,
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    miterLimit: 0,
    strokes: [],
    currentPath: [],
    beginPath() { this.currentPath = []; },
    save() {
      stack.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
        lineJoin: this.lineJoin, lineCap: this.lineCap, miterLimit: this.miterLimit });
    },
    restore() { Object.assign(this, stack.pop()); },
  };
}

test("packed paint arcs draw the same paths as GeoJSON", async t => {
  installBoundaryPath(t);
  const long = Array.from({ length: 40 }, (_, i) => [-60 + i / 50, 10 + Math.sin(i / 15)]);
  const lines = [[[140, 10], [-160, 30], [-80, 20]], long];
  const graph = { featureIds: ["A", "B"], coordinates: Float64Array.from(lines.flat(2)),
    offsets: Uint32Array.of(0, 3, 3 + long.length), owners: Uint32Array.of(0, 1, 0, 1) };
  const colors = { A: "#112233", B: "#445566" };
  const view = createPaintContourMesh(graph, id => colors[id]);
  const packed = view.getMesh();
  const data = getPackedPaintContourMesh(packed);
  assert.equal(data.coordinates, graph.coordinates);
  assert.deepEqual([...data.arcs], [0, 1]);
  for (const interactive of [false, true]) {
    const baseline = createPreparedBorderHarness({ paintMesh: { type: "MultiLineString", coordinates: lines } });
    baseline.owner.drawHierarchicalBorders(2, { interactive });
    const h = createPreparedBorderHarness({ paintMesh: packed });
    h.owner.drawHierarchicalBorders(2, { interactive });
    assert.deepEqual(h.context.strokes, baseline.context.strokes, "direct draw preserves D3 clipping/resampling and stroke order");
    h.context.strokes.length = 0;
    assert.equal(await h.owner.prepareHierarchicalBorders(2, { interactive }), true);
    h.owner.drawHierarchicalBorders(2, { interactive });
    assert.deepEqual(h.context.strokes, baseline.context.strokes);
  }
});

function createViewportBorderHarness() {
  const state = { zoomTransform: { x: 0, y: 0, k: 5 }, styleConfig: { coastlines: { opacity: 0 } } };
  const mesh = { type: "MultiLineString", coordinates: [
    [[-30, -30], [-20, -20]],
    [[-20, 5], [5, 5], [20, 5], [30, 5], [5, 6], [-20, 6]],
    [[-10, 0], [0, 0], [0, 10]], [[3, 3]], [[-20, -20]], [[4, 4], [4, 4]],
  ] };
  const viewport = { key: "screen", bounds: [0, 0, 10, 10], maxStrokeWidth: 10, maxMiterLimit: 4 };
  const paths = [];
  const context = { getLineDash: () => [], stroke: path => paths.push(path), beginPath() {} };
  const projection = point => point;
  projection.stream = sink => sink;
  const owner = createBorderDrawOwner({ state, getters: {
    getContext: () => context, getProjection: () => projection,
    getBoundaryPathViewport: () => viewport, getPathCanvas: () => () => {},
  }, helpers: { getPaintContourMeshes: () => [mesh], getCoastlineCollectionForZoom: () => [],
    isUsableMesh: value => !!value?.coordinates?.length } });
  return { owner, mesh, paths };
}

test("viewport rejection preserves exact endpoints, crossing joins, boundary touches and singleton subpaths", async t => {
  installBoundaryPath(t);
  const h = createViewportBorderHarness();
  assert.equal(await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} }), true);
  h.owner.drawMeshCollection([h.mesh], "black", 1);
  assert.equal(h.paths.length, 1, "all retained subpaths still share one stroke");
  assert.deepEqual(h.paths[0].commands, [
    ["moveTo", -20, 5], ["lineTo", 5, 5], ["lineTo", 20, 5],
    ["moveTo", 30, 5], ["lineTo", 5, 6], ["lineTo", -20, 6],
    ["moveTo", -10, 0], ["lineTo", 0, 0], ["lineTo", 0, 10],
    ["moveTo", 3, 3], ["moveTo", 4, 4], ["lineTo", 4, 4],
  ]);
});
