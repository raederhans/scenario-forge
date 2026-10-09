import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { parse } from "acorn";

import { createViewportReadModelOwner } from "../js/core/renderer/viewport_read_model_owner.js";

function createFeature(id) {
  return { id, properties: { id } };
}

function createZoomIdentity() {
  return {
    x: 0,
    y: 0,
    k: 1,
    translate(x, y) {
      return { x, y, k: 1 };
    },
  };
}

function extractMapRendererFunction(functionName) {
  const source = fs.readFileSync(
    new URL("../js/core/map_renderer.js", import.meta.url),
    "utf8",
  );
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const declaration = ast.body.find((node) => (
    node.type === "FunctionDeclaration" && node.id?.name === functionName
  ));
  assert.ok(declaration, `map_renderer must define ${functionName}`);
  return source.slice(declaration.start, declaration.end);
}

function createCompositionHarness() {
  const featureA = createFeature("A");
  const featureB = createFeature("B");
  const skippedFeature = createFeature("SKIP");
  const runtimeState = {
    width: 800,
    height: 600,
    dpr: 1,
    zoomTransform: { x: 10, y: 20, k: 2 },
    landData: { features: [featureA, featureB, skippedFeature] },
  };
  const projectedBoundsById = new Map([
    ["A", { minX: 10, minY: 20, maxX: 30, maxY: 40 }],
    ["B", { minX: -5, minY: 50, maxX: 80, maxY: 120 }],
    ["SKIP", { minX: -500, minY: -500, maxX: 500, maxY: 500 }],
  ]);
  const calls = { projected: [], skipped: [], renderable: 0, translated: [] };
  const projection = {
    scale: () => 123.4567,
    translate: () => [10.3333, -20.6666],
    invert: ([x, y]) => [x - 100, y - 200],
  };
  const zoomIdentity = {
    x: 0,
    y: 0,
    k: 1,
    translate(x, y) {
      calls.translated.push({ x, y });
      return { x, y, k: 1 };
    },
  };
  let capturedOptions = null;
  const context = {
    MAP_PAN_PADDING_PX: 50,
    runtimeState,
    rendererSurfaceHost: {
      getPathSvg: () => ({}),
      getProjection: () => projection,
    },
    getFeatureId: (feature) => feature.id,
    getProjectedFeatureBounds: (feature, options) => {
      calls.projected.push({ id: feature.id, options });
      return projectedBoundsById.get(feature.id) || null;
    },
    getLogicalCanvasDimensions: () => [800, 600],
    shouldSkipFeature: (feature, width, height, options) => {
      calls.skipped.push({ id: feature.id, width, height, options });
      return feature.id === "SKIP";
    },
    getRenderableLandFeatures: () => {
      calls.renderable += 1;
      return [featureB];
    },


    createViewportReadModelOwner: (options) => {
      capturedOptions = options;
      return createViewportReadModelOwner(options);
    },
    globalThis: { d3: { zoomIdentity } },
  };
  const source = [
    "let viewportReadModelOwner = null;",
    extractMapRendererFunction("getViewportReadModelOwner"),
    "globalThis.getViewportReadModelOwner = getViewportReadModelOwner;",
  ].join("\n");
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    calls,
    context,
    featureA,
    featureB,
    getCapturedOptions: () => capturedOptions,
    getOwner: () => context.globalThis.getViewportReadModelOwner(),
  };
}

