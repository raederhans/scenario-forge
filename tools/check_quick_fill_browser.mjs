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
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ ...evidence, pageErrors: errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(evidence));
