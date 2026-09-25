const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

test("ownership editing stays disabled in editor and developer workspace", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/?ui_shell=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#workspaceExportBtn")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#bootOverlay")).toBeHidden();
  await expect(page.locator("#paintModeVisualBtn")).toBeVisible();
  await expect(page.locator("#paintModePoliticalBtn")).toBeHidden();
  await expect(page.locator("#paintModePoliticalBtn")).toBeDisabled();
  await expect(page.locator("#countryInspectorSetActive")).toBeHidden();
  await expect(page.getByRole("button", { name: "Return to Political Ownership Brush", exact: true })).toHaveCount(0);
  await expect(page.locator(".scenario-visual-adjustments").first()).toBeVisible();

  const outcome = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { state } = await load("./js/core/state.js");
    const actions = await load("./js/core/state/actions/scenario_presentation_actions.js");
    const { setFeatureOwnerCode } = await load("./js/core/sovereignty_manager.js");
    const { applyOwnerToFeatureIds } = await load("./js/core/scenario_ownership_editor.js");
    const before = JSON.stringify(state.sovereigntyByFeatureId);
    actions.restoreProjectImportFields(state, { paintMode: "sovereignty" });
    state.updatePaintModeUIFn?.();
    return {
      mode: state.paintMode,
      changed: setFeatureOwnerCode("ui-shell-test", "GER"),
      result: applyOwnerToFeatureIds(["ui-shell-test"], "GER"),
      referenceUnchanged: JSON.stringify(state.sovereigntyByFeatureId) === before,
    };
  });
  expect(outcome.mode).toBe("visual");
  expect(outcome.changed).toBe(false);
  expect(outcome.result.reason).toBe("ownership-editing-disabled");
  expect(outcome.referenceUnchanged).toBe(true);

  await page.locator("#developerModeBtn").click();
  await expect(page.locator("#devWorkspacePanel")).toBeVisible();
  for (const id of ["devQuickOwnerInput", "devQuickUseTagBtn", "devQuickApplyOwnerBtn", "devQuickResetOwnerBtn", "devQuickSaveOwnersBtn"]) {
    await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator("#devScenarioOwnershipPanel")).toBeHidden();
  await expect(page.locator("#devScenarioTagCreatorPanel")).toBeHidden();
  // The quickbar is collapsed in this layout. The selection panel stays usable.
  await expect(page.locator("#devSelectionToggleSelectedBtn")).toBeVisible();
  await expect(page.locator("#devSelectionToggleSelectedBtn")).toBeEnabled();
  await expect(page.locator("#devSelectionRemoveLastBtn")).toBeVisible();
  await expect(page.locator("#devSelectionClearBtn")).toBeVisible();
  for (const category of ["scenario", "runtime", "selection"]) {
    await page.locator(`[data-dev-workspace-category="${category}"]`).click();
    await expect(page.locator("#devScenarioOwnershipPanel")).toBeHidden();
    await expect(page.locator("#devScenarioTagCreatorPanel")).toBeHidden();
  }
  await expect(page.locator("#devSelectionToggleSelectedBtn")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("visual-only-developer-workspace.png") });
  expect(errors).toEqual([]);
});

