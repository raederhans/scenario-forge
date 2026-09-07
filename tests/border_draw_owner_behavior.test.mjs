import assert from "node:assert/strict";
import test from "node:test";

import { createBorderDrawOwner } from "../js/core/renderer/border_draw_owner.js";

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
      isDynamicBordersEnabled: () => false,
      isUsableMesh: (candidate) => !!candidate?.coordinates?.length,
      sanitizePolyline: (line) => (Array.isArray(line) ? line : []),
      ...helpers,
    },
  });
  return { owner, context, coastalAccentCalls, state };
}

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
