import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { applyScenarioOpeningView } from "../js/core/scenario/presentation_opening_view.js";
import { createScenarioRefreshRuntime } from "../js/core/map_renderer/scenario_refresh_runtime.js";
import { createRendererProjectionPathOwner } from "../js/core/renderer/renderer_projection_path_owner.js";
import { createRendererFitProjectionOwner } from "../js/core/renderer/renderer_fit_projection_owner.js";
import { createRendererSurfaceHost } from "../js/core/renderer/renderer_surface_host.js";
import { createViewportCommandOwner } from "../js/core/renderer/viewport_command_owner.js";
import { createViewportReadModelOwner } from "../js/core/renderer/viewport_read_model_owner.js";
import { createZoomInteractionLifecycleOwner } from "../js/core/renderer/zoom_interaction_lifecycle_owner.js";
import { createMapExportCanvas } from "../js/core/renderer/regional_camera.js";
import { getRegionalBackgroundColor } from "../js/core/renderer/regional_backdrop.js";
import { createCachedPassCompositorOwner } from "../js/core/renderer/cached_pass_compositor_owner.js";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");

const manifest = { region: { bounds: [15.79, 32.75, -169.74, 81.86], central_meridian: 90 },
  opening_view: { bounds: [18, 36, 112, 72] } };

const points = [[-175, 66], [37.6, 55.75]];
const noop = () => {};
const effects = (names) => Object.fromEntries(names.split(" ").map(name => [name, noop]));
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }

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

test("region fits and centers in the viewport", () => {
  const width = 1440, height = 440;

  const f = fixture(width, height);
  f.activate(manifest);
  const [[x0, y0], [x1, y1]] = f.fit.getRegionalBounds();
  near(Math.max((x1 - x0) / width, (y1 - y0) / height), 1);
  near(x0 + x1, width);
  near(y0 + y1, height);
  assertBoxVisible(f, manifest.region.bounds);
});

test("focus contains the widest latitude along a wrapped box", () => {
  const f = fixture(500, 1100);
  const equatorial = { region: { bounds: [110, -65, -150, 65], central_meridian: 150 },
    opening_view: { bounds: [168, -35, -152, 35] } };
  f.activate(equatorial, () => f.open(equatorial));
  assert.ok(f.state.zoomTransform.k > 1);
  assertBoxVisible(f, equatorial.opening_view.bounds);
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

test("regional export frame clips passes at the target resolution", async () => {
  const f = fixture(440, 900);
  const { state } = f;
  const document = { createElement: recordingExportCanvas };
  const ocean = "#19568b";
  const getExportFrame = () => f.fit.getExportFrame(() => getRegionalBackgroundColor(state.activeScenarioManifest, ocean));
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
  f.activate(manifest);
  f.commands.setZoomPercent(125);
  f.rect.call(f.zoom.translateBy, 20, 5);
  function expectedClip(canvas) {
    const { bounds } = manifest.region;
    const [x0, y1] = f.screen([bounds[0], bounds[1]]);
    const [x1] = f.screen([bounds[2], bounds[1]]);
    const [, y0] = f.screen([bounds[0], bounds[3]]);
    const left = Math.round(x0 * canvas.width / state.width), top = Math.round(y0 * canvas.height / state.height);
    assert.ok(top > 0 && y1 < state.height);
    return [left, top, Math.round(x1 * canvas.width / state.width) - left, Math.round(y1 * canvas.height / state.height) - top];
  }
  const dimensions = { pixelRatio: 3, width: 1320, height: 2700 };

  const canvas = await runtime.buildCompositeSourceCanvas(ui, dimensions);
  const clip = expectedClip(canvas);
  const images = canvas.draws.filter(draw => draw.kind === "image");

  assert.deepEqual(images.map(draw => draw.clip), [clip, clip]);
});
