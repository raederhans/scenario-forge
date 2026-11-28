import test from "node:test";
import assert from "node:assert/strict";
import { getVisibleViewportRect } from "../js/ui/visual_viewport_sync.js";

const win = { document: { documentElement: { clientWidth: 800, clientHeight: 600 } },
  innerWidth: 820, innerHeight: 580 };

test("visible viewport rect uses layout coordinates", () => {
  const visualViewport = { offsetTop: 40, offsetLeft: 10, width: 360, height: 300 };
  assert.deepEqual(getVisibleViewportRect({ ...win, visualViewport }), {
    top: 40, left: 10, width: 360, height: 300, bottom: 340, right: 370,
  });
});

test("viewport rect falls back to layout dimensions", () => {
  assert.deepEqual(getVisibleViewportRect(win), {
    top: 0, left: 0, width: 820, height: 600, bottom: 600, right: 820,
  });
});
