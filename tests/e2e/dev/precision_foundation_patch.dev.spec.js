const { test, expect } = require('@playwright/test');

test('93-feature worker patches match complete native rasterization, holes and painter order', async ({ page }, testInfo) => {
  // The test exercises real served module workers, not full-app data boot.
  await page.route(url => url.pathname === '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Precision patch native check</title>' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { runPrecisionFoundationNativeCase } = await import('/tests/e2e/dev/support/precision_foundation_native_case.mjs');
    return runPrecisionFoundationNativeCase();
  });
  await testInfo.attach('native-patch-result', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.editedCount).toBe(93);
  expect(result.samples.every(sample => sample.differences === 0)).toBe(true);
  expect(result.patchMetrics).toHaveLength(3);
  expect(result.patchMetrics.every(metric => metric.rasterizedCount < metric.composedCount)).toBe(true);
  expect(result.patchesAfterPan).toBe(result.patchesBeforePan);
  expect(result.staleDraw).toBeNull();
  expect(result.staleResults).toBe(1);
  expect(result.fallbacks).toBe(0);
  expect(result.uploads.slice(1).every(count => count === 0)).toBe(true);
});

test('separated native crops clear holes without stale exterior pixels', async ({ page }, testInfo) => {
  await page.route(url => url.pathname === '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Separated crop oracle</title>' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { runPrecisionFoundationNativeCase } = await import('/tests/e2e/dev/support/precision_foundation_native_case.mjs');
    return runPrecisionFoundationNativeCase({ separatedEdits: true });
  });
  await testInfo.attach('separated-crop-result', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.samples).toHaveLength(7);
  expect(result.samples.every(sample => sample.differences === 0)).toBe(true);
  expect(result.patchMetrics).toHaveLength(6);
  expect(result.clearedPixels.slice(1,7).every(count => count < result.clearedPixels[0])).toBe(true);
  expect(result.staleDraw).toBeNull();
  expect(result.fallbacks).toBe(0);
});
