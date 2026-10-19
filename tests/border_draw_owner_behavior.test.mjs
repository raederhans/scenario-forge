import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";
import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { sanitizePolyline } from "../js/core/renderer/polyline_simplification_helpers.js";
import { createPaintContourMesh, getPackedPaintContourMesh } from "../js/core/renderer/paint_contour_mesh.js";
import { createPackedLineMesh } from "../js/core/renderer/packed_line_mesh.js";
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

function createPreparedBorderHarness({ long = false, constants = {}, paintMesh = null } = {}) {
  const counts = { direct: 0, stream: 0, streamPoints: 0, pathCanvas: 0, river: 0, accent: 0, reconcile: 0 };
  const nativePaths = [];
  let baseProjection = d3.geoEqualEarth().scale(170).translate([200, 160]).clipExtent([[0, 0], [400, 320]]).precision(0.08);
  const projection = (point) => { counts.direct++; return baseProjection(point); };
  projection.stream = (sink) => {
    counts.stream++;
    const stream = baseProjection.stream(sink);
    return {
      point(...args) { counts.streamPoints++; stream.point(...args); },
      lineStart: (...args) => stream.lineStart(...args), lineEnd: (...args) => stream.lineEnd(...args),
      polygonStart: (...args) => stream.polygonStart(...args), polygonEnd: (...args) => stream.polygonEnd(...args),
      sphere: (...args) => stream.sphere(...args),
    };
  };
  const line = long ? Array.from({ length: 4096 }, (_, i) => [-60 + i / 50, 10 + Math.sin(i / 15)])
    : [[-40, 0], [-39.999, 0], [-20, 10], [0, -5], [35, 25]];
  const makeMesh = (coordinates) => ({ type: "MultiLineString", coordinates });
  const local = makeMesh([line, [[0, 0], [0.00001, 0]]]);
  const province = makeMesh([[[170, -10], [-170, 20], [-90, 30]], [[-5, 5], [20, 5]]]);
  const paint = paintMesh || makeMesh([[[140, 10], [-160, 30], [-80, 20]], [[-30, 2], [10, 1]]]);
  const political = makeMesh([[[20, -10], [80, 5]]]);
  const coast = makeMesh([line, [[-80, 30], [-10, 40], [60, 15]]]);
  const coast2 = makeMesh([[[100, -30], [140, -25], [170, -10]]]);
  const state = {
    activeScenarioId: "tno", sceneGeneration: 1, currentScenarioApplyRequestId: 1,
    renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
    styleConfig: { internalBorders: { width: 1.2, opacity: 0.7, color: "#112233" },
      empireBorders: { width: 1.7, opacity: 0.8, color: "#223344" }, coastlines: { width: 1.3, opacity: 0.6, color: "#334455" },
      parentBorders: { width: 1.1, opacity: 0.75, color: "#445566" } },
    cachedLocalBordersByCountry: new Map([["AA", [local]]]),
    cachedProvinceBordersByCountry: new Map([["AA", [province]]]),
    cachedDetailAdmBorders: [political], cachedParentBordersByCountry: new Map([["AA", [paint]]]),
    parentBordersVisible: true, parentBorderSupportedCountries: ["AA"], parentBorderEnabledByCountry: { AA: true },
    cachedCoastlinesLow: [coast, coast2],
  };
  const context = createContextRecorder();
  let currentPath = new RecordingBoundaryPath();
  context.beginPath = () => { currentPath = new RecordingBoundaryPath(); };
  for (const method of ["moveTo", "lineTo", "closePath", "arc"]) context[method] = (...args) => currentPath[method](...args);
  context.stroke = (path) => context.strokes.push({ alpha: context.globalAlpha, strokeStyle: context.strokeStyle,
    lineWidth: context.lineWidth, lineJoin: context.lineJoin, lineCap: context.lineCap, miterLimit: context.miterLimit,
    path: [...(path || currentPath).commands] });
  const path = d3.geoPath(projection).context(context);
  let visible = ["AA"];
  const owner = createBorderDrawOwner({ state, constants, getters: {
    getContext: () => context, getProjection: () => projection,
    getPathCanvas: () => (geometry) => { counts.pathCanvas++; path(geometry); },
  }, helpers: {
    createBoundaryPath: () => { const path = new RecordingBoundaryPath(); nativePaths.push(path); return path; },
    sanitizePolyline, isUsableMesh: value => !!value?.coordinates?.length,
    // Fresh wrappers must not invalidate the same geometry snapshot.
    getPaintContourMeshes: () => [paint], getPoliticalBorderMeshes: () => [political],
    getCoastlineCollectionForZoom: () => [coast, coast2],
    getVisibleCountryCodesForBorderMeshes: () => new Set(visible),
    getInternalBorderStrokeColor: (code, color) => code === "AA" ? color : "#778899",
    drawRiverInternalContours: () => { counts.river++; }, drawScenarioCoastalAccentLayer: () => { counts.accent++; },
    reconcileDetailAdmBorders: () => { counts.reconcile++; },
    drawCoastalTransition(k, { lineWidth, buildPath }) {
      context.save();
      context.beginPath(); // Model the ocean/Atlantropa clip paths before the coastline.
      context.strokeStyle = "halo"; context.globalAlpha = 0.6 * 0.13; context.lineWidth = lineWidth + 2.2 / k;
      context.lineJoin = "round"; context.lineCap = "round";
      const cached = buildPath();
      context.stroke(cached);
      context.restore();
      return true;
    },
  } });
  return { owner, state, context, counts, projection, local, paint, nativePaths,
    setVisible(codes) { visible = codes; },
    changeProjection() { baseProjection = baseProjection.rotate([15, 0]); markProjectionGeometryChanged(projection); } };
}

