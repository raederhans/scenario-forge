import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EXPORT_RENDER_BUDGET_BYTES, estimateExportRenderBytes } from "../js/core/renderer/export_render_budget.js";
import { getRiverPaintRuntime } from "../js/core/river_paint/runtime.js";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const start = source.indexOf("let exportRenderInProgress = false;");
const end = source.indexOf("\nfunction composeTransformedFrameToBuffer(", start);
assert.ok(start >= 0 && end > start);
const exportSource = source.slice(start, end);

function harness({ failPass = false, failComposition = false, screenDpr = 1, budgetExceeded = false, contourStatus = "ready", politicalStatus = "ready", hgo = false } = {}) {
  const visibleCache = { canvases: { background: { width: 100, height: 50 } } };
  const runtimeState = {
    width: 100,
    height: 50,
    dpr: screenDpr,
    colorCanvas: { width: 100 * screenDpr, height: 50 * screenDpr },
    renderPassCache: visibleCache,
    zoomTransform: { k: 1, x: 0, y: 0 },
  };
  const calls = [];
  let allocatedCanvases = 0;
  const context = vm.createContext({
    runtimeState,
    getRiverPaintRuntime,
    EXPORT_RENDER_BUDGET_BYTES,
    estimateExportRenderBytes: (input) => budgetExceeded
      ? EXPORT_RENDER_BUDGET_BYTES + 1
      : estimateExportRenderBytes(input),
    document: {
      createElement: () => {
        allocatedCanvases += 1;
        return {
          width: 0,
          height: 0,
          getContext() { return { canvas: this, setTransform() {}, clearRect() {} }; },
        };
      },
    },
    isHgoRuntimePreviewReady: () => hgo,
    getPaintContourRuntimeOwner: () => ({
      diagnostics() { calls.push(`contours-${contourStatus}`); return { status: contourStatus }; },
    }),
    getPoliticalBorderRuntimeOwner: () => ({
      diagnostics() { calls.push(`political-${politicalStatus}`); return { status: politicalStatus }; },
    }),
    getRenderPipelinePassesOwner: () => ({
      ensureIdleRenderPasses: () => calls.push("screen-pass"),
      getIdleRenderPassDefinitions: () => [
        ["background", () => calls.push("draw-source")],
        ["borders", () => calls.push("draw-contours")],
      ],
    }),
    getRenderPassCacheHostOwner: () => ({
      prepareRenderPassHost: ({ passName, drawFn }) => {
        calls.push(`render-${passName}-${runtimeState.dpr}`);
        if (failPass) throw new Error("pass failed");
        runtimeState.renderPassCache.canvases[passName] = {
          width: Math.round(runtimeState.width * runtimeState.dpr),
          height: Math.round(runtimeState.height * runtimeState.dpr),
        };
        drawFn();
        return { skipped: false };
      },
    }),
    setPassReferenceTransform: (name, transform) => {
      runtimeState.renderPassCache.referenceTransforms[name] = transform;
    },
    composeRenderPassesToTarget: (target, names, _transform, options) => {
      calls.push(`compose-${target.canvas?.width || 0}`);
      if (failComposition) return { ok: false, reason: "missing-pass" };
      if (options?.requireAllPasses) {
        assert.equal(runtimeState.renderPassCache.canvases[names[0]].width, 200);
      }
      return { ok: true };
    },
    commitRenderPassCacheState: (state, cache) => { state.renderPassCache = cache; },
    createDefaultRenderPassCacheState: () => ({ canvases: {}, referenceTransforms: {} }),
  });
  vm.runInContext(exportSource, context);
  return { run: context.renderExportPassesToCanvas, runtimeState, visibleCache, calls, allocatedCanvases: () => allocatedCanvases };
}

