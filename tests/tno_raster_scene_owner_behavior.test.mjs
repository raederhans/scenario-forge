import test from "node:test";
import assert from "node:assert/strict";
import { createTnoRasterSceneOwner } from "../js/core/renderer/tno_raster_scene_owner.js";

function harness() {
  const records = { frames: [], accounts: [], releases: [], gpuOptions: [], sceneOptions: [], colorBaselines: [] };
  const parent = { children: [], insertBefore(child, next) {
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child); child.parentNode = this;
  } };
  const doc = { defaultView: { getComputedStyle: () => ({ zIndex: "3" }) }, createElement() {
    return { width: 0, height: 0, style: {}, setAttribute() {}, remove() {
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
    } };
  } };
  const overlay = { style: { visibility: "visible" } };
  const map = { width: 200, height: 100, ownerDocument: doc, parentNode: parent, style: { visibility: "visible", zIndex: "" }, nextSibling: overlay };
  parent.children.push(map, overlay);
  let currentMap = map;
  const reference = { k: 2, x: 10, y: 20 };
  const passes = new Map(["base", "labels"].map(name => [name, { canvas: { width: 240, height: 180 }, reference, layout: { offsetX: 10, offsetY: 20 } }]));
  let currentFrame = null, dpr = 2, nextError = null, lost = false, politicalTextureBytes = 1234;
  let stats = { frames: 0, textureUploads: 0, gpuTextureBytes: 0, outputSurfaceBytesEstimate: 80000, lastFrameMs: 0 };
  const cached = new Map();
  const helpers = {
    getActivePassNames: () => ["base", "political", "labels"],
    getPassCanvas: name => passes.get(name)?.canvas,
    getPassReferenceTransform: name => passes.get(name)?.reference,
    getPassLayout: name => passes.get(name)?.layout,
    getDirectFrame: () => currentFrame, getDpr: () => dpr,
    capturePublishedColorBaseline: options => records.colorBaselines.push(options),
  };
  const owner = createTnoRasterSceneOwner({
    surface: { getMapCanvas: () => currentMap },
    helpers,
    resourceBudget: { update: (_owner, amount) => records.accounts.push(amount), release: owner => records.releases.push(owner) },
    createCompositor: options => {
      records.sceneOptions.push(options);
      return records.compositor = { gl: {}, isAvailable: () => !lost,
        captureRetainedLayers: layers => layers.filter(layer => layer.canvas).map(layer => ({ name: `overview:${layer.name}`,
          sourceName: layer.name, revision: layer.revision, scaleX: 2, scaleY: 2 })),
        releaseRetainedLayers: () => {},
        render(frame) {
          if (nextError) throw nextError;
          const canvasBytes = frame.layers.reduce((sum, layer) => sum + (layer.canvas ? layer.canvas.width * layer.canvas.height * 4 : 0), 0);
          if (canvasBytes + frame.reservedTextureBytes > options.maxTextureBytes) throw new RangeError("GPU scene texture budget exceeded.");
          records.frames.push(frame);
          stats.frames++;
          stats.gpuTextureBytes = 0;
          for (const layer of frame.layers) {
            if (layer.draw) { layer.draw({ width: frame.width, height: frame.height }); continue; }
            if (layer.retained) { stats.gpuTextureBytes += 240 * 180 * 4; continue; }
            if (cached.get(layer.name) !== layer.revision) stats.textureUploads++;
            cached.set(layer.name, layer.revision);
            stats.gpuTextureBytes += layer.canvas.width * layer.canvas.height * 4;
          }
          stats.lastFrameMs = 1;
          return true;
        }, getStats: () => stats, dispose: () => { lost = true; },
      };
    },
    createGpu: options => {
      records.gpuOptions.push(options);
      return { isAvailable: () => true, getStats: () => ({ gpuTextureBytes: politicalTextureBytes }), drawLayer: frame => records.direct = frame };
    },
  });
  const gpu = owner.ensureGpu({ onContextLost() {} });
  currentFrame = { gpu, transform: reference, dpr: 2, layout: { offsetX: 10, offsetY: 20 },
    plan: { originX: -100, originY: -100, width: 400, height: 300, scale: 1,
      outputX: -40, outputY: -20, outputWidth: 400, outputHeight: 300 } };
  return { owner, records, map, overlay, parent, passes, currentFrame, helpers,
    setMap: value => currentMap = value,
    setFrame: value => currentFrame = value,
    setDpr: value => dpr = value, fail: error => nextError = error,
    setPoliticalTextureBytes: value => politicalTextureBytes = value,
    transform: { k: 4, x: 30, y: 50 },
  };
}

