import test from "node:test";
import assert from "node:assert/strict";
import { getUncoveredRatio } from "../js/core/renderer/political_id_raster_coverage.js";

const viewport = { x: 0, y: 0, width: 100, height: 100 };

test("a central hole remains uncovered inside the outer rectangle", () => {
  assert.equal(getUncoveredRatio([
    { x: 0, y: 0, width: 100, height: 20 },
    { x: 0, y: 80, width: 100, height: 20 },
    { x: 0, y: 20, width: 20, height: 60 },
    { x: 80, y: 20, width: 20, height: 60 },
  ], viewport), 0.36);
});

test("separated rectangles do not cover the space between them", () => {
  assert.equal(getUncoveredRatio([
    { x: 0, y: 0, width: 20, height: 100 },
    { x: 80, y: 0, width: 20, height: 100 },
  ], viewport), 0.6);
});

test("overlapping and duplicate rectangles count their union once", () => {
  const rectangles = [
    { x: 0, y: 0, width: 60, height: 100 },
    { x: 40, y: 0, width: 40, height: 100 },
  ];
  assert.equal(getUncoveredRatio([...rectangles, rectangles[0]], viewport), 0.2);
  assert.equal(getUncoveredRatio([viewport, ...rectangles], viewport), 0);
  assert.equal(getUncoveredRatio([], viewport), 1);
});

test("coverage is clipped to an offset viewport", () => {
  assert.equal(getUncoveredRatio([
    { x: -100, y: -100, width: 160, height: 300 },
    { x: 200, y: 200, width: 50, height: 50 },
    { x: 10, y: 20, width: 0, height: 100 },
  ], { x: 10, y: 20, width: 100, height: 100 }), 0.5);
});

test("converting viewport and coverage from CSS to device pixels preserves the ratio", () => {
  const rectangles = [{ x: 20, y: 10, width: 50, height: 60 }];
  for (const dpr of [1, 1.25, 2, 3]) {
    const physical = rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * dpr]));
    assert.equal(getUncoveredRatio(rectangles.map(physical), physical(viewport)), 0.7);
  }
});
