const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");


async function expectSupportPopoverVisibility(page, { guide, reference, export: exportVisible }) {
  await expect(page.locator("#scenarioGuidePopover"))[guide ? "toBeVisible" : "toBeHidden"]();
  await expect(page.locator("#scenarioGuideBackdrop"))[guide ? "toBeVisible" : "toBeHidden"]();
  await expect(page.locator("#dockReferencePopover"))[reference ? "toBeVisible" : "toBeHidden"]();
  await expect(page.locator("#exportWorkbenchOverlay"))[exportVisible ? "toBeVisible" : "toBeHidden"]();
}

async function activateSupportTrigger(page, selector) {
  await page.locator(selector).focus();
  await page.keyboard.press("Enter");
}

test("phase 03 support and transport surfaces stay unified", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#inspectorSidebarTabProject").click();
  await expect(page.locator("#inspectorUtilitiesSection")).toBeVisible();
  await page.evaluate(() => {
    const utilities = document.querySelector("#inspectorUtilitiesSection");
    const diagnostics = document.querySelector("#diagnosticsSection");
    if (utilities instanceof HTMLDetailsElement) utilities.open = true;
    if (diagnostics instanceof HTMLDetailsElement) diagnostics.open = true;
  });
  await expect(page.locator("#inspectorUtilitiesSection")).toHaveJSProperty("open", true);

  await expect(page.locator("#utilitiesGuideBtn")).toHaveText("Guide");
  await expect(page.locator("#dockReferenceBtn")).toHaveText("Reference");
  await expect(page.locator("#dockExportBtn")).toHaveText("Open workbench");

  await activateSupportTrigger(page, "#utilitiesGuideBtn");
  await expectSupportPopoverVisibility(page, { guide: true, reference: false, export: false });
  await expect(page.locator("#scenarioGuideTitle")).not.toHaveText("");
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);

  await page.keyboard.press("Escape");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator("#utilitiesGuideBtn")).toBeFocused();

  await page.locator("#dockReferenceBtn").focus();
  await page.keyboard.press("Enter");
  await expectSupportPopoverVisibility(page, { guide: false, reference: true, export: false });
  await expect(page.locator("#lblReferenceImage")).not.toHaveText("");
  await page.keyboard.press("Escape");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator("#dockReferenceBtn")).toBeFocused();
  await page.evaluate(() => {
    const exportSection = document.querySelector("#exportProjectSection");
    if (exportSection instanceof HTMLDetailsElement) exportSection.open = true;
  });
  await expect(page.locator("#dockExportBtn")).toBeVisible();

  await page.locator("#dockExportBtn").focus();
  await page.keyboard.press("Enter");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: true });
  await expect(page.locator("#exportWorkbenchTitle")).not.toHaveText("");

  await activateSupportTrigger(page, "#utilitiesGuideBtn");
  await expectSupportPopoverVisibility(page, { guide: true, reference: false, export: false });

  await page.keyboard.press("Escape");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator("#utilitiesGuideBtn")).toBeFocused();

  await page.locator("#zoomControls #scenarioTransportWorkbenchBtn").click();
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  await expect(page.locator("#transportWorkbenchLensTitle")).toBeVisible();
  await expect(page.locator(".transport-workbench-meta-strip")).toBeVisible();
  await expect(page.locator(".transport-workbench-meta-pill")).toHaveCount(3);
  await expect(page.locator("#transportWorkbenchInspectorDetails")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#transportWorkbenchLayerOrderPanel")).toHaveAttribute("aria-live", "polite");

  await page.locator("#transportWorkbenchCloseBtn").click();
  await expect(page.locator("#transportWorkbenchOverlay")).toBeHidden();
  await expect(page.locator("#zoomControls #scenarioTransportWorkbenchBtn")).toBeVisible();
});