test("scene installs beside base surface and presents ordered device-pixel affine layers", () => {
  const h = harness();
  const sceneCanvas = h.parent.children[1];
  assert.equal(sceneCanvas.id, "map-scene-canvas");
  assert.deepEqual(h.parent.children, [h.map, sceneCanvas, h.overlay]);
  assert.equal(sceneCanvas.style.display, "none");
  assert.equal(sceneCanvas.style.zIndex, "3");
  assert.equal(sceneCanvas.style.pointerEvents, "none");
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(sceneCanvas.style.width, "100px");
  assert.equal(sceneCanvas.style.height, "50px");
  const frame = h.records.frames[0];
  assert.deepEqual(frame.layers.map(layer => layer.name), ["base", "political", "labels"]);
  assert.deepEqual(frame.layers[0].transform, { a: 2, d: 2, e: -20, f: -60 });
  assert.deepEqual(h.records.direct.transform, { a: 2, d: 2, e: 100, f: 100 });
  assert.equal(frame.reservedTextureBytes, 1234);
  assert.equal(h.records.gpuOptions[0].maxTextureBytes, 80 * 1024 * 1024);
  assert.equal(h.records.sceneOptions[0].maxTextureBytes, 160 * 1024 * 1024);
  assert.equal(sceneCanvas.style.display, "block");
  assert.equal(h.map.style.visibility, "hidden");
  assert.equal(h.overlay.style.visibility, "visible");
  assert.equal(h.owner.isActive(), true);
  assert.deepEqual(h.owner.getDiagnostics().view, { ...h.transform, dpr: 2, width: 200, height: 100 });
});

function publicationHarness() {
  const h = harness(), jobs = [], requests = [];
  let identity = "candidate-1", sceneIdentity = "source-1", transform = h.transform;
  h.helpers.getPreparationIdentity = () => identity;
  h.helpers.getSceneIdentity = () => sceneIdentity;
  h.helpers.getCurrentTransform = () => transform;
  h.helpers.requestRender = reason => requests.push(reason);
  h.records.compositor.prepareLayers = options => new Promise((resolve, reject) => jobs.push({ options, resolve, reject }));
  h.records.compositor.cancelPreparedLayers = () => { h.records.cancels = (h.records.cancels || 0) + 1; };
  return { ...h, jobs, requests, setIdentity: value => identity = value,
    setSceneIdentity: value => sceneIdentity = value, setTransform: value => transform = value };
}

test("publication coverage is captured once, retained navigation stays usable and ready identity is consumed once", async () => {
  const h = publicationHarness();
  assert.equal(h.owner.present(h.transform), true);
  let coverageCalls = 0;
  h.helpers.ensurePassCoverage = () => { coverageCalls++; h.owner.notePassCommit("labels"); return true; };
  assert.equal(h.owner.preparePublication(h.transform), false);
  assert.equal(h.jobs[0].options.layers.at(-1).revision, 1);
  assert.equal(h.jobs[0].options.getReservedTextureBytes(), 1234);
  h.setPoliticalTextureBytes(4000);
  assert.equal(h.jobs[0].options.getReservedTextureBytes(), 4000, "reservation reads pending political bytes live");
  assert.equal(h.jobs[0].options.isCurrent(), true);
  assert.equal(h.owner.present(h.transform, { refresh: false }), true);
  assert.equal(h.records.frames.at(-1).layers.at(-1).revision, 0);
  h.jobs[0].resolve(true); await Promise.resolve();
  assert.equal(h.owner.getDiagnostics().publicationPending, true, "ready private data is still awaiting publication");
  assert.equal(h.owner.preparePublication(h.transform), true);
  assert.equal(h.jobs.length, 1);
  h.setIdentity("published-1");
  h.setFrame({ ...h.currentFrame });
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(coverageCalls, 1, "final presentation must not repaint after snapshot validation");
  assert.equal(h.records.frames.at(-1).layers.at(-1).revision, 1);
  assert.equal(h.owner.getDiagnostics().publicationPending, false);
  assert.equal(h.owner.preparePublication(h.transform), true);
  assert.equal(h.jobs.length, 1, "consumed publication does not restart preparation");
});

