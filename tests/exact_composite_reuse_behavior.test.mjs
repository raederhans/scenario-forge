import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createExactCompositeReuseOwner } from "../js/core/renderer/exact_composite_reuse_owner.js";
import { createCachedPassCompositorOwner } from "../js/core/renderer/cached_pass_compositor_owner.js";
const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
function realFunction(name, globals) {
  const node = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(node.start, node.end), context);
  return context[name];
}
function canvas(pixels = [null, null]) {
  const result = { width: 2, height: 1, pixels: [...pixels] };
  const context = { canvas: result, draws: 0, save() {}, restore() {}, setTransform() {}, translate() {}, scale() {},
    clearRect() { result.pixels = [null, null]; },
    drawImage(image) { this.draws++; image.pixels.forEach((pixel, index) => { if (pixel !== null) result.pixels[index] = pixel; }); },
  };
  result.getContext = () => context;
  return result;
}
function harness() {
  const buffer = canvas(), main = canvas();
  const cache = { canvases: { base: canvas([1, 1]), overlay: canvas([null, 2]) }, dirty: {} };
  const transform = { k: 1, x: 0, y: 0 }, reference = { ...transform }, layout = { offsetX: 0, offsetY: 0 };
  const state = { dpr: 1, zoomTransform: transform, colorCanvas: main };
  const counters = {};
  let diagnostics = false, blits = 0;
  const compositor = createCachedPassCompositorOwner({ constants: { renderPassNames: ["base", "overlay"] },
    getters: { getActiveTargetContext: () => buffer.getContext(), getRenderPassCacheSnapshot: () => cache,
      getPassReferenceTransform: name => cache.canvases[name] ? reference : null, getRenderPassLayout: () => layout,
      getDpr: () => state.dpr, getRenderPhase: () => "idle", isRenderDiagnosticsEnabled: () => false },
    helpers: { cloneZoomTransform: value => ({ ...value }), areZoomTransformsEquivalent: (a, b) => a.k === b.k && a.x === b.x && a.y === b.y },
    effects: { recordTransformedPassDiagnostics() {} },
  });
  const owner = createExactCompositeReuseOwner({ getCache: () => cache, getReferenceTransform: () => reference,
    getLayout: () => layout, getDpr: () => state.dpr, diagnosticsEnabled: () => diagnostics,
    resetContext: context => context.clearRect(), compose: compositor.composeRenderPassesToTarget });
  const globals = { runtimeState: state, exactCompositeReuseOwner: owner,
    rendererSurfaceHost: { getContext: () => main.getContext() }, ensureCompositeBufferCanvas: () => buffer,
    getExactCompositeReuseOwner: () => owner, getExactAfterSettleControllerState: () => ({}), recordRenderPerfMetric() {},
    blitCompositeBufferToMain(image) { blits++; main.pixels = [...image.pixels]; },
    incrementPerfCounter(name) { counters[name] = (counters[name] || 0) + 1; },
  };
  return { buffer, main, cache, transform, reference, layout, state, counters, owner, globals, compositor,
    render: realFunction("composeCachedPasses", globals), setDiagnostics: value => { diagnostics = value; }, getBlits: () => blits };
}

test("actual exact composition reuses identical pixels while every frame still blits", () => {
  const h = harness();
  assert.equal(h.render(["base", "overlay"]), true);
  const pixels = [...h.main.pixels];
  assert.equal(h.buffer.getContext().draws, 2);
  h.render(["base", "overlay"]);
  assert.deepEqual(h.main.pixels, pixels);
  assert.equal(h.buffer.getContext().draws, 2);
  assert.equal(h.getBlits(), 2);
  assert.deepEqual(h.counters, { composites: 1, compositeBufferReuses: 1 });
});

test("real full/partial/worker writers invalidate before touching pass pixels", () => {
  const h = harness();
  const names = ["base", "overlay"];
  h.render(names);
  const repaint = realFunction("tryPartialPoliticalPassRepaint", { exactCompositeReuseOwner: h.owner,
    getPoliticalPartialRepaintOwner: () => ({ tryPartialPoliticalPassRepaint() { h.cache.canvases.overlay.pixels[1] = 3; return true; } }) });
  repaint({}, "", {});
  h.render(names);
  assert.deepEqual(h.main.pixels, [1, 3]);
  const worker = realFunction("drawPoliticalWorkerBitmapResult", { exactCompositeReuseOwner: h.owner,
    getPoliticalPartialRepaintOwner: () => ({ drawPoliticalWorkerBitmapResult() { h.cache.canvases.overlay.pixels[1] = 4; } }) });
  worker({}, {});
  h.render(names);
  assert.deepEqual(h.main.pixels, [1, 4]);
  const full = realFunction("renderPassToCache", { exactCompositeReuseOwner: h.owner, nowMs: () => 0,
    getRenderPassCacheHostOwner: () => ({ prepareRenderPassHost({ drawFn }) { drawFn(); return { drawResult: {} }; } }),
    getRenderPassCommitAccountingOwner: () => ({ commitRenderPass() {} }) });
  full("base", () => { h.cache.canvases.base.pixels[0] = 9; }, {}, {});
  h.render(names);
  assert.deepEqual(h.main.pixels, [9, 4]);
  assert.equal(h.counters.composites, 4);
});

