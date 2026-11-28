import assert from "node:assert/strict";
import test from "node:test";
import { createViewportReadModelOwner } from "../js/core/renderer/viewport_read_model_owner.js";

function createOwner(bounds) {
  return createViewportReadModelOwner({
    getters: { getViewportDimensions: () => ({ width: 800, height: 600 }) },
    capabilities: {
      getProjectedRenderableContentBoundsSnapshots: () => bounds,
      createZoomTransform: ({ x, y }) => ({ x, y, k: 1 }),
    },
  });
}

test("projected content bounds combine renderable features", () => {
  const a = { minX: 0, minY: 0, maxX: 40, maxY: 50 };
  const b = { minX: 100, minY: 120, maxX: 180, maxY: 220 };
  assert.deepEqual(
    createOwner([b]).getProjectedRenderableContentBounds(),
    { minX: 100, minY: 120, maxX: 180, maxY: 220, width: 80, height: 100 },
  );
  assert.deepEqual(
    createOwner([a, b]).getProjectedRenderableContentBounds(),
    { minX: 0, minY: 0, maxX: 180, maxY: 220, width: 180, height: 220 },
  );
});

test("centered fit transform applies horizontal centering", () => {
  const owner = createOwner([{ minX: 10, minY: 20, maxX: 110, maxY: 120 }]);
  const centered = owner.getCenteredFitZoomTransform({ centerX: true, centerY: false });
  assert.deepEqual(centered, { x: 340, y: 0, k: 1 });
});