function createHarness({
  modelState: modelStateOverrides = {},
  projection = null,
  pathSvg = null,
  zoomIdentity = createZoomIdentity(),
  landFeatures = [],
  contentBounds = null,
  logicalCanvasDimensions = [800, 600],
  projectedBoundsById = {},
  renderableLandFeatures = null,
  skipFeatureIds = new Set(),
} = {}) {
  const modelState = {
    width: 800,
    height: 600,
    dpr: 1,
    zoomTransform: null,
    ...modelStateOverrides,
  };
  const calls = {
    projectedBounds: [],
    skipped: [],
    renderable: 0,
    zoomTransforms: [],
  };
  const getBoundsSnapshot = (feature) => {
    const bounds = projectedBoundsById[feature?.id];
    if (!bounds) return null;
    return {
      minX: Number(bounds.minX),
      minY: Number(bounds.minY),
      maxX: Number(bounds.maxX),
      maxY: Number(bounds.maxY),
    };
  };
  const getPanContentBoundsSnapshots = () => {
    if (contentBounds) return [{ ...contentBounds }];
    if (!pathSvg) return [];
    return landFeatures
      .filter((feature) => {
        calls.skipped.push({
          id: feature?.id,
          canvasWidth: logicalCanvasDimensions[0],
          canvasHeight: logicalCanvasDimensions[1],
          options: { forceProd: true },
        });
        return !skipFeatureIds.has(feature?.id);
      })
      .map((feature) => {
        calls.projectedBounds.push({ id: feature?.id, options: { allowCompute: false } });
        return getBoundsSnapshot(feature);
      })
      .filter(Boolean);
  };
  const getProjectedRenderableContentBoundsSnapshots = () => {
    if (contentBounds) return [{ ...contentBounds }];
    if (modelState.width <= 0 || modelState.height <= 0 || !landFeatures.length) return [];
    const renderable = renderableLandFeatures
      ? renderableLandFeatures(logicalCanvasDimensions[0], logicalCanvasDimensions[1], { forceProd: true })
      : [];
    if (renderableLandFeatures) calls.renderable += 1;
    const features = Array.isArray(renderable) && renderable.length ? renderable : landFeatures;
    return features.map((feature) => {
      calls.projectedBounds.push({ id: feature?.id, options: { allowCompute: false } });
      return getBoundsSnapshot(feature);
    }).filter(Boolean);
  };
  const owner = createViewportReadModelOwner({
    getters: {
      getViewportDimensions: () => ({ width: modelState.width, height: modelState.height }),
      getViewportDpr: () => modelState.dpr,
    },
    capabilities: {
      getProjectionSnapshot: () => {
        if (!projection || typeof projection.scale !== "function" || typeof projection.translate !== "function") {
          return null;
        }
        const translate = projection.translate() || [0, 0];
        return { scale: projection.scale(), translate: [translate[0], translate[1]] };
      },
      invertProjectionPoint: (point) => (
        typeof projection?.invert === "function" ? projection.invert(point) : null
      ),
      getZoomTransformSnapshot: () => {
        const transform = modelState.zoomTransform || zoomIdentity;
        return transform ? { x: transform.x, y: transform.y, k: transform.k } : null;
      },
      createZoomTransform: ({ x, y, translate }) => {
        calls.zoomTransforms.push({ x, y, translate });
        if (!zoomIdentity) return null;
        if (!translate) return zoomIdentity;
        return typeof zoomIdentity.translate === "function"
          ? zoomIdentity.translate(x, y)
          : { x, y, k: zoomIdentity.k || 1 };
      },
      getPanContentBoundsSnapshots,
      getProjectedRenderableContentBoundsSnapshots,
    },
  });
  return { calls, modelState, owner };
}

test("getViewportRenderSignature rounds dimensions and dpr", () => {
  const { owner } = createHarness({
    modelState: { width: 799.6, height: 600.4, dpr: 1.234 },
  });

  assert.equal(owner.getViewportRenderSignature(), "800|600|1.23");
});

test("getProjectionRenderSignature handles missing projection and rounded projection values", () => {
  assert.equal(createHarness().owner.getProjectionRenderSignature(), "projection:na");

  const projection = {
    scale: () => 123.4567,
    translate: () => [10.3333, -20.6666],
  };
  assert.equal(createHarness({ projection }).owner.getProjectionRenderSignature(), "123.457|10.333|-20.667");
});

test("getViewportGeoBounds falls back to world bounds without usable inversion", () => {
  assert.deepEqual(createHarness().owner.getViewportGeoBounds(), [-180, -90, 180, 90]);
  assert.deepEqual(
    createHarness({ projection: { invert: () => [NaN, Infinity] } }).owner.getViewportGeoBounds(),
    [-180, -90, 180, 90],
  );
});

test("getViewportGeoBounds clips inverted lon lat samples", () => {
  const projection = {
    invert: ([x, y]) => [x - 500, y - 300],
  };

  assert.deepEqual(createHarness({ projection }).owner.getViewportGeoBounds(), [-180, -90, 180, 90]);
});

test("getViewportGeoBounds trims one outlier when nine samples are valid", () => {
  const outputs = [
    [-170, -80],
    [-50, -30],
    [-20, -10],
    [-40, -20],
    [0, 0],
    [40, 20],
    [20, 10],
    [50, 30],
    [170, 80],
  ];
  let index = 0;
  const projection = {
    invert: () => outputs[index++],
  };

  assert.deepEqual(createHarness({ projection }).owner.getViewportGeoBounds(), [-50, -30, 50, 30]);
});

