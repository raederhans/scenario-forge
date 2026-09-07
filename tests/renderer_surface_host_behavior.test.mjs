import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parse } from "acorn";

import {
  createRendererSurfaceHost,
  RENDERER_SURFACE_HANDLE_KEYS,
} from "../js/core/renderer/renderer_surface_host.js";
import * as passCatalog from "../js/core/map_renderer/render_pass_catalog.js";

// Exercise the actual composition functions without booting the map or invoking
// owner effects. Owner algorithms have their own behavior suites.
const rendererSource = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const rendererAst = parse(rendererSource, { ecmaVersion: "latest", sourceType: "module" });
function createOwnerWiringHarness(name, { dependencies = {}, includeFunctions = [] } = {}) {
  const scope = {};
  const noop = () => {};
  for (const node of rendererAst.body) {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type === "FunctionDeclaration") scope[declaration.id.name] = noop;
    for (const entry of declaration?.declarations || []) {
      if (entry.id.type === "Identifier") scope[entry.id.name] = null;
      if (entry.id.type === "ObjectPattern") {
        // Display-model methods are destructured at the composition root.
        for (const property of entry.id.properties) {
          assert.equal(property.value?.type, "Identifier", "owner method bindings use explicit names");
          scope[property.value.name] = noop;
        }
      }
    }
    for (const entry of node.type === "ImportDeclaration" ? node.specifiers : []) scope[entry.local.name] = noop;
  }
  const runtimeState = {};
  const handles = {};
  let reads = 0;
  const rendererSurfaceHost = {};
  for (const key of ["Context", "HitContext", "Projection", "PathSvg", "PathCanvas", "PathHitCanvas", "ZoomBehavior", "InteractionRect", "MapContainer", "MapSvg", "ViewportGroup", "Tooltip", "OperationalLinesGroup", "OperationGraphicsGroup", "UnitCountersGroup", "SpecialZonesGroup", "SpecialZoneEditorGroup"]) {
    rendererSurfaceHost[`get${key}`] = function () {
      assert.equal(this, rendererSurfaceHost, `get${key} must keep its host receiver`);
      reads++;
      return handles[key];
    };
  }
  const globals = {};
  for (const key of ["d3", "devicePixelRatio"]) {
    Object.defineProperty(globals, key, { configurable: true, get() { reads++; return undefined; } });
  }
  Object.assign(scope, passCatalog, {
    runtimeState, rendererSurfaceHost, globalThis: globals, window: undefined,
    MIN_ZOOM_SCALE: 1, MAX_ZOOM_SCALE: 16, PROJECTION_PRECISION: 0.25,
    PATH_POINT_RADIUS: 4.5, PROJECTION_FIT_PADDING_RATIO: 0.05, MAP_PAN_PADDING_PX: 24,
    RENDER_PHASE_IDLE: "idle", RENDER_PHASE_INTERACTING: "interacting", RENDER_PHASE_SETTLING: "settling",
    HIT_SNAP_RADIUS_HOVER_PX: 3, STAGED_HIT_CANVAS_TIMEOUT_MS: 100,
  });
  Object.assign(scope, dependencies);
  let constructions = 0;
  scope[`create${name}`] = (options) => { constructions++; return options; };
  const factory = rendererAst.body.find(node => node.type === "FunctionDeclaration" && node.id.name === `get${name}`);
  assert.ok(factory, `get${name} exists`);
  const extraSource = includeFunctions.map(functionName => {
    const node = rendererAst.body.find(entry => entry.type === "FunctionDeclaration" && entry.id.name === functionName);
    assert.ok(node, functionName);
    return rendererSource.slice(node.start, node.end);
  }).join("\n");
  const { getOwner, setWindow } = new Function(...Object.keys(scope), `${extraSource}\n${rendererSource.slice(factory.start, factory.end)}; return { getOwner: get${name}, setWindow(value) { window = value; } };`)(...Object.values(scope));
  assert.equal(constructions, 0, "owner construction stays lazy");
  const owner = getOwner();
  assert.equal(getOwner(), owner, "owner singleton is preserved");
  assert.equal(constructions, 1);
  assert.equal(reads, 0, "assembling dependencies must not resolve live surfaces or browser globals");
  if (["RenderCacheOwner", "ViewportCommandOwner", "ViewportResizeLifecycleOwner", "ZoomInteractionLifecycleOwner", "RendererFitProjectionOwner", "MapHoverInteractionOwner"].includes(name)) {
    assert.equal(owner.state, runtimeState, "the original runtime state instance must reach the owner");
    assert.equal(Object.isFrozen(runtimeState), false);
  }
  if ("surfaceHost" in owner) assert.equal(owner.surfaceHost, rendererSurfaceHost);
  return { owner, handles, runtimeState, globals, setWindow };
}