test("P3 real-map country paint, erase, history and current-format reload share one visual state", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/?default_scenario=modern_world&startup_interaction=full&startup_worker=0&startup_cache=0", { waitUntil: "domcontentloaded" });
  const { waitForAppInteractive, waitForRenderIdle } = require("./support/playwright-app");
  await waitForAppInteractive(page);
  await waitForRenderIdle(page);
  const result = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { state } = await load("./js/core/state.js");
    const { getMapDataBoundary } = await load("./js/core/map_data_boundary.js");
    const history = await load("./js/core/history_manager.js");
    const { restoreProjectImportFields } = await load("./js/core/state/actions/scenario_presentation_actions.js");
    const renderer = await load("./js/core/map_renderer.js");
    const funnel = await load("./js/core/interaction_funnel.js");
    const { FileManager } = await load("./js/core/file_manager.js");
    const reference = getMapDataBoundary(state).reference;
    const candidates = Array.from(state.landIndex.values()).filter(feature => {
      const origin = reference.getFeatureOrigin(feature);
      return ["BR", "FR", "AU"].includes(origin.geographicCountryCode)
        && !!origin.scenarioGroupCode
        && globalThis.d3.geoContains(feature, globalThis.d3.geoCentroid(feature));
    }).sort((a, b) => globalThis.d3.geoArea(b) - globalThis.d3.geoArea(a));
    const feature = candidates.find(feature => {
      const origin = reference.getFeatureOrigin(feature);
      const members = reference.getScenarioGroupFeatureIds(origin.scenarioGroupCode);
      return members.length > 1 && members.every(id => state.landIndex.has(id));
    });
    if (!feature) throw new Error("No fully loaded multi-feature reference country available in real modern_world");
    const origin = reference.getFeatureOrigin(feature);
    const ids = [...reference.getScenarioGroupFeatureIds(origin.scenarioGroupCode)];
    const point = renderer.projectGeoToScreen(...globalThis.d3.geoCentroid(feature));
    const rect = document.getElementById("mapContainer").getBoundingClientRect();
    const click = () => funnel.dispatchMapClick({
      clientX: rect.left + point[0], clientY: rect.top + point[1],
      detail: 1, timeStamp: performance.now(), preventDefault() {},
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    });
    const referenceBefore = JSON.stringify(reference.getScenarioAssignments());
    const paletteBefore = JSON.stringify(state.sovereignBaseColors);
    const before = history.captureHistoryState({ featureIds: ids });
    const { setClickSelectedColorState } = await load("./js/core/state/actions/renderer_interaction_actions.js");
    document.getElementById("toolFillBtn").click();
    if (state.brushModeEnabled) throw new Error("Real-map regression requires the normal click tool");
    restoreProjectImportFields(state, { interactionGranularity: "country" });
    setClickSelectedColorState(state, "#12ab34");
    history.clearHistory();
    await click();
    const fillHistoryCount = state.historyPast.length;
    const fillKind = state.historyPast.at(-1)?.kind;
    const painted = ids.every(id => state.visualOverrides[id] === "#12ab34");
    const after = history.captureHistoryState({ featureIds: ids });
    history.undoHistory();
    const undoRestored = JSON.stringify(history.captureHistoryState({ featureIds: ids })) === JSON.stringify(before);
    history.redoHistory();
    const redoRestored = JSON.stringify(history.captureHistoryState({ featureIds: ids })) === JSON.stringify(after);
    document.getElementById("toolEraserBtn").click();
    await click();
    const eraseKind = state.historyPast.at(-1)?.kind;
    const erased = ids.every(id => !Object.hasOwn(state.visualOverrides, id) && !Object.hasOwn(state.featureOverrides, id));
    const baseUnchanged = JSON.stringify(state.sovereignBaseColors) === paletteBefore;
    const referenceUnchanged = JSON.stringify(reference.getScenarioAssignments()) === referenceBefore;
    history.undoHistory();
    const exported = FileManager.buildProjectPayload(state);
    const serialized = JSON.stringify(exported);
    const savedAllPaint = ids.every(id => exported.visualOverrides[id] === "#12ab34");
    const imported = await funnel.importProjectTextThroughFunnel(serialized, { fileName: "p3-current-format.json" });
    return {
      scenario: state.activeScenarioId, group: origin.scenarioGroupCode, members: ids.length,
      fillHistoryCount, fillKind, painted, undoRestored, redoRestored, eraseKind, erased,
      baseUnchanged, referenceUnchanged, savedAllPaint,
      importStatus: imported?.status, reloadedPaint: ids.every(id => state.visualOverrides[id] === "#12ab34"),
      mode: state.paintMode,
    };
  });
  await testInfo.attach("real-map-transaction.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.scenario).toBe("modern_world");
  expect(result.members).toBeGreaterThan(1);
  expect(result.fillHistoryCount).toBe(1);
  expect(result.fillKind).toBe("fill-country-color");
  expect(result.eraseKind).toBe("erase-country-color");
  for (const key of ["painted", "undoRestored", "redoRestored", "erased", "baseUnchanged", "referenceUnchanged", "savedAllPaint", "reloadedPaint"]) {
    expect(result[key], key).toBe(true);
  }
  expect(["committed", "committed-with-warnings"]).toContain(result.importStatus);
  expect(result.mode).toBe("visual");
  expect(errors).toEqual([]);
});