test("boundary filtering projects each sanitized point once and preserves threshold decisions", () => {
  let projections = 0;
  const projection = ([x, y]) => { projections += 1; return [x * x, y * 2]; };
  const owner = createBorderDrawOwner({
    state: {}, getters: { getProjection: () => projection },
    helpers: { sanitizePolyline, isUsableMesh: value => !!value?.coordinates?.length },
  });
  const line = [[0, 0], [0, 0], null, [NaN, 1], [1, 0], [2, 3]];
  const source = { type: "MultiLineString", coordinates: [line] };
  // Projected line is (0,0), (1,0), (4,6): span 6, area 24, length 1 + sqrt(45).
  const options = { simplifyDistancePx: 0.1, minSpanPx: 6, minAreaPx: 24, minLengthPx: 1 + Math.sqrt(45) };
  assert.deepEqual(owner.buildRenderableBoundaryMesh(source, options)?.coordinates, [[[0, 0], [1, 0], [2, 3]]]);
  assert.equal(projections, 3);
  for (const key of ["minSpanPx", "minAreaPx", "minLengthPx"]) {
    assert.equal(owner.buildRenderableBoundaryMesh(source, { ...options, [key]: options[key] + 0.000001 }), null);
  }
  const longLine = Array.from({ length: 1000 }, (_, index) => [index, index % 2]);
  projections = 0;
  assert.equal(owner.buildRenderableBoundaryMesh({ type: "MultiLineString", coordinates: [longLine] },
    { simplifyDistancePx: 0.01 }).coordinates[0].length, 1000);
  assert.equal(projections, 1000);
});

test("boundary projection reuse preserves missing projections, degenerate lines, and simplified endpoints", () => {
  const createGeometryOwner = projection => createBorderDrawOwner({
    state: {}, getters: { getProjection: () => projection },
    helpers: { sanitizePolyline, isUsableMesh: value => !!value?.coordinates?.length },
  });
  const source = { type: "MultiLineString", coordinates: [[[0, 0], [1, 0], [2, 0], [3, 4]]] };
  const partial = createGeometryOwner(([x, y]) => x === 1 ? null : x === 2 ? [Infinity, y] : [x, y]);
  assert.deepEqual(partial.buildRenderableBoundaryMesh(source, { simplifyDistancePx: 2, minLengthPx: 5 }), source);
  assert.equal(partial.buildRenderableBoundaryMesh(source, { simplifyDistancePx: 2, minLengthPx: 5.001 }), null);
  const missing = createGeometryOwner(null);
  assert.deepEqual(missing.buildRenderableBoundaryMesh(source, { simplifyDistancePx: 2 }), source);
  assert.equal(missing.buildRenderableBoundaryMesh(source, { minLengthPx: 1 }), null);
  const identity = createGeometryOwner(point => point);
  const straight = { type: "MultiLineString", coordinates: [[[0, 0], [1, 0], [2, 0], [10, 0]]] };
  assert.deepEqual(identity.buildRenderableBoundaryMesh(straight, { simplifyDistancePx: 3, angleThresholdDeg: 181 })?.coordinates,
    [[[0, 0], [10, 0]]]);
  assert.equal(identity.buildRenderableBoundaryMesh({ type: "MultiLineString", coordinates: [[[1, 1], [1, 1]]] }), null);
});

test("boundary and coastline geometry reuse follows projection and exact thresholds, not paint state", () => {
  let projections = 0;
  const projection = (point) => { projections += 1; return point; };
  const state = {};
  const owner = createBorderDrawOwner({ state, getters: { getProjection: () => projection },
    helpers: { isUsableMesh: (value) => !!value?.coordinates?.length } });
  const source = { type: "MultiLineString", coordinates: [[[0, 0], [1, 0], [100, 0]]] };
  const options = { simplifyDistancePx: 3, minLengthPx: 10 };
  const first = owner.buildRenderableBoundaryMesh(source, options);
  const coast = owner.getViewportAwareCoastlineCollection([source], 1)[0];
  const count = projections;
  state.colorRevision = 9;
  state.zoomTransform = { x: 200, y: -50, k: 1.2 };
  state.dpr = 2;
  assert.equal(owner.buildRenderableBoundaryMesh(source, options), first);
  const coastAtZoom = owner.getViewportAwareCoastlineCollection([source], 1.2)[0];
  assert.notEqual(coastAtZoom, coast);
  const coastZoomProjectionCount = projections;
  assert.equal(owner.getViewportAwareCoastlineCollection([source], 1.2)[0], coastAtZoom);
  assert.equal(projections, coastZoomProjectionCount);
  assert.ok(coastZoomProjectionCount > count);
  assert.notEqual(owner.buildRenderableBoundaryMesh(source, { ...options, minLengthPx: 20 }), first);
  assert.notEqual(owner.getViewportAwareCoastlineCollection([source], 2)[0], coast);
  markProjectionGeometryChanged(projection);
  assert.notEqual(owner.buildRenderableBoundaryMesh(source, options), first);
  assert.notEqual(owner.getViewportAwareCoastlineCollection([source], 1)[0], coast);
  const replaced = { ...source, coordinates: [[[0, 0], [200, 0]]] };
  assert.notEqual(owner.buildRenderableBoundaryMesh(replaced, options), first);
});

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
  const localAt3 = owner.getBoundaryMeshTransform("internal-local", 3);
  const localAt32 = owner.getBoundaryMeshTransform("internal-local", 3.2);
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

