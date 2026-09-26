const { test, expect } = require('@playwright/test');
const { getAppUrl, waitForAppInteractive, waitForRenderIdle } = require('./support/playwright-app');

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
test.setTimeout(120000);

test('display quality preserves camera and scenario political borders survive same-color fills', async ({ page }, testInfo) => {
  const pageErrors = [];
  const borderPackRequests = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/tno_1962/mesh_pack.json')) borderPackRequests.push(request.url());
  });
  await page.goto(getAppUrl('/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0'));
  await waitForAppInteractive(page, { timeout: 45000 });
  await waitForRenderIdle(page, { scenarioId: 'tno_1962', timeout: 45000, requireInfra: false });
  const worldBorders = await page.evaluate(async () => {
    const renderer = await import(new URL('./js/core/map_renderer.js', location.href));
    globalThis.__politicalSourceAtWorld = globalThis.__playwrightStateRef.activeScenarioMeshPack?.meshes?.opening_owner_borders;
    return renderer.getPoliticalBorderDiagnostics();
  });
  expect(worldBorders.status).toBe('ready');
  expect(worldBorders.source).toBe('scenario-mesh-pack');
  expect(worldBorders.lineCount).toBeGreaterThan(0);
  await page.screenshot({path: '.runtime/browser/map-clarity-world.png'});
  await page.evaluate(async () => {
    globalThis.__clarityRenderer = await import(new URL('./js/core/map_renderer.js', location.href));
    globalThis.__clarityRenderer.setZoomPercent(250);
  });
  await waitForRenderIdle(page, { scenarioId: 'tno_1962', timeout: 45000, requireInfra: false });
  await page.evaluate(async () => {
    await globalThis.__clarityRenderer.ensurePaintContoursReady();
    globalThis.__clarityRenderer.render();
  });
  const read = () => page.evaluate(() => {
    const s = globalThis.__playwrightStateRef;
    return { quality:s.styleConfig.rendering.quality, dpr:s.dpr, camera:{...s.zoomTransform},
      width:s.width, height:s.height, canvas:[s.colorCanvas.width,s.colorCanvas.height],
      profile:s.renderProfile, contours:globalThis.__clarityRenderer.getPaintContourDiagnostics(),
      politicalBorders:globalThis.__clarityRenderer.getPoliticalBorderDiagnostics(),
      samePoliticalSource:s.activeScenarioMeshPack?.meshes?.opening_owner_borders === globalThis.__politicalSourceAtWorld,
      exactPasses: ['political','borders'].map(name => ({...s.renderPassCache.referenceTransforms[name]})),
      idle:s.renderPhase === 'idle' && !s.deferExactAfterSettle };
  });
  const initial = await read();
  expect(initial.quality).toBe('high');
  expect(initial.dpr).toBe(2);
  expect(initial.canvas).toEqual([initial.width * 2, initial.height * 2]);
  expect(initial.profile).toBe('balanced');
  expect(initial.idle).toBe(true);
  expect(initial.contours.status).toBe('ready');
  expect(initial.politicalBorders.lineCount).toBe(worldBorders.lineCount);
  expect(initial.samePoliticalSource).toBe(true);
  expect(initial.politicalBorders.builds).toBe(worldBorders.builds);
  expect(initial.exactPasses).toEqual([initial.camera,initial.camera]);

  await page.locator('#editorTaskLayersBtn').click();
  await page.locator('#appearanceTabBorders').click();
  for (const [quality, dpr] of [['balanced',1.5], ['performance',1.25], ['high',2]]) {
    await page.locator('#displayQuality').selectOption(quality);
    await expect.poll(async () => (await read()).dpr).toBe(dpr);
    await waitForRenderIdle(page, { scenarioId:'tno_1962', timeout:15000, requireInfra:false });
    // Idle input state can precede the asynchronous geometry raster result.
    await expect.poll(async () => (await read()).exactPasses, { timeout:15000 })
      .toEqual([initial.camera,initial.camera]);
    const result = await read();
    expect(result.camera).toEqual(initial.camera);
    expect(result.canvas).toEqual([Math.floor(result.width*dpr),Math.floor(result.height*dpr)]);
    expect(result.profile).toBe('balanced');
    expect(result.exactPasses).toEqual([initial.camera,initial.camera]);
  }
  await page.locator('#lblEmpireBorders').click();
  await expect(page.locator('#politicalBorderToggle')).toBeChecked();
  await page.evaluate(() => {
    const canvas = globalThis.__clarityRenderer.renderExportPassesToCanvas(['borders'], {pixelRatio:2});
    globalThis.__enabledBorderPixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    // Source-backed samples at the former Algerian gap and overlap, not a
    // generic pixel difference that could pass while this seam stays broken.
    globalThis.__algerianSeamPixels = [[2.0582293565854957,28],[2.082992210342993,29],[2.0198030416848667,29.5]]
      .map(([lon,lat]) => globalThis.__clarityRenderer.projectGeoToScreen(lon,lat).map(v => Math.round(v*2)));
  });
  await page.locator('#politicalBorderToggle').uncheck();
  const disabled = await read();
  const changedPixels = await page.evaluate(() => {
    const canvas = globalThis.__clarityRenderer.renderExportPassesToCanvas(['borders'], {pixelRatio:2});
    const current = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let changed=0;
    for(let i=0;i<current.length;i+=4) {
      if(current[i]!==globalThis.__enabledBorderPixels[i] || current[i+3]!==globalThis.__enabledBorderPixels[i+3]) changed++;
    }
    const seamChanges = globalThis.__algerianSeamPixels.map(([x,y]) => {
      let count=0;
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++) {
        const index=((y+dy)*canvas.width+x+dx)*4;
        if(current[index+3]!==globalThis.__enabledBorderPixels[index+3])count++;
      }
      return count;
    });
    delete globalThis.__enabledBorderPixels;
    return {total:changed,seamChanges};
  });
  await page.locator('#politicalBorderToggle').check();
  const enabled = await read();
  expect(disabled.politicalBorders.lineCount).toBe(0);
  expect(enabled.politicalBorders.lineCount).toBe(worldBorders.lineCount);
  expect(enabled.politicalBorders.builds).toBe(disabled.politicalBorders.builds);
  expect(enabled.contours.activeArcCount).toBe(disabled.contours.activeArcCount);
  expect(enabled.contours.builds).toBe(disabled.contours.builds);
  expect(changedPixels.total).toBeGreaterThan(100);
  expect(changedPixels.seamChanges).toHaveLength(3);
  for(const changed of changedPixels.seamChanges)expect(changed).toBeGreaterThan(0);
  await page.screenshot({path: '.runtime/browser/map-clarity-zoomed.png'});
  const algeriaClip = await page.evaluate(() => {
    const s=globalThis.__playwrightStateRef;
    const rect=s.colorCanvas.getBoundingClientRect();
    const project=globalThis.__clarityRenderer.projectGeoToScreen;
    const west=project(-2,30)[0],east=project(6,30)[0],north=project(2,37)[1],south=project(2,24)[1];
    const x=Math.max(rect.x,rect.x+west-25),y=Math.max(rect.y,rect.y+north-25);
    return {x,y,width:Math.min(rect.right,rect.x+east+25)-x,height:Math.min(rect.bottom,rect.y+south+25)-y};
  });
  await page.screenshot({path:'.runtime/browser/algeria-border-repaired.png',clip:algeriaClip});

  const exportCheck = await page.evaluate(() => {
    const s = globalThis.__playwrightStateRef;
    const beforeCache = s.renderPassCache;
    const canvas = globalThis.__clarityRenderer.renderExportPassesToCanvas(['political','borders'], {pixelRatio:3});
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let painted = 0;
    for (let i=3;i<pixels.length;i+=4) if (pixels[i]) painted++;
    return {width:canvas.width,height:canvas.height,painted,dpr:s.dpr,sameCache:beforeCache===s.renderPassCache};
  });
  expect(exportCheck.width).toBe(initial.width*3);
  expect(exportCheck.height).toBe(initial.height*3);
  expect(exportCheck.painted).toBeGreaterThan(10000);
  expect(exportCheck.dpr).toBe(2);
  expect(exportCheck.sameCache).toBe(true);
  expect(borderPackRequests).toHaveLength(1);
  expect(pageErrors).toEqual([]);
  await testInfo.attach('clarity-runtime-evidence', {
    body: JSON.stringify({worldBorders,initial,disabled,enabled,changedPixels,borderPackRequests,exportCheck,pageErrors},null,2), contentType:'application/json',
  });
});
