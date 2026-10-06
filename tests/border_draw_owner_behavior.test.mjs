import assert from "node:assert/strict";
import test from "node:test";

import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";
import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { sanitizePolyline } from "../js/core/renderer/polyline_simplification_helpers.js";

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

function createOwner({ hgoVectorScene = false, interactive = false, helpers = {} } = {}) {
  const context = createContextRecorder();
  const coastalAccentCalls = [];
  const state = {
    activeScenarioId: "",
    activeScenarioManifest: hgoVectorScene
      ? {
        scenario_contract_profile: "hgo_vector",
        performance_hints: {
          hgo_vector_scene_default: true,
        },
      }
      : null,
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

test("HGO vector scenes suppress canonical coastlines in both passes", () => {
  for (const interactive of [false, true]) {
    const { owner, context, coastalAccentCalls } = createOwner({ hgoVectorScene: true, interactive });
    owner.drawHierarchicalBorders(2, { interactive });
    assert.ok(context.strokes.find(stroke => stroke.strokeStyle === "#222222"));
    assert.equal(context.strokes.find(stroke => stroke.strokeStyle === "#333333"), undefined);
    if (!interactive) assert.equal(coastalAccentCalls.length, 0);
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

test("zero-opacity, missing, and HGO coastlines never request a transition", () => {
  for (const reason of ["zero-opacity", "missing", "hgo"]) {
    for (const interactive of [false, true]) {
      let transitions = 0;
      const { owner, context, state, coastalAccentCalls } = createOwner({
        interactive, hgoVectorScene: reason === "hgo", helpers: {
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
