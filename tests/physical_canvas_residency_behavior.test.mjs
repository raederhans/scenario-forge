import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getObjectIdentityToken } from "../js/core/renderer/object_identity.js";
import { getContextCollectionRevision, getContextGeometryRevision, recordContextLayerPublication } from "../js/core/state/context_layer_revision.js";
import { resolvePhysicalAtlasCollection } from "../js/core/renderer/physical_atlas_lod_policy.js";
import { planPhysicalViewportSurface } from "../js/core/renderer/physical_raster_surface.js";

const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
function section(startMarker, endMarker) {
  const start = rendererSource.indexOf(startMarker);
  const end = rendererSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, startMarker + " source boundary");
  return rendererSource.slice(start, end);
}

function harness() {
  const records = { owners: [], preparations: [], atlas: [], native: [], events: [], commits: [], requests: [], accounts: [], releases: [], targets: [] };
  const ledger = new Map();
  const environment = { selected: true, projectionGeneration: 1, politicalRevision: 0, layout: {}, activePasses: ["physicalBase"], failDraw: false };
  function canvas(name, width = 1, height = 1) {
    const surface = { name, width, height };
    surface.context = { canvas: surface };
    surface.getContext = () => surface.context;
    return surface;
  }
  const state = { activeScenarioId: "tno_1962", sceneGeneration: 1, currentScenarioApplyRequestId: 1,
    showPhysical: true, dpr: 2, width: 400, height: 300, contextLayerRevision: 0,
    zoomTransform: { k: 1, x: 12, y: 23 }, styleConfig: { physical: { opacity: 1 } },
    intensityFields: { channels: { physicalAtlas: { enabled: false } } },
    physicalSemanticsData: { features: [{ id: "coarse" }] },
    contextLayerExternalDataByName: { physical_semantics_detail: { features: [{ id: "detail" }] } },
  };
  const viewport = canvas("viewport", 800, 600);
  const cache = { canvases: { physicalBase: viewport }, dirty: { physicalBase: true } };
  state.renderPassCache = cache;
  const mask = { collection: { features: [{ id: "mask" }] }, maskSource: "scenarioLandMask", maskQualityToken: "valid" };
  const projectionValues = { scale: 1, translate: [0, 0], center: [0, 0], rotate: [0, 0, 0], angle: 0,
    reflectX: false, reflectY: false, precision: 0.1, clipAngle: 0, clipExtent: null, parallels: null,
    preclip: () => {}, postclip: () => {} };
  const projection = Object.fromEntries(Object.keys(projectionValues).map(name => [name, () => projectionValues[name]]));
  let target = viewport.context;
  const layout = () => ({ offsetX: 0, offsetY: 0, logicalWidth: state.width, logicalHeight: state.height,
    paddedWidth: state.width, paddedHeight: state.height, pixelWidth: state.width * state.dpr,
    pixelHeight: state.height * state.dpr, dpr: state.dpr, ...environment.layout });
  const withRenderTarget = (context, draw) => {
    const previous = target; target = context;
    try { return draw(); } finally { target = previous; }
  };
  const mockOwner = { options: null, ready: null, retained: false, pendingBytes: 0, clearCount: 0, result: null,
    prepare() { records.preparations.push(this.options.readSnapshot()); return this.result; },
    takeReady() { records.events.push("take-ready"); const ready = this.ready; this.ready = null; return ready; },
    noteCommitted(job, previous) {
      records.events.push("note-committed");
      assert.equal(cache.canvases.physicalBase, job.canvas);
      assert.equal(records.commits.at(-1)?.passName, "physicalBase", "ordinary commit accounting precedes owner acknowledgement");
      assert.deepEqual([previous.width, previous.height], [800, 600], "ask whether the old backing is retained before resizing it");
      this.lastCommit = { job, previous }; return this.retained;
    },
    noteNativeDraw(canvas) { records.events.push(["native-draw", canvas]); this.lastNativeCanvas = canvas; },
    clear() { this.clearCount++; records.events.push("clear-owner"); },
    getPendingBytes() { return this.pendingBytes; }, getPendingPromise() { return null; }, getStats() { return null; },
  };
  const dependencies = {
    runtimeState: state, exportRenderInProgress: false, cityPointsRenderOwner: null,
    rendererSurfaceHost: { getProjection: () => environment.projection || projection, getContext: () => target },
    getPhysicalLandMaskInfo: () => mask,
    getResolvedPhysicalAtlasCollection: () => resolvePhysicalAtlasCollection(state),
    getObjectIdentityToken, getProjectionGeometryGeneration: () => environment.projectionGeneration,
    getContextCollectionRevision, getContextGeometryRevision,
    planPhysicalViewportSurface,
    getPoliticalGeometrySnapshot: () => ({ revision: environment.politicalRevision }),
    cloneZoomTransform: value => ({ ...value }),
    isTnoRasterSceneSelected: () => environment.selected && state.activeScenarioId === "tno_1962",
    getRenderPassLayout: layout, getRenderPassCacheState: () => cache,
    createPhysicalViewportCacheOwner(options) { mockOwner.options = options; records.owners.push(options); return mockOwner; },
    pageResourceBudget: {
      update(owner, amount) { ledger.set(owner, amount); records.accounts.push({ owner: owner.description, amount }); },
      release(owner) { ledger.delete(owner); records.releases.push(owner.description); },
    },
    withRenderTarget,
    prepareTargetContext(context, transform, value) {
      assert.equal(target, context); records.targets.push({ context, transform: { ...transform }, layout: value }); return transform.k;
    },
    getPhysicalLayerRenderOwner: () => ({ drawPhysicalBasePass(k, options) {
      assert.equal(target, records.targets.at(-1).context);
      records.atlas.push({ context: target, k, options });
      if (environment.failDraw) throw new Error("native draw failed");
    } }),
    recordRenderPerfMetric: (...args) => records.events.push(["metric", ...args]), nowMs: () => 1,
    requestRendererRender: (...args) => records.requests.push(args), console: { warn() {} },
    exactCompositeReuseOwner: { invalidate() {} },
    getRenderCacheOwner: () => ({ syncSurfaceResourceAccounting() { records.events.push("sync-surfaces"); }, releaseInactivePassSurfaces: () => false }),
    getRenderPassCacheHostOwner: () => ({ prepareRenderPassHost({ passName, transform, drawFn, onHostReady }) {
      records.events.push("native-host"); onHostReady?.();
      withRenderTarget(cache.canvases[passName].context, () => drawFn(transform.k)); return { skipped: false };
    } }),
    getRenderPassCommitAccountingOwner: () => ({ commitRenderPass(value) {
      records.events.push("commit"); cache.dirty[value.passName] = false;
      records.commits.push(value); return { committed: true };
    } }),
    tnoRasterSceneOwner: { notePassCommit: pass => records.events.push(["scene-commit", pass]), clear() {}, dispose() {} },
    politicalIdRasterRuntimeOwner: { dispose() {} },
    getActiveRenderPassNames: () => environment.activePasses,
    politicalBackgroundRenderOwner: null, labelDrawSnapshotOwner: { clear() {} }, navigationSceneOwner: null,
    invalidateInteractionComposite() {}, clearLastGoodFrame() {}, invalidateRenderPasses() {},
    publishPoliticalIdRasterStatus() {}, getPoliticalIdRasterDiagnostics: () => ({}),
  };
  // Test renderer integration at the owner/platform boundary. LRU admission,
  // eviction and stale-job validation are covered by the owner's own tests.
  const implementation = [
    section("let physicalViewportCacheOwner = null;", "function prepareScenarioBorderPaths("),
    section("function renderPassToCache(", "function resetCanvasContext("),
    section("function resetPoliticalRasterPolicy()", "function isTnoRasterSceneSelected()"),
    section("function reconcileRenderFrameResources()", "function drawCanvas()"),
  ].join("\n");
  const api = new Function(...Object.keys(dependencies),
    'let previousRenderSceneKey = "", previousActiveRenderPassSignature = "", navigationExactRefreshNeeded = false;\n'
    + 'let tnoRasterSceneFailure = "", politicalPassUsesDirectScene = false, politicalIdRasterActivationKey = "";\n'
    + implementation + '\nreturn { prepare: preparePhysicalCanvasPass, render: renderPassToCache,\n'
    + 'snapshot: readPhysicalViewportSnapshot, key: physicalCanvasKey, identity: physicalCanvasIdentity,\n'
    + 'owner: getPhysicalViewportCacheOwner, pendingBytes: getPhysicalCandidateBytes,\n'
    + 'resetPolicy: resetPoliticalRasterPolicy, reconcile: reconcileRenderFrameResources,\n'
    + 'setExport(value) { exportRenderInProgress = value; },\n'
    + 'setBorderPending(bytes) { borderCanvasPreparationOwner = { getPendingBytes: () => bytes, clear() {} }; } };'
  )(...Object.values(dependencies));
  api.reconcile();
  const render = () => api.render("physicalBase", k => records.native.push({ context: target, k }), { ...state.zoomTransform }, {});
  return { api, records, state, environment, viewport, cache, mask, projectionValues, projection, ledger, mockOwner, canvas, layout, render, target: () => target };
}

