import assert from "node:assert/strict";
import test from "node:test";
import { resolveDisplayPixelRatio } from "../js/core/renderer/display_quality_policy.js";

test("display density respects device and quality caps across common DPRs", () => {
  const caps = { performance: 1.25, balanced: 1.5, high: 2 };
  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
    for (const [quality, cap] of Object.entries(caps)) {
      assert.equal(
        resolveDisplayPixelRatio({ quality, devicePixelRatio, width: 1000, height: 1000 }),
        Math.min(devicePixelRatio, cap),
        `${quality} at device DPR ${devicePixelRatio}`,
      );
    }
  }
  assert.equal(resolveDisplayPixelRatio({ quality: "unknown", devicePixelRatio: 3, width: 1000, height: 1000 }), 2);
});

test("a large viewport keeps DPR at least one", () => {
  assert.equal(resolveDisplayPixelRatio({ quality: "high", devicePixelRatio: 3, width: 4000, height: 3000 }), 1);
});