test("publication snapshots cancel on revision, camera, DPR, surface, layout, order and source changes", async () => {
  const mutations = {
    revision: h => h.owner.notePassCommit("labels"),
    camera: h => h.setTransform({ ...h.transform, x: h.transform.x + 1 }),
    dpr: h => h.setDpr(3),
    size: h => { h.map.width++; },
    surface: h => h.setMap({ ...h.map }),
    canvas: h => { h.passes.get("labels").canvas = { width: 240, height: 180 }; },
    reference: h => { h.passes.get("labels").reference = { k: 2, x: 11, y: 20 }; },
    layout: h => { h.passes.get("labels").layout.offsetX++; },
    order: h => { h.helpers.getActivePassNames = () => ["labels", "political", "base"]; },
    candidate: h => h.setIdentity("candidate-2"),
    source: h => h.setSceneIdentity("source-2"),
    clear: h => h.owner.clear(),
    dispose: h => h.owner.dispose(),
    context: h => h.records.sceneOptions[0].onContextLost(),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const h = publicationHarness();
    h.owner.present(h.transform);
    assert.equal(h.owner.preparePublication(h.transform), false, name);
    mutate(h);
    assert.equal(h.jobs[0].options.isCurrent(), false, name);
    h.jobs[0].resolve(false); await Promise.resolve();
    assert.equal(h.owner.getDiagnostics().publicationPending, false, name);
    assert.ok(h.records.cancels > 0, name);
    if (["revision", "canvas", "reference", "layout", "order", "candidate", "source"].includes(name)) {
      assert.equal(h.owner.present(h.transform, { refresh: false }), true, `${name}: old published navigation stays available`);
    }
  }
});

test("failed private preparation records the original error and falls through synchronously once per identity", async () => {
  const h = publicationHarness();
  assert.equal(h.owner.preparePublication(h.transform), false);
  h.jobs[0].reject(new Error("original asynchronous failure"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.owner.getDiagnostics().publicationPending, false);
  assert.equal(h.owner.getDiagnostics().preparationError, "original asynchronous failure");
  assert.equal(h.owner.preparePublication(h.transform), true);
  assert.equal(h.owner.preparePublication(h.transform), true);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.owner.preparePublication(h.transform), true);
  assert.equal(h.jobs.length, 1);
});

test("GPU scene matches the editor surface CSS size inside a bordered container", () => {
  const h = harness(), sceneCanvas = h.parent.children[1];
  h.map.style.width = "736px";
  h.map.style.height = "844px";
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(sceneCanvas.style.width, h.map.style.width);
  assert.equal(sceneCanvas.style.height, h.map.style.height);
  h.map.style.width = "740px";
  assert.equal(h.owner.present(h.transform, { refresh: false }), true);
  assert.equal(sceneCanvas.style.width, "740px");
});

