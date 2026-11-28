import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { cancelMapPointPick, startMapPointPick } from "../js/core/map_renderer/public.js";
import { createClickSelectionTransactionOwner } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { createPhysicalIntensityPreviewOwner } from "../js/core/renderer/physical_intensity_preview_owner.js";

test("a map pick returns inverse-projected coordinates", async t => {
  t.after(cancelMapPointPick);
  const rect = {};
  globalThis.d3 = {
    pointer(event, node) {
      assert.equal(node, rect);
      return [event.clientX, event.clientY];
    },
  };
  t.after(() => { delete globalThis.d3; });
  const { getMapLonLatFromEvent } = createPhysicalIntensityPreviewOwner({ zoomTransform: { x: 5, y: 7, k: 2 } }, {
    rendererSurfaceHost: {
      getInteractionRect: () => ({ node: () => rect }),
      getProjection: () => ({ invert: ([x, y]) => [x - 90, 90 - y] }),
    },
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  });
  const hit = { targetType: "land", id: "A" };
  const ports = values => new Proxy(values, {
    get: (target, key) => target[key] ?? (() => assert.fail(`unexpected interaction: ${key}`)),
  });
  const click = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 5 },
    getters: { getClickState: () => state, getSelectedFacilityEntry: () => null },
    effects: ports({ consumeSuppressedBrushClick: () => false }),
    services: ports({
      nowMs: () => 0,
      getMapLonLatFromEvent,
      getHitFromEvent: () => hit,
    }),
  });
  state.currentTool = "select";
  const picked = startMapPointPick({ purpose: "capital" });
  await click.handleClick({ detail: 1, clientX: 45, clientY: 87 });
  assert.deepEqual(await picked, { lon: -70, lat: 50, hostFeatureId: "A" });
});