// Pixel acceptance deliberately uses tiny geometries and the real worker/draw
// owner, so missing shared edges cannot hide behind a whole-world screenshot.
test('P3B worker contours render exact split seams and clear stale pixels', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await gotoApp(page, '/?ui_shell=1', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { createPaintContourRuntime } = await load('./js/core/renderer/paint_contour_runtime.js');
    const { createBorderDrawOwner } = await load('./js/core/renderer/border_draw_owner.js');
    const rect = (id, x) => ({ id, geometry: { type:'Polygon', coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]] } });
    const a = rect('A',0), b = rect('B',1);
    b.geometry.coordinates[0] = [[1,0],[2,0],[2,1],[1,1],[1,0.5],[1,0]];
    const state = { colorRevision:0, topologyRevision:0, activeScenarioId:'pixel-fixture',
      land:[a,b], styleConfig:{empireBorders:{color:'#ff0000',opacity:1,width:3},internalBorders:{opacity:0}},
      cachedCountryBorders:[{type:'MultiLineString',coordinates:[[[0,0],[2,1]]]}], cachedDetailAdmBorders:[] };
    const colors = { A:'#123456', B:'#654321' };
    const runtime = createPaintContourRuntime({state,getFeatures:()=>state.land,getFeatureId:f=>f.id,resolveColor:f=>colors[f.id]});
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=100;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    const project = p => [p[0]*40+10,70-p[1]*40];
    const owner = createBorderDrawOwner({state,getters:{getContext:()=>context,getProjection:()=>project,
      getPathCanvas:()=>mesh=>{ for(const line of mesh.coordinates){ line.forEach((point,i)=>{ const p=project(point); i?context.lineTo(...p):context.moveTo(...p); }); } }},
      helpers:{getPaintContourMeshes:()=>runtime.getMeshes(),isUsableMesh:m=>!!m?.coordinates?.length}});
    const draw = (interactive=false) => {context.clearRect(0,0,120,100); owner.drawHierarchicalBorders(1,{interactive});
      const pixels=context.getImageData(48,45,5,10).data;return [...pixels].filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0);};
    const ready = async () => {
      runtime.getMeshes();
      const until=performance.now()+15_000;
      while(runtime.diagnostics().status==='building'&&performance.now()<until)await new Promise(r=>setTimeout(r,20));
      if(runtime.diagnostics().status!=='ready')throw new Error(JSON.stringify(runtime.diagnostics()));
    };
    await ready();
    const different=draw(),interactive=draw(true),builds=runtime.diagnostics().builds;
    colors.B=colors.A;state.colorRevision++;runtime.notifyPaintChanged(['B']);const merged=draw();
    // Overlay colors must not participate in persistent contour resolution.
    state.colors={A:'#ff00ff',B:'#00ff00'};state.strategicChoroplethMetric='steel';const overlay=draw();
    colors.B='#654321';state.colorRevision++;runtime.notifyPaintChanged(['B']);const undo=draw();
    const noReindex=runtime.diagnostics().builds===builds;
    state.land=[a,rect('B',4)];state.topologyRevision++;const pending=draw();await ready();const moved=draw();
    state.land=[a,b,rect('supplement',2)];colors.supplement='#fedcba';state.topologyRevision++;await ready();
    const supplementCount=runtime.diagnostics().featureCount;
    state.activeScenarioId='new-scene';state.land=[];const cleared=draw();runtime.dispose();
    return {different,interactive,merged,overlay,undo,noReindex,pending,moved,supplementCount,cleared};
  });
  await testInfo.attach('contour-pixel-probes.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.different).toBeGreaterThan(0); expect(result.interactive).toBeGreaterThan(0);
  for(const key of ['merged','overlay','pending','moved','cleared'])expect(result[key],key).toBe(0);
  expect(result.undo).toBe(result.different);expect(result.noReindex).toBe(true);expect(result.supplementCount).toBe(3);
});