test("project support panels and inspector search stay polished and inset", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#inspectorSidebarTabProject").click();
  await page.evaluate(() => {
    for (const id of ["frontlineProjectSection", "exportProjectSection", "inspectorUtilitiesSection"]) {
      const section = document.querySelector(`#${id}`);
      if (section instanceof HTMLDetailsElement) section.open = true;
    }
    for (const id of ["accordionLines", "accordionGraphics", "accordionCounters"]) {
      const accordion = document.querySelector(`#${id}`);
      accordion?.classList.add("is-open");
      accordion?.querySelector(".strategic-accordion-header")?.setAttribute("aria-expanded", "true");
    }
  });

  await expect(page.locator("#exportProjectSection .sidebar-help-copy")).toHaveText("Preview layers, format, and resolution before export.");
  await expect(page.locator("#inspectorUtilitiesSection > .inspector-panel-body > .inspector-utilities-shell > .sidebar-help-copy")).toHaveCount(0);

  const projectMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    } : null;
    const exportSection = document.querySelector("#exportProjectSection");
    const utilitiesSection = document.querySelector("#inspectorUtilitiesSection");
    const frontlinePanel = document.querySelector("#frontlineOverlayPanel");
    const strategicPanel = document.querySelector("#strategicOverlayPanel");
    const accordionBodies = [...document.querySelectorAll("#strategicOverlayPanel .strategic-accordion-body")].map((element) => {
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
        maxHeight: style.maxHeight,
      };
    });
    const frontlineHints = [...document.querySelectorAll("#frontlineProjectSection .sidebar-tool-hint")]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => String(element.textContent || "").trim())
      .filter(Boolean);
    const projectSectionIds = [
      "projectLegendSection",
      "frontlineProjectSection",
      "exportProjectSection",
      "inspectorUtilitiesSection",
      "diagnosticsSection",
    ];
    const visibleOverflow = [...document.querySelectorAll("#projectSidebarPanel *")].filter((element) => {
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
      const rect = element.getBoundingClientRect();
      const panelRect = document.querySelector("#projectSidebarPanel")?.getBoundingClientRect();
      return panelRect && rect.width > 0 && (rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1);
    }).map((element) => element.id || element.className || element.tagName);
    return {
      exportSection: rectToObject(exportSection?.getBoundingClientRect()),
      exportButton: rectToObject(document.querySelector("#dockExportBtn")?.getBoundingClientRect()),
      utilitiesSection: rectToObject(utilitiesSection?.getBoundingClientRect()),
      guideButton: rectToObject(document.querySelector("#utilitiesGuideBtn")?.getBoundingClientRect()),
      referenceButton: rectToObject(document.querySelector("#dockReferenceBtn")?.getBoundingClientRect()),
      utilityActionsDisplay: getComputedStyle(document.querySelector("#inspectorUtilitiesSection .inspector-utility-actions")).display,
      frontlinePanelRadius: frontlinePanel ? getComputedStyle(frontlinePanel).borderRadius : "",
      strategicPanelRadius: strategicPanel ? getComputedStyle(strategicPanel).borderRadius : "",
      strategicAccordionRadii: [...document.querySelectorAll("#strategicOverlayPanel .strategic-accordion-section")]
        .map((element) => getComputedStyle(element).borderRadius),
      strategicAccordionBodies: accordionBodies,
      frontlineHintTexts: frontlineHints,
      projectSectionRadii: projectSectionIds
        .map((id) => document.querySelector(`#${id}`))
        .filter(Boolean)
        .map((element) => getComputedStyle(element).borderRadius),
      visibleOverflow,
    };
  });

  expect(projectMetrics.visibleOverflow).toEqual([]);
  expect(projectMetrics.exportButton.left).toBeGreaterThan(projectMetrics.exportSection.left + 12);
  expect(projectMetrics.exportButton.right).toBeLessThan(projectMetrics.exportSection.right - 12);
  expect(projectMetrics.guideButton.left).toBeGreaterThan(projectMetrics.utilitiesSection.left + 12);
  expect(projectMetrics.referenceButton.right).toBeLessThan(projectMetrics.utilitiesSection.right - 12);
  expect(projectMetrics.utilityActionsDisplay).toBe("grid");
  expect(projectMetrics.frontlinePanelRadius).toBe("18px");
  expect(projectMetrics.strategicPanelRadius).toBe("18px");
  expect(projectMetrics.strategicAccordionRadii.every((radius) => radius === "15px")).toBe(true);
  expect(projectMetrics.strategicAccordionBodies.length).toBe(3);
  expect(projectMetrics.strategicAccordionBodies.every((body) => body.overflowY === "auto" && body.maxHeight !== "none")).toBe(true);
  expect(projectMetrics.frontlineHintTexts.every((text) => text.length <= 42)).toBe(true);
  expect(projectMetrics.projectSectionRadii.every((radius) => radius === "18px")).toBe(true);

  await page.locator("#inspectorSidebarTabInspector").click();
  const searchMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      width: rect.width,
    } : null;
    const searchBlock = document.querySelector(".inspector-search-block");
    const countrySection = document.querySelector("#countryInspectorSection");
    const searchInput = document.querySelector("#countrySearch");
    const inputStyle = getComputedStyle(searchInput);
    return {
      searchBlock: rectToObject(searchBlock?.getBoundingClientRect()),
      countrySection: rectToObject(countrySection?.getBoundingClientRect()),
      inputPaddingLeft: Number.parseFloat(inputStyle.paddingLeft),
      inputPaddingRight: Number.parseFloat(inputStyle.paddingRight),
      inputBorderLeft: inputStyle.borderLeftWidth,
    };
  });

  expect(searchMetrics.searchBlock.left).toBeCloseTo(searchMetrics.countrySection.left, 0);
  expect(searchMetrics.searchBlock.width).toBeCloseTo(searchMetrics.countrySection.width, 0);
  expect(searchMetrics.inputPaddingLeft).toBeGreaterThanOrEqual(6);
  expect(searchMetrics.inputPaddingRight).toBeGreaterThanOrEqual(6);
  expect(searchMetrics.inputBorderLeft).toBe("0px");
});

