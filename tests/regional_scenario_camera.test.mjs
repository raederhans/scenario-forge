import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { applyGlobalScenarioOpeningView, applyScenarioOpeningView } from "../js/core/scenario/presentation_opening_view.js";
import { createSetMapDataTransactionOwner } from "../js/core/map_renderer/set_map_data_transaction_owner.js";
import { createScenarioRefreshRuntime } from "../js/core/map_renderer/scenario_refresh_runtime.js";
import { createRendererProjectionPathOwner } from "../js/core/renderer/renderer_projection_path_owner.js";
import { createRendererFitProjectionOwner } from "../js/core/renderer/renderer_fit_projection_owner.js";
import { createRendererSurfaceHost } from "../js/core/renderer/renderer_surface_host.js";
import { createViewportCommandOwner } from "../js/core/renderer/viewport_command_owner.js";
import { createViewportReadModelOwner } from "../js/core/renderer/viewport_read_model_owner.js";
import { createZoomInteractionLifecycleOwner } from "../js/core/renderer/zoom_interaction_lifecycle_owner.js";
import { createNavigationSceneOwner } from "../js/core/renderer/navigation_scene_owner.js";
import { createGeometryRasterRuntimeOwner } from "../js/core/renderer/geometry_raster_runtime_owner.js";
import { createGeometryRasterProjection } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import { getProjectionGeometryGeneration } from "../js/core/renderer/projection_geometry_identity.js";
import { createPoliticalIdRasterCoordinateSpace } from "../js/core/renderer/political_id_raster_coordinates.js";
import { createProjectionInverseParams, invertProjectedPoint } from "../js/core/renderer/bathymetry_texture_math.js";
import { createMapExportCanvas } from "../js/core/renderer/regional_camera.js";
import { createCachedPassCompositorOwner } from "../js/core/renderer/cached_pass_compositor_owner.js";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");
const manifest = { region: { bounds: [15.79, 32.75, -169.74, 81.86], central_meridian: 90 },
  opening_view: { bounds: [18, 36, 112, 72] } };
const dateline = [175, 58, -172, 69];
const points = [[-175, 66], [37.6, 55.75]];
const noop = () => {};
const effects = (names) => Object.fromEntries(names.split(" ").map(name => [name, noop]));
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }
function nearPoint(a, b) { a.forEach((v, i) => near(v, b[i])); }

