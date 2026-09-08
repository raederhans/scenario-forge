const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('../support/playwright-app');

test.setTimeout(180_000);
const startupPath = '/app/?render_profile=balanced&startup_interaction=full&startup_worker=1&startup_cache=0&perf=1';
const stableInputWindow = process.env.M2_STABLE_INPUT === '1';

async function waitForStableInputWindow(page) {
  if (!stableInputWindow) return;
  await page.evaluate(() => { globalThis.__inputStableWindow = null; });
  await page.waitForFunction(() => {
    const s = globalThis.__playwrightStateRef;
    const c = s.runtimeChunkLoadState || {};
    globalThis.__inputStableDiagnostics = {
      scenario: s.activeScenarioId, apply: s.scenarioApplyInFlight, interacting: s.isInteracting,
      phase: s.renderPhase, exact: s.deferExactAfterSettle, exactHandle: !!s.exactAfterSettleHandle,
      activeTask: s.activePostReadyTaskKey, pendingReason: c.pendingReason,
      refresh: c.refreshScheduled, promotionScheduled: c.promotionScheduled,
      pendingPromotion: !!c.pendingPromotion, pendingInfra: !!c.pendingInfraPromotion,
      commit: c.promotionCommitInFlight, ready: s.interactionInfrastructureReady,
    };
    const idle = !s.scenarioApplyInFlight && !s.isInteracting && s.renderPhase === 'idle'
      && !s.deferExactAfterSettle && !s.exactAfterSettleHandle && !s.activePostReadyTaskKey
      && !c.pendingReason && !c.refreshScheduled && !c.promotionScheduled
      && !c.pendingPromotion && !c.pendingInfraPromotion && !c.promotionCommitInFlight;
    const signature = JSON.stringify([s.activeScenarioId, c.selectionVersion,
      s.renderPerfMetrics?.scenarioChunkPromotionInfraStage?.sequence,
      s.renderPerfMetrics?.rebuildPoliticalLandCollectionsBreakdown?.sequence,
      s.landData?.features?.length, s.colorRevision]);
    const prior = globalThis.__inputStableWindow;
    if (!idle || !prior || prior.signature !== signature) {
      globalThis.__inputStableWindow = { signature, since: performance.now() };
      return false;
    }
    return s.interactionInfrastructureReady && performance.now() - prior.since >= 2000;
  }, undefined, { timeout: 30_000 });
}

