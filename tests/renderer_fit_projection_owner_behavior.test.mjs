import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRendererFitProjectionOwner } from "../js/core/renderer/renderer_fit_projection_owner.js";
import { getProjectionGeometryGeneration } from "../js/core/renderer/projection_geometry_identity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

test("successful projection fit invalidates geometry while a skipped fit preserves it", () => {
  const harness = createHarness();
  const before = getProjectionGeometryGeneration(harness.projection);
  assert.equal(harness.owner.fitProjection(), true);
  assert.notEqual(getProjectionGeometryGeneration(harness.projection), before);
  const skipped = createHarness({ features: [] });
  const unchanged = getProjectionGeometryGeneration(skipped.projection);
  assert.equal(skipped.owner.fitProjection(), false);
  assert.equal(getProjectionGeometryGeneration(skipped.projection), unchanged);
});

const BASE_FEATURES = Object.freeze([
  { type: "Feature", id: "A", geometry: { type: "Point", coordinates: [0, 0] } },
  { type: "Feature", id: "B", geometry: { type: "Point", coordinates: [1, 1] } },
]);

const REQUIRED_EFFECTS = Object.freeze([
  "resetCityAnchorCache",
  "rebuildProjectedBoundsCache",
  "buildSpatialIndex",
  "setHitCanvasDirty",
  "updateSpecialZonesPaths",
  "renderSpecialZoneEditorOverlay",
  "updateZoomTranslateExtent",
  "markAllOverlaysDirty",
]);

function createHarness({
  features = BASE_FEATURES,
  renderableFeatures = [],
  width = 1000,
  height = 500,
  includeFitExtent = true,
} = {}) {
  const calls = {
    effects: [],
    fitExtent: [],
    getLogicalCanvasDimensions: 0,
    getRenderableLandFeatures: [],
  };
  const state = {
    height,
    landData: { type: "FeatureCollection", features },
    width,
  };
  const projection = {};
  if (includeFitExtent) {
    projection.fitExtent = (extent, target) => {
      calls.fitExtent.push({ extent, target });
      calls.effects.push("fitExtent");
      return projection;
    };
  }
  const owner = createRendererFitProjectionOwner({
    surfaceHost: {
      getProjection: () => projection,
    },
    state,
    constants: {
      projectionFitPaddingRatio: 0.04,
    },
    getters: {
      getLogicalCanvasDimensions: () => {
        calls.getLogicalCanvasDimensions += 1;
        return [800, 400];
      },
      getRenderableLandFeatures: (canvasWidth, canvasHeight, options) => {
        calls.getRenderableLandFeatures.push({ canvasHeight, canvasWidth, options });
        return renderableFeatures;
      },
    },
    effects: Object.fromEntries(
      REQUIRED_EFFECTS.map((effectName) => [effectName, () => calls.effects.push(effectName)]),
    ),
  });

  return {
    calls,
    owner,
    projection,
    state,
  };
}

function createRequiredDependencyOptions() {
  return {
    surfaceHost: {
      getProjection: () => ({
        fitExtent: () => {},
      }),
    },
    state: {
      height: 500,
      landData: { type: "FeatureCollection", features: BASE_FEATURES },
      width: 1000,
    },
    constants: {
      projectionFitPaddingRatio: 0.04,
    },
    getters: {
      getLogicalCanvasDimensions: () => [800, 400],
      getRenderableLandFeatures: () => [],
    },
    effects: Object.fromEntries(REQUIRED_EFFECTS.map((effectName) => [effectName, () => {}])),
  };
}

test("no land data returns false without effects", () => {
  const harness = createHarness({ features: [] });

  assert.equal(harness.owner.fitProjection(), false);
  assert.deepEqual(harness.calls.fitExtent, []);
  assert.deepEqual(harness.calls.effects, []);
});

test("invalid width or height returns false without effects", () => {
  const zeroWidth = createHarness({ width: 0 });
  const zeroHeight = createHarness({ height: 0 });

  assert.equal(zeroWidth.owner.fitProjection(), false);
  assert.equal(zeroHeight.owner.fitProjection(), false);
  assert.deepEqual(zeroWidth.calls.effects, []);
  assert.deepEqual(zeroHeight.calls.effects, []);
});

