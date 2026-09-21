#!/usr/bin/env node
// Focused live-app UI smoke. It does not claim to replay a pointer hit for every country.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const output = ".runtime/browser/quick-fill";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
let evidence = {};
try {
  await page.goto("http://127.0.0.1:8810/app/?startup_interaction=full&startup_worker=0&startup_cache=0", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => { globalThis.__qfState = (await import("./js/core/state.js")).state; });
  await page.waitForFunction(() => globalThis.__qfState?.bootBlocking === false && !globalThis.__qfState.scenarioApplyInFlight, undefined, { timeout: 90000 });
  evidence.boot = await page.evaluate(() => ({ scenario: globalThis.__qfState.activeScenarioId, leaves: globalThis.__qfState.landIndex?.size, readonly: globalThis.__qfState.startupReadonly }));
  // Seed the currently inspected feature; exercise the real toolbar/controller thereafter.
  await page.evaluate(async () => {
    const state = globalThis.__qfState;
    const feature = Array.from(state.landIndex?.values() || []).find((row) => row.properties?.id?.startsWith("FR_ARR_"));
    if (!feature) throw new Error("No French arrondissement in the live index");
    state.currentTool = "fill"; state.paintMode = "visual"; state.interactionGranularity = "subdivision";
    state.selectedInspectorCountryCode = "FR";
    state.devSelectedHit = { id: feature.properties.id, targetType: "land" };
    const { callRuntimeHook } = await import("./js/core/state/index.js");
    callRuntimeHook(state, "updatePaintModeUIFn");
  });
  await page.locator("#dockQuickFillBtn").click();
  const select = page.locator("#quickFillLevelSelect");
  await select.waitFor({ state: "visible" });
  evidence.options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, label: node.textContent })));
  assert.ok(evidence.options.some((option) => option.value === "level:department"));
  await select.selectOption("level:department");
  evidence.selectedScope = await page.evaluate(() => globalThis.__qfState.batchFillScope);
  assert.equal(evidence.selectedScope, "level:department");
  if (!(await select.isVisible())) await page.locator("#dockQuickFillBtn").click();
  await page.screenshot({ path: `${output}/france-department.png` });
  evidence.selectCount = await page.locator("#quickFillLevelSelect").count();
  assert.equal(evidence.selectCount, 1);
  await page.locator("#dockQuickFillBtn").click();
  // Replay real pointer events against existing geometry, including the leading
  // single click, then exercise the real history manager rather than synthetic entries.
  const locate = () => page.evaluate(async () => {
    const state = globalThis.__qfState;
    const feature = state.landIndex.get("FR_ARR_33002");
    if (!feature) throw new Error("Gironde probe is not loaded");
    const { projectGeoToScreen } = await import("./js/core/map_renderer.js");
    const point = projectGeoToScreen(...globalThis.d3.geoCentroid(feature));
    const rect = document.getElementById("mapContainer").getBoundingClientRect();
    return { x: rect.left + point[0], y: rect.top + point[1] };
  });
  let point = await locate();
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -1100);
  await page.waitForFunction(() => globalThis.__qfState.renderPhase === "idle", undefined, { timeout: 15000 });
  point = await locate();
  evidence.before = await page.evaluate(async () => {
    const state = globalThis.__qfState;
    state.selectedColor = "#12ab34";
    const ids = state.hierarchyData.quick_fill.countries.FR.levels.department.groups.FR_DEPT_33.feature_ids
      .filter((id) => state.sovereigntyByFeatureId[id] === state.sovereigntyByFeatureId.FR_ARR_33002);
    const history = await import("./js/core/history_manager.js");
    history.clearHistory();
    return { ids, snapshot: history.captureHistoryState({ featureIds: ids }) };
  });
  await page.mouse.dblclick(point.x, point.y, { delay: 100 });
  await page.waitForFunction(() => globalThis.__qfState.historyPast.some((entry) => entry.kind === "fill-parent-group"), undefined, { timeout: 10000 });
  evidence.gesture = await page.evaluate(async (ids) => {
    const state = globalThis.__qfState;
    const history = await import("./js/core/history_manager.js");
    const count = state.historyPast.length;
    const entry = state.historyPast.at(-1);
    const after = history.captureHistoryState({ featureIds: ids });
    const undo = history.undoHistory();
    const restored = history.captureHistoryState({ featureIds: ids });
    const redo = history.redoHistory();
    const replayed = history.captureHistoryState({ featureIds: ids });
    return { count, kind: entry?.kind, targetIds: Object.keys(entry?.after?.visualOverrides || {}), after, undo, restored, redo, replayed };
  }, evidence.before.ids);
  assert.equal(evidence.gesture.count, 1, "one pointer double-click must create one undo entry");
  assert.deepEqual(evidence.gesture.targetIds.sort(), [...evidence.before.ids].sort());
  assert.ok(evidence.before.ids.length > 1);
  assert.ok(Object.values(evidence.gesture.after.visualOverrides).every((color) => color === "#12ab34"));
  assert.equal(evidence.gesture.undo, true);
  assert.deepEqual(evidence.gesture.restored, evidence.before.snapshot);
  assert.equal(evidence.gesture.redo, true);
  assert.deepEqual(evidence.gesture.replayed, evidence.gesture.after);
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ ...evidence, pageErrors: errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(evidence));