// Keep the existing diagnostics as the source of phase timings. Sampling observes
// distinct published sequences; missing stages remain absent, never zero-filled.
async function installStageObserver(page) {
  await page.addInitScript(() => {
    globalThis.__runtimeStageSamples = [];
    const seen = new Set();
    setInterval(() => {
      const metrics = globalThis.__renderPerfMetrics || {};
      for (const name of ['scenarioChunkPromotionInfraStage', 'scenarioChunkPromotionVisualStage',
        'rebuildPoliticalLandCollectionsBreakdown', 'rebuildResolvedColors', 'buildSpatialIndex', 'buildHitCanvas']) {
        const metric = metrics[name];
        if (!metric || !Number.isFinite(metric.sequence)) continue;
        const key = `${name}:${metric.sequence}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (globalThis.__runtimeStageSamples.length < 256) {
          globalThis.__runtimeStageSamples.push({ name, ...metric });
        }
      }
    }, 50);
  });
}

async function installInputObserver(page, point) {
  await page.evaluate(({ x, y }) => {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 9; sampleCanvas.height = 9;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    const readPixels = () => {
      context.clearRect(0, 0, 9, 9);
      for (const id of ['map-canvas', 'map-political-patch-canvas', 'map-interaction-overlay-canvas']) {
        const canvas = document.getElementById(id);
        if (!canvas || getComputedStyle(canvas).display === 'none') continue;
        const rect = canvas.getBoundingClientRect();
        const sx = (x - rect.left) * canvas.width / rect.width;
        const sy = (y - rect.top) * canvas.height / rect.height;
        context.drawImage(canvas, Math.floor(sx) - 4, Math.floor(sy) - 4, 9, 9, 0, 0, 9, 9);
      }
      return Array.from(context.getImageData(0, 0, 9, 9).data);
    };
    globalThis.__runtimeInputProbe = { results: [], pending: null, readPixels };
    document.addEventListener('pointerdown', () => {
      const p = globalThis.__runtimeInputProbe.pending;
      if (p && p.kind !== 'zoom' && p.startedAt === null) p.startedAt = performance.now();
    }, true);
    document.addEventListener('wheel', () => {
      const p = globalThis.__runtimeInputProbe.pending;
      if (p?.kind === 'zoom') p.startedAt = performance.now();
    }, { capture: true, passive: true });
    function observe() {
      const probe = globalThis.__runtimeInputProbe;
      const pending = probe.pending;
      if (pending?.startedAt !== null && pending) {
        const state = globalThis.__playwrightStateRef;
        const pixels = readPixels();
        let visible = false;
        if (pending.kind === 'selection') {
          visible = !!document.querySelector('path.dev-selected-feature[d]')?.getAttribute('d');
        } else if (pending.kind === 'zoom') {
          visible = state.renderPhase === 'idle' && !state.deferExactAfterSettle
            && !state.exactAfterSettleHandle && !state.pendingZoomTransform
            && state.zoomTransform.k !== pending.zoomK
            && pixels.some((value, index) => value !== pending.before[index]);
        } else {
          const start = pending.kind === 'undo' ? probe.paintedPixelIndex : 0;
          const end = pending.kind === 'undo' ? start + 4 : pixels.length;
          for (let i = start; i < end; i += 4) {
            if (pending.rgb.every((v, channel) => Math.abs(pixels[i + channel] - v) < 18)) {
              if (pending.kind === 'fill') {
                probe.paintedPixelIndex = i;
                probe.undoRgb = pending.before.slice(i, i + 3);
              }
              visible = true; break;
            }
          }
        }
        if (visible) {
          const metrics = state.renderPerfMetrics || {};
          const stages = Object.fromEntries(['refreshColorState', 'rebuildResolvedColors', 'drawContextScenarioPass', 'drawCanvas', 'fillPatchInputToFirstPixelMs'].map(name => [name,
            metrics[name]?.sequence > pending.beforeSequence ? metrics[name] : null]));
          probe.results.push({ kind: pending.kind, durationMs: performance.now() - pending.startedAt, stages,
            stableWindow: pending.stableWindow, startedAt: pending.startedAt,
            evidence: pending.kind === 'selection' ? 'svg-path-at-animation-frame' : 'composited-canvas-pixel-at-animation-frame' });
          probe.pending = null;
        }
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  }, point);
}

async function arm(page, kind, rgb = null) {
  if (kind !== 'zoom') await waitForStableInputWindow(page);
  await page.evaluate(({ kind, rgb }) => {
    const probe = globalThis.__runtimeInputProbe;
    probe.pending = { kind, rgb: kind === 'undo' ? probe.undoRgb : rgb, startedAt: null, before: probe.readPixels(),
      stableWindow: globalThis.__inputStableWindow || null,
      beforeSequence: globalThis.__playwrightStateRef.renderPerfMetricSequence || 0,
      zoomK: globalThis.__playwrightStateRef.zoomTransform.k };
  }, { kind, rgb });
}

async function waitForInputEvidence(page) {
  await page.waitForFunction(() => !globalThis.__runtimeInputProbe.pending, undefined, { timeout: 30_000 });
}

for (const scenarioId of ['tno_1962', 'hoi4_1939']) {
  test(`runtime stage and input feedback ${scenarioId}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await installStageObserver(page);
    try {
      await gotoApp(page, `${startupPath}&default_scenario=${scenarioId}`, { waitUntil: 'domcontentloaded' });
      await waitForAppInteractive(page);
      await waitForRenderIdle(page, { scenarioId });
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
      await installInputObserver(page, point);
      await arm(page, 'selection');
      await page.keyboard.down('Control');
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up('Control');
      await waitForInputEvidence(page);
      const initial = await page.evaluate(async () => {
        const s = globalThis.__playwrightStateRef;
        const id = s.devSelectedHit?.id;
        const color = s.colors[id];
        const rgb = globalThis.d3.color(color);
        const { clearDevSelection } = await import(new URL('./js/core/map_renderer.js', location.href));
        clearDevSelection();
        return { id, rgb: [rgb.r, rgb.g, rgb.b], overrides: { ...s.visualOverrides } };
      });
      expect(initial.id).toBeTruthy();
      await waitForRenderIdle(page, { scenarioId });
      await arm(page, 'fill', [227, 26, 196]);
      await page.mouse.click(point.x, point.y);
      await waitForInputEvidence(page);
      expect(await page.evaluate(() => Object.values(globalThis.__playwrightStateRef.visualOverrides))).toContain('#e31ac4');
      await arm(page, 'undo', initial.rgb);
      await page.locator('#undoBtn').click();
      await waitForInputEvidence(page);
      expect(await page.evaluate(() => ({ ...globalThis.__playwrightStateRef.visualOverrides }))).toEqual(initial.overrides);
      await arm(page, 'redo', [227, 26, 196]);
      await page.locator('#redoBtn').click();
      await waitForInputEvidence(page);
      expect(await page.evaluate(() => Object.values(globalThis.__playwrightStateRef.visualOverrides))).toContain('#e31ac4');
      await page.locator('#undoBtn').click();
      await waitForRenderIdle(page, { scenarioId });
      // Exercise immediate undo separately: no idle/pixel wait between the two inputs.
      await page.mouse.click(point.x, point.y);
      await page.locator('#undoBtn').click();
      await waitForRenderIdle(page, { scenarioId });
      expect(await page.evaluate(() => ({ ...globalThis.__playwrightStateRef.visualOverrides }))).toEqual(initial.overrides);
      await arm(page, 'zoom');
      await page.mouse.move(point.x, point.y);
      for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -100);
      await waitForInputEvidence(page);
      await waitForRenderIdle(page, { scenarioId });
      await waitForStableInputWindow(page);
      const results = await page.evaluate(() => globalThis.__runtimeInputProbe.results);
      expect(results.map(item => item.kind)).toEqual(['selection', 'fill', 'undo', 'redo', 'zoom']);
      for (const item of results) expect(item.durationMs).toBeGreaterThan(0);
      expect(pageErrors).toEqual([]);
    } finally {
      const evidence = await page.evaluate(() => ({
        stages: globalThis.__runtimeStageSamples || [],
        snapshot: globalThis.__mc_perf__?.snapshot?.() || null,
        inputs: globalThis.__runtimeInputProbe?.results || [],
        pendingInput: globalThis.__runtimeInputProbe?.pending || null,
        stableDiagnostics: globalThis.__inputStableDiagnostics || null,
      }));
      const evidencePath = testInfo.outputPath('runtime-stage-input-evidence.json');
      fs.writeFileSync(evidencePath, JSON.stringify({ scenarioId, stableInputWindow, pageErrors, ...evidence }, null, 2));
      await testInfo.attach('runtime-stage-input-evidence', { path: evidencePath, contentType: 'application/json' });
    }
  });
}

test('runtime scenario A-B-A preserves usable indexes and clears selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, `${startupPath}&default_scenario=tno_1962`, { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await waitForRenderIdle(page, { scenarioId: 'tno_1962' });
  let originalTnoFeatureId = '';
  for (const [step, scenarioId] of ['tno_1962', 'hoi4_1939', 'tno_1962'].entries()) {
    if (step > 0) await page.evaluate(async id => {
      const { applyScenarioByIdCommand } = await import(new URL('./js/core/scenario_dispatcher.js', location.href));
      await applyScenarioByIdCommand(id, { renderMode: 'flush', markDirtyReason: '', showToastOnComplete: false });
    }, scenarioId);
    await waitForRenderIdle(page, { scenarioId });
    if (await page.locator('#scenarioGuidePopover').isVisible()) await page.locator('#scenarioGuideCloseBtn').click();
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
    const result = await page.evaluate(() => {
      const state = globalThis.__playwrightStateRef;
      const hitId = state.devSelectedHit?.id;
      return { id: state.activeScenarioId, ready: state.interactionInfrastructureReady,
        hitId, hitColor: state.colors[hitId], hitIndexed: state.landIndex.has(hitId),
        indexSize: state.landIndex.size, spatialSize: state.spatialItems.length,
        landCount: state.landData?.features?.length, fullCount: state.landDataFull?.features?.length,
        colorsCount: Object.keys(state.colors || {}).length, stage: state.interactionInfrastructureStage,
        chunkCount: state.scenarioPoliticalChunkData?.features?.length,
        selectedWater: state.selectedWaterRegionId, inFlight: state.runtimeChunkLoadState?.promotionCommitInFlight };
    });
    fs.writeFileSync(testInfo.outputPath(`switch-${step}-${scenarioId}.json`), JSON.stringify(result, null, 2));
    expect(result.id).toBe(scenarioId);
    expect(result.ready).toBe(true);
    expect(result.indexSize).toBeGreaterThan(0);
    expect(result.spatialSize).toBeGreaterThan(0);
    expect(result.fullCount).toBeGreaterThan(0);
    expect(result.landCount).toBeGreaterThan(0);
    expect(result.colorsCount).toBeGreaterThan(0);
    expect(result.hitId).toBeTruthy();
    expect(result.hitColor).toBeTruthy();
    expect(result.hitIndexed).toBe(true);
    if (step === 0) originalTnoFeatureId = result.hitId;
    if (step === 2) expect(result.hitId).toBe(originalTnoFeatureId);
    expect(result.selectedWater).toBe('');
    expect(result.inFlight).toBeFalsy();
    await page.evaluate(async () => {
      const { clearDevSelection } = await import(new URL('./js/core/map_renderer.js', location.href));
      clearDevSelection();
    });
  }
});
