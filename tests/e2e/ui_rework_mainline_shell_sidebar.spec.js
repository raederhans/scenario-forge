const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");


test("phase 02 shell and sidebar mainline stays on the new rails", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await expect(page.locator("#scenarioContextBar #scenarioTransportWorkbenchBtn")).toHaveCount(0);
  await expect(page.locator("#zoomControls #scenarioTransportWorkbenchBtn")).toBeVisible();
  await expect(page.locator("#scenarioGuideBtn")).toHaveText("Guide");

  await expect(page.locator("#dockEditPopoverBtn")).toHaveCount(0);
  await expect(page.locator("#presetClear")).toHaveCount(0);

  await expect(page.locator("#dockReferenceBtn")).toHaveText("Reference");
  await expect(page.locator("#dockExportBtn")).toHaveText("Open workbench");

  await page.locator("#scenarioGuideBtn").click();

  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);

  const search = await page.evaluate(() => globalThis.location.search);
  expect(search).toContain("view=guide");

  await page.keyboard.press("Escape");
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("#scenarioGuideBtn")).toBeFocused();
});


test("adaptive scenario bar and bottom dock stay inside the viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 760 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.evaluate(() => {
    const scenarioText = document.querySelector("#scenarioContextScenarioText");
    if (scenarioText) {
      scenarioText.textContent = "Scenario: " + "Very Long Scenario Name ".repeat(16);
    }
    const activeText = document.querySelector("#scenarioContextActiveText");
    if (activeText) {
      activeText.textContent = "Active: " + "Very Long Country Name ".repeat(16);
    }
  });

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const scenario = rectToObject(document.querySelector("#scenarioContextBar")?.getBoundingClientRect());
    const zoom = rectToObject(document.querySelector("#zoomControls")?.getBoundingClientRect());
    const dock = rectToObject(document.querySelector("#bottomDock")?.getBoundingClientRect());
    return {
      scenario,
      zoom,
      dock,
      viewportWidth: window.innerWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      scenarioStyle: document.querySelector("#scenarioContextBar")?.getAttribute("style") || "",
      scenarioMaxWidth: document.querySelector("#scenarioContextBar")?.style.maxWidth || "",
    };
  });

  expect(metrics.scenarioMaxWidth).toBe("");
  expect(metrics.scenario.left).toBeGreaterThanOrEqual(0);
  expect(metrics.scenario.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dock.left).toBeGreaterThanOrEqual(0);
  expect(metrics.dock.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.scenario.bottom <= metrics.zoom.top || metrics.scenario.top >= metrics.zoom.bottom || metrics.scenario.right <= metrics.zoom.left).toBeTruthy();
});


test("top scenario and utility bars align and tool switching stays inline", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#toolEraserBtn").click();
  await page.waitForTimeout(160);

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    } : null;
    const scenario = document.querySelector("#scenarioContextBar");
    const zoom = document.querySelector("#zoomControls");
    const toolHud = document.querySelector("#toolHudChip");
    const scenarioStyle = scenario ? getComputedStyle(scenario) : null;
    const zoomStyle = zoom ? getComputedStyle(zoom) : null;
    return {
      scenario: rectToObject(scenario?.getBoundingClientRect()),
      zoom: rectToObject(zoom?.getBoundingClientRect()),
      toolHud: rectToObject(toolHud?.getBoundingClientRect()),
      toolHudVisible: toolHud ? getComputedStyle(toolHud).display !== "none" && !toolHud.classList.contains("hidden") : false,
      scenarioRadius: scenarioStyle?.borderRadius || "",
      zoomRadius: zoomStyle?.borderRadius || "",
      scenarioShadow: scenarioStyle?.boxShadow || "",
      zoomShadow: zoomStyle?.boxShadow || "",
    };
  });

  expect(Math.abs(metrics.scenario.top - metrics.zoom.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.scenario.bottom - metrics.zoom.bottom)).toBeLessThanOrEqual(1);
  expect(metrics.scenario.right).toBeLessThan(metrics.zoom.left);
  expect(metrics.scenarioRadius).toBe(metrics.zoomRadius);
  expect(metrics.scenarioShadow).toContain("rgba");
  expect(metrics.zoomShadow).toContain("rgba");
  expect(metrics.toolHudVisible).toBe(false);
  expect(metrics.toolHud.width).toBe(0);
});