test("navigation retains pass revisions and a committed pass alone advances its upload", () => {
  const h = harness();
  h.owner.present(h.transform);
  h.owner.present({ ...h.transform, x: 31 });
  assert.equal(h.owner.getDiagnostics().textureUploads, 2);
  h.owner.notePassCommit("labels");
  h.owner.present(h.transform);
  assert.equal(h.owner.getDiagnostics().textureUploads, 3);
  assert.equal(h.records.frames[2].layers[0].revision, 0);
  assert.equal(h.records.frames[2].layers[2].revision, 1);
  assert.deepEqual(h.records.accounts.at(-1), { gpuTextures: 240 * 180 * 4 * 2, workerSurfaces: 80000 });
  assert.equal(h.owner.getDiagnostics().bytes, 240 * 180 * 4 * 2 + 80000, "political texture bytes are not counted twice");
});

test("scene budget includes other-pass textures while the political pool stays capped at 80 MiB", () => {
  const h = harness(), MiB = 1024 * 1024;
  // Two 52 MiB surfaces model the measured high-DPR ordinary-pass footprint.
  for (const pass of h.passes.values()) pass.canvas = { width: 4096, height: 3328 };
  h.setPoliticalTextureBytes(34 * MiB);
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.records.frames.at(-1).reservedTextureBytes, 34 * MiB);
  assert.equal(h.owner.getDiagnostics().gpuTextureBytes, 104 * MiB);
  assert.equal(h.records.sceneOptions[0].maxTextureBytes, 160 * MiB);
  h.currentFrame.gpu = h.owner.ensureGpu({ maxTextureBytes: 160 * MiB });
  assert.equal(h.records.gpuOptions.at(-1).maxTextureBytes, 80 * MiB, "scene capacity cannot expand the political pool");
  h.setPoliticalTextureBytes(56 * MiB);
  assert.equal(h.owner.present(h.transform), true, "104 + 56 MiB fits the exact combined cap");
  h.setPoliticalTextureBytes(56 * MiB + 1);
  assert.equal(h.owner.present(h.transform), false, "one byte beyond the combined cap falls back");
  assert.equal(h.owner.getDiagnostics().fallbackReason, "gpu-budget");
  assert.equal(h.records.frames.length, 2, "over-budget scene is never published");
  assert.equal(h.map.style.visibility, "visible");
});

test("candidate pass writes cannot replace the published scene while political preparation is pending", () => {
  const h = harness();
  h.owner.present(h.transform);
  const before = h.owner.getDiagnostics();
  h.currentFrame.presentationState = "retained";
  const labels = h.passes.get("labels");
  labels.canvas.width = 1;
  labels.reference = { k: 9, x: 1000, y: 1000 };
  h.owner.notePassCommit("labels");
  h.helpers.ensurePassCoverage = () => { throw new Error("candidate work must not run during retained presentation"); };
  assert.equal(h.owner.present({ ...h.transform, x: 31 }), true);
  const frame = h.records.frames.at(-1);
  assert.equal(frame.layers[2].retained, true);
  assert.equal(frame.layers[2].revision, 0);
  assert.deepEqual(frame.layers[2].transform, { a: 2, d: 2, e: -18, f: -60 });
  assert.equal(h.owner.getDiagnostics().textureUploads, before.textureUploads);
  assert.equal(h.owner.getDiagnostics().retainedFrames, 1);
  assert.equal(h.owner.getDiagnostics().publications, 1);
  assert.equal(h.owner.getDiagnostics().presentationState, "retained");
  assert.deepEqual(h.records.colorBaselines, [{ overview: false }], "retained edits cannot reset the restoration baseline");
});

test("navigation cannot publish partially prepared pass caches even before raster invalidation", () => {
  const h = harness();
  h.owner.present(h.transform);
  h.passes.delete("labels");
  h.owner.notePassCommit("labels");
  assert.equal(h.owner.present(h.transform, { refresh: false }), true);
  assert.equal(h.records.frames.at(-1).layers[2].retained, true);
  assert.equal(h.owner.getDiagnostics().textureUploads, 2);
  assert.equal(h.owner.getDiagnostics().presentationState, "retained",
    "water or physical preparation can retain the scene while political data is already ready");
});

