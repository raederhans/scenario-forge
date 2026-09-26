import assert from "node:assert/strict";
import test from "node:test";
import {
  DISPLAY_PIXEL_BUDGET,
  normalizeDisplayQuality,
  normalizeRenderingStyleConfig,
  resolveDisplayPixelRatio,
} from "../js/core/renderer/display_quality_policy.js";

test("display quality normalizes imports and unknown values to high", () => {
  assert.equal(normalizeDisplayQuality(" BALANCED "), "balanced");
  assert.equal(normalizeDisplayQuality("unknown"), "high");
  assert.equal(normalizeDisplayQuality("unknown", "performance"), "performance");
  assert.deepEqual(normalizeRenderingStyleConfig({ quality: " High ", extra: true }), { quality: "high" });
  assert.deepEqual(normalizeRenderingStyleConfig({ quality: "full" }), { quality: "high" });
  assert.deepEqual(normalizeRenderingStyleConfig(null), { quality: "high" });
});

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

test("the shared viewport budget keeps density monotone and DPR at least one", () => {
  const width = 2560;
  const height = 1440;
  const budgetDpr = Math.sqrt(DISPLAY_PIXEL_BUDGET / (width * height));
  const performance = resolveDisplayPixelRatio({ quality: "performance", devicePixelRatio: 3, width, height });
  const balanced = resolveDisplayPixelRatio({ quality: "balanced", devicePixelRatio: 3, width, height });
  const high = resolveDisplayPixelRatio({ quality: "high", devicePixelRatio: 3, width, height });
  assert.equal(performance, 1.25);
  assert.equal(balanced, budgetDpr);
  assert.equal(high, budgetDpr);
  assert.ok(performance <= balanced && balanced <= high);
  assert.equal(resolveDisplayPixelRatio({ quality: "high", devicePixelRatio: 3, width: 4000, height: 3000 }), 1);
});