test("desktop bottom dock keeps quick controls in a usable horizontal rail", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    } : null;
    const dock = document.querySelector("#bottomDock");
    const primary = document.querySelector("#bottomDock .bottom-dock-primary");
    const groups = [...document.querySelectorAll("#bottomDock .dock-group")].map((group) => {
      const rect = group.getBoundingClientRect();
      return {
        className: group.className,
        rect: rectToObject(rect),
      };
    });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dock: rectToObject(dock?.getBoundingClientRect()),
      primary: rectToObject(primary?.getBoundingClientRect()),
      dockScrollWidth: dock?.scrollWidth || 0,
      dockClientWidth: dock?.clientWidth || 0,
      primaryScrollWidth: primary?.scrollWidth || 0,
      primaryClientWidth: primary?.clientWidth || 0,
      dockFlexDirection: dock ? getComputedStyle(dock).flexDirection : "",
      primaryGridColumns: primary ? getComputedStyle(primary).gridTemplateColumns : "",
      groups,
    };
  });

  expect(metrics.dockFlexDirection).toBe("row");
  expect(metrics.dock.width).toBeGreaterThan(520);
  expect(metrics.dock.height).toBeLessThan(96);
  expect(metrics.dock.left).toBeGreaterThanOrEqual(0);
  expect(metrics.dock.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dockScrollWidth).toBeLessThanOrEqual(metrics.dockClientWidth + 1);
  expect(metrics.primaryScrollWidth).toBeLessThanOrEqual(metrics.primaryClientWidth + 1);
  expect(metrics.primaryGridColumns.split(" ").length).toBeGreaterThanOrEqual(4);
  for (const group of metrics.groups) {
    expect(group.rect.width).toBeGreaterThan(34);
    expect(group.rect.left).toBeGreaterThanOrEqual(metrics.dock.left - 1);
    expect(group.rect.right).toBeLessThanOrEqual(metrics.dock.right + 1);
    expect(group.rect.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  }
});