test("zooming out uses a complete bounded overview until the new primary scene is published", () => {
  const h = harness();
  const overview = { ...h.currentFrame, sourceFrame: h.currentFrame };
  h.helpers.getOverviewFrame = () => overview;
  h.owner.present(h.transform);
  assert.equal(h.owner.getDiagnostics().overviewReady, true);
  const high = { ...h.currentFrame, transform: { k: 8, x: 30, y: 50 }, layout: { offsetX: 0, offsetY: 0 },
    plan: { originX: 0, originY: 0, width: 200, height: 100, scale: 1,
      outputX: 0, outputY: 0, outputWidth: 200, outputHeight: 100 } };
  for (const pass of h.passes.values()) {
    pass.reference = high.transform; pass.layout = high.layout;
    pass.canvas = { width: 200, height: 100 };
  }
  h.setFrame(high);
  h.owner.present(high.transform);
  const publications = h.owner.getDiagnostics().publications;
  high.presentationState = "retained";
  assert.equal(h.owner.present(h.transform, { refresh: false }), true);
  assert.equal(h.owner.getDiagnostics().usingOverview, true);
  assert.equal(h.owner.getDiagnostics().presentationState, "retained");
  assert.equal(h.owner.getDiagnostics().publications, publications, "preview does not count as new precision publication");
  const output = h.records.frames.at(-1);
  assert.equal(output.preserveLayers, true);
  assert.equal(output.layers[0].name, "overview:base");
  assert.deepEqual(output.layers[0].transform, { a: 4, d: 4, e: -20, f: -60 });
});

test("incomplete, uncovered, wrong-DPR or missing-pass frames restore the base canvas", () => {
  const h = harness();
  h.owner.present(h.transform);
  h.currentFrame.complete = false;
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "direct-frame-unavailable");
  h.currentFrame.complete = true;
  assert.equal(h.owner.present({ ...h.transform, x: 1000 }), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "direct-frame-coverage");
  h.setDpr(3);
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "direct-frame-dpr-mismatch");
  h.setDpr(2);
  h.passes.delete("labels");
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "pass-unavailable:labels");
  assert.equal(h.map.style.visibility, "visible");
  assert.equal(h.parent.children[1].style.display, "none");
  assert.equal(h.records.frames.length, 1, "rejected frames never reach compositor");
});

test("budget/render failures hide the scene and clear preserves shared-context lifetime", () => {
  const h = harness();
  h.owner.present(h.transform);
  h.fail(new RangeError("GPU scene texture budget exceeded."));
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "gpu-budget");
  h.fail(new Error("draw exploded"));
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "render-failed: draw exploded");
  h.fail(null);
  h.owner.clear();
  assert.equal(h.owner.isActive(), false);
  assert.equal(h.records.releases.length, 0);
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.records.sceneOptions.length, 1);
  h.owner.dispose(); h.owner.dispose();
  assert.equal(h.records.releases.length, 1);
  assert.deepEqual(h.parent.children, [h.map, h.overlay]);
  assert.equal(h.map.style.visibility, "visible");
  assert.equal(h.owner.present(h.transform), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "disposed");
});

test("context loss immediately restores the ordinary surface", () => {
  const h = harness();
  h.owner.present(h.transform);
  h.records.sceneOptions[0].onContextLost();
  assert.equal(h.owner.isActive(), false);
  assert.equal(h.map.style.visibility, "visible");
  assert.equal(h.owner.getDiagnostics().fallbackReason, "context-lost");
});

test("wide political tiles cannot publish a panned or zoomed-out unpadded canvas pass", () => {
  const h = harness();
  const labels = h.passes.get("labels");
  labels.reference = { ...h.transform };
  labels.layout = { offsetX: 0, offsetY: 0 };
  labels.canvas = { width: h.map.width, height: h.map.height };
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.owner.present({ ...h.transform, x: h.transform.x + 20 }), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "pass-coverage");
  assert.equal(h.owner.present({ k: 2, x: 15, y: 25 }), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "pass-coverage");
  assert.equal(h.records.frames.length, 1);
  assert.equal(h.map.style.visibility, "visible");
});