test("calculatePanExtent returns padded fallback when path or land is unavailable", () => {
  assert.deepEqual(createHarness().owner.calculatePanExtent(), [[-50, -50], [850, 650]]);
  assert.deepEqual(
    createHarness({ pathSvg: {}, landFeatures: [] }).owner.calculatePanExtent(),
    [[-50, -50], [850, 650]],
  );
});

test("calculatePanExtent uses supplied content bounds", () => {
  const contentBounds = { minX: 10, minY: 20, maxX: 110, maxY: 220, width: 100, height: 200 };

  assert.deepEqual(createHarness({ contentBounds }).owner.calculatePanExtent(), [[-40, -30], [160, 270]]);
});

test("calculatePanExtent uses projected feature bounds and skip decisions for land features", () => {
  const landFeatures = [createFeature("A"), createFeature("B"), createFeature("SKIP")];
  const { calls, owner } = createHarness({
    pathSvg: {},
    landFeatures,
    skipFeatureIds: new Set(["SKIP"]),
    projectedBoundsById: {
      A: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      B: { minX: -5, minY: 50, maxX: 80, maxY: 120 },
      SKIP: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
    },
  });

  assert.deepEqual(owner.calculatePanExtent(), [[-55, -30], [130, 170]]);
  assert.deepEqual(calls.skipped.map((entry) => entry.id), ["A", "B", "SKIP"]);
});

test("getProjectedRenderableContentBounds returns supplied bounds and null for missing inputs", () => {
  const contentBounds = { minX: 1, minY: 2, maxX: 3, maxY: 4, width: 2, height: 2 };

  assert.deepEqual(
    createHarness({ contentBounds }).owner.getProjectedRenderableContentBounds(),
    contentBounds,
  );
  assert.equal(createHarness({ landFeatures: [] }).owner.getProjectedRenderableContentBounds(), null);
  assert.equal(
    createHarness({ modelState: { width: 0 }, landFeatures: [createFeature("A")] })
      .owner.getProjectedRenderableContentBounds(),
    null,
  );
});

test("getProjectedRenderableContentBounds uses renderable helper and falls back to all land", () => {
  const featureA = createFeature("A");
  const featureB = createFeature("B");
  const projectedBoundsById = {
    A: { minX: 0, minY: 0, maxX: 40, maxY: 50 },
    B: { minX: 100, minY: 120, maxX: 180, maxY: 220 },
  };

  assert.deepEqual(
    createHarness({
      landFeatures: [featureA, featureB],
      projectedBoundsById,
      renderableLandFeatures: () => [featureB],
    }).owner.getProjectedRenderableContentBounds(),
    { minX: 100, minY: 120, maxX: 180, maxY: 220, width: 80, height: 100 },
  );
  assert.deepEqual(
    createHarness({
      landFeatures: [featureA, featureB],
      projectedBoundsById,
      renderableLandFeatures: () => [],
    }).owner.getProjectedRenderableContentBounds(),
    { minX: 0, minY: 0, maxX: 180, maxY: 220, width: 180, height: 220 },
  );
});

test("getCenteredFitZoomTransform handles missing identity missing bounds and horizontal centering", () => {
  assert.equal(createHarness({ zoomIdentity: null }).owner.getCenteredFitZoomTransform(), null);

  const identity = createZoomIdentity();
  const withoutBounds = createHarness({ zoomIdentity: identity });
  assert.equal(withoutBounds.owner.getCenteredFitZoomTransform(), identity);
  assert.deepEqual(withoutBounds.calls.zoomTransforms, [{ x: 0, y: 0, translate: false }]);

  const feature = createFeature("A");
  const centered = createHarness({
    zoomIdentity: identity,
    landFeatures: [feature],
    projectedBoundsById: {
      A: { minX: 10, minY: 20, maxX: 110, maxY: 120 },
    },
  }).owner.getCenteredFitZoomTransform({ centerX: true, centerY: false });
  assert.deepEqual(centered, { x: 340, y: 0, k: 1 });
});

test("getZoomPercent formats the current zoom scale", () => {
  assert.equal(createHarness().owner.getZoomPercent(), "100%");
  assert.equal(createHarness({ modelState: { zoomTransform: { k: 1.234 } } }).owner.getZoomPercent(), "123%");
});

