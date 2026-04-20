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
  await page.evaluate(() => {
    const projectTab = document.querySelector("#inspectorSidebarTabProject");
    if (projectTab instanceof HTMLElement) {
      projectTab.click();
    }
  });
  await page.evaluate(() => {
    const section = document.querySelector("#frontlineProjectSection");
    if (section instanceof HTMLDetailsElement) {
      section.open = true;
    }
  });
  await expect(page.locator("#frontlineProjectSection")).toBeVisible();
  await page.waitForFunction(() => {
    const section = document.querySelector("#frontlineProjectSection");
    return !!section?.open
      && !!document.querySelector("#frontlineOverlayPanel")
      && !!document.querySelector("#strategicOverlayPanel");
  });
}

test("strategic overlay smoke keeps frontline wiring, line editing, and counter editing alive", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, undefined, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });
  await primeStateRef(page);
  await openFrontlineTab(page);

  const activeScenarioId = await page.evaluate(() => String(globalThis.__playwrightStateRef?.activeScenarioId || ""));
  expect(activeScenarioId).toBe("tno_1962");

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectOperationalLineById, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.operationalLines = [{
      id: "opl_smoke_1",
      kind: "frontline",
      label: "Smoke Line",
      points: [[8, 48], [13, 49], [18, 51]],
      stylePreset: "frontline",
      stroke: "#6b7280",
      width: 2.1,
      opacity: 0.82,
      attachedCounterIds: ["unit_smoke_1"],
    }];
    state.unitCounters = [{
      id: "unit_smoke_1",
      renderer: "game",
      sidc: "INF",
      symbolCode: "INF",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      iconId: "infantry",
      unitType: "INF",
      echelon: "corps",
      label: "Smoke Counter",
      subLabel: "Nord",
      strengthText: "",
      organizationPct: 84,
      equipmentPct: 73,
      statsPresetId: "regular",
      statsSource: "preset",
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "GER" },
      layoutAnchor: { kind: "attachment", key: "opl_smoke_1", slotIndex: 0 },
      attachment: { kind: "operational-line", lineId: "opl_smoke_1" },
    }];
    state.operationalLinesDirty = true;
    state.unitCountersDirty = true;
    selectOperationalLineById("opl_smoke_1");
    selectUnitCounterById("unit_smoke_1");
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  await expect(page.locator("#operationalLineList")).toHaveValue("opl_smoke_1");
  await page.locator("#operationalLineLabelInput").fill("Smoke Line Updated");
  await page.locator("#operationalLineLabelInput").blur();
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    const line = (state?.operationalLines || []).find((entry) => entry.id === "opl_smoke_1");
    return line?.label === "Smoke Line Updated";
  });

  await expect(page.locator("#unitCounterList")).toHaveValue("unit_smoke_1");
  await page.locator("#unitCounterLabelInput").fill("Smoke Counter Updated");
  await page.locator("#unitCounterLabelInput").blur();
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    const counter = (state?.unitCounters || []).find((entry) => entry.id === "unit_smoke_1");
    return counter?.label === "Smoke Counter Updated";
  });

  const runtimeState = await page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    return {
      lineLabel: state?.operationalLines?.[0]?.label || "",
      attachedCounterIds: state?.operationalLines?.[0]?.attachedCounterIds || [],
      counterLabel: state?.unitCounters?.[0]?.label || "",
      activeMode: String(state?.strategicOverlayUi?.activeMode || ""),
    };
  });

  expect(runtimeState.lineLabel).toBe("Smoke Line Updated");
  expect(runtimeState.attachedCounterIds).toEqual(["unit_smoke_1"]);
  expect(runtimeState.counterLabel).toBe("Smoke Counter Updated");
  expect(runtimeState.activeMode).toBe("idle");
});