function fixture(width = 1000, height = 560) {
  const land = { type: "FeatureCollection", features: points.map((coordinates, id) => ({
    type: "Feature", id: String(id), geometry: { type: "Point", coordinates },
  })) };
  const state = { width, height, dpr: 1, landData: land, landDataFull: land, zoomTransform: d3.zoomIdentity };
  const surface = createRendererSurfaceHost({ handles: { context: {}, hitContext: {}, hitCanvas: { width, height } } });
  const paths = createRendererProjectionPathOwner({ surfaceHost: surface, getters: { getD3: () => d3 },
    constants: { projectionPrecision: 0.1, pathPointRadius: 4.5 } }).initializeProjectionPaths();
  const projection = paths.projection;
  const fit = createRendererFitProjectionOwner({ surfaceHost: surface, state,
    constants: { projectionFitPaddingRatio: 0.04 },
    getters: { getLogicalCanvasDimensions: () => [state.width, state.height], getRenderableLandFeatures: () => land.features },
    effects: { ...effects("resetCityAnchorCache rebuildProjectedBoundsCache buildSpatialIndex setHitCanvasDirty updateSpecialZonesPaths renderSpecialZoneEditorOverlay markAllOverlaysDirty"),
      updateZoomTranslateExtent: () => commands.updateZoomTranslateExtent() },
  });
  const read = createViewportReadModelOwner({
    getters: { getViewportDimensions: () => state },
    capabilities: { getRegionalBounds: fit.getRegionalBounds, invertProjectionPoint: projection.invert,
      getProjectionSnapshot: () => ({ scale: projection.scale(), translate: projection.translate(), rotate: projection.rotate() }),
      getZoomTransformSnapshot: () => state.zoomTransform },
  });
  const node = new EventTarget();
  node.getBoundingClientRect = () => ({ left: 0, top: 0 });
  node.clientLeft = node.clientTop = 0;
  const rect = d3.select(node);
  const ports = { getD3: () => d3, getInteractionRect: () => rect, getZoomBehavior: surface.getZoomBehavior };
  const setTransform = transform => { state.zoomTransform = transform; };
  const commands = createViewportCommandOwner({ state, getters: { ...ports, getRegionalBounds: fit.getRegionalBounds,
    calculatePanExtent: read.calculatePanExtent }, effects: { setZoomTransform: setTransform } });
  const gestures = createZoomInteractionLifecycleOwner({ state, getters: { ...ports,
    getD3: () => ({ ...d3, zoom: () => d3.zoom().touchable(false) }), getWidth: () => state.width,
    getHeight: () => state.height, getZoomTransform: () => state.zoomTransform },
    helpers: { constrainCamera: commands.constrainCamera, requestAnimationFrame: noop },
    effects: { updateMap: setTransform, setZoomBehavior: surface.setZoomBehavior,
      updateZoomTranslateExtent: commands.updateZoomTranslateExtent, resetZoomToFit: commands.resetZoomToFit },
  });
  const zoom = gestures.initZoom();
  const refresh = createScenarioRefreshRuntime({ runtimeState: state,
    ...effects("resetRendererTransactionState rebuildPrimaryPoliticalDerivedState clearLastGoodFrame invalidateInteractionComposite resetFirstVisibleFramePainted invalidateRenderPasses clearRenderPassReferenceTransforms markAllOverlaysDirty rebuildStaticMeshes invalidateBorderCache updateDynamicBorderStatusUI updateSpecialZonesPaths renderSpecialZoneEditorOverlay resetScenarioWaterCacheAdaptiveState scheduleSecondarySpatialIndexBuild recordRenderPerfMetric"),
    render: noop, nowMs: () => 0, getEffectiveAtlantropaFeatures: () => ({ water: [] }), needsScenarioRefit: fit.needsScenarioRefit,
    fitProjection: fit.fitProjection, resetZoomToFit: commands.resetZoomToFit, updateZoomTranslateExtent: commands.updateZoomTranslateExtent,
  });
  function activate(next, applyOpeningView = null) {
    state.activeScenarioManifest = next;
    refresh.refreshMapDataForScenarioApply({ suppressRender: true, applyOpeningView });
  }
  function open(next) {
    return applyScenarioOpeningView(next, { resetZoomToFit: commands.resetZoomToFit,
      focusGeoBounds: (bounds, options) => commands.focusRegionalGeoBounds(projection, bounds, options) });
  }
  function screen(point) { return state.zoomTransform.apply(projection(point)); }
  return { state, paths, projection, surface, read, fit, commands, zoom, rect, activate, open, screen };
}

function assertBoxVisible(f, [west, south, east, north]) {
  const end = east < west ? east + 360 : east;
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 8; j++) {
      const [x, y] = f.screen([west + i * (end - west) / 12, south + j * (north - south) / 8]);
      assert.ok(x >= -1e-7 && x <= f.state.width + 1e-7 && y >= -1e-7 && y <= f.state.height + 1e-7, `outside: ${x},${y}`);
    }
  }
}

for (const [width, height] of [[1440, 440], [440, 900]]) {
  test(`region fits, centers, and bounds every camera command at ${width} x ${height}`, () => {
    const f = fixture(width, height);
    f.activate(manifest);
    const [[x0, y0], [x1, y1]] = f.fit.getRegionalBounds();
    near(Math.max((x1 - x0) / width, (y1 - y0) / height), 1);
    near(x0 + x1, width);
    near(y0 + y1, height);
    assertBoxVisible(f, manifest.region.bounds);
    assert.deepEqual(f.zoom.scaleExtent(), [1, 50]);
    f.commands.setZoomPercent(1);
    f.commands.zoomByStep(-1);
    f.rect.call(f.zoom.scaleBy, 0.1);
    assert.equal(f.state.zoomTransform.k, 1);
    f.commands.setZoomPercent(1200);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      f.rect.call(f.zoom.translateBy, dx * 1e6, dy * 1e6);
      const transform = f.state.zoomTransform;
      const a = transform.apply([x0, y0]), b = transform.apply([x1, y1]);
      for (const [start, end, size, direction] of [[a[0], b[0], width, dx], [a[1], b[1], height, dy]]) {
        if (end - start < size) near(start + end, size);
        else near(direction > 0 ? start : end - size, direction * 12);
      }
    }
    for (const k of [0.01, 500]) {
      f.rect.call(f.zoom.transform, d3.zoomIdentity.translate(1e6, -1e6).scale(k));
      const transform = f.state.zoomTransform;
      assert.equal(transform.k, k < 1 ? 1 : 50);
      assert.deepEqual(d3.zoomTransform(f.rect.node()), transform);
      if (k < 1) assertBoxVisible(f, manifest.region.bounds);
      else {
        near(transform.applyX(x0), 12);
        near(transform.applyY(y1), height - 12);
      }
    }
    f.commands.resetZoomToFit();
    assertBoxVisible(f, manifest.region.bounds);
    Object.assign(f.state, { width: height, height: width });
    f.fit.fitProjection();
    f.commands.resetZoomToFit();
    assertBoxVisible(f, manifest.region.bounds);
  });
}

