import assert from "node:assert/strict";
import test from "node:test";

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

test("boundary and coastline geometry reuse follows projection and simplification, not paint or camera", () => {
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
  assert.equal(owner.getViewportAwareCoastlineCollection([source], 1.2)[0], coast);
  assert.equal(projections, count);
  assert.notEqual(owner.buildRenderableBoundaryMesh(source, { ...options, minLengthPx: 20 }), first);
  assert.notEqual(owner.getViewportAwareCoastlineCollection([source], 2)[0], coast);
  markProjectionGeometryChanged(projection);
  assert.notEqual(owner.buildRenderableBoundaryMesh(source, options), first);
  assert.notEqual(owner.getViewportAwareCoastlineCollection([source], 1)[0], coast);
  const replaced = { ...source, coordinates: [[[0, 0], [200, 0]]] };
  assert.notEqual(owner.buildRenderableBoundaryMesh(replaced, options), first);
});

const mesh = { type: "MultiLineString", coordinates: [[[0, 0], [100, 100]]] };

function nearlyEqual(actual, expected, epsilon = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

function createContextRecorder() {
  return {
    globalAlpha: 1,
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    miterLimit: 0,
    strokes: [],
    beginPath() {},
    stroke() {
      this.strokes.push({
        alpha: this.globalAlpha,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
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
      getPathCanvas: () => () => {},
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