test("coverage callback rejects before pass reads and refreshed revision uploads in original order", () => {
  const h = harness();
  const labels = h.passes.get("labels");
  labels.reference = { ...h.transform };
  labels.layout = { offsetX: 0, offsetY: 0 };
  labels.canvas = { width: h.map.width, height: h.map.height };
  assert.equal(h.owner.present(h.transform), true);
  let coverageCalls = 0, passReads = 0;
  const getPassCanvas = h.helpers.getPassCanvas;
  h.helpers.getPassCanvas = name => { passReads++; return getPassCanvas(name); };
  h.helpers.ensurePassCoverage = () => { coverageCalls++; return false; };
  assert.equal(h.owner.present({ ...h.transform, x: 1000 }), false);
  assert.equal(coverageCalls, 0, "political coverage fails before ordinary-pass refresh");
  const moved = { ...h.transform, x: h.transform.x + 5 };
  assert.equal(h.owner.present(moved), false);
  assert.equal(h.owner.getDiagnostics().fallbackReason, "pass-coverage");
  assert.equal(coverageCalls, 1);
  assert.equal(passReads, 0, "no stale pass references are read before callback completion");
  assert.equal(h.records.frames.length, 1);
  h.helpers.ensurePassCoverage = transform => {
    labels.reference = { ...transform };
    h.owner.notePassCommit("labels");
    return true;
  };
  assert.equal(h.owner.present(moved), true);
  assert.deepEqual(h.records.frames[1].layers.map(layer => layer.name), ["base", "political", "labels"]);
  assert.equal(h.records.frames[1].layers[0].revision, 0);
  assert.equal(h.records.frames[1].layers[2].revision, 1);
  assert.equal(h.owner.getDiagnostics().textureUploads, 3, "only the refreshed pass is uploaded again");
  assert.deepEqual(h.records.frames[1].layers[2].transform, { a: 1, d: 1, e: 0, f: 0 });
});

test("TNO default layers enable 96px paint margin while optional producers and vector keep zero", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createDefaultUiState, createDefaultStyleConfig } = await import("../js/core/state/ui_state.js");
  const { default: vm } = await import("node:vm");
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const begin = source.indexOf("function getTnoScenePaintOverscanPx(");
  const end = source.indexOf("function getPoliticalDirectFrameKey(", begin);
  const runtimeState = { ...createDefaultUiState(), styleConfig: createDefaultStyleConfig() };
  const scope = { runtimeState, exportRenderInProgress: false, isTnoRasterSceneSelected: () => true, VIEWPORT_CULL_OVERSCAN_PX: 96 };
  vm.createContext(scope); vm.runInContext(source.slice(begin, end), scope);
  for (const name of ["borders", "labels", "textureLabels"]) assert.equal(scope.getTnoScenePaintOverscanPx(name), 96);
  runtimeState.showRoad = true;
  assert.equal(scope.getTnoScenePaintOverscanPx("labels"), 0);
  runtimeState.showRoad = false;
  runtimeState.styleConfig.physical.showRegionLabels = true;
  assert.equal(scope.getTnoScenePaintOverscanPx("labels"), 0);
  runtimeState.styleConfig.physical.showRegionLabels = false;
  scope.isTnoRasterSceneSelected = () => false;
  assert.equal(scope.getTnoScenePaintOverscanPx("labels"), 0);
  scope.isTnoRasterSceneSelected = () => true; scope.exportRenderInProgress = true;
  assert.equal(scope.getTnoScenePaintOverscanPx("labels"), 0);
});