for (const scenario of ['modern_world', 'tno_1962']) {
  test(`P3B ${scenario} composed land paint, erase and history update contours without rebuilding geometry`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:1000});
    await gotoApp(page, `/?default_scenario=${scenario}&startup_interaction=full&startup_worker=0&startup_cache=0`, {waitUntil:'domcontentloaded'});
    const {waitForAppInteractive,waitForRenderIdle}=require('./support/playwright-app');
    await waitForAppInteractive(page,{timeout:30_000});
    await waitForRenderIdle(page,{scenarioId:scenario,timeout:30_000});
    await page.waitForFunction(async()=>{
      const renderer=await import(new URL('./js/core/map_renderer.js',location.href).href);
      return renderer.getPaintContourDiagnostics().status==='ready';
    },null,{timeout:25_000});
    const result=await page.evaluate(async()=>{
      const load=path=>import(new URL(path,location.href).href);
      const {state}=await load('./js/core/state.js');
      const renderer=await load('./js/core/map_renderer.js');
      const {applyFeaturePaintState}=await load('./js/core/state/color_state.js');
      const history=await load('./js/core/history_manager.js');
      // A promotion may land between the preceding poll and this task. Await
      // the actual generation here, then perform the synchronous transaction.
      await renderer.ensurePaintContoursReady();
      const initial=renderer.getPaintContourDiagnostics();
      const ids=state.landData.features.map(f=>String(f.properties?.id||f.id||'')).filter(Boolean);
      history.clearHistory();
      const before=history.captureHistoryState({featureIds:ids});
      applyFeaturePaintState(state,ids,'#142638');renderer.refreshResolvedColorsForFeatures(ids,{renderNow:true});
      const after=history.captureHistoryState({featureIds:ids});
      history.pushHistoryEntry({kind:'p3b-test-paint',before,after,meta:{}});
      const uniform=renderer.getPaintContourDiagnostics();
      history.undoHistory();const undo=renderer.getPaintContourDiagnostics();
      history.redoHistory();const redo=renderer.getPaintContourDiagnostics();
      applyFeaturePaintState(state,ids,null,{remove:true});renderer.refreshResolvedColorsForFeatures(ids,{renderNow:true});
      const erased=renderer.getPaintContourDiagnostics();
      return {scenario:state.activeScenarioId,initial,uniform,undo,redo,erased,
        supplementaryLand:ids.filter(id=>id.startsWith('ATL')).length,
        geometryStable:[uniform,undo,redo,erased].every(d=>d.builds===initial.builds&&d.sourceVersion===initial.sourceVersion)};
    });
    await testInfo.attach(`${scenario}-contours.json`,{body:JSON.stringify(result,null,2),contentType:'application/json'});
    expect(result.initial.activeArcCount).toBeGreaterThan(0);
    expect(result.uniform.activeArcCount).toBe(0);expect(result.redo.activeArcCount).toBe(0);
    expect(result.undo.activeArcCount).toBe(result.initial.activeArcCount);
    expect(result.erased.activeArcCount).toBe(result.initial.activeArcCount);
    expect(result.geometryStable).toBe(true);expect(errors).toEqual([]);
    if(scenario==='tno_1962')expect(result.supplementaryLand).toBeGreaterThan(0);
    await page.screenshot({path:testInfo.outputPath(`${scenario}-paint-contours.png`)});
  });
}
