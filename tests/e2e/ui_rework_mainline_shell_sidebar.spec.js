const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function expectDockCommandsToFit(page, width) {
  const ids = ["toolFillBtn", "toolEraserBtn", "toolEyedropperBtn", "brushModeBtn",
    "undoBtn", "redoBtn", "presetPolitical", "paintModeVisualBtn", "paintModePoliticalBtn", "selectedColorPreview"];
  const boxes = [];
  for (const id of ids) {
    const control = page.locator(`#${id}`);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(width);
    boxes.push({ id, ...box });
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (const other of boxes.slice(i + 1)) {
      const box = boxes[i];
      const overlaps = box.x < other.x + other.width - 1 && box.x + box.width > other.x + 1
        && box.y < other.y + other.height - 1 && box.y + box.height > other.y + 1;
      expect(overlaps, `${box.id} overlaps ${other.id} at ${width}px`).toBe(false);
    }
  }
}

test("desktop commands and tablet drawers remain usable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoApp(page, "/?ui_shell=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#workspaceExportBtn")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#bootOverlay")).toBeHidden();
  for (const width of [1366, 1440, 1920, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await expectDockCommandsToFit(page, width);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator("#workspaceExportBtn").click();
  await expect(page.locator("#exportWorkbenchParams")).toBeHidden();
  const fields = await page.locator(".export-workbench-field").evaluateAll((nodes) => nodes.map((node) => ({
    width: node.clientWidth, scrollWidth: node.scrollWidth,
    labelHeight: node.querySelector("label").getBoundingClientRect().height,
  })));
  for (const field of fields) {
    expect(field.width).toBeGreaterThan(100);
    expect(field.scrollWidth).toBeLessThanOrEqual(field.width + 1);
    expect(field.labelHeight).toBeLessThan(36);
  }
  await page.locator("#exportWorkbenchAdvancedBtn").click();
  await expect(page.locator("#exportWorkbenchParams")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#workspaceExportBtn")).toBeFocused();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectDockCommandsToFit(page, 768);
  await expect(page.locator("#leftSidebar")).toHaveJSProperty("inert", true);
  await expect(page.locator("#rightSidebar")).toHaveJSProperty("inert", true);
  await page.locator("#leftPanelToggle").click();
  const close = page.locator('[data-close-drawer="left"]');
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.getElementById("leftSidebar").contains(document.activeElement))).toBe(true);
  await expect(close).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#leftPanelToggle")).toBeFocused();
  await expect(page.locator("#leftSidebar")).toHaveJSProperty("inert", true);
  await page.locator("#rightPanelToggle").click();
  await expect(page.locator('[data-close-drawer="right"]')).toBeFocused();
  await page.locator('[data-close-drawer="right"]').click();
  await expect(page.locator("#rightPanelToggle")).toBeFocused();
});

test("desktop export preview opens with the real scenario", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#workspaceExportBtn")).toBeEnabled();
  await expect(page.locator("#themeSelect")).not.toHaveValue("");
  await expect(page.locator("#paletteLibrarySources")).toBeHidden();
  await expectDockCommandsToFit(page, 1440);
  const closedSections = await page.locator("#rightSidebar details.card:not([open])").evaluateAll((nodes) =>
    nodes.filter((node) => node.getClientRects().length).map((node) => node.getBoundingClientRect().height));
  for (const height of closedSections) expect(height).toBeLessThanOrEqual(58);
  await page.screenshot({ path: testInfo.outputPath("editor-desktop.png") });
  await page.locator("#workspaceExportBtn").click();
  await expect(page.locator("#exportWorkbenchPanel")).toBeVisible();
  await expect(page.locator("#exportWorkbenchParams")).toBeHidden();
  await expect(page.locator("#exportWorkbenchSnapshotBtn")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#exportWorkbenchPreviewStage canvas")).toBeVisible();
  await expect(page.locator("#exportWorkbenchPreviewLayerSelect")).toHaveCSS("opacity", "0");
  await page.screenshot({ path: testInfo.outputPath("export-desktop.png") });
  await page.locator("#exportWorkbenchAdvancedBtn").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#exportWorkbenchSnapshotBtn")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#exportWorkbenchAdvancedBtn")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#workspaceExportBtn")).toBeFocused();
});