test("draw never creates or prepares an owner and preparation forwards its one cached owner", () => {
  const h = harness(); h.render();
  assert.equal(h.records.owners.length, 0); assert.equal(h.records.preparations.length, 0);
  assert.equal(h.records.native.length, 1);
  const result = {}; h.mockOwner.result = result;
  assert.equal(h.api.prepare(), result); assert.equal(h.api.prepare(), result);
  assert.equal(h.records.owners.length, 1); assert.equal(h.records.preparations.length, 2);
  assert.equal(h.records.preparations[0].atlasCollection, h.state.physicalSemanticsData);
});

test("snapshot isolates exact camera/layout keys from source identity and copies the camera", () => {
  const h = harness(), original = h.api.snapshot();
  assert.equal(original.sourceKey, h.api.identity()); assert.equal(original.key, h.api.key());
  h.state.zoomTransform.x++; const camera = h.api.snapshot();
  assert.notEqual(camera.key, original.key); assert.equal(camera.sourceKey, original.sourceKey);
  assert.deepEqual(original.reference, { k: 1, x: 12, y: 23 });
  for (const mutation of [
    h => { h.state.zoomTransform.y++; }, h => { h.state.zoomTransform.k = 2.5; },
    h => { h.environment.layout.offsetX = 20; }, h => { h.environment.layout.offsetY = 30; },
    h => { h.environment.layout.logicalWidth = 350; }, h => { h.environment.layout.logicalHeight = 250; },
    h => { h.environment.layout.paddedWidth = 450; }, h => { h.environment.layout.paddedHeight = 350; },
    h => { h.environment.layout.pixelWidth = 900; }, h => { h.environment.layout.pixelHeight = 700; },
    h => { h.state.width = 450; }, h => { h.state.height = 350; },
  ]) {
    const current = harness(), before = current.api.snapshot(); mutation(current);
    assert.notEqual(current.api.snapshot().key, before.key);
    assert.equal(current.api.snapshot().sourceKey, before.sourceKey);
  }
});