test("successful GPU handoff retires legacy navigation while incomplete, vector and export retain it", async () => {
  const { readFile } = await import("node:fs/promises");
  const { default: vm } = await import("node:vm");
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const begin = source.indexOf("function composeCachedPasses(");
  const end = source.indexOf("function canDrawTransformedPass(", begin);
  for (const mode of ["gpu", "incomplete", "vector", "export"]) {
    let disposed = 0, overviewClears = 0, gpuPresents = 0, nativeBlits = 0;
    const legacy = { dispose: () => { disposed++; } };
    const scene = { present: () => { gpuPresents++; return mode === "gpu"; }, clear() {} };
    const scope = {
      rendererSurfaceHost: { getContext: () => ({ canvas: {} }) },
      runtimeState: { zoomTransform: { k: 1, x: 0, y: 0 } },
      exportRenderInProgress: mode === "export",
      isTnoRasterSceneSelected: () => mode !== "vector",
      politicalIdRasterRuntimeOwner: { getDiagnostics: () => ({ stagedPending: false }) },
      getTnoRasterSceneOwner: () => scene, tnoRasterSceneOwner: scene,
      politicalPassUsesDirectScene: false, navigationSceneOwner: legacy,
      overviewFrameOwner: { clear: () => { overviewClears++; } },
      incrementPerfCounter() {}, ensureCompositeBufferCanvas: () => ({}),
      getExactCompositeReuseOwner: () => ({ composeExact: () => ({ ok: true }) }),
      blitCompositeBufferToMain: () => { nativeBlits++; },
    };
    vm.createContext(scope); vm.runInContext(source.slice(begin, end), scope);
    assert.equal(scope.composeCachedPasses([]), true);
    assert.equal(scope.composeCachedPasses([]), true);
    assert.equal(disposed, mode === "gpu" ? 1 : 0, mode);
    assert.equal(overviewClears, mode === "gpu" ? 1 : 0, mode);
    assert.equal(scope.navigationSceneOwner, mode === "gpu" ? null : legacy, mode);
    assert.equal(gpuPresents, mode === "export" || mode === "vector" ? 0 : 2, mode);
    assert.equal(nativeBlits, mode === "gpu" ? 0 : 2, mode);
  }
});


test("political candidate admission reserves excess live scene textures without counting itself twice", () => {
  const h = harness(), MiB = 1024 * 1024;
  const reserve = h.records.gpuOptions[0].getReservedTextureBytes;
  assert.equal(reserve(), 0);
  h.passes.get("base").canvas = { width: 4000, height: 4000 };
  h.passes.get("labels").canvas = { width: 4000, height: 4000 };
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(reserve(), 128000000 - 80 * MiB);
  h.setPoliticalTextureBytes(10 * MiB);
  assert.equal(reserve(), 128000000 - 80 * MiB, "political and overview bytes are charged by their own owner");
});

test("compose gates political publication on prepared layers and preserves the synchronous final boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const { default: vm } = await import("node:vm");
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const begin = source.indexOf("function composeCachedPasses(");
  const end = source.indexOf("function canDrawTransformedPass(", begin);
  const calls = [];
  let ready = false;
  const scene = { preparePublication: () => { calls.push("prepare"); return ready; },
    present: (_transform, options) => { calls.push(options?.refresh === false ? "retained" : "present"); return true; } };
  const scope = {
    rendererSurfaceHost: { getContext: () => ({ canvas: {} }) },
    runtimeState: { zoomTransform: { k: 1, x: 0, y: 0 } }, exportRenderInProgress: false,
    isTnoRasterSceneSelected: () => true, getTnoRasterSceneOwner: () => scene, tnoRasterSceneOwner: scene,
    politicalIdRasterRuntimeOwner: { getDiagnostics: () => ({ stagedPending: true }),
      publishDirectFrame: () => { calls.push("publish-political"); return true; } },
    politicalPassUsesDirectScene: false, navigationSceneOwner: null, incrementPerfCounter() {},
  };
  vm.createContext(scope); vm.runInContext(source.slice(begin, end), scope);
  assert.equal(scope.composeCachedPasses([]), false);
  assert.deepEqual(calls, ["prepare", "retained"]);
  calls.length = 0; ready = true;
  assert.equal(scope.composeCachedPasses([]), true);
  assert.deepEqual(calls, ["prepare", "publish-political", "present"]);
});