test("startup and transaction reset wire cancellation to the hover lifecycle owner", () => {
  for (const name of ["RendererStartupTransactionOwner", "RendererTransactionResetOwner"]) {
    const calls = [];
    const { owner } = createOwnerWiringHarness(name, {
      dependencies: { getMapHoverInteractionOwner: () => ({
        resetTooltipState: () => calls.push("tooltip-reset"),
        cancelPendingHoverWork: () => calls.push("cancel-hover-and-tooltip"),
      }) },
      includeFunctions: ["cancelScheduledHoverOverlayRender"],
    });
    assert.deepEqual(calls, [], "construction does not perform reset effects");
    owner.effects.resetTooltipState?.();
    owner.effects.cancelScheduledHoverOverlayRender();
    assert.deepEqual(calls, name === "RendererStartupTransactionOwner"
      ? ["tooltip-reset", "cancel-hover-and-tooltip"] : ["cancel-hover-and-tooltip"]);
  }
});

test("renderer owner wiring remains lazy and preserves live host and global reads", () => {
  const dependencies = {
    RendererProjectionPathOwner: { getD3: "d3" },
    RendererFitProjectionOwner: {},
    ProjectedGeometryBoundsOwner: { getProjection: "Projection", getPathCanvas: "PathCanvas", getPathSvg: "PathSvg" },
    SpatialIndexRuntimeOwner: { getPathSvg: "PathSvg" },
    IntensityFieldMaskOwner: { getProjection: "Projection" },
    HgoRuntimePreviewRenderOwner: { getProjection: "Projection", getMapSvg: "MapSvg", getTargetCanvas: "TargetCanvas" },
    StrategicOverlayHelpersOwner: { getOperationalLinesGroup: "OperationalLinesGroup", getOperationGraphicsGroup: "OperationGraphicsGroup", getUnitCountersGroup: "UnitCountersGroup", getSpecialZonesGroup: "SpecialZonesGroup", getSpecialZoneEditorGroup: "SpecialZoneEditorGroup" },
    RenderCacheOwner: { getContext: "Context" },
    ViewportReadModelOwner: {},
    ViewportCommandOwner: { getZoomBehavior: "ZoomBehavior", getInteractionRect: "InteractionRect", getD3: "d3" },
    RendererViewportUpdateOwner: { getViewportGroup: "ViewportGroup" },
    ViewportResizeLifecycleOwner: { getMapContainer: "MapContainer", getDevicePixelRatio: "devicePixelRatio" },
    ZoomInteractionLifecycleOwner: { getD3: "d3", getInteractionRect: "InteractionRect", getZoomBehavior: "ZoomBehavior", getZoomIdentity: "zoomIdentity" },
    MapInteractionEventBindingOwner: { getInteractionRect: "InteractionRect" },
    HitCanvasSchedulingOwner: {},
    MapHoverInteractionOwner: {},
    RenderPassCacheHostOwner: {},
    RenderPassCommitAccountingOwner: {},
  };
  for (const [name, getters] of Object.entries(dependencies)) {
    const { owner, handles, globals, setWindow } = createOwnerWiringHarness(name);
    if (name === "StrategicOverlayHelpersOwner") {
      for (const helper of ["getUnitCounterCardModel", "getUnitCounterRenderEntries", "getUnitCounterRenderScale"]) {
        assert.equal(typeof owner.helpers[helper], "function", helper);
      }
    }
    for (let version = 1; version <= 2; version++) {
      const d3 = { zoomIdentity: { version } };
      Object.defineProperty(globals, "d3", { value: d3, configurable: true });
      Object.defineProperty(globals, "devicePixelRatio", { value: version, configurable: true });
      for (const [getter, key] of Object.entries(getters)) {
        handles[key] = { version };
        if (key === "TargetCanvas") handles.Context = { canvas: handles[key] };
        const expected = key === "d3" ? d3 : key === "zoomIdentity" ? d3.zoomIdentity : key === "devicePixelRatio" ? version : handles[key];
        assert.equal((owner.getters || owner.groupGetters || owner)[getter](), expected, `${name}.${getter} version ${version}`);
      }
      if (name === "MapInteractionEventBindingOwner") {
        const node = { version };
        setWindow(node);
        assert.equal(owner.getters.getWindow(), node);
        handles.InteractionRect = { node() { assert.equal(this, handles.InteractionRect); return node; } };
        assert.equal(owner.getters.getInteractionRectNode(), node);
      }
    }
  }
});