test("phase 03 support surfaces restore the requested view from URL", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=reference", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await expect(page.locator("#inspectorSidebarTabProject")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspectorUtilitiesSection")).toHaveJSProperty("open", true);
  await expect(page.locator("#dockReferencePopover")).toBeVisible();
  await expect(page.locator("#dockReferenceBtn")).toHaveAttribute("aria-expanded", "true");

  await page.locator("#inspectorSidebarTabInspector").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#dockReferencePopover")).toBeHidden();
  await expect(page.locator("#dockReferenceBtn")).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/scope=current-object/);
  await expect(page).not.toHaveURL(/view=/);
});

test("phase 03 support surfaces restore the guide view from URL", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=guide&guide_section=tools", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);
  await expect(page.locator("#scenarioGuideBtn")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#scenarioGuideTabTools")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#scenarioGuideSectionTools")).toBeVisible();
});

test("phase 03 guide URL restore returns focus to visible topbar trigger on compact viewport", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=guide", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);

  await page.keyboard.press("Escape");
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("#scenarioGuideBtn")).toBeFocused();
});

test("phase 03 guide remembers active section across close and reopen", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#scenarioGuideBtn").click();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await page.locator("#scenarioGuideTabTools").click();
  await expect(page.locator("#scenarioGuideTabTools")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#scenarioGuideSectionTools")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();

  await page.locator("#scenarioGuideBtn").click();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("#scenarioGuideTabTools")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#scenarioGuideSectionTools")).toBeVisible();
});

test("phase 03 support surfaces restore the export view and stay idempotent", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=export", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#inspectorSidebarTabProject")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#exportProjectSection")).toHaveJSProperty("open", true);
  await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible();
  await expect(page.locator("#dockExportBtn")).toHaveAttribute("aria-expanded", "true");

  const stateAfterRepeat = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.restoreSupportSurfaceFromUrlFn?.();
    state.restoreSupportSurfaceFromUrlFn?.();
    const overlay = document.querySelector("#exportWorkbenchOverlay");
    const trigger = document.querySelector("#dockExportBtn");
    return {
      visible: overlay instanceof HTMLElement ? !overlay.classList.contains("hidden") : false,
      expanded: trigger?.getAttribute("aria-expanded") || "",
    };
  });
  expect(stateAfterRepeat.visible).toBe(true);
  expect(stateAfterRepeat.expanded).toBe("true");
});

test("phase 03 ignores unknown support-surface view values", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    history.replaceState(history.state, "", `${location.pathname}?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=bogus`);
    state.restoreSupportSurfaceFromUrlFn?.();
  });
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#dockReferencePopover")).toBeHidden();
  await expect(page.locator("#exportWorkbenchOverlay")).toBeHidden();
});

test("phase 03 guide modal closes cleanly from backdrop without leaving drawer scrim behind", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.locator("#scenarioGuideBtn").click();
  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);

  await page.mouse.click(16, 16);
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/scenario-guide-open/);
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
  await expect(page.locator("#scenarioGuideBtn")).toBeFocused();
});