test("source identity invalidates projection, geometry, collection, style and atlas LOD changes", () => {
  const mutations = [
    h => { h.state.sceneGeneration++; }, h => { h.state.currentScenarioApplyRequestId++; },
    h => { h.state.dpr = 1; }, h => { h.environment.projectionGeneration++; },
    h => { h.environment.projection = { ...h.projection }; },
    h => { h.mask.maskSource = "replacement"; }, h => { h.mask.maskQualityToken = "new"; },
    h => { h.mask.collection = { features: [{ id: "replacement" }] }; }, h => { h.mask.collection.features = [...h.mask.collection.features]; },
    h => { h.mask.collection.features.push({ id: "extra" }); }, h => { h.environment.politicalRevision++; },
    h => { h.state.contextLayerRevision++; }, h => { h.state.scenarioContextLandMaskVersionTag = "new"; },
    h => { h.state.scenarioLandMaskVersionTag = "new"; }, h => { h.state.styleConfig.physical.opacity = 0.5; },
    h => { h.state.physicalSemanticsData = { features: [{ id: "new" }] }; },
    h => { h.state.physicalSemanticsData.features = [...h.state.physicalSemanticsData.features]; },
    h => { h.state.intensityFields.channels.physicalAtlas.revision = 1; }, h => { h.state.zoomTransform.k = 4; },
    h => { const previous = h.state.contextLayerRevision++; recordContextLayerPublication(h.state, previous, [h.mask.collection]); },
    h => { const previous = h.state.contextLayerRevision++; recordContextLayerPublication(h.state, previous, [h.state.physicalSemanticsData]); },
  ];
  for (const [name, value] of Object.entries({ scale: 2, translate: [1, 2], center: [1, 0], rotate: [0, 1, 0], angle: 1,
    reflectX: true, reflectY: true, precision: 0.2, clipAngle: 1, clipExtent: [[0, 0], [1, 1]], parallels: [1, 2], preclip: () => {}, postclip: () => {} })) {
    mutations.push(h => { h.projectionValues[name] = value; });
  }
  for (const mutation of mutations) {
    const h = harness(), before = h.api.snapshot(); mutation(h); const after = h.api.snapshot();
    assert.notEqual(after.sourceKey, before.sourceKey); assert.notEqual(after.key, before.key);
    assert.equal(after.atlasCollection, resolvePhysicalAtlasCollection(h.state));
  }
});