test("country inspector submenus keep hierarchy and compact adaptive heights", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.evaluate(() => {
    document.querySelector("#countryInspectorSection")?.setAttribute("open", "");
    document.querySelector("#selectedCountryActionsSection")?.setAttribute("open", "");
    document.querySelector("#specialRegionInspectorSection")?.setAttribute("open", "");
    document.querySelector("#waterInspectorSection")?.setAttribute("open", "");
    if (typeof globalThis.__playwrightStateRef?.renderCountryListFn === "function") {
      globalThis.__playwrightStateRef.renderCountryListFn();
    }
  });
  await page.waitForTimeout(180);
  await page.locator("#countryList .country-select-main-btn").first().click();
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    document.querySelectorAll("#presetTree details").forEach((details) => {
      if (details instanceof HTMLDetailsElement) details.open = true;
    });
    const firstDisclosureBody = document.querySelector("#presetTree .inspector-action-disclosure-body");
    if (firstDisclosureBody) {
      for (let index = 0; index < 24; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scenario-action-card";
        button.textContent = `Stress preset action ${index + 1}`;
        firstDisclosureBody.appendChild(button);
      }
    }
  });
  await page.waitForTimeout(120);

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    } : null;
    const sidebar = document.querySelector("#rightSidebar");
    const sidebarRect = sidebar.getBoundingClientRect();
    const countrySection = document.querySelector("#countryInspectorSection");
    const actionSection = document.querySelector("#selectedCountryActionsSection");
    const countryList = document.querySelector("#countryList");
    const presetTree = document.querySelector("#presetTree");
    const actionBody = actionSection?.querySelector(".inspector-panel-body");
    const actionBodyStyle = actionBody ? getComputedStyle(actionBody) : null;
    const specialSection = document.querySelector("#specialRegionInspectorSection");
    const waterSection = document.querySelector("#waterInspectorSection");
    const colorRow = document.querySelector("#countryInspectorColorRow");
    const firstGroup = document.querySelector("#countryList > .country-explorer-group:not(.country-select-card)");
    const firstRow = document.querySelector("#countryList .country-select-row");
    const presetSummaries = [...document.querySelectorAll("#presetTree summary")].map((summary) => String(summary.textContent || "").trim());
    const presetText = String(presetTree.textContent || "");
    const disclosureBodies = [...document.querySelectorAll("#presetTree .inspector-action-disclosure-body")].map((element) => {
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
        maxHeight: style.maxHeight,
      };
    });
    const naturalActionLists = [...document.querySelectorAll("#presetTree .inspector-action-list-natural")].map((element) => {
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
        maxHeight: style.maxHeight,
      };
    });
    const visualAdjustmentBody = document.querySelector("#presetTree .scenario-visual-adjustments-body");
    const visualAdjustmentStyle = visualAdjustmentBody ? getComputedStyle(visualAdjustmentBody) : null;
    const visibleOverflow = [...document.querySelectorAll("#inspectorSidebarPanel *")].filter((element) => {
      if (element.classList.contains("info-tooltip")) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0
        && (rect.left < sidebarRect.left - 1 || rect.right > sidebarRect.right + 1);
    }).map((element) => element.id || element.className || element.tagName).slice(0, 10);
    return {
      countrySectionRect: rectToObject(countrySection.getBoundingClientRect()),
      actionSectionRect: rectToObject(actionSection.getBoundingClientRect()),
      countryListRect: rectToObject(countryList.getBoundingClientRect()),
      presetTreeRect: rectToObject(presetTree.getBoundingClientRect()),
      actionBodyClientHeight: actionBody?.clientHeight || 0,
      actionBodyScrollHeight: actionBody?.scrollHeight || 0,
      actionBodyOverflowY: actionBodyStyle?.overflowY || "",
      actionBodyMaxHeight: actionBodyStyle?.maxHeight || "",
      countryListClientHeight: countryList.clientHeight,
      countryListScrollHeight: countryList.scrollHeight,
      presetTreeClientHeight: presetTree.clientHeight,
      presetTreeOverflowY: getComputedStyle(presetTree).overflowY,
      countrySectionRadius: getComputedStyle(countrySection).borderRadius,
      actionSectionRadius: getComputedStyle(actionSection).borderRadius,
      specialSectionRadius: specialSection ? getComputedStyle(specialSection).borderRadius : "",
      waterSectionRadius: waterSection ? getComputedStyle(waterSection).borderRadius : "",
      colorRowVisible: colorRow ? getComputedStyle(colorRow).display !== "none" : false,
      firstGroupBackground: firstGroup ? getComputedStyle(firstGroup).backgroundImage : "",
      firstRowBackground: firstRow ? getComputedStyle(firstRow).backgroundImage : "",
      firstRowTransition: firstRow ? getComputedStyle(firstRow).transitionProperty : "",
      presetSummaries,
      presetText,
      disclosureBodies,
      naturalActionLists,
      visualAdjustmentOverflowY: visualAdjustmentStyle?.overflowY || "",
      visualAdjustmentMaxHeight: visualAdjustmentStyle?.maxHeight || "",
      visibleOverflow,
    };
  });

  expect(metrics.countrySectionRadius).toBe("18px");
  expect(metrics.actionSectionRadius).toBe("18px");
  expect(metrics.countryListRect.width).toBeGreaterThan(180);
  expect(metrics.countryListClientHeight).toBeGreaterThanOrEqual(260);
  expect(metrics.countryListClientHeight).toBeLessThanOrEqual(280);
  expect(metrics.countryListScrollHeight).toBeGreaterThan(metrics.countryListClientHeight);
  expect(metrics.actionBodyClientHeight).toBeGreaterThanOrEqual(480);
  expect(metrics.actionBodyClientHeight).toBeLessThanOrEqual(490);
  expect(metrics.actionBodyScrollHeight).toBeGreaterThan(metrics.actionBodyClientHeight);
  expect(metrics.actionBodyOverflowY).toBe("auto");
  expect(metrics.actionBodyMaxHeight).not.toBe("none");
  expect(metrics.presetTreeClientHeight).toBeGreaterThan(metrics.actionBodyClientHeight);
  expect(metrics.presetTreeOverflowY).toBe("visible");
  expect(metrics.specialSectionRadius).toBe("18px");
  expect(metrics.waterSectionRadius).toBe("18px");
  expect(metrics.colorRowVisible).toBe(false);
  expect(metrics.actionSectionRect.top).toBeGreaterThan(metrics.countrySectionRect.top);
  expect(metrics.firstGroupBackground).toContain("linear-gradient");
  expect(metrics.firstRowBackground).toContain("linear-gradient");
  expect(metrics.firstRowTransition).not.toContain("transform");
  expect(metrics.presetText).not.toContain("Notes");
  expect(metrics.presetSummaries).not.toContain("Navigation");
  expect(metrics.disclosureBodies.length).toBeGreaterThan(0);
  expect(metrics.disclosureBodies.some((body) => body.overflowY === "auto" && body.scrollHeight > body.clientHeight)).toBe(true);
  expect(metrics.disclosureBodies.every((body) => body.maxHeight !== "none")).toBe(true);
  expect(metrics.naturalActionLists.every((list) => list.overflowY === "auto" && list.maxHeight !== "none")).toBe(true);
  expect(metrics.visualAdjustmentOverflowY).toBe("auto");
  expect(metrics.visualAdjustmentMaxHeight).not.toBe("none");
  expect(metrics.visibleOverflow).toEqual([]);
});