test("viewport read model wiring provides fresh detached snapshots instead of raw state and handles", () => {
  const { owner, handles, runtimeState } = createOwnerWiringHarness("ViewportReadModelOwner");
  assert.equal(owner.state, undefined);
  assert.equal(owner.getters.getProjection, undefined);
  assert.equal(owner.getters.getPathSvg, undefined);
  for (let version = 1; version <= 2; version++) {
    const translate = [version, version + 1];
    handles.Projection = { scale: () => version * 10, translate: () => translate };
    Object.assign(runtimeState, { width: String(version * 100), height: version * 50,
      dpr: String(version), zoomTransform: { x: String(version), y: version + 1, k: version } });
    assert.deepEqual(owner.getters.getViewportDimensions(), { width: version * 100, height: version * 50 });
    assert.equal(owner.getters.getViewportDpr(), version);
    const snapshot = owner.capabilities.getProjectionSnapshot();
    assert.deepEqual(snapshot, { scale: version * 10, translate });
    assert.notEqual(snapshot.translate, translate);
    snapshot.translate[0] = 999;
    assert.equal(translate[0], version);
    const zoom = owner.capabilities.getZoomTransformSnapshot();
    assert.deepEqual(zoom, { x: version, y: version + 1, k: version });
    zoom.x = 999;
    assert.equal(runtimeState.zoomTransform.x, String(version));
  }
});

test("surface lifecycle wiring supplies the canvas helpers without invoking them", () => {
  const calls = [];
  const helpers = Object.fromEntries(["ensureCanvasLayers", "getCanvasLayer", "createHitCanvasElement"]
    .map(name => [name, () => calls.push(name)]));
  const names = { political: "political", hit: "hit" };
  const { owner } = createOwnerWiringHarness("RendererSurfaceLifecycleOwner", {
    dependencies: { ...helpers, CANVAS_LAYER_NAMES: names },
  });
  assert.deepEqual(calls, []);
  assert.equal(owner.canvasLayerManager.CANVAS_LAYER_NAMES, names);
  assert.equal(owner.canvasLayerManager.ensureCanvasLayers, helpers.ensureCanvasLayers);
  assert.equal(owner.canvasLayerManager.getCanvasLayer, helpers.getCanvasLayer);
  assert.equal(owner.helpers.createHitCanvasElement, helpers.createHitCanvasElement);
});

test("renderer cache wiring preserves null context and isolated pass collections", () => {
  const { owner, handles } = createOwnerWiringHarness("RenderCacheOwner");
  for (const value of [undefined, null, false]) {
    handles.Context = value;
    assert.equal(owner.getters.getContext(), null);
  }
  for (const [key, original] of [
    ["renderPassNames", passCatalog.RENDER_PASS_NAMES],
    ["interactionCompositePassNames", passCatalog.INTERACTION_COMPOSITE_PASS_NAMES],
  ]) {
    assert.deepEqual(owner.constants[key], original);
    assert.notEqual(owner.constants[key], original);
    assert.equal(Object.isFrozen(owner.constants[key]), true);
  }
  assert.deepEqual(owner.constants.transformedFramePassNames, passCatalog.TRANSFORM_REUSED_RENDER_PASS_NAMES);
  assert.notEqual(owner.constants.transformedFramePassNames, passCatalog.TRANSFORM_REUSED_RENDER_PASS_NAMES);
});

