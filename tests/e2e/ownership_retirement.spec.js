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
  test.setTimeout(180_000);
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
