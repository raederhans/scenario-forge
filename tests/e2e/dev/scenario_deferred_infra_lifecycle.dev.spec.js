const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('../support/playwright-app');

// Three bounded lifecycle windows; this is not a latency budget or perf comparison.
test.setTimeout(180_000);
test.use({ trace: 'off', viewport: { width: 1600, height: 1000 } });

async function installLifecycleObserver(page) {
  await page.addInitScript(() => {
    globalThis.__n4Timeline = [];
    globalThis.__n4Record = (kind, details) => {
      if (globalThis.__n4Timeline.length < 4096) globalThis.__n4Timeline.push({ at: performance.now(), kind, ...details });
    };
    globalThis.__n4Run = (key, callback) => {
      globalThis.__n4Record('task-start', { key });
      let value;
      try { value = callback(); }
      finally { globalThis.__n4Record('task-sync-return', { key }); }
      return Promise.resolve(value).finally(() => globalThis.__n4Record('task-finish', { key }));
    };
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) globalThis.__n4Record('longtask', {
          startTime: entry.startTime, duration: entry.duration,
        });
      }).observe({ type: 'longtask' });
    }
  });
  const source = fs.readFileSync(path.resolve('js/bootstrap/post_ready_scheduler.js'), 'utf8');
  const instrumented = source.replace('Promise.resolve(callback())', 'Promise.resolve(globalThis.__n4Run(taskKey, callback))')
    .replace('return diagnostics;', 'globalThis.__n4Record("scheduler", diagnostics); return diagnostics;');
  expect(instrumented).not.toBe(source);
  await page.route('**/js/bootstrap/post_ready_scheduler.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: instrumented,
  }));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const s = globalThis.__playwrightStateRef || {};
    const c = s.runtimeChunkLoadState || {};
    return { at: performance.now(), scenarioId: s.activeScenarioId,
      requestId: s.currentScenarioApplyRequestId, latestRequestId: s.latestScenarioApplyRequestId,
      selectionVersion: c.selectionVersion, promotionVersion: c.pendingInfraPromotion?.promotionVersion,
      pendingInfra: c.pendingInfraPromotion || null, pendingPromotion: !!c.pendingPromotion,
      pendingVisual: !!c.pendingVisualPromotion, pendingReason: c.pendingReason,
      ready: s.interactionInfrastructureReady, stage: s.interactionInfrastructureStage,
      activeTask: s.activePostReadyTaskKey, activeRecovery: s.activeInteractionRecoveryTaskKey,
      scheduler: s.postReadyTaskDiagnostics, landCount: s.landData?.features?.length,
      fullCount: s.landDataFull?.features?.length, indexSize: s.landIndex?.size,
      failure: s.renderPerfMetrics?.scenarioChunkPromotionInfraFailure || null,
      infraMetric: s.renderPerfMetrics?.scenarioChunkPromotionInfraStage || null,
      timeline: globalThis.__n4Timeline || [] };
  });
}

test('deferred infra terminates across cold warm and scenario-switch editing windows', async ({ page }, testInfo) => {
  await installLifecycleObserver(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const windows = [];
  try {
    for (const window of ['cold', 'warm', 'scenario-switch']) {
      if (window !== 'scenario-switch') {
        await gotoApp(page, '/app/?default_scenario=tno_1962&render_profile=balanced&startup_interaction=full&startup_worker=1&startup_cache=1&perf=1', { waitUntil: 'domcontentloaded' });
        await waitForAppInteractive(page);
      } else {
        await page.evaluate(async () => {
          globalThis.__n4Timeline = [];
          const { applyScenarioByIdCommand } = await import(new URL('./js/core/scenario_dispatcher.js', location.href));
          await applyScenarioByIdCommand('hoi4_1939', { renderMode: 'flush', markDirtyReason: '', showToastOnComplete: false });
        });
        await waitForAppInteractive(page);
      }
      const scenarioId = window === 'scenario-switch' ? 'hoi4_1939' : 'tno_1962';
      const entry = { window, beforeEdit: await snapshot(page) };
      windows.push(entry);
      if (await page.locator('#scenarioGuidePopover').isVisible()) await page.locator('#scenarioGuideCloseBtn').click();
      await page.locator('#paintModeVisualBtn').click();
      await page.locator('#toolFillBtn').click();
      await page.locator('#customColor').fill('#e31ac4');
      const point = await page.evaluate(async () => {
        const { projectGeoToScreen } = await import(new URL('./js/core/map_renderer.js', location.href));
        const xy = projectGeoToScreen(13.4, 52.5);
        const rect = document.querySelector('#mapContainer').getBoundingClientRect();
        return { x: rect.left + xy[0], y: rect.top + xy[1] };
      });
      await page.keyboard.down('Control');
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up('Control');
      await expect(page.locator('path.dev-selected-feature')).toHaveAttribute('d', /\S+/);
      const featureId = await page.evaluate(() => globalThis.__playwrightStateRef.devSelectedHit.id);
      const oldColor = await page.evaluate(id => globalThis.__playwrightStateRef.colors[id], featureId);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => page.evaluate(id => globalThis.__playwrightStateRef.featureOverrides[id], featureId)).toBe('#e31ac4');
      entry.painted = { featureId, oldColor, color: '#e31ac4' };
      await waitForRenderIdle(page, { scenarioId, timeout: 30_000 });
      await page.waitForFunction(() => {
        const s = globalThis.__playwrightStateRef;
        return !s.activePostReadyTaskKey && !s.activeInteractionRecoveryTaskKey
          && !(s.postReadyTaskDiagnostics?.pendingTaskKeys || []).length
          && !s.runtimeChunkLoadState?.pendingInfraPromotion;
      }, undefined, { timeout: 30_000 });
      entry.afterDrain = await snapshot(page);
      expect(entry.afterDrain.ready).toBe(true);
      expect(entry.afterDrain.indexSize).toBeGreaterThan(0);
      expect(entry.afterDrain.landCount).toBeGreaterThan(0);
      expect(entry.afterDrain.pendingInfra).toBeNull();
      expect(entry.afterDrain.failure).toBeNull();
      expect(entry.afterDrain.scheduler.pendingTaskKeys).toEqual([]);
      console.log(`[N4] ${window}: drained, ready, index=${entry.afterDrain.indexSize}`);
      expect(await page.evaluate(id => globalThis.__playwrightStateRef.featureOverrides[id], featureId)).toBe('#e31ac4');
      await page.locator('#undoBtn').click();
      await expect.poll(() => page.evaluate(id => globalThis.__playwrightStateRef.colors[id], featureId)).toBe(oldColor);
      await page.locator('#redoBtn').click();
      await expect.poll(() => page.evaluate(id => globalThis.__playwrightStateRef.colors[id], featureId)).toBe('#e31ac4');
      // Restore the color changed by this window before continuing.
      await page.locator('#undoBtn').click();
      await expect.poll(() => page.evaluate(id => globalThis.__playwrightStateRef.colors[id], featureId)).toBe(oldColor);
    }
    expect(errors).toEqual([]);
  } finally {
    const output = testInfo.outputPath('deferred-infra-windows.json');
    fs.writeFileSync(output, JSON.stringify({ windows, errors, lastState: await snapshot(page),
      timingBoundary: 'scheduler callbacks and longtask entries; async task lifetime is not CPU time; warm is same-browser navigation' }, null, 2));
    await testInfo.attach('deferred-infra-windows', { path: output, contentType: 'application/json' });
  }
});