test("renderer hit and zoom accessors observe subsequent runtime mutations", () => {
  const hit = createOwnerWiringHarness("HitCanvasSchedulingOwner");
  const zoom = createOwnerWiringHarness("ZoomInteractionLifecycleOwner");
  for (let version = 1; version <= 2; version++) {
    Object.assign(hit.runtimeState, { activeScenarioId: version, hitCanvasDirty: true, deferHitCanvasBuild: false, renderPhase: "idle", hitCanvasBuildScheduled: version });
    Object.assign(hit.handles, { HitContext: {}, PathHitCanvas: {} });
    assert.equal(hit.owner.getters.getActiveScenarioId(), version);
    assert.equal(hit.owner.getters.getScheduledHitCanvasBuildHandle(), version);
    assert.equal(hit.owner.getters.hasHitCanvasRuntime(), true);
    for (const [key, getter] of [["width", "getWidth"], ["height", "getHeight"], ["zoomTransform", "getZoomTransform"], ["pendingZoomTransform", "getPendingZoomTransform"], ["zoomGestureStartTransform", "getZoomGestureStartTransform"]]) {
      zoom.runtimeState[key] = { version };
      assert.equal(zoom.owner.getters[getter](), zoom.runtimeState[key]);
    }
  }
});

const REQUIRED_OWNER_GETTERS = Object.freeze([
  "getContext",
  "getProjection",
  "getPathSvg",
  "getPathCanvas",
  "getZoomBehavior",
  "getInteractionRect",
  "getMapContainer",
]);

const REQUIRED_SETTERS = Object.freeze([
  "setContext",
  "setProjection",
  "setPathSvg",
  "setPathCanvas",
  "setZoomBehavior",
  "setInteractionRect",
  "setMapContainer",
]);

test("surface host initializes every registered handle as null", () => {
  const host = createRendererSurfaceHost();

  for (const getterName of REQUIRED_OWNER_GETTERS) {
    assert.equal(typeof host[getterName], "function", `${getterName} must be available`);
  }
  for (const setterName of REQUIRED_SETTERS) {
    assert.equal(typeof host[setterName], "function", `${setterName} must be available`);
  }
  for (const handleKey of RENDERER_SURFACE_HANDLE_KEYS) {
    assert.equal(host.snapshot()[handleKey].present, false, `${handleKey} must start empty`);
  }
});

test("surface host setters preserve handle identity", () => {
  const host = createRendererSurfaceHost();
  const context = { kind: "context" };
  const projection = () => [1, 2];
  const pathSvg = { kind: "pathSvg" };
  const zoomBehavior = { kind: "zoom" };

  assert.equal(host.setContext(context), context);
  assert.equal(host.setProjection(projection), projection);
  assert.equal(host.setPathSvg(pathSvg), pathSvg);
  assert.equal(host.setZoomBehavior(zoomBehavior), zoomBehavior);
  assert.equal(host.getContext(), context);
  assert.equal(host.getProjection(), projection);
  assert.equal(host.getPathSvg(), pathSvg);
  assert.equal(host.getZoomBehavior(), zoomBehavior);
});

test("surface host reset clears registered handles", () => {
  const host = createRendererSurfaceHost();
  host.setMany({
    mapContainer: { kind: "container" },
    mapCanvas: { kind: "canvas" },
    context: { kind: "context" },
    projection: () => null,
    pathCanvas: { kind: "pathCanvas" },
    zoomBehavior: { kind: "zoom" },
  });

  assert.equal(host.snapshot().context.present, true);
  host.reset();

  for (const handleKey of RENDERER_SURFACE_HANDLE_KEYS) {
    assert.equal(host.snapshot()[handleKey].present, false, `${handleKey} must be reset`);
  }
});

test("surface host snapshot reports presence metadata without raw handles", () => {
  const host = createRendererSurfaceHost();
  const context = { kind: "context" };
  host.setContext(context);
  host.setProjection(() => null);

  const snapshot = host.snapshot();
  assert.deepEqual(snapshot.context, { present: true, type: "object" });
  assert.deepEqual(snapshot.projection, { present: true, type: "function" });
  assert.deepEqual(snapshot.mapContainer, { present: false, type: "null" });
  assert.notEqual(snapshot.context, context, "snapshot must not expose raw handle objects");
});

test("surface host getters stay live after handle updates", () => {
  const host = createRendererSurfaceHost();
  const firstContext = { version: 1 };
  const secondContext = { version: 2 };

  host.setContext(firstContext);
  assert.equal(host.getContext(), firstContext);
  host.setContext(secondContext);
  assert.equal(host.getContext(), secondContext);
});

test("surface host supports initial handles and null normalization", () => {
  const initialContainer = { id: "mapContainer" };
  const host = createRendererSurfaceHost({
    handles: {
      mapContainer: initialContainer,
      tooltip: undefined,
    },
  });

  assert.equal(host.getMapContainer(), initialContainer);
  assert.equal(host.getTooltip(), null);
});