test("coastline simplification and filtering follow screen thresholds near zoom 3", () => {
  const owner = createBorderDrawOwner({
    state: {},
    getters: { getProjection: () => (point) => point },
    helpers: { isUsableMesh: (value) => !!value?.coordinates?.length },
  });
  const coastline = { type: "MultiLineString", coordinates: [[[0, 0], [7, 0]]] };
  const coastlineAt3 = owner.getBoundaryMeshTransform("coastline", 3)(coastline);
  assert.deepEqual(coastlineAt3.coordinates, coastline.coordinates);

  const thresholdCoastline = { type: "MultiLineString", coordinates: [[[0, 0], [2.55, 0]]] };
  const coastlineAt3_0 = owner.getBoundaryMeshTransform("coastline", 3)(thresholdCoastline);
  const coastlineAt3_19 = owner.getBoundaryMeshTransform("coastline", 3.19)(thresholdCoastline);
  assert.equal(coastlineAt3_0, null);
  assert.deepEqual(coastlineAt3_19.coordinates, thresholdCoastline.coordinates);
  assert.equal(owner.getBoundaryMeshTransform("coastline", 3.2), null);

  const detailedCoastline = {
    type: "MultiLineString",
    coordinates: [[[0, 0], [0.59, 0], [7, 0]]],
  };
  const viewAt3 = owner.getViewportAwareCoastlineCollection([detailedCoastline], 3)[0];
  const viewAt3_19 = owner.getViewportAwareCoastlineCollection([detailedCoastline], 3.19)[0];
  assert.deepEqual(viewAt3.coordinates, [[[0, 0], [7, 0]]]);
  assert.deepEqual(viewAt3_19.coordinates, detailedCoastline.coordinates);
  assert.equal(owner.getViewportAwareCoastlineCollection([detailedCoastline], 3.2)[0], detailedCoastline);
});

const mesh = { type: "MultiLineString", coordinates: [[[0, 0], [100, 100]]] };

function nearlyEqual(actual, expected, epsilon = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

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
    stroke() {
      this.strokes.push({
        alpha: this.globalAlpha,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
        path: this.currentPath,
      });
    },
  };
}

function createOwner({ interactive = false, helpers = {} } = {}) {
  const context = createContextRecorder();
  const coastalAccentCalls = [];
  const state = {
    activeScenarioId: "",
    activeScenarioManifest: null,
    scenarioBorderMode: "canonical",
    cachedCountryBorders: [mesh],
    cachedCoastlines: [mesh],
    cachedCoastlinesHigh: [mesh],
    cachedCoastlinesLow: [mesh],
    cachedCoastlinesMid: [mesh],
    cachedProvinceBordersByCountry: new Map([["AAA", [mesh]]]),
    cachedLocalBordersByCountry: new Map([["AAA", [mesh]]]),
    cachedDetailAdmBorders: [],
    cachedParentBordersByCountry: new Map(),
    parentBorderSupportedCountries: [],
    parentBorderEnabledByCountry: {},
    parentBordersVisible: true,
    styleConfig: {
      internalBorders: {
        color: "#111111",
        colorMode: "manual",
        opacity: 0,
        width: 1,
      },
      empireBorders: {
        color: "#222222",
        opacity: 0.25,
        width: 2,
      },
      coastlines: {
        color: "#333333",
        opacity: 0.5,
        width: 1.8,
      },
      parentBorders: {
        color: "#444444",
        opacity: 0.85,
        width: 1.1,
      },
    },
  };
  const owner = createBorderDrawOwner({
    state,
    getters: {
      getContext: () => context,
      getPathCanvas: () => (geometry) => context.currentPath.push(geometry),
      getProjection: () => (point) => point,
      getVisibleInternalBorderMeshSignature: () => "",
    },
    helpers: {
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      drawScenarioCoastalAccentLayer: (...args) => coastalAccentCalls.push(args),
      getCoastlineCollectionForZoom: () => (interactive ? state.cachedCoastlinesLow : state.cachedCoastlines),
      getInternalBorderStrokeColor: (_countryCode, fallbackColor) => fallbackColor,
      getSafeCanvasColor: (value, fallbackColor) => value || fallbackColor,
      getVisibleCountryCodesForBorderMeshes: () => new Set(["AAA"]),
      getPaintContourMeshes: () => [mesh],
      getPoliticalBorderMeshes: () => [],
      isUsableMesh: (candidate) => !!candidate?.coordinates?.length,
      sanitizePolyline: (line) => (Array.isArray(line) ? line : []),
      ...helpers,
    },
  });
  return { owner, context, coastalAccentCalls, state };
}

test("river contours inherit paint contour style before global border strokes in settled and interactive passes", () => {
  for (const interactive of [false, true]) {
    for (const scenario of [false, true]) {
      let h;
      const calls = [];
      h = createOwner({ interactive, helpers: { drawRiverInternalContours: options => {
        assert.equal(h.context.strokes.length, 0, "river scratch must composite before global borders");
        calls.push(options);
      } } });
      if (scenario) h.state.activeScenarioId = "river-scenario";
      h.owner.drawHierarchicalBorders(2, { interactive });
      assert.equal(calls.length, 1);
      const { color, alpha, width, ...rest } = calls[0];
      const paintStroke = h.context.strokes.find(stroke => stroke.strokeStyle === color);
      assert.ok(paintStroke);
      assert.equal(alpha, paintStroke.alpha);
      assert.equal(width, paintStroke.lineWidth);
      assert.deepEqual(rest, { k: 2, interactive, lineJoin: "round", lineCap: "round", miterLimit: 4 });
    }
  }
});

test("drawing requests detail cache reconciliation without writing renderer state", () => {
  const requests = [];
  const detailMeta = { signature: "zoom-5", detailCountries: ["AAA"] };
  const { owner, state } = createOwner({
    helpers: {
      buildDetailAdmMeshSignature: () => detailMeta,
      reconcileDetailAdmBorders: (meta) => requests.push(meta),
    },
  });
  Object.freeze(state);
  owner.drawHierarchicalBorders(5);
  assert.deepEqual(requests, [detailMeta]);
});