test("phase 02 shell and sidebar mainline stays on the new rails", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await expect(page.locator("#scenarioContextBar #scenarioTransportWorkbenchBtn")).toHaveCount(0);
  await expect(page.locator("#zoomControls #scenarioTransportWorkbenchBtn")).toHaveCount(0);
  await page.locator("#inspectorSidebarTabProject").click();
  const transportSection = page.locator("#transportProjectSection");
  if ((await transportSection.evaluate((node) => node.open)) !== true) {
    await page.locator("#lblTransportProject").click();
  }
  await expect(transportSection).toHaveJSProperty("open", true);
  await expect(page.locator("#projectSidebarPanel #scenarioTransportWorkbenchBtn")).toBeVisible();
  await expect(page.locator("#projectSidebarPanel #scenarioTransportWorkbenchBtn")).toHaveText("Open workbench");
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
  expect(metrics.dock.height).toBeLessThanOrEqual(96);
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
    const specialList = document.querySelector("#specialRegionList");
    const specialEmpty = document.querySelector("#specialRegionInspectorEmpty");
    const specialVisibilityToggleRow = document.querySelector("#scenarioSpecialRegionVisibilityToggle")?.closest(".toggle-label");
    const specialReliefToggleRow = document.querySelector("#scenarioReliefOverlayVisibilityToggle")?.closest(".toggle-label");
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
    const fontSampleSelectors = [
      "#selectedCountryActionsSection .sidebar-section-title",
      "#selectedCountryActionsSection .scenario-action-card",
      "#countryList .country-select-title",
      "#specialRegionInspectorSection .toggle-label",
      "#waterInspectorSection .select-input",
      "#specialRegionInspectorSection .sidebar-tool-hint",
      "#waterInspectorSection .sidebar-field-label",
    ];
    const fontSamples = Object.fromEntries(fontSampleSelectors.map((selector) => {
      const element = document.querySelector(selector);
      const style = element ? getComputedStyle(element) : null;
      return [selector, {
        exists: !!element,
        fontFamily: style?.fontFamily || "",
        fontSize: style?.fontSize || "",
        lineHeight: style?.lineHeight || "",
      }];
    }));
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
      viewportHeight: window.innerHeight,
      countrySectionRect: rectToObject(countrySection.getBoundingClientRect()),
      actionSectionRect: rectToObject(actionSection.getBoundingClientRect()),
      actionSectionClass: actionSection?.className || "",
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
      specialSectionHidden: specialSection ? specialSection.classList.contains("hidden") : true,
      specialSectionEmptyPanel: specialSection ? specialSection.classList.contains("is-empty-scenario-panel") : false,
      specialSectionDisplay: specialSection ? getComputedStyle(specialSection).display : "",
      specialListHidden: specialList ? specialList.classList.contains("hidden") : true,
      specialListClientHeight: specialList?.clientHeight || 0,
      specialListMaxHeight: specialList ? getComputedStyle(specialList).maxHeight : "",
      specialVisibilityToggleHeight: specialVisibilityToggleRow?.getBoundingClientRect().height || 0,
      specialReliefToggleHeight: specialReliefToggleRow?.getBoundingClientRect().height || 0,
      specialEmptyClientHeight: specialEmpty?.clientHeight || 0,
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
      fontSamples,
      visibleOverflow,
    };
  });

  expect(metrics.countrySectionRadius).toBe("18px");
  expect(metrics.actionSectionRadius).toBe("18px");
  expect(metrics.countryListRect.width).toBeGreaterThan(180);
  expect(metrics.countryListClientHeight).toBeGreaterThanOrEqual(220);
  expect(metrics.countryListClientHeight).toBeLessThanOrEqual(320);
  expect(metrics.countryListScrollHeight).toBeGreaterThan(metrics.countryListClientHeight);
  expect(metrics.actionBodyClientHeight).toBeGreaterThanOrEqual(420);
  if (metrics.actionSectionClass.includes("has-open-visual-adjustments")) {
    expect(metrics.actionBodyClientHeight).toBeLessThanOrEqual(Math.ceil(metrics.viewportHeight * 0.66));
  } else {
    expect(metrics.actionBodyClientHeight).toBeLessThanOrEqual(560);
  }
  expect(metrics.actionBodyScrollHeight).toBeGreaterThan(metrics.actionBodyClientHeight);
  expect(metrics.actionBodyOverflowY).toBe("auto");
  expect(metrics.actionBodyMaxHeight).not.toBe("none");
  expect(metrics.presetTreeClientHeight).toBeGreaterThan(metrics.actionBodyClientHeight);
  expect(metrics.presetTreeOverflowY).toBe("visible");
  expect(metrics.specialSectionRadius).toBe("18px");
  expect(metrics.specialSectionHidden).toBe(false);
  expect(metrics.specialSectionDisplay).not.toBe("none");
  if (metrics.specialSectionEmptyPanel) {
    expect(metrics.specialEmptyClientHeight).toBeGreaterThan(0);
  } else {
    const hasVisibleSpecialRegionList = !metrics.specialListHidden && metrics.specialListClientHeight > 0;
    const hasVisibleSpecialRegionControls = metrics.specialVisibilityToggleHeight > 0 || metrics.specialReliefToggleHeight > 0;
    expect(hasVisibleSpecialRegionList || hasVisibleSpecialRegionControls).toBe(true);
  }
  expect(metrics.specialListMaxHeight).not.toBe("none");
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
  const fontSizeOf = (selector) => parseFloat(metrics.fontSamples[selector].fontSize);
  for (const sample of Object.values(metrics.fontSamples)) {
    expect(sample.exists).toBe(true);
    expect(sample.fontFamily.length).toBeGreaterThan(0);
  }
  expect(fontSizeOf("#selectedCountryActionsSection .sidebar-section-title")).toBeGreaterThan(fontSizeOf("#countryList .country-select-title"));
  expect(fontSizeOf("#countryList .country-select-title")).toBeGreaterThan(fontSizeOf("#specialRegionInspectorSection .toggle-label"));
  expect(Math.abs(fontSizeOf("#specialRegionInspectorSection .toggle-label") - fontSizeOf("#selectedCountryActionsSection .scenario-action-card"))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(fontSizeOf("#waterInspectorSection .select-input") - fontSizeOf("#selectedCountryActionsSection .scenario-action-card"))).toBeLessThanOrEqual(0.5);
  expect(fontSizeOf("#specialRegionInspectorSection .sidebar-tool-hint")).toBeLessThan(fontSizeOf("#specialRegionInspectorSection .toggle-label"));
  expect(fontSizeOf("#waterInspectorSection .sidebar-field-label")).toBeLessThan(fontSizeOf("#specialRegionInspectorSection .toggle-label"));
  expect(metrics.visibleOverflow).toEqual([]);

  await page.evaluate(() => {
    const toggle = document.querySelector("#scenarioSpecialRegionVisibilityToggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForFunction(() => {
    const section = document.querySelector("#specialRegionInspectorSection");
    const list = document.querySelector("#specialRegionList");
    const empty = document.querySelector("#specialRegionInspectorEmpty");
    return !!section
      && !section.classList.contains("hidden")
      && ((list?.getBoundingClientRect().height || 0) > 0 || (empty?.getBoundingClientRect().height || 0) > 0);
  });
  const specialAfterToggleOff = await page.evaluate(() => {
    const section = document.querySelector("#specialRegionInspectorSection");
    const list = document.querySelector("#specialRegionList");
    const empty = document.querySelector("#specialRegionInspectorEmpty");
    return {
      hidden: section?.classList.contains("hidden") ?? true,
      display: section ? getComputedStyle(section).display : "",
      listHeight: list?.getBoundingClientRect().height || 0,
      emptyHeight: empty?.getBoundingClientRect().height || 0,
    };
  });
  expect(specialAfterToggleOff.hidden).toBe(false);
  expect(specialAfterToggleOff.display).not.toBe("none");
  expect(specialAfterToggleOff.listHeight > 0 || specialAfterToggleOff.emptyHeight > 0).toBe(true);

  await page.evaluate(() => {
    const reliefToggle = document.querySelector("#scenarioReliefOverlayVisibilityToggle");
    if (reliefToggle instanceof HTMLInputElement) {
      reliefToggle.checked = false;
      reliefToggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForFunction(() => {
    const section = document.querySelector("#specialRegionInspectorSection");
    return !!section && !section.classList.contains("hidden") && section.classList.contains("is-empty-scenario-panel");
  });
  const specialAfterAllContentOff = await page.evaluate(() => {
    const section = document.querySelector("#specialRegionInspectorSection");
    return {
      hidden: section?.classList.contains("hidden") ?? true,
      display: section ? getComputedStyle(section).display : "",
      emptyPanel: section?.classList.contains("is-empty-scenario-panel") ?? false,
    };
  });
  expect(specialAfterAllContentOff.hidden).toBe(false);
  expect(specialAfterAllContentOff.display).not.toBe("none");
  expect(specialAfterAllContentOff.emptyPanel).toBe(true);

  await page.evaluate(() => {
    const reliefToggle = document.querySelector("#scenarioReliefOverlayVisibilityToggle");
    if (reliefToggle instanceof HTMLInputElement) {
      reliefToggle.checked = true;
      reliefToggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const toggle = document.querySelector("#scenarioSpecialRegionVisibilityToggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForFunction(() => !document.querySelector("#specialRegionInspectorSection")?.classList.contains("hidden"));
  const specialAfterToggleOn = await page.evaluate(() => {
    const section = document.querySelector("#specialRegionInspectorSection");
    return {
      hidden: section?.classList.contains("hidden") ?? true,
      display: section ? getComputedStyle(section).display : "",
    };
  });
  expect(specialAfterToggleOn.hidden).toBe(false);
  expect(specialAfterToggleOn.display).not.toBe("none");
});
