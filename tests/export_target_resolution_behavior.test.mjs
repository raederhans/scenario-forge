import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EXPORT_RENDER_BUDGET_BYTES, estimateExportRenderBytes } from "../js/core/renderer/export_render_budget.js";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const start = source.indexOf("let exportRenderInProgress = false;");
const end = source.indexOf("\nfunction composeTransformedFrameToBuffer(", start);
assert.ok(start >= 0 && end > start);
const exportSource = source.slice(start, end);

function harness({ failPass = false, failComposition = false, screenDpr = 1, budgetExceeded = false } = {}) {
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
  const context = vm.createContext({
    runtimeState,
    EXPORT_RENDER_BUDGET_BYTES,
    estimateExportRenderBytes: (input) => budgetExceeded
      ? EXPORT_RENDER_BUDGET_BYTES + 1
      : estimateExportRenderBytes(input),
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext() { return { canvas: this, setTransform() {}, clearRect() {} }; },
      }),
    },
    getRenderPipelinePassesOwner: () => ({
      ensureIdleRenderPasses: () => calls.push("screen-pass"),
      getIdleRenderPassDefinitions: () => [["background", () => calls.push("draw-source")]],
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
  return { run: context.renderExportPassesToCanvas, runtimeState, visibleCache, calls };
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
