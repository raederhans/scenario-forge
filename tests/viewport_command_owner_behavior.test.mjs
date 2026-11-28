import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createViewportCommandOwner } from "../js/core/renderer/viewport_command_owner.js";
import { createZoomInteractionLifecycleOwner } from "../js/core/renderer/zoom_interaction_lifecycle_owner.js";

function createHarness() {
  const calls = { scaleTo: [] };
  const owner = createViewportCommandOwner({
    state: {},
    getters: {
      getZoomBehavior: () => ({ scaleTo: (scale) => calls.scaleTo.push(scale) }),
      getInteractionRect: () => ({ node: () => ({}) }),
      getD3: () => ({ select: () => ({ call: (method, ...args) => method(...args) }) }),
    },
  });
  return { calls, owner };
}

test("setZoomPercent parses percent strings numbers clamps and ignores non-finite values", () => {
  const { calls, owner } = createHarness();

  owner.setZoomPercent("123%");
  owner.setZoomPercent(250);
  owner.setZoomPercent("-10%");
  owner.setZoomPercent("9000%");
  owner.setZoomPercent("nope");

  assert.deepEqual(calls.scaleTo, [1.23, 2.5, 0.35, 50]);
});

test("constraint correction updates the real D3 transform", () => {
  const vendor = { navigator: { maxTouchPoints: 0 }, setTimeout, clearTimeout };
  vm.runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), vendor);
  const d3 = vendor.d3;
  for (const suppressRender of [false, true]) {
    const initial = d3.zoomIdentity.translate(1500, 1200);
    const state = { width: 800, height: 600, zoomTransform: initial };
    const node = { __zoom: initial, addEventListener() {}, removeEventListener() {} };
    let behavior;
    const lifecycle = createZoomInteractionLifecycleOwner({
      getters: {
        getD3: () => d3,
        getWidth: () => state.width,
        getHeight: () => state.height,
        getInteractionRect: () => ({ node: () => node }),
        getZoomTransform: () => state.zoomTransform,
        getPendingZoomTransform: () => state.pending,
        getZoomGestureStartTransform: () => state.gestureStart,
        isZoomRenderScheduled: () => state.scheduled,
      },
      helpers: { requestAnimationFrame: () => 1 },
      effects: {
        setZoomBehavior: (value) => { behavior = value; },
        setPendingZoomTransform: (value) => { state.pending = value; },
        setZoomRenderScheduled: (value) => { state.scheduled = value; },
        setZoomGestureStartTransform: (value) => { state.gestureStart = value; },
        updateMap: (value) => {
          state.zoomTransform = value;
        },
      },
    });
    lifecycle.initZoom();
    const owner = createViewportCommandOwner({
      state,
      getters: {
        getD3: () => d3,
        getZoomBehavior: () => behavior,
        getInteractionRect: () => ({ node: () => node }),
        calculatePanExtent: () => [[0, 0], [400, 300]],
      },
      effects: { setZoomTransform: (value) => { state.zoomTransform = value; } },
    });
    owner.updateZoomTranslateExtent();
    // This is an actual out-of-bounds correction, not an identity no-op.
    const expected = behavior.constrain()(initial, [[0, 0], [800, 600]], [[0, 0], [400, 300]]);
    assert.notEqual(expected.x, initial.x);
    owner.enforceZoomConstraints({ suppressRender });
    assert.equal(node.__zoom.x, expected.x);
    assert.equal(node.__zoom.y, expected.y);
    assert.equal(node.__zoom.k, expected.k);
    assert.equal(state.zoomTransform, node.__zoom);
    lifecycle.dispose();
  }
});