test("projection signature reads fresh snapshots and preserves numeric coercion", () => {
  let snapshot = null;
  let reads = 0;
  const owner = createViewportReadModelOwner({
    capabilities: {
      getProjectionSnapshot: () => {
        reads += 1;
        return snapshot;
      },
    },
  });
  assert.equal(createViewportReadModelOwner().getProjectionRenderSignature(), "projection:na");
  assert.equal(owner.getProjectionRenderSignature(), "projection:na");
  snapshot = { scale: "123.4567", translate: ["10.3333", -20.6666] };
  assert.equal(owner.getProjectionRenderSignature(), "123.457|10.333|-20.667");
  snapshot.scale = 200.0001;
  snapshot.translate[0] = 1.9999;
  assert.equal(owner.getProjectionRenderSignature(), "200|2|-20.667");
  snapshot = { scale: NaN, translate: [null, false] };
  assert.equal(owner.getProjectionRenderSignature(), "0|0|0");
  snapshot = { scale: "invalid", translate: null };
  assert.equal(owner.getProjectionRenderSignature(), "NaN|0|0");
  snapshot = null;
  assert.equal(owner.getProjectionRenderSignature(), "projection:na");
  assert.equal(reads, 6);
});

test("map_renderer composes viewport reads through numeric snapshots and live value capabilities", () => {
  const harness = createCompositionHarness();
  const owner = harness.getOwner();
  const options = harness.getCapturedOptions();

  assert.equal(Object.hasOwn(options, "state"), false);
  assert.equal(Object.hasOwn(options, "helpers"), false);
  assert.equal(Object.hasOwn(options.capabilities, "getProjectionRenderSignature"), false);
  const projectionSnapshot = options.capabilities.getProjectionSnapshot();
  assert.equal(projectionSnapshot.scale, 123.4567);
  assert.deepEqual(Array.from(projectionSnapshot.translate), [10.3333, -20.6666]);
  assert.equal(owner.getProjectionRenderSignature(), "123.457|10.333|-20.667");
  assert.equal(owner.getZoomPercent(), "200%");
  assert.deepEqual(owner.calculatePanExtent(), [[-55, -30], [130, 170]]);
  assert.deepEqual(
    owner.getProjectedRenderableContentBounds(),
    { minX: -5, minY: 50, maxX: 80, maxY: 120, width: 85, height: 70 },
  );

  const panSnapshots = options.capabilities.getPanContentBoundsSnapshots();
  const renderableSnapshots = options.capabilities.getProjectedRenderableContentBoundsSnapshots();
  assert.deepEqual(Array.from(panSnapshots, (snapshot) => ({ ...snapshot })), [
    { minX: 10, minY: 20, maxX: 30, maxY: 40 },
    { minX: -5, minY: 50, maxX: 80, maxY: 120 },
  ]);
  assert.deepEqual(
    Array.from(renderableSnapshots, (snapshot) => ({ ...snapshot })),
    [{ minX: -5, minY: 50, maxX: 80, maxY: 120 }],
  );
  assert.ok(panSnapshots.every((snapshot) => snapshot !== harness.featureA && snapshot !== harness.featureB));
  assert.deepEqual(harness.calls.skipped.map(({ id }) => id), ["A", "B", "SKIP", "A", "B", "SKIP"]);
  assert.equal(harness.calls.renderable, 2);

  harness.context.runtimeState.zoomTransform = { x: 30, y: 40, k: 3 };
  harness.context.runtimeState.width = 640;
  assert.equal(owner.getViewportRenderSignature(), "640|600|1");
  assert.equal(owner.getZoomPercent(), "300%");
  harness.context.rendererSurfaceHost.getProjection = () => ({
    scale: () => 42.1234,
    translate: () => [5.4321, 6.5432],
  });
  assert.equal(owner.getProjectionRenderSignature(), "42.123|5.432|6.543");
  harness.context.rendererSurfaceHost.getProjection = () => null;
  assert.equal(owner.getProjectionRenderSignature(), "projection:na");

  harness.context.runtimeState.landData = { features: [] };
  assert.equal(owner.getCenteredFitZoomTransform(), harness.context.globalThis.d3.zoomIdentity);
  assert.deepEqual(harness.calls.translated, []);
});
