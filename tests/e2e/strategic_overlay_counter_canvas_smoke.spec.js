const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  primeStateRef,
  waitForAppInteractive,
} = require("./support/playwright-app");

async function openFrontlineTab(page) {
  await page.evaluate(async () => {
    const sidebarModule = await import("/js/ui/sidebar.js");
    const mapRendererModule = await import("/js/core/map_renderer.js");
    if (
      !document.querySelector("#frontlineProjectSection")
      || !document.querySelector("#operationGraphicList")
      || !document.querySelector("#unitCounterList")
    ) {
      sidebarModule.initSidebar({ render: mapRendererModule.render });
    }
  });
  await page.evaluate(async () => {
    const projectTab = document.querySelector("#inspectorSidebarTabProject");
    if (projectTab instanceof HTMLElement) {
      projectTab.click();
    }
    const section = document.querySelector("#frontlineProjectSection");
    if (section instanceof HTMLDetailsElement) {
      section.open = true;
    }
    const { state } = await import("/js/core/state.js");
    if (!state.ui || typeof state.ui !== "object") {
      state.ui = {};
    }
    state.ui.rightSidebarTab = "project";
    state.updateScenarioUIFn?.();
    state.updateStrategicOverlayUIFn?.();
  });
  await expect(page.locator("#frontlineProjectSection")).toBeVisible();
}

async function setZoomPercentViaApi(page, percent) {
  await page.evaluate(async (nextPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(nextPercent);
  }, percent);
  await expect.poll(async () => {
    const zoomK = await page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      return Number(state.zoomTransform?.k || 0);
    });
    return Math.round(zoomK * 100);
  }, { timeout: 4000 }).toBe(percent);
}

test("unit counter canvas visibility stays hidden at 600 and turns visible at 700", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, undefined, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });
  await primeStateRef(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.unitCounters = [{
      id: "unit_canvas_smoke_1",
      renderer: "game",
      sidc: "INF",
      symbolCode: "INF",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      iconId: "infantry",
      unitType: "INF",
      echelon: "corps",
      label: "Canvas Smoke",
      organizationPct: 84,
      equipmentPct: 73,
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "GER" },
    }];
    state.unitCountersDirty = true;
    selectUnitCounterById("unit_canvas_smoke_1");
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  const counterGroup = page.locator('g.unit-counter[data-counter-id="unit_canvas_smoke_1"]');
  await setZoomPercentViaApi(page, 600);
  const hiddenState = await page.evaluate(() => {
    const node = document.querySelector('g.unit-counter[data-counter-id="unit_canvas_smoke_1"]');
    if (!node) return null;
    return {
      display: node.getAttribute("display") || "",
      opacity: Number(node.getAttribute("opacity") || 1),
    };
  });
  expect(
    hiddenState === null
      || hiddenState.display === "none"
      || hiddenState.opacity <= 0.05,
  ).toBeTruthy();

  await setZoomPercentViaApi(page, 700);
  await expect(counterGroup).toBeVisible();
});