test("known unrelated context publication and disabled grid payloads do not pollute physical identity", () => {
  const h = harness(); let payloadReads = 0;
  const rejectRead = () => { payloadReads++; throw new Error("Do not inspect disabled grid payloads"); };
  const channel = h.state.intensityFields.channels.physicalAtlas;
  channel.grid = new Proxy({}, { ownKeys: rejectRead, get: rejectRead }); channel.toJSON = rejectRead;
  const before = h.api.snapshot(), previous = h.state.contextLayerRevision++;
  recordContextLayerPublication(h.state, previous, [{ features: [{ id: "water-only" }] }]);
  assert.deepEqual(h.api.snapshot(), before); assert.equal(payloadReads, 0);
});

test("native private draw uses the exact snapshot synchronously and restores the target even on failure", async () => {
  const h = harness(); h.environment.layout = { offsetX: 37, offsetY: 43, paddedWidth: 474, paddedHeight: 386, pixelWidth: 948, pixelHeight: 772 };
  const snapshot = h.api.snapshot(), options = h.api.owner().options, surface = h.canvas("candidate", 948, 772);
  const originalTarget = h.target();
  assert.equal(options.draw(surface.context, snapshot), undefined, "draw cannot hold the global target across an await");
  assert.equal(h.target(), originalTarget); await Promise.resolve(); assert.equal(h.target(), originalTarget);
  assert.deepEqual(h.records.targets, [{ context: surface.context, transform: snapshot.reference, layout: snapshot.layout }]);
  assert.deepEqual(h.records.atlas, [{ context: surface.context, k: 1, options: { atlasCollection: snapshot.atlasCollection } }]);
  h.environment.failDraw = true;
  assert.throws(() => options.draw(surface.context, snapshot), /native draw failed/); assert.equal(h.target(), originalTarget);
});

test("ready adoption commits atomically and resizes the old backing only when the owner does not retain it", () => {
  for (const retained of [false, true]) {
    const h = harness(), surface = h.canvas("ready", 800, 600), job = { canvas: surface };
    h.api.owner(); h.mockOwner.ready = job; h.mockOwner.retained = retained; h.records.events.length = 0;
    h.render();
    assert.equal(h.cache.canvases.physicalBase, surface); assert.equal(h.cache.dirty.physicalBase, false);
    assert.deepEqual(h.mockOwner.lastCommit, { job, previous: h.viewport });
    assert.deepEqual(h.records.events, ["take-ready", "sync-surfaces", "commit", "note-committed", ["scene-commit", "physicalBase"]]);
    assert.deepEqual([h.viewport.width, h.viewport.height], retained ? [800, 600] : [1, 1]);
    assert.equal(h.records.native.length, 0); assert.equal(h.records.preparations.length, 0);
  }
});

test("a ready canvas already used as the pass backing is never shrunk", () => {
  const h = harness(); h.api.owner(); h.mockOwner.ready = { canvas: h.viewport }; h.render();
  assert.equal(h.cache.canvases.physicalBase, h.viewport);
  assert.deepEqual([h.viewport.width, h.viewport.height], [800, 600]);
});

test("when the owner returns no ready work the renderer draws native without taking ownership", () => {
  const h = harness(); h.api.owner(); h.render();
  assert.equal(h.cache.canvases.physicalBase, h.viewport); assert.equal(h.records.native.length, 1);
  assert.equal(h.mockOwner.lastCommit, undefined); assert.equal(h.records.preparations.length, 0);
});