test("transform, layout, DPR, pass order, dimensions, dirty inputs and shared overwrite force composition", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names);
  for (const change of [() => h.transform.x++, () => h.reference.y++, () => h.layout.offsetX++,
    () => h.state.dpr++, () => h.buffer.width++, () => h.cache.canvases.base.width++,
    () => { h.cache.dirty.base = true; }, () => { h.cache.dirty.base = false; },
    () => { h.owner.invalidate(); h.buffer.pixels = [99, 99]; }, () => h.setDiagnostics(true)]) {
    const before = h.counters.composites;
    change(); h.render(names);
    assert.equal(h.counters.composites, before + 1);
    assert.deepEqual(h.main.pixels, [1, 2]);
  }
  h.setDiagnostics(false);
  h.render(["overlay", "base"]);
  assert.deepEqual(h.main.pixels, [1, 1]);
});

test("missing pass never publishes reuse eligibility", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names);
  const overlay = h.cache.canvases.overlay;
  delete h.cache.canvases.overlay;
  assert.equal(h.render(names), false);
  h.cache.canvases.overlay = overlay;
  h.render(names);
  assert.equal(h.counters.composites, 2);
  assert.equal(h.counters.compositeBufferReuses, undefined);
});

test("actual export remains a separate pass composition after exact buffer reuse", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names); h.render(names);
  let prepared = 0;
  const exportFrame = realFunction("renderExportPassesToCanvas", {
    runtimeState: h.state, getRenderPipelinePassesOwner: () => ({ ensureIdleRenderPasses() { prepared++; } }),
    document: { createElement: () => canvas() }, composeRenderPassesToTarget: h.compositor.composeRenderPassesToTarget,
  });
  const result = exportFrame(names);
  assert.notEqual(result, h.buffer);
  assert.deepEqual(result.pixels, h.main.pixels);
  assert.equal(result.getContext().draws, 2);
  assert.equal(prepared, 1);
});


test("thrown composition invalidates the previous buffer even when returning to its old transform", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names);
  const context = h.buffer.getContext(), draw = context.drawImage;
  context.drawImage = () => { throw new Error("paint failed"); };
  h.transform.x = 1;
  assert.throws(() => h.render(names), /paint failed/);
  context.drawImage = draw;
  h.transform.x = 0;
  h.render(names);
  assert.deepEqual(h.main.pixels, [1, 2]);
  assert.equal(h.counters.composites, 2);
  assert.equal(h.counters.compositeBufferReuses, undefined);
});

test("actual transformed-owner buffer injection invalidates prior exact pixels", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names);
  const noops = Object.fromEntries([
    "getActiveTransformedFramePassNames", "isHgoRuntimePreviewReady", "nowMs", "canDrawTransformedPass",
    "getInteractionCompositeReuseDecision", "resetCanvasContext", "withRenderTarget", "drawInteractionComposite",
    "composeRenderPassesToTarget", "drawTransformedPass", "drawInteractionBorderSnapshot", "drawBordersPass",
    "resetMainCanvas", "invalidateInteractionComposite", "buildInteractionComposite", "canDrawInteractionComposite",
    "recordPassTiming",
  ].map(name => [name, () => {}]));
  const getTransformed = realFunction("getTransformedFrameCompositorOwner", {
    ...h.globals, ...noops, transformedFrameCompositorOwner: null,
    INTERACTION_COMPOSITE_PASS_NAMES: names, RENDER_PHASE_IDLE: "idle",
    RENDER_PHASE_INTERACTING: "interacting", RENDER_PHASE_SETTLING: "settling",
    getRenderPassCacheState: () => h.cache,
    createTransformedFrameCompositorOwner: options => options.effects,
  });
  const shared = getTransformed().ensureCompositeBufferCanvas();
  assert.equal(shared, h.buffer);
  shared.pixels = [77, 88];
  h.render(names);
  assert.deepEqual(h.main.pixels, [1, 2]);
  assert.equal(h.counters.composites, 2);
});

test("actual resize facade invalidates even when dimensions return to the same values", () => {
  const h = harness(), names = ["base", "overlay"];
  h.render(names);
  const resize = realFunction("resizeRenderPassCanvases", {
    exactCompositeReuseOwner: h.owner, RENDER_PASS_NAMES: names,
    getRenderCacheOwner: () => ({ resizeRenderPassCanvases() { h.cache.canvases.overlay.pixels = [null, null]; } }),
  });
  resize();
  h.render(names);
  assert.deepEqual(h.main.pixels, [1, 1]);
  assert.equal(h.counters.composites, 2);
});