test("border styles retain normal and interactive opacity and width", () => {
  for (const [interactive, countryAlpha, coastAlpha, countryWidth, coastWidth] of [
    [false, 0.25, 0.3785714286, 1.0071428571, 0.8485714286],
    [true, 0.22, 0.39, 0.95, 0.792],
  ]) {
    const { owner, context } = createOwner({ interactive });
    owner.drawHierarchicalBorders(2, { interactive });
    const country = context.strokes.find(stroke => stroke.strokeStyle === "#222222");
    const coast = context.strokes.find(stroke => stroke.strokeStyle === "#333333");
    nearlyEqual(country.alpha, countryAlpha);
    nearlyEqual(coast.alpha, coastAlpha);
    nearlyEqual(country.lineWidth, countryWidth);
    nearlyEqual(coast.lineWidth, coastWidth);
    if (!interactive) assert.equal(context.strokes.find(stroke => stroke.strokeStyle === "#111111").alpha, 0);
  }
});


test("empty or pending paint contours never revive cached reference borders", () => {
  for (const interactive of [false, true]) {
    const { owner, context, state } = createOwner({ helpers: { getPaintContourMeshes: () => [] } });
    state.activeScenarioId = "tno_1962";
    state.scenarioBorderMode = "scenario_owner_only";
    state.cachedDynamicOwnerBorders = state.cachedCountryBorders[0];
    state.cachedScenarioOpeningOwnerBorders = state.cachedCountryBorders[0];
    owner.drawHierarchicalBorders(2, { interactive });
    assert.equal(context.strokes.some(stroke => stroke.strokeStyle === "#222222"), false);
    assert.ok(context.strokes.some(stroke => stroke.strokeStyle === "#333333"));
  }
});

test("scenario paint and political borders draw separately with subdued paint styling", () => {
  const politicalMesh = { type: "MultiLineString", coordinates: [[[1, 1], [2, 2]]] };
  const { owner, context, state } = createOwner({
    helpers: { getPoliticalBorderMeshes: () => [politicalMesh] },
  });
  state.activeScenarioId = "tno_1962";
  state.styleConfig.empireBorders = { color: "#abcdef", opacity: 0.4, width: 2 };

  owner.drawHierarchicalBorders(1);

  const borders = context.strokes.filter(stroke => stroke.strokeStyle === "#abcdef");
  assert.equal(borders.length, 2);
  nearlyEqual(borders[0].lineWidth, 1.3);
  nearlyEqual(borders[0].alpha, 0.2);
  nearlyEqual(borders[1].lineWidth, 1.2);
  nearlyEqual(borders[1].alpha, 0.272);
});

test("political borders reach the full user style by medium zoom in both passes", () => {
  const politicalMesh = { type: "MultiLineString", coordinates: [[[1, 1], [2, 2]]] };
  const records = [];
  for (const interactive of [false, true]) {
    const { owner, context, state } = createOwner({
      interactive,
      helpers: { getPoliticalBorderMeshes: () => [politicalMesh] },
    });
    state.activeScenarioId = "tno_1962";
    state.styleConfig.empireBorders = { color: "#abcdef", opacity: 0.4, width: 2 };
    owner.drawHierarchicalBorders(3.2, { interactive });
    records.push(context.strokes.find(stroke => stroke.strokeStyle === "#abcdef" && Math.abs(stroke.alpha - 0.4) < 0.0001));
  }
  const expectedWidth = (2 * (0.95 + (0.40 * ((3.2 - 1) / 7))) / 3.2);
  for (const border of records) {
    assert.ok(border);
    nearlyEqual(border.lineWidth, expectedWidth);
    nearlyEqual(border.alpha, 0.4);
  }
  nearlyEqual(records[0].lineWidth, records[1].lineWidth);
  nearlyEqual(records[0].alpha, records[1].alpha);
});

test("disabled political layer draws no political mesh", () => {
  const { owner, context, state } = createOwner();
  state.activeScenarioId = "tno_1962";
  owner.drawHierarchicalBorders(1);
  assert.equal(context.strokes.filter(stroke => stroke.strokeStyle === "#222222").length, 1);
});

test("coastal transition clips one combined path then reuses it for the original fine stroke", () => {
  const secondMesh = { type: "MultiLineString", coordinates: [[[10, 10], [100, 100]]] };
  for (const interactive of [false, true]) {
    let oceanOwner;
    const harness = createOwner({ interactive, helpers: {
      drawCoastalTransition: (...args) => oceanOwner.drawCoastalTransition(...args),
      getCoastlineCollectionForZoom: () => [mesh, secondMesh],
    } });
    const { owner, context, state, coastalAccentCalls } = harness;
    state.cachedCoastlinesLow = [mesh, secondMesh];
    let masks = 0;
    oceanOwner = createOceanRenderOwner({ state, getters: { getContext: () => context }, helpers: {
      getPhysicalLandMaskInfo: () => ({ collection: { type: "FeatureCollection", features: [] } }),
      applyOceanClipMask: () => { masks += 1; context.beginPath(); },
      clipOutAtlantropaAccentRegions: () => context.beginPath(),
    } });
    owner.drawHierarchicalBorders(2, { interactive });
    const halo = context.strokes.find(stroke => stroke.strokeStyle === "#d7ebf5");
    const fine = context.strokes.find(stroke => stroke.strokeStyle === "#333333");
    assert.equal(masks, 1);
    assert.equal(halo.path, fine.path);
    assert.equal(halo.path.length, 2);
    assert.equal(context.strokes.filter(stroke => stroke.strokeStyle === "#d7ebf5").length, 1);
    nearlyEqual(halo.alpha, 0.5 * 0.13);
    nearlyEqual(halo.lineWidth - fine.lineWidth, 2.2 / 2);
    nearlyEqual(fine.alpha, interactive ? 0.39 : 0.3785714286);
    assert.ok(context.strokes.indexOf(halo) < context.strokes.indexOf(fine));
    assert.equal(coastalAccentCalls.length, interactive ? 0 : 1);
    assert.equal(context.globalAlpha, 1);
    const baseline = createOwner({ interactive });
    baseline.owner.drawHierarchicalBorders(2, { interactive });
    const otherBorders = (strokes) => strokes.filter(stroke => !["#d7ebf5", "#333333"].includes(stroke.strokeStyle));
    assert.deepEqual(otherBorders(context.strokes), otherBorders(baseline.context.strokes));
  }
});