for (const politicalStatus of ["pending", "error"]) {
  test(`border export rejects ${politicalStatus} political borders before allocation or cache mutation`, () => {
    const h = harness({ politicalStatus });
    assert.throws(() => h.run(["background", "borders"], { pixelRatio: 2 }),
      new RegExp(`Political borders are ${politicalStatus}`));
    assert.equal(h.allocatedCanvases(), 0);
    assert.deepEqual(h.calls, ["contours-ready", `political-${politicalStatus}`]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

for (const passName of ["political", "borders"]) {
  test(`${passName} export rejects loading river partitions before allocation or cache mutation`, () => {
    const h = harness();
    const runtime = getRiverPaintRuntime(h.runtimeState);
    runtime.enable(() => new Promise(() => {}));
    try {
      assert.throws(() => h.run([passName], { pixelRatio: 2 }), /River partitions are still loading/);
      assert.equal(h.allocatedCanvases(), 0);
      assert.deepEqual(h.calls, []);
      assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
      assert.equal(h.runtimeState.dpr, 1);
    } finally {
      runtime.cancel();
    }
  });
}

test("2x export redraws passes at target pixels and restores visible cache", () => {
  const h = harness();
  const result = h.run(["background"], { pixelRatio: 2 });
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
  assert.deepEqual(h.calls, ["render-background-2", "draw-source", "compose-200"]);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
  assert.equal(h.runtimeState.dpr, 1);
  assert.equal(h.visibleCache.canvases.background.width, 100);
});

test("matching screen and target DPR still redraws exact pass geometry", () => {
  const h = harness({ screenDpr: 2 });
  const result = h.run(["background"], { pixelRatio: 2 });
  assert.equal(result.width, 200);
  assert.deepEqual(h.calls, ["render-background-2", "draw-source", "compose-200"]);
  assert.equal(h.runtimeState.dpr, 2);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

test("4x full export is rejected by pass memory estimate before canvas allocation", () => {
  const estimate = estimateExportRenderBytes({
    width: 1280,
    height: 720,
    pixelRatio: 4,
    passNames: ["background", "physicalBase", "political", "contextBase", "contextScenario", "effects", "lineEffects", "contextMarkers", "dayNight", "borders", "textureLabels", "labels"],
  });
  assert.ok(estimate > EXPORT_RENDER_BUDGET_BYTES);
  const h = harness({ budgetExceeded: true });
  assert.throws(() => h.run(["background"], { pixelRatio: 4 }), /Export render budget exceeded/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

for (const [name, options, message] of [
  ["pass error", { failPass: true }, /pass failed/],
  ["composition error", { failComposition: true }, /Export composition failed/],
]) {
  test(`export restores visible cache after ${name}`, () => {
    const h = harness(options);
    assert.throws(() => h.run(["background"], { pixelRatio: 2 }), message);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

// Exercise the actual synchronous export entry, not a copy of the readiness guard.
for (const contourStatus of ["building", "error"]) {
  test(`border export rejects ${contourStatus} contours before allocation or cache mutation`, () => {
    const h = harness({ contourStatus });
    assert.throws(() => h.run(["background", "borders"], { pixelRatio: 2 }),
      new RegExp(`Paint contours are ${contourStatus}`));
    assert.equal(h.allocatedCanvases(), 0);
    assert.deepEqual(h.calls, [`contours-${contourStatus}`]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

for (const contourStatus of ["ready", "empty"]) {
  test(`border export accepts a ${contourStatus} contour graph at exact target resolution`, () => {
    const h = harness({ contourStatus });
    const canvas = h.run(["borders"], { pixelRatio: 2 });
    assert.equal(canvas.width, 200);
    assert.deepEqual(h.calls, [`contours-${contourStatus}`, "political-ready", "render-borders-2", "draw-contours", "compose-200"]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.runtimeState.dpr, 1);
  });
}

test("HGO vector export does not depend on the separate land-contour worker", () => {
  const h = harness({ hgo: true, contourStatus: "error" });
  assert.ok(h.run(["borders"], { pixelRatio: 2 }));
  assert.deepEqual(h.calls, ["render-borders-2", "draw-contours", "compose-200"]);
  assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
});

const toolbarSource = readFileSync(new URL("../js/ui/toolbar.js", import.meta.url), "utf8");
const compositeStart = toolbarSource.indexOf("  const buildCompositeSourceCanvas = async");
const compositeEnd = toolbarSource.indexOf("  const buildSingleExportSourceCanvas = async", compositeStart);
assert.ok(compositeStart >= 0 && compositeEnd > compositeStart);

for (const pixelRatio of [null, 2]) {
  test(`composite source owns one renderer canvas with ordered SVG overlays at ${pixelRatio ?? "screen"} resolution`, async () => {
    const h = harness();
    const events = [];
    const context = vm.createContext({
      ensureScenarioPoliticalDetailForExport: async () => events.push("detail-ready"),
      ensurePaintContoursReady: async () => events.push("contours-ready"),
      resolveExportPassSequence: () => ["background", "labels"],
      RENDER_PASS_NAMES: ["background", "labels"],
      SVG_ANNOTATION_VIEWPORT_SELECTOR: ".annotation-layer",
      renderExportPassesToCanvas: h.run,
      createExportError: (_kind, message) => new Error(message),
      drawSvgLayerToCanvas: async (canvas, ctx, options) => {
        assert.equal(ctx.canvas, canvas);
        (canvas.overlays ??= []).push(options.onlyViewportSelector);
      },
    });
    vm.runInContext(`${toolbarSource.slice(compositeStart, compositeEnd)}\nthis.buildComposite = buildCompositeSourceCanvas;`, context);
    const dimensions = pixelRatio === null ? null : { pixelRatio };
    const result = await context.buildComposite({ textVisibility: { "svg-annotations": true, "special-zones": true } }, dimensions);
    assert.equal(h.allocatedCanvases(), 1);
    assert.equal(result.width, pixelRatio === null ? 100 : 200);
    assert.deepEqual(result.overlays, [".annotation-layer", ".special-zones-layer"]);
    assert.deepEqual(events, ["detail-ready", "contours-ready"]);
    assert.equal(h.runtimeState.renderPassCache, h.visibleCache);
    assert.equal(h.visibleCache.canvases.background.overlays, undefined);
    const rasterOnly = await context.buildComposite({ textVisibility: {} }, dimensions);
    assert.notEqual(rasterOnly, result);
    assert.equal(rasterOnly.overlays, undefined);
    assert.equal(h.allocatedCanvases(), 2);
  });
}

test("export budget reserves both regional bathymetry mask surfaces only with a background pass", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["background"] };
  assert.ok(estimateExportRenderBytes({ ...input, bathymetryCoverage: true })
    >= estimateExportRenderBytes(input) + 100 * 80 * 4 * 8);
  const withoutBackground = { ...input, passNames: ["labels"] };
  assert.equal(estimateExportRenderBytes({ ...withoutBackground, bathymetryCoverage: true }),
    estimateExportRenderBytes(withoutBackground));
});

test("physical brush exports account for scratch pixels and inverse projection cache", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["physicalBase"] };
  assert.ok(estimateExportRenderBytes({ ...input, physicalIntensity: true }) > estimateExportRenderBytes(input) + 100 * 80 * 4 * 8);
});
