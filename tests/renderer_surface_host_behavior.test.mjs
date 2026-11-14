import assert from "node:assert/strict";
import test from "node:test";

import {
  createRendererSurfaceHost,
  RENDERER_SURFACE_HANDLE_KEYS,
} from "../js/core/renderer/renderer_surface_host.js";

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

test("renderer composition imports without eager dependency initialization errors", async () => {
  await import("../js/core/map_renderer.js");
});