test("opening and wrapped boxes focus inside the fitted region on startup and scenario switch", () => {
  for (const switching of [false, true]) {
    const f = fixture();
    if (switching) {
      f.fit.fitProjection();
      f.commands.setZoomPercent(400);
    }
    f.activate(manifest, () => f.open(manifest));
    assert.ok(f.state.zoomTransform.k > 1);
    assertBoxVisible(f, manifest.opening_view.bounds);
    const before = getProjectionGeometryGeneration(f.projection);
    const view = f.state.zoomTransform;
    f.activate(structuredClone(manifest));
    assert.equal(getProjectionGeometryGeneration(f.projection), before);
    assert.deepEqual(f.state.zoomTransform, view);
    f.open({ ...manifest, opening_view: { bounds: dateline } });
    assertBoxVisible(f, dateline);
    const [west, , east] = f.read.getViewportGeoBounds();
    assert.ok(west > east, `${west} .. ${east}`);
    assert.ok(Math.abs(f.screen([179.99, 66])[0] - f.screen([-179.99, 66])[0]) < 5);
    f.open({ region: manifest.region });
    assert.equal(f.state.zoomTransform.k, 1);
    assertBoxVisible(f, manifest.region.bounds);
    for (const bounds of [[10, 2, 10, 5], [181, 1, 2, 4], [1, 1, -181, 4], [1, 3, 2, 0], [1, 2, NaN, 3]]) {
      assert.equal(f.open({ ...manifest, opening_view: { bounds } }), undefined);
    }
  }
});

test("focus contains the widest latitude along a wrapped box and native wheel stops at fit", async () => {
  const f = fixture(500, 1100);
  const equatorial = { region: { bounds: [110, -65, -150, 65], central_meridian: 150 },
    opening_view: { bounds: [168, -35, -152, 35] } };
  f.activate(equatorial, () => f.open(equatorial));
  assert.ok(f.state.zoomTransform.k > 1);
  assertBoxVisible(f, equatorial.opening_view.bounds);
  const end = new Promise(resolve => f.zoom.on("end.test", resolve));
  f.rect.node().dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), {
    deltaY: 10000, deltaMode: 0, clientX: 200, clientY: 500,
  }));
  await end;
  assert.equal(f.state.zoomTransform.k, 1);
  assertBoxVisible(f, equatorial.region.bounds);
});

