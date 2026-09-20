const { test, expect } = require("@playwright/test");

test("packed geometry preserves native pixels, holes, worker reuse and eviction", async ({ page }) => {
  await page.route("**/__precision_scaling__", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Precision test</title>" }));
  await page.goto("/__precision_scaling__");
  const result = await page.evaluate(async () => {
    const { runPrecisionScalingNativeCase } = await import("/tests/e2e/dev/support/precision_scaling_native_case.mjs");
    return runPrecisionScalingNativeCase();
  });
  expect(result.differingChannels, JSON.stringify(result)).toBe(0);
  expect(result.workerDifference, JSON.stringify(result)).toBe(0);
  expect(result.hitDifference, JSON.stringify(result)).toBe(0);
  expect(result.centerAlpha).toBe(0);
  expect(result.insideAlpha).toBe(255);
  expect(result.rendered).toBe(true);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.mode).toBe("packed-f64");
  expect(new Set(result.evicted)).toEqual(new Set(["holes", "dense"]));
  expect(result.uploads).toEqual([2, 0]);
  expect(result.fallbackCount).toBe(0);
});