test("phase 03 transport compare runtime strings localize across live states", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const transportTrigger = page.locator("#zoomControls #scenarioTransportWorkbenchBtn");
  const compareBtn = page.locator("#transportWorkbenchCompareBtn");
  const compareStatus = page.locator("#transportWorkbenchCompareStatus");
  const roadTab = page.locator('[data-transport-family="road"]');
  const layersTab = page.locator('[data-transport-family="layers"]');

  await transportTrigger.click();
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  await expect(compareBtn).toHaveText("Compare baseline");
  await expect(compareStatus).toHaveText("Live working state");

  await compareBtn.focus();
  await page.keyboard.down("Enter");
  await expect(compareStatus).toHaveText("Baseline preview");
  await page.keyboard.up("Enter");
  await expect(compareStatus).toHaveText("Live working state");

  await layersTab.click();
  await expect(compareBtn).toHaveText("Baseline unavailable");
  await expect(compareStatus).toHaveText("Baseline unavailable for this family");

  await page.evaluate(() => {
    document.getElementById("btnToggleLang")?.click();
  });
  await expect(compareBtn).toHaveText("\u57fa\u7ebf\u4e0d\u53ef\u7528");
  await expect(compareStatus).toHaveText("\u8fd9\u4e2a\u5bb6\u65cf\u6ca1\u6709\u53ef\u7528\u57fa\u7ebf");

  await roadTab.click();
  await expect(compareBtn).toHaveText("\u6bd4\u8f83\u57fa\u7ebf");
  await expect(compareStatus).toHaveText("\u5f53\u524d\u5de5\u4f5c\u72b6\u6001");

  await compareBtn.focus();
  await page.keyboard.down("Enter");
  await expect(compareStatus).toHaveText("\u57fa\u7ebf\u9884\u89c8\u4e2d");
  await page.keyboard.up("Enter");
  await expect(compareStatus).toHaveText("\u5f53\u524d\u5de5\u4f5c\u72b6\u6001");
});


test("adaptive support, transport, and palette surfaces stay contained", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 900, height: 720 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.evaluate(() => {
    document.querySelector("#rightPanelToggle")?.click();
    document.querySelector("#inspectorSidebarTabProject")?.click();
    const utilities = document.querySelector("#inspectorUtilitiesSection");
    if (utilities instanceof HTMLDetailsElement) utilities.open = true;
  });

  await page.locator("#dockReferenceBtn").click();
  await expect(page.locator("#dockReferencePopover")).toBeVisible();

  const supportMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const popover = rectToObject(document.querySelector("#dockReferencePopover")?.getBoundingClientRect());
    return {
      popover,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bodyScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(supportMetrics.popover.left).toBeGreaterThanOrEqual(0);
  expect(supportMetrics.popover.right).toBeLessThanOrEqual(supportMetrics.viewportWidth);
  expect(supportMetrics.popover.bottom).toBeLessThanOrEqual(supportMetrics.viewportHeight);
  expect(supportMetrics.bodyScrollWidth).toBeLessThanOrEqual(supportMetrics.viewportWidth + 1);

  await page.keyboard.press("Escape");
  await page.locator("#zoomControls #scenarioTransportWorkbenchBtn").click();
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  await page.locator("#transportWorkbenchInfoBtn").click();
  await expect(page.locator("#transportWorkbenchInfoPopover")).toBeVisible();

  const transportMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const popover = rectToObject(document.querySelector("#transportWorkbenchInfoPopover")?.getBoundingClientRect());
    return {
      popover,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(transportMetrics.popover.left).toBeGreaterThanOrEqual(0);
  expect(transportMetrics.popover.right).toBeLessThanOrEqual(transportMetrics.viewportWidth);
  expect(transportMetrics.popover.bottom).toBeLessThanOrEqual(transportMetrics.viewportHeight);

  await page.locator("#transportWorkbenchCloseBtn").click();
  const paletteMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const list = document.querySelector("#paletteLibraryList");
    const rect = rectToObject(list?.getBoundingClientRect());
    const styles = list ? getComputedStyle(list) : null;
    return {
      rect,
      minHeight: styles?.getPropertyValue("--palette-library-list-min-block") || "",
      maxHeight: styles?.getPropertyValue("--palette-library-list-max-block") || "",
      overflowY: styles?.overflowY || "",
    };
  });
  expect(paletteMetrics.minHeight.trim()).toBe("240px");
  expect(paletteMetrics.maxHeight.trim()).toBe("480px");
  expect(["auto", "scroll"]).toContain(paletteMetrics.overflowY);
});