test("missing physical land masks skip the halo while preserving fine coastlines and scenario accents", () => {
  let oceanOwner;
  const { owner, context, state, coastalAccentCalls } = createOwner({ helpers: {
    drawCoastalTransition: (...args) => oceanOwner.drawCoastalTransition(...args),
  } });
  oceanOwner = createOceanRenderOwner({ state, getters: { getContext: () => context }, helpers: {
    getPhysicalLandMaskInfo: () => ({ collection: null }),
    applyOceanClipMask: () => assert.fail("unexpected ocean clip"),
  } });
  owner.drawHierarchicalBorders(2);
  assert.equal(context.strokes.some(stroke => stroke.strokeStyle === "#d7ebf5"), false);
  const fine = context.strokes.find(stroke => stroke.strokeStyle === "#333333");
  assert.ok(fine);
  assert.equal(fine.path.length, 1);
  nearlyEqual(fine.alpha, 0.3785714286);
  assert.equal(coastalAccentCalls.length, 1);
});

test("zero-opacity and missing coastlines never request a transition", () => {
  for (const reason of ["zero-opacity", "missing"]) {
    for (const interactive of [false, true]) {
      let transitions = 0;
      const { owner, context, state, coastalAccentCalls } = createOwner({
        interactive, helpers: {
          drawCoastalTransition: () => { transitions += 1; return false; },
          ...(reason === "missing" ? { getCoastlineCollectionForZoom: () => [] } : {}),
        },
      });
      if (reason === "zero-opacity") state.styleConfig.coastlines.opacity = 0;
      if (reason === "missing") {
        state.cachedCoastlines = [];
        state.cachedCoastlinesLow = [];
        state.cachedCoastlinesHigh = [];
      }
      owner.drawHierarchicalBorders(2, { interactive });
      assert.equal(transitions, 0, `${reason}, interactive=${interactive}`);
      assert.equal(context.strokes.some(stroke => stroke.strokeStyle === "#333333"), false);
      if (reason !== "missing") assert.equal(coastalAccentCalls.length, 0);
      assert.ok(context.strokes.some(stroke => stroke.strokeStyle === "#222222"));
    }
  }
});

test("prepared border paths exactly match D3 geometry, style, order and combined coastal strokes", async (t) => {
  installBoundaryPath(t);
  for (const interactive of [false, true]) {
    for (const k of [1, 1.4, 2, 3.19, 3.2, 5]) {
      const baseline = createPreparedBorderHarness();
      baseline.owner.drawHierarchicalBorders(k, { interactive });
      const h = createPreparedBorderHarness();
      const revision = h.owner.getHierarchicalBordersPreparationState(k, { interactive }).revision;
      assert.equal(h.owner.getHierarchicalBordersPreparationState(k, { interactive }).revision, revision);
      let clock = 0, yields = 0;
      const prepared = await h.owner.prepareHierarchicalBorders(k, { interactive, nowMs: () => ++clock, sliceBudgetMs: 1,
        yieldControl: async () => {
          yields++;
          assert.equal(h.context.strokes.length, 0, "preparation never paints or calls drawing helpers");
          assert.equal(h.counts.river + h.counts.accent + h.counts.reconcile, 0);
          // Another path user between slices must not disturb this line stream.
          d3.geoPath(h.projection).context(new RecordingBoundaryPath())(h.paint);
        },
      });
      assert.equal(prepared, true);
      assert.ok(yields > 1);
      const status = h.owner.getHierarchicalBordersPreparationState(k, { interactive });
      assert.equal(status.ready, true);
      assert.equal(status.pending, false);
      assert.ok(status.estimatedPathBytes > 0 && status.estimatedPathBytes <= status.maxPreparedBytes);
      const before = { ...h.counts };
      h.owner.drawHierarchicalBorders(k, { interactive });
      assert.deepEqual(h.context.strokes, baseline.context.strokes, `k=${k}, interactive=${interactive}`);
      assert.equal(h.counts.pathCanvas, before.pathCanvas, "prepared draw performs no geoPath construction");
      assert.equal(h.counts.direct, before.direct, "prepared draw does not simplify/project vertices");
      assert.equal(h.counts.stream, before.stream, "prepared draw does not build projection streams");
      assert.equal(h.counts.river, 1);
      assert.equal(h.counts.accent, interactive ? 0 : 1);
    }
  }
});