test("shared paths, hit worker, depth, raster signature and regional navigation follow projection changes", async t => {
  const oldD3 = globalThis.d3, oldTopojson = globalThis.topojson;
  Object.assign(globalThis, { d3, topojson });
  t.after(() => {
    if (oldD3) globalThis.d3 = oldD3; else delete globalThis.d3;
    if (oldTopojson) globalThis.topojson = oldTopojson; else delete globalThis.topojson;
  });
  const f = fixture();
  f.fit.fitProjection();
  Object.assign(f.state, { firstVisibleFramePainted: true, hitCanvasDirty: true, idToKey: new Map([["0", 1]]) });
  let request, finish, commits = 0, closed = 0;
  const worker = createGeometryRasterRuntimeOwner({ state: f.state, surface: f.surface,
    client: { available: () => true, dispose: noop, request: packet => {
      request = packet;
      return new Promise(resolve => { finish = () => resolve({ bitmap: { close() { closed++; } } }); });
    } },
    helpers: { isEnabled: () => true, excludeHit: () => false, keyToColor: () => "#000001",
      collectHitItems: () => ({ items: [{ id: "0", feature: f.state.landData.features[0] }] }) },
    effects: { commitHit: () => commits++, recordMetric: noop, requestRender: noop },
  });
  t.after(worker.dispose);
  worker.requestHit();
  const worldPoints = points.map(f.projection);
  const worldOptions = request.projectionOptions;
  const worldSignature = f.read.getProjectionRenderSignature();
  const rasterSignature = options => createPoliticalIdRasterCoordinateSpace(options).signature;
  f.activate(manifest);
  finish();
  await new Promise(setImmediate);
  assert.equal(commits, 0);
  assert.equal(closed, 1);
  assert.deepEqual(f.projection.rotate(), [-90, 0, 0]);
  assert.notEqual(f.read.getProjectionRenderSignature(), worldSignature);
  worker.requestHit();
  const rotatedWorker = createGeometryRasterProjection(d3, request.projectionOptions);
  assert.notEqual(rasterSignature(request.projectionOptions), rasterSignature(worldOptions));
  Object.assign(f.state, { activeScenarioId: "region", topologyPrimary: { type: "Topology", arcs: [],
    objects: { land: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [19, 42] }] } } } });
  let frame, navRequest;
  const navigation = createNavigationSceneOwner(f.state, { surface: f.surface,
    createFrameOwner: () => ({ prepare: spec => { frame = spec; }, isReady: () => false, clear: noop }),
    createWorkerClient: () => ({ available: () => true, dispose: noop, request: packet => { navRequest = packet; } }),
    helpers: { recordMetric: noop, getOceanBaseFillColor: () => "#003344", getFeatureId: feature => feature.id,
      getEffectiveAtlantropaFeatures: () => ({ land: [], shoal: [], relief: [] }), getEffectiveWaterRegionFeatures: () => [],
      isBaseGeographyScenarioFeature: () => false, shouldExcludePoliticalVisualFeature: () => false,
      getResolvedFeatureColor: () => "#cc0000", ensureNavigationSources: () => assert.fail("regional navigation requested chunks") },
    yieldTask: noop,
  });
  t.after(navigation.dispose);
  navigation.prewarm();
  frame.bounds.forEach((p, i) => nearPoint(p, f.fit.getRegionalBounds()[i]));
  await frame.renderRaster({ width: 400, height: 200, bounds: frame.bounds, signal: new AbortController().signal });
  assert.deepEqual(navRequest.entries.map(entry => entry.fillColor), ["#003344", "#b9b7b2", "#cc0000", "#cc0000"]);
  const colors = [];
  const context = { beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, closePath: noop, fill() { colors.push(this.fillStyle); } };
  for (const layer of frame.layers) for (const item of layer.items) layer.drawItem(context, item);
  assert.deepEqual(colors, navRequest.entries.map(entry => entry.fillColor));
  const navProjection = createGeometryRasterProjection(d3, navRequest.projectionOptions);
  const inverse = createProjectionInverseParams(f.projection);
  for (const point of points) {
    const screen = f.projection(point);
    for (const path of [f.paths.pathCanvas, f.paths.pathHitCanvas, f.paths.pathSvg]) {
      assert.equal(path.projection(), f.projection);
    }
    nearPoint(rotatedWorker(point), screen);
    nearPoint(navProjection(point), screen);
    nearPoint(invertProjectedPoint(inverse, ...screen), point);
  }
  f.activate(null);
  finish();
  await new Promise(setImmediate);
  assert.equal(commits, 0);
  assert.equal(closed, 2);
  worker.requestHit();
  assert.deepEqual(request.projectionOptions, worldOptions);
  assert.equal(f.read.getProjectionRenderSignature(), worldSignature);
  assert.equal(rasterSignature(request.projectionOptions), rasterSignature(worldOptions));
  points.forEach((point, i) => nearPoint(f.projection(point), worldPoints[i]));
  assert.deepEqual(f.zoom.scaleExtent(), [0.35, 50]);
  finish();
  await new Promise(setImmediate);
  assert.equal(commits, 1);
  f.commands.setZoomPercent(35);
  near(f.state.zoomTransform.k, 0.35);
});