test("native fallback notifies the owner of the current backing before drawing into it", () => {
  const h = harness(), fallback = h.canvas("native-fallback", 800, 600);
  h.api.owner(); h.cache.canvases.physicalBase = fallback; h.records.events.length = 0;
  h.render();
  assert.equal(h.mockOwner.lastNativeCanvas, fallback, "failed-key fallback invalidates the actual backing rather than a former cached canvas");
  assert.deepEqual(h.records.events, ["take-ready", ["native-draw", fallback], "native-host", "commit", ["scene-commit", "physicalBase"]]);
  assert.equal(h.records.native[0].context, fallback.context);
  assert.equal(h.mockOwner.lastCommit, undefined);
  assert.deepEqual([fallback.width, fallback.height], [800, 600]);
});

test("export never prepares or takes a ready viewport and ordinary rendering can adopt it afterwards", () => {
  const h = harness(), job = { canvas: h.canvas("ready", 800, 600) };
  h.api.owner(); h.mockOwner.ready = job; h.api.setExport(true); h.records.events.length = 0;
  assert.equal(h.api.prepare(), null); assert.equal(h.api.snapshot(), null); h.render();
  assert.equal(h.records.preparations.length, 0); assert.equal(h.mockOwner.ready, job);
  assert.equal(h.records.events.includes("take-ready"), false);
  assert.equal(h.mockOwner.lastNativeCanvas, undefined, "export drawing must not invalidate ordinary viewport LRU entries");
  assert.equal(h.records.native.length, 1); assert.equal(h.cache.canvases.physicalBase, h.viewport);
  h.api.setExport(false); h.render(); assert.equal(h.cache.canvases.physicalBase, job.canvas);
});

test("unsupported mode, visibility, intensity and missing atlas deny snapshot admission", () => {
  for (const mutation of [h => { h.environment.selected = false; }, h => { h.state.activeScenarioId = "other"; },
    h => { h.state.showPhysical = false; }, h => { h.state.intensityFields.channels.physicalAtlas.enabled = true; },
    h => { h.state.physicalSemanticsData = null; }, h => { h.state.physicalSemanticsData.features = []; }]) {
    const h = harness(); mutation(h); assert.equal(h.api.snapshot(), null);
    h.api.prepare(); assert.equal(h.records.preparations[0], null, "owner receives null and owns cleanup");
  }
});

test("scene, projection, mode, active-pass and policy resets clear the owner without resizing the live pass", () => {
  for (const transition of [h => { h.state.sceneGeneration++; h.api.reconcile(); },
    h => { h.environment.projectionGeneration++; h.api.reconcile(); },
    h => { h.environment.selected = false; h.api.reconcile(); },
    h => { h.environment.activePasses = []; h.api.reconcile(); }, h => h.api.resetPolicy()]) {
    const h = harness(); h.api.owner(); transition(h);
    assert.ok(h.mockOwner.clearCount > 0);
    assert.equal(h.cache.canvases.physicalBase, h.viewport); assert.deepEqual([h.viewport.width, h.viewport.height], [800, 600]);
  }
});

test("owner callbacks account physical bitmaps, share admission with borders and request rendering", () => {
  const h = harness(), options = h.api.owner().options;
  h.api.setBorderPending(12); assert.equal(options.canAllocate(80 * 1024 * 1024 - 12), true);
  assert.equal(options.canAllocate(80 * 1024 * 1024 - 11), false);
  h.mockOwner.pendingBytes = 1920000; assert.equal(h.api.pendingBytes(), 1920000);
  options.onResource(1920000); assert.deepEqual([...h.ledger.values()], [{ bitmaps: 1920000, gpuTextures: 0 }]);
  options.onResource(0); assert.equal(h.ledger.size, 0); assert.deepEqual(h.records.releases, ["physical-canvas-candidate"]);
  options.onReady(); assert.deepEqual(h.records.requests, [["physical-viewport-prepared", { flush: false }]]);
  const stats = { totalMs: 2 }; options.onStats(stats);
  assert.deepEqual(h.records.events.at(-1), ["metric", "physicalCanvasPreparation", 2, stats]);
});