test("packed paint arcs stream exact coordinates without materializing a GeoJSON copy", async t => {
  installBoundaryPath(t);
  const long = Array.from({ length: 4096 }, (_, i) => [-60 + i / 50, 10 + Math.sin(i / 15)]);
  const lines = [[[140, 10], [-160, 30], [-80, 20]], long];
  const graph = { featureIds: ["A", "B"], coordinates: Float64Array.from(lines.flat(2)),
    offsets: Uint32Array.of(0, 3, 3 + long.length), owners: Uint32Array.of(0, 1, 0, 1) };
  const colors = { A: "#112233", B: "#445566" };
  const view = createPaintContourMesh(graph, id => colors[id]);
  const packed = view.getMesh();
  const data = getPackedPaintContourMesh(packed);
  assert.equal(data.coordinates, graph.coordinates);
  assert.deepEqual([...data.arcs], [0, 1]);
  Object.defineProperty(packed, "coordinates", { get() { throw Error("must not expand packed contour coordinates"); } });
  for (const interactive of [false, true]) {
    const baseline = createPreparedBorderHarness({ paintMesh: { type: "MultiLineString", coordinates: lines } });
    baseline.owner.drawHierarchicalBorders(2, { interactive });
    const h = createPreparedBorderHarness({ paintMesh: packed });
    h.owner.drawHierarchicalBorders(2, { interactive });
    assert.deepEqual(h.context.strokes, baseline.context.strokes, "direct draw preserves D3 clipping/resampling and stroke order");
    h.context.strokes.length = 0;
    let clock = 0, yields = 0;
    assert.equal(await h.owner.prepareHierarchicalBorders(2, { interactive,
      nowMs: () => ++clock, sliceBudgetMs: 1, yieldControl: async () => { yields++; } }), true);
    assert.ok(yields > 16, "long packed arcs remain interruptible at vertex slices");
    const streams = h.counts.stream;
    h.owner.drawHierarchicalBorders(2, { interactive });
    assert.deepEqual(h.context.strokes, baseline.context.strokes);
    assert.equal(h.counts.stream, streams, "accepted paths repaint without projection");
  }
  colors.B = colors.A; view.refresh(["B"]);
  assert.equal(view.getActiveArcCount(), 0);
  assert.deepEqual([...data.arcs], [0, 1], "a retained mesh keeps its immutable active range snapshot");
  colors.B = "#ffffff"; view.refresh(["B"]);
  assert.deepEqual(view.getMesh().coordinates, lines, "ordinary GeoJSON remains available for external consumers");
});

test("one long line is prepared across vertex slices and concurrent callers share a job", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness({ long: true });
  let clock = 0, previousDirect = 0, previousStream = 0, slices = 0;
  const options = { nowMs: () => ++clock, sliceBudgetMs: 1, yieldControl: async () => {
    slices++;
    assert.ok(h.counts.direct - previousDirect <= 256, "projection of a long source line is bounded per slice");
    assert.ok(h.counts.streamPoints - previousStream <= 256, "path streaming also yields within a long line");
    previousDirect = h.counts.direct; previousStream = h.counts.streamPoints;
  } };
  const pending = h.owner.prepareHierarchicalBorders(5, options);
  assert.equal(h.owner.prepareHierarchicalBorders(5, options), pending);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).pending, true);
  assert.equal(await pending, true);
  assert.ok(slices > 30);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).pending, false);
});

for (const change of ["projection", "mesh", "mesh coordinates", "visible", "style", "scene epoch", "zoom", "abort", "cancel"]) {
  test(`border preparation discards a private candidate after ${change}`, async (t) => {
    installBoundaryPath(t);
    const h = createPreparedBorderHarness({ long: true });
    const controller = new AbortController();
    let slices = 0, clock = 0;
    const pending = h.owner.prepareHierarchicalBorders(5, { signal: controller.signal, nowMs: () => ++clock, sliceBudgetMs: 1,
      yieldControl: async () => {
        if (++slices !== 3) return;
        assert.ok(h.counts.direct + h.counts.streamPoints > 0, "invalidate after real private geometry work");
        if (change === "projection") h.changeProjection();
        else if (change === "mesh") h.state.cachedLocalBordersByCountry.set("AA", [{ ...h.local }]);
        else if (change === "mesh coordinates") h.local.coordinates = [...h.local.coordinates];
        else if (change === "visible") h.setVisible(["BB"]);
        else if (change === "style") h.state.styleConfig.internalBorders.width++;
        else if (change === "scene epoch") h.state.renderTransactionDiagnostics.scenarioApplyEpoch++;
        else if (change === "zoom") h.state.zoomTransform = { k: 6 };
        else if (change === "abort") controller.abort();
        else h.owner.cancelHierarchicalBordersPreparation();
      },
    });
    assert.equal(await pending, false);
    assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false);
    assert.equal(h.owner.getHierarchicalBordersPreparationState(5).pending, false);
    assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, 0);
    assert.equal(h.context.strokes.length, 0);
  });
}

test("native path estimates include combined coast copies and budget failures preserve the accepted cache", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness({ constants: { borderPreparationMaxBytes: 1 } });
  const revision = h.owner.getHierarchicalBordersPreparationState(5).revision;
  await assert.rejects(h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} }), RangeError);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).revision, revision);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).pending, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, 0);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false);
  h.owner.drawHierarchicalBorders(5);
  assert.ok(h.counts.pathCanvas > 0, "an unsupported/failed preparation retains the synchronous rendering route");

  const good = createPreparedBorderHarness();
  await good.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  const accepted = good.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes;
  assert.equal(accepted, good.nativePaths.reduce((sum, path) => sum + 256 + path.commands.length * 32, 0),
    "all native path commands, including the combined coastline copy, are charged");
  const combined = good.nativePaths.at(-1);
  const beforeCombined = accepted - 256 - combined.commands.length * 32;
  const limited = createPreparedBorderHarness({ constants: { borderPreparationMaxBytes: beforeCombined + 255 } });
  await assert.rejects(limited.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} }), RangeError);
  assert.equal(limited.nativePaths.length, good.nativePaths.length - 1, "the combined path's base allocation is budgeted before construction");
  const controller = new AbortController();
  good.state.styleConfig.internalBorders.width++;
  assert.equal(await good.owner.prepareHierarchicalBorders(5, { signal: controller.signal,
    yieldControl: async () => { controller.abort(); } }), false);
  assert.equal(good.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, accepted);
});

test("missing Path2D support returns an explicit synchronous fallback state", async () => {
  const h = createPreparedBorderHarness();
  const status = h.owner.getHierarchicalBordersPreparationState(5);
  assert.equal(status.supported, false);
  assert.equal(status.pending, false);
  assert.equal(await h.owner.prepareHierarchicalBorders(5), false);
  h.owner.drawHierarchicalBorders(5);
  assert.ok(h.context.strokes.length > 0);
});

