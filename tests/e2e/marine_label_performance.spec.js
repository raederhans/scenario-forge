const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("./support/playwright-app");

test("marine label redraw preserves pixels and records repeated geometry work", async ({ page }) => {
  test.setTimeout(60000);
  await gotoApp(page, "/?startup_interaction=full", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await page.evaluate(async () => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    await applyScenarioByIdCommand("tno_1962", { renderMode: "request", showToastOnComplete: false });
    const { state } = await import("/js/core/state.js");
    const { render, invalidateOceanWaterInteractionVisualState } = await import("/js/core/map_renderer.js");
    const { patchAppearanceVisibilityState } = await import("/js/core/state/actions/appearance_visibility_actions.js");
    patchAppearanceVisibilityState(state, { showWaterRegions: true, showOpenOceanRegions: true });
    invalidateOceanWaterInteractionVisualState("marine-label-perf");
    render();
  });
  await waitForRenderIdle(page, { scenarioId: "tno_1962" });
  const results = [];
  for (const view of ["world", "bo-hai"]) {
    if (view === "bo-hai") {
      expect(await page.evaluate(async () => {
        const { state } = await import("/js/core/state.js");
        const { focusWaterRegionById } = await import("/js/core/map_renderer.js");
        const { setClickSelectedWaterRegionIdState } = await import("/js/core/state/actions/scenario_presentation_actions.js");
        setClickSelectedWaterRegionIdState(state, "tno_bo_hai");
        return focusWaterRegionById(state.selectedWaterRegionId);
      })).toBe(true);
      await page.waitForFunction(async () => (await import("/js/core/state.js")).state.zoomTransform.k > 2);
      await waitForRenderIdle(page, { scenarioId: "tno_1962" });
    }
    const result = await page.evaluate(async (view) => {
      const { state } = await import("/js/core/state.js");
      const { renderExportPassesToCanvas } = await import("/js/core/map_renderer.js");
      const originalContains = globalThis.d3.geoContains;
      let calls = 0;
      globalThis.d3.geoContains = (...args) => { calls += 1; return originalContains(...args); };
      const samples = [];
      let firstPixels = null;
      let identical = true;
      try {
        for (let i = 0; i < 12; i += 1) {
          calls = 0;
          const canvas = renderExportPassesToCanvas(["labels"], { pixelRatio: state.dpr });
          const metric = state.renderPerfMetrics.drawMarineLabels;
          samples.push({ durationMs: metric.durationMs, containsCalls: calls, drawnCount: metric.drawnCount });
          // Compare exact pixels, outside the measured drawing interval.
          const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          if (!firstPixels) firstPixels = pixels;
          else if (pixels.some((value, index) => value !== firstPixels[index])) identical = false;
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally { globalThis.d3.geoContains = originalContains; }
      return { view, samples, identical, zoom: state.zoomTransform.k };
    }, view);
    expect(result.identical).toBe(true);
    expect(result.samples.every((sample) => sample.drawnCount > 0)).toBe(true);
    expect(result.samples.slice(1).map((sample) => sample.containsCalls)).toEqual(Array(11).fill(0));
    results.push(result);
  }
  const report = process.env.MARINE_PERF_REPORT || ".runtime/reports/generated/ocean-next/marine-label-perf.json";
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify(results, null, 2));
});