test("computes padding and fit extent exactly", () => {
  const harness = createHarness({ width: 1000, height: 500 });

  assert.equal(harness.owner.fitProjection(), true);

  assert.deepEqual(harness.calls.fitExtent, [{
    extent: [[20, 20], [980, 480]],
    target: harness.state.landData,
  }]);
  assert.deepEqual(harness.calls.getRenderableLandFeatures, [{
    canvasHeight: 400,
    canvasWidth: 800,
    options: { forceProd: true },
  }]);
});

test("uses minimum padding of sixteen pixels", () => {
  const harness = createHarness({ width: 100, height: 50 });

  assert.equal(harness.owner.fitProjection(), true);

  assert.deepEqual(harness.calls.fitExtent[0].extent, [[16, 16], [84, 34]]);
});

test("chooses renderable feature collection when non-empty", () => {
  const renderableFeatures = [BASE_FEATURES[1]];
  const harness = createHarness({ renderableFeatures });

  assert.equal(harness.owner.fitProjection(), true);

  assert.deepEqual(harness.calls.fitExtent[0].target, {
    type: "FeatureCollection",
    features: renderableFeatures,
  });
});

test("falls back to state land data when renderable list is empty", () => {
  const harness = createHarness({ renderableFeatures: [] });

  assert.equal(harness.owner.fitProjection(), true);

  assert.equal(harness.calls.fitExtent[0].target, harness.state.landData);
});

test("calls effects in exact order", () => {
  const harness = createHarness();

  assert.equal(harness.owner.fitProjection(), true);

  assert.deepEqual(harness.calls.effects, [
    "fitExtent",
    "resetCityAnchorCache",
    "rebuildProjectedBoundsCache",
    "buildSpatialIndex",
    "setHitCanvasDirty",
    "updateSpecialZonesPaths",
    "renderSpecialZoneEditorOverlay",
    "updateZoomTranslateExtent",
    "markAllOverlaysDirty",
  ]);
});

test("respects skipSpatialIndex", () => {
  const harness = createHarness();

  assert.equal(harness.owner.fitProjection({ skipSpatialIndex: true }), true);

  assert.deepEqual(harness.calls.effects, [
    "fitExtent",
    "resetCityAnchorCache",
    "rebuildProjectedBoundsCache",
    "setHitCanvasDirty",
    "updateSpecialZonesPaths",
    "renderSpecialZoneEditorOverlay",
    "updateZoomTranslateExtent",
    "markAllOverlaysDirty",
  ]);
});

test("fails fast when projection.fitExtent is missing", () => {
  const harness = createHarness({ includeFitExtent: false });

  assert.throws(
    () => harness.owner.fitProjection(),
    /surfaceHost\.getProjection\(\)\.fitExtent/,
  );
});

test("fails fast when required injected dependencies are missing", () => {
  for (const dependencyName of [
    "constants.projectionFitPaddingRatio",
    "getters.getLogicalCanvasDimensions",
    "getters.getRenderableLandFeatures",
    ...REQUIRED_EFFECTS.map((effectName) => `effects.${effectName}`),
  ]) {
    const options = createRequiredDependencyOptions();
    const [ownerName, propertyName] = dependencyName.split(".");
    delete options[ownerName][propertyName];

    assert.throws(
      () => createRendererFitProjectionOwner(options),
      new RegExp(`${ownerName}\\.${propertyName}`),
      `missing ${dependencyName} must fail fast`,
    );
  }
});

test("fails fast when projection fit padding ratio is not finite", () => {
  const options = createRequiredDependencyOptions();
  options.constants.projectionFitPaddingRatio = Number.NaN;

  assert.throws(
    () => createRendererFitProjectionOwner(options),
    /finite constants\.projectionFitPaddingRatio/,
  );
});

test("owner source stays independent from runtime state writes and render semantics", () => {
  const ownerSource = fs.readFileSync(
    path.join(REPO_ROOT, "js", "core", "renderer", "renderer_fit_projection_owner.js"),
    "utf8",
  );
  const stateWriteToken = ["runtimeState.", "hitCanvasDirty"].join("");

  for (const token of [
    "runtimeState",
    stateWriteToken,
    "from \"../state.js\"",
    "from \"./state.js\"",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "applyDevSelectionFill",
    "refreshMapDataForScenarioChunkPromotion",
    "exactAfterSettle",
    "strategicOverlayRuntime",
    "renderFrontlineOverlay",
    "renderSpecialZones",
    "renderHoverOverlay",
    "setMapData",
    "initZoom",
    "bindEvents",
    "requestRender",
    "flushRenderBoundary",
  ]) {
    assert.equal(ownerSource.includes(token), false, `owner source must avoid ${token}`);
  }
});