test("explicit border cleanup releases accepted paths and transformed geometry before rebuilding", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness();
  const options = { yieldControl: async () => {} };
  assert.equal(await h.owner.prepareHierarchicalBorders(5, options), true);
  const accepted = h.owner.getHierarchicalBordersPreparationState(5);
  const transform = h.owner.getBoundaryMeshTransform("internal-local", 5);
  const oldGeometry = transform(h.local);
  const oldPaths = new Set(h.nativePaths);
  h.owner.clearHierarchicalBordersPreparation();
  const cleared = h.owner.getHierarchicalBordersPreparationState(5);
  assert.equal(cleared.ready, false);
  assert.equal(cleared.pending, false);
  assert.equal(cleared.estimatedPathBytes, 0);
  assert.ok(cleared.revision > accepted.revision);
  assert.notEqual(transform(h.local), oldGeometry, "the old transformed geometry is no longer retained through its source cache");
  assert.equal(await h.owner.prepareHierarchicalBorders(5, options), true);
  const rebuilt = h.nativePaths.slice(oldPaths.size);
  assert.equal(rebuilt.length, oldPaths.size, "every projected path, including the combined coast, must be constructed again");
  assert.ok(rebuilt.every(path => !oldPaths.has(path)));
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, accepted.estimatedPathBytes);
});

test("clearing a suspended border candidate detaches its input keys and prevents late publication", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness();
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const pending = h.owner.prepareHierarchicalBorders(3, { yieldControl: () => held });
  await new Promise(setImmediate);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(3).pending, true);
  h.owner.clearHierarchicalBordersPreparation();
  assert.equal(h.owner.getHierarchicalBordersPreparationState(3).pending, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, 0);
  release();
  assert.equal(await pending, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(3).ready, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false);
});

test("ordinary candidate cancellation preserves the accepted border working set", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness();
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  const accepted = h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const pending = h.owner.prepareHierarchicalBorders(3, { yieldControl: () => held });
  await new Promise(setImmediate);
  h.owner.cancelHierarchicalBordersPreparation();
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, true);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, accepted);
  release();
  assert.equal(await pending, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, true);
});

test("repeated inactive cleanup preserves native-vector geometry reuse and does not advance revisions", async (t) => {
  installBoundaryPath(t);
  const h = createPreparedBorderHarness();
  const transform = h.owner.getBoundaryMeshTransform("internal-local", 5);
  const initial = transform(h.local);
  const projections = h.counts.direct;
  h.owner.clearHierarchicalBordersPreparation();
  h.owner.clearHierarchicalBordersPreparation();
  assert.equal(transform(h.local), initial, "a vector-only owner has no prepared working set to invalidate");
  assert.equal(h.counts.direct, projections);

  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  const before = h.owner.getHierarchicalBordersPreparationState(5).revision;
  h.owner.clearHierarchicalBordersPreparation();
  const nativeVector = transform(h.local);
  h.owner.clearHierarchicalBordersPreparation();
  h.owner.clearHierarchicalBordersPreparation();
  assert.equal(transform(h.local), nativeVector, "later vector frames retain their newly populated geometry cache");
  const after = h.owner.getHierarchicalBordersPreparationState(5);
  assert.equal(after.revision, before + 2, "one clear plus re-observing inputs; inactive clears do not increment");
  assert.equal(after.ready, false);
});

function createViewportBorderHarness() {
  let sharedCoast = false;
  const state = { zoomTransform: { x: 0, y: 0, k: 5 }, styleConfig: { coastlines: { opacity: 0 } } };
  const mesh = { type: "MultiLineString", coordinates: [
    [[-30, -30], [-20, -20]],
    [[-20, 5], [5, 5], [20, 5], [30, 5], [5, 6], [-20, 6]],
    [[-10, 0], [0, 0], [0, 10]], [[3, 3]], [[-20, -20]], [[4, 4], [4, 4]],
  ] };
  let viewport = { key: "screen", bounds: [0, 0, 10, 10], maxStrokeWidth: 10, maxMiterLimit: 4 };
  let streams = 0, fallback = 0;
  const paths = [];
  const context = { getLineDash: () => [], stroke: path => paths.push(path), beginPath() {} };
  const projection = point => point;
  projection.stream = sink => { streams++; return sink; };
  const owner = createBorderDrawOwner({ state, getters: {
    getContext: () => context, getProjection: () => projection,
    getBoundaryPathViewport: () => viewport, getPathCanvas: () => () => { fallback++; },
  }, helpers: { getPaintContourMeshes: () => [mesh], getCoastlineCollectionForZoom: () => sharedCoast ? [mesh] : [],
    isUsableMesh: value => !!value?.coordinates?.length } });
  return { owner, state, mesh, paths, context,
    enableSharedCoast() { sharedCoast = true; state.styleConfig.coastlines.opacity = 0.8; }, get streams() { return streams; }, get fallback() { return fallback; },
    get viewport() { return viewport; }, set viewport(value) { viewport = value; } };
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
  const status = h.owner.getHierarchicalBordersPreparationState(5);
  assert.equal(status.projectedInputPoints, 15);
  assert.equal(status.submittedPathPoints, 12);
});

for (const change of ["camera x", "camera y", "bounds", "layout", "disabled", "source"]) {
  test(`viewport paths cannot be drawn or reused after ${change}`, async t => {
    installBoundaryPath(t);
    const h = createViewportBorderHarness();
    await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
    h.owner.drawMeshCollection([h.mesh], "black", 1);
    const oldPath = h.paths[0], streams = h.streams;
    if (change === "camera x") h.state.zoomTransform.x++;
    else if (change === "camera y") h.state.zoomTransform.y++;
    else if (change === "bounds") h.viewport.bounds[2]++;
    else if (change === "layout") h.viewport.key = "resized";
    else if (change === "disabled") h.viewport = null;
    else h.mesh.coordinates = [...h.mesh.coordinates];
    assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false);
    h.owner.drawMeshCollection([h.mesh], "black", 1);
    assert.equal(h.fallback, 1);
    assert.equal(await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} }), true);
    h.owner.drawMeshCollection([h.mesh], "black", 1);
    assert.ok(h.streams > streams);
    assert.notEqual(h.paths.at(-1), oldPath);
  });
}

