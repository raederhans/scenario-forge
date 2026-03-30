const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);

async function gotoReady(page) {
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 45_000 });
}

async function installBoundarySpy(page) {
  await page.evaluate(async () => {
    const { bindRenderBoundary } = await import("/js/core/render_boundary.js");
    const { state } = await import("/js/core/state.js");
    globalThis.__pwShortcutHistoryBoundary = {
      flushes: [],
      schedules: [],
      state,
    };
    bindRenderBoundary({
      scheduleRender(payload = {}) {
        globalThis.__pwShortcutHistoryBoundary.schedules.push({
          reason: String(payload.reason || ""),
          reasons: Array.isArray(payload.reasons) ? [...payload.reasons] : [],
        });
      },
      flushRender(payload = {}) {
        globalThis.__pwShortcutHistoryBoundary.flushes.push(String(payload.reason || ""));
      },
    });
  });
}

async function resetBoundarySpy(page) {
  await page.evaluate(() => {
    globalThis.__pwShortcutHistoryBoundary.flushes = [];
    globalThis.__pwShortcutHistoryBoundary.schedules = [];
  });
}

async function readFlushes(page) {
  return page.evaluate(() => [...(globalThis.__pwShortcutHistoryBoundary?.flushes || [])]);
}

test("history undo and redo flush through render boundary", async ({ page }) => {
  await gotoReady(page);
  await installBoundarySpy(page);

  await page.evaluate(async () => {
    const { undoHistory, redoHistory } = await import("/js/core/history_manager.js");
    const state = globalThis.__pwShortcutHistoryBoundary.state;
    const featureId = Array.from(state.landIndex?.keys?.() || []).find(Boolean) || "TEST_FEATURE";
    state.visualOverrides = {
      [featureId]: { fill: "#112233" },
    };
    state.featureOverrides = {
      [featureId]: null,
    };
    state.historyPast = [{
      before: {
        visualOverrides: {
          [featureId]: null,
        },
        featureOverrides: {
          [featureId]: null,
        },
      },
      after: {
        visualOverrides: {
          [featureId]: { fill: "#112233" },
        },
        featureOverrides: {
          [featureId]: null,
        },
      },
      meta: {},
    }];
    state.historyFuture = [];
    state.updateHistoryUIFn = () => {};
    state.updateToolUIFn = () => {};
    state.updateSwatchUIFn = () => {};
    state.updatePaintModeUIFn = () => {};
    state.updateToolbarInputsFn = () => {};
    state.updateActiveSovereignUIFn = () => {};
    state.renderCountryListFn = () => {};
    state.renderWaterRegionListFn = () => {};
    state.renderSpecialRegionListFn = () => {};
    state.renderPresetTreeFn = () => {};
    state.updateLegendUI = () => {};
    state.updateStrategicOverlayUIFn = () => {};
    state.refreshColorStateFn = () => {};
    state.recomputeDynamicBordersNowFn = () => {};

    undoHistory();
    redoHistory();
  });

  await expect.poll(async () => readFlushes(page)).toEqual([
    "history-undo",
    "history-redo",
  ]);
});

test("Escape shortcut flushes for strategic overlay cancel and special-zone cancel", async ({ page }) => {
  await gotoReady(page);
  await installBoundarySpy(page);

  await page.evaluate(async () => {
    const state = globalThis.__pwShortcutHistoryBoundary.state;
    state.unitCounters = [];
    state.unitCounterEditor = {
      ...(state.unitCounterEditor || {}),
      active: true,
      selectedId: null,
      returnSelectionId: null,
    };
  });

  await page.keyboard.press("Escape");
  await expect.poll(async () => readFlushes(page)).toContain("shortcut-strategic-overlay-cancel");

  await resetBoundarySpy(page);
  await page.evaluate(async () => {
    const state = globalThis.__pwShortcutHistoryBoundary.state;
    state.unitCounterEditor = {
      ...(state.unitCounterEditor || {}),
      active: false,
    };
    state.specialZoneEditor = {
      ...(state.specialZoneEditor || {}),
      active: true,
      vertices: [[0, 0]],
      zoneType: "disputed",
      label: "",
    };
  });

  await page.keyboard.press("Escape");
  await expect.poll(async () => readFlushes(page)).toContain("shortcut-special-zone-cancel");
});