test("global camera and opening behavior persist through full refresh, clear and rollback", () => {
  const f = fixture();
  f.fit.fitProjection();
  const original = f.read.getProjectionRenderSignature();
  f.projection.rotate([-90, 0, 0]);
  assert.notEqual(f.read.getProjectionRenderSignature(), original);
  f.projection.rotate([0, 0, 0]);
  const transaction = createSetMapDataTransactionOwner({
    getters: { ...effects("nowMs getActiveScenarioId getLandFeatureCount getRenderProfile"),
      needsScenarioRefit: f.fit.needsScenarioRefit },
    effects: new Proxy({ fitProjection: f.fit.fitProjection, enforceZoomConstraints: f.commands.enforceZoomConstraints },
      { get: (target, key) => target[key] ?? noop }),
  });
  const refresh = () => transaction.runSetMapDataTransaction({ refitProjection: false, resetZoom: false, suppressRender: true });
  const layers = ["setMapCanvas", "setMapSvg", "setPoliticalPatchCanvas", "setInteractionOverlayCanvas"]
    .map(set => f.surface[set]({ style: {} }));
  const container = f.surface.setMapContainer({ style: {} });
  f.state.activeScenarioManifest = manifest;
  refresh();
  f.fit.syncRegionalFrameClip(f.state.zoomTransform);
  assert.ok(layers.every(layer => /^inset\(/.test(layer.style.clipPath)));
  assert.equal(container.style.backgroundColor, "#b9b7b2");
  f.state.activeScenarioManifest = null;
  refresh();
  assert.equal(f.read.getProjectionRenderSignature(), original);
  f.fit.syncRegionalFrameClip(f.state.zoomTransform);
  assert.ok(layers.every(layer => layer.style.clipPath === ""));
  assert.equal(container.style.backgroundColor, "");
  const generation = getProjectionGeometryGeneration(f.projection);
  for (const id of ["blank_base", "modern_world", "tno_1962", "hoi4_1936", "hoi4_1939"]) {
    const globalManifest = require(`../data/scenarios/${id}/manifest.json`);
    f.activate(globalManifest);
    assert.equal(getProjectionGeometryGeneration(f.projection), generation);
    assert.equal(f.read.getProjectionRenderSignature(), original);
    const [west, , east] = f.read.getViewportGeoBounds();
    assert.ok(west <= east);
    const commands = [];
    applyGlobalScenarioOpeningView(globalManifest, {
      focusGeoBounds: bounds => commands.push(bounds), resetZoomToFit: () => commands.push("fit"),
    });
    assert.deepEqual(commands, [globalManifest.opening_view?.bounds || "fit"]);
  }
  assert.equal(applyGlobalScenarioOpeningView(manifest, { focusGeoBounds: assert.fail }), undefined);
  f.state.activeScenarioManifest = manifest;
  refresh();
  const before = getProjectionGeometryGeneration(f.projection);
  refresh();
  assert.equal(getProjectionGeometryGeneration(f.projection), before);
  f.state.activeScenarioManifest = { region: { ...manifest.region, bounds: dateline } };
  refresh();
  assert.notEqual(getProjectionGeometryGeneration(f.projection), before);
  assertBoxVisible(f, dateline);
});

function recordingExportCanvas() {
  let path, clip = null;
  const stack = [], draws = [];
  const ctx = {
    save() { stack.push([clip, this.fillStyle]); },
    restore() { [clip, this.fillStyle] = stack.pop(); },
    beginPath() { path = null; },
    rect(...rect) { path = rect; },
    clip() { clip = path; },
    fillRect(...rect) { draws.push({ kind: "fill", color: this.fillStyle, rect, clip }); },
    clearRect(...rect) { draws.push({ kind: "clear", rect, clip }); },
    drawImage(image) { draws.push({ kind: "image", image, clip, filter: this.filter }); },
    setTransform: noop, measureText: () => ({ width: 60 }),
    fillText() { draws.push({ kind: "text", clip }); },
  };
  return { draws, getContext: () => ctx };
}

test("regional export frame clips cached passes, target-resolution passes and subsequent overlay draws", async () => {
  const f = fixture(440, 900);
  const { state } = f;
  const document = { createElement: recordingExportCanvas };
  const ocean = "#19568b";
  const getExportFrame = () => f.fit.getExportFrame(() => ocean);
  const passes = { background: { id: "background" }, labels: { id: "labels" } };
  const compositor = createCachedPassCompositorOwner({
    constants: { renderPassNames: Object.keys(passes) },
    getters: {
      getActiveTargetContext: noop, getRenderPhase: () => "idle", isRenderDiagnosticsEnabled: () => false,
      getRenderPassCacheSnapshot: () => ({ canvases: passes }),
      getRenderPassLayout: () => ({ offsetX: 0, offsetY: 0 }),
      getPassReferenceTransform: () => state.zoomTransform, getDpr: () => state.dpr,
    },
    helpers: { cloneZoomTransform: t => t, areZoomTransformsEquivalent: (a, b) => a === b },
    effects: { recordTransformedPassDiagnostics: noop },
  });
  const runtime = createExportBakeRuntime({
    state, document, getExportFrame, renderPassNames: Object.keys(passes),
    ...effects("ensureScenarioPoliticalDetailForExport ensurePaintContoursReady ensureCountryLabelsReadyForExport ensureBathymetryReadyForExport"),
    renderExportPassesToCanvas(names, { pixelRatio }) {
      const ratio = pixelRatio ?? state.dpr;
      const canvas = createMapExportCanvas(document, Math.round(state.width * ratio), Math.round(state.height * ratio), getExportFrame());
      const result = compositor.composeRenderPassesToTarget(canvas.getContext("2d"), names, state.zoomTransform,
        { requireAllPasses: pixelRatio !== undefined });
      assert.equal(result.ok, true);
      return canvas;
    },
  });
  const ui = { textVisibility: { "render-labels": true }, adjustments: { brightness: 140 },
    mapTitles: { title: { enabled: true, text: "Russia", position: "top-center" } } };
  state.dpr = 1.5;
  for (const active of [manifest, null]) {
    f.activate(active);
    f.commands.setZoomPercent(125);
    f.rect.call(f.zoom.translateBy, 20, 5);
    function expectedClip(canvas) {
      if (!active) return null;
      const { bounds } = manifest.region;
      const [x0, y1] = f.screen([bounds[0], bounds[1]]);
      const [x1] = f.screen([bounds[2], bounds[1]]);
      const [, y0] = f.screen([bounds[0], bounds[3]]);
      const left = Math.round(x0 * canvas.width / state.width), top = Math.round(y0 * canvas.height / state.height);
      assert.ok(top > 0 && y1 < state.height);
      return [left, top, Math.round(x1 * canvas.width / state.width) - left, Math.round(y1 * canvas.height / state.height) - top];
    }
    const titleLayer = await runtime.buildSingleExportSourceCanvas(ui, "map-titles", { width: 440, height: 900, pixelRatio: 1 });
    assert.deepEqual(titleLayer.draws.at(-1), { kind: "text", clip: expectedClip(titleLayer) });
    for (const dimensions of [null, { pixelRatio: 3, width: 1320, height: 2700 }]) {
      const canvas = await runtime.buildCompositeSourceCanvas(ui, dimensions);
      const clip = expectedClip(canvas);
      const images = canvas.draws.filter(draw => draw.kind === "image");
      assert.deepEqual(images.map(draw => draw.image), Object.values(passes));
      assert.deepEqual(images.map(draw => draw.clip), [clip, clip]);
      assert.deepEqual(canvas.draws.at(-1), { kind: "text", clip });
      if (active) {
        assert.deepEqual(canvas.draws[0], { kind: "fill", color: ocean, rect: [0, 0, canvas.width, canvas.height], clip: null });
        assert.deepEqual(canvas.draws[1], { kind: "clear", rect: clip, clip });
      } else {
        assert.equal(canvas.draws[0].kind, "image");
      }
      const adjusted = runtime.applyExportAdjustmentsToCanvas(canvas, ui, { width: 330, height: 675 });
      assert.deepEqual(adjusted.draws.at(-1).clip, expectedClip(adjusted));
      assert.match(adjusted.draws.at(-1).filter, /brightness\(1\.400\)/);
      if (active) assert.equal(adjusted.draws[0].color, ocean);
      else assert.equal(adjusted.draws.length, 1);
    }
    if (active) {
      const clip = expectedClip(titleLayer);
      f.activate(null);
      const copy = runtime.applyExportAdjustmentsToCanvas(titleLayer, ui);
      assert.deepEqual(copy.draws.at(-1).clip, clip);
      assert.equal(copy.draws[0].color, ocean);
    }
  }
});