test("viewport changes during yielded preparation discard the private candidate", async t => {
  installBoundaryPath(t);
  const h = createViewportBorderHarness();
  let yields = 0, clock = 0;
  assert.equal(await h.owner.prepareHierarchicalBorders(5, { sliceBudgetMs: 1, nowMs: () => ++clock,
    yieldControl: async () => { if (++yields === 2) h.viewport.key = "new layout"; } }), false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false);
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).estimatedPathBytes, 0);
});

test("unknown viewport guards and unsupported drawing effects retain the original route", async t => {
  installBoundaryPath(t);
  for (const invalid of [null, { key: "bad", bounds: [0, 0, Infinity, 10] },
    { key: "bad", bounds: [0, 0, 10, 10], maxStrokeWidth: -1, maxMiterLimit: 4 }]) {
    const h = createViewportBorderHarness(); h.viewport = invalid;
    await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
    h.owner.drawMeshCollection([h.mesh], "black", 1);
    assert.equal(h.paths[0].commands.length, 15, "invalid guard does not prune native geometry");
  }
  for (const effect of ["dash", "filter", "shadow", "width", "miter"]) {
    const h = createViewportBorderHarness();
    await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
    if (effect === "dash") h.context.getLineDash = () => [2, 3];
    if (effect === "filter") h.context.filter = "blur(2px)";
    if (effect === "shadow") h.context.shadowBlur = 2;
    h.owner.drawMeshCollection([h.mesh], "black", effect === "width" ? 11 : 1,
      effect === "miter" ? { miterLimit: 5 } : {});
    assert.equal(h.fallback, 1, effect);
  }
});


test("enabling viewport pruning retains the complete native Path2D until replacement is prepared", async t => {
  installBoundaryPath(t);
  const h = createViewportBorderHarness();
  const viewport = h.viewport;
  h.viewport = null;
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  h.owner.drawMeshCollection([h.mesh], "black", 1);
  const fullPath = h.paths.at(-1);
  assert.equal(fullPath.commands.length, 15);
  h.viewport = viewport;
  assert.equal(h.owner.getHierarchicalBordersPreparationState(5).ready, false,
    "a pruned replacement is still requested for the newly enabled viewport");
  h.owner.drawMeshCollection([h.mesh], "black", 1);
  assert.equal(h.paths.at(-1), fullPath, "complete geometry remains safe across viewport changes");
  assert.equal(h.fallback, 0, "do not switch to immediate Canvas path construction");
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  h.owner.drawMeshCollection([h.mesh], "black", 1);
  assert.notEqual(h.paths.at(-1), fullPath);
  assert.equal(h.paths.at(-1).commands.length, 12);
  assert.equal(h.fallback, 0);
});


test("a coast mesh shared with paint keeps its complete native path even after a pruned cache exists", async t => {
  installBoundaryPath(t);
  const h = createViewportBorderHarness();
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  h.owner.drawMeshCollection([h.mesh], "black", 1);
  const prunedPath = h.paths.at(-1);
  assert.equal(prunedPath.commands.length, 12);
  h.enableSharedCoast();
  await h.owner.prepareHierarchicalBorders(5, { yieldControl: async () => {} });
  h.paths.length = 0;
  h.owner.drawHierarchicalBorders(5);
  assert.equal(h.paths.length, 2, "paint and coast retain their original separate strokes");
  assert.notEqual(h.paths[0], prunedPath, "the previously pruned alias cannot serve the coast");
  for (const path of h.paths) assert.deepEqual(path.commands, h.mesh.coordinates.flatMap(line =>
    line.map(([x, y], index) => [index ? "lineTo" : "moveTo", x, y])));
  assert.equal(h.fallback, 0);
  h.state.zoomTransform.x++;
  h.paths.length = 0;
  h.owner.drawHierarchicalBorders(5);
  assert.equal(h.paths.length, 2);
  assert.equal(h.fallback, 0, "complete shared paths remain safe after camera changes");
  for (const path of h.paths) assert.equal(path.commands.length, 15);
});

test("packed worker lines retain native LOD and interruptible preparation without expanding the source", async t => {
  installBoundaryPath(t);
  const baseline = createPreparedBorderHarness({ long: true });
  const h = createPreparedBorderHarness({ long: true });
  const lines = h.local.coordinates;
  const offsets = Uint32Array.from([0, ...lines.map((line, i) => lines.slice(0, i + 1).reduce((n, value) => n + value.length, 0))]);
  const packed = createPackedLineMesh({ coordinates: Float64Array.from(lines.flat(2)), offsets, arcs: Uint32Array.from([0, 1]) });
  Object.defineProperty(packed, "coordinates", { get() { throw Error("worker mesh must remain packed"); } });
  h.state.cachedLocalBordersByCountry.set("AA", [packed]);
  baseline.owner.drawHierarchicalBorders(2.5);
  let yields = 0, clock = 0;
  assert.equal(await h.owner.prepareHierarchicalBorders(2.5, { yieldControl: async () => { yields++; },
    nowMs: () => ++clock, sliceBudgetMs: 1 }), true);
  h.owner.drawHierarchicalBorders(2.5);
  assert.deepEqual(h.context.strokes, baseline.context.strokes);
  assert.ok(yields > 10, "packed long line conversion and LOD remain cooperative");
});
