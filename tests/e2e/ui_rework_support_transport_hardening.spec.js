const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("./support/playwright-app");

const TNO_TRANSPORT_READY_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=tno_1962";


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

async function openTransportWorkbench(page) {
  if (await page.locator("#leftSidebar").evaluate((node) => node.inert)) {
    if (await page.locator("#sidebarDrawerBackdrop").isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("#sidebarDrawerBackdrop")).toBeHidden();
      await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
    }
    await page.locator("#leftPanelToggle").click();
  }
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabTransport").click();
  await page.locator("#transportProjectSection #scenarioTransportWorkbenchBtn").click();
}

test("phase 03 support and transport surfaces stay unified", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const isWorkspace = await page.locator("body.editor-workspace").count();
  const guideTrigger = isWorkspace ? "#scenarioGuideBtn" : "#utilitiesGuideBtn";
  if (isWorkspace) {
    await expect(page.locator("#inspectorUtilitiesSection")).toBeHidden();
    await expect(page.locator("#utilitiesGuideBtn")).toBeHidden();
    await expect(page.locator("#dockReferenceBtn")).toBeHidden();
  } else {
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
  }
  await expect(page.locator(guideTrigger)).toHaveText("Guide");
  await expect(page.locator("#dockExportBtn")).toHaveText("Open workbench");

  await activateSupportTrigger(page, guideTrigger);
  await expectSupportPopoverVisibility(page, { guide: true, reference: false, export: false });
  await expect(page.locator("#scenarioGuideTitle")).not.toHaveText("");
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);

  await page.keyboard.press("Escape");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator(guideTrigger)).toBeFocused();

  if (isWorkspace) {
    await page.locator("#editorTaskLayersBtn").click();
    await activateSupportTrigger(page, "#editorLayer-reference");
    const reference = page.locator("#editorProperty-reference");
    await expect(reference).toBeVisible();
    await expect(reference.locator("#lblReferenceImage")).not.toHaveText("");
    await expect(reference.locator("#referenceOpacity")).toBeVisible();
    await reference.locator("#referenceOpacity").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(reference.locator("#referenceOpacityValue")).toHaveText("1%");
    await page.locator("#editorTaskLayersBtn").click();
    await expect(reference).toBeVisible();
    await page.locator("#editorLayer-legend").click();
    await expect(reference).toBeHidden();
    await expect(page.locator("#editorProperty-legend")).toBeVisible();
  } else {
    await page.locator("#dockReferenceBtn").focus();
    await page.keyboard.press("Enter");
    await expectSupportPopoverVisibility(page, { guide: false, reference: true, export: false });
    await expect(page.locator("#lblReferenceImage")).not.toHaveText("");
    await page.keyboard.press("Escape");
    await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
    await expect(page.locator("#dockReferenceBtn")).toBeFocused();
  }
  if (await page.locator("body.editor-workspace").count()) {
    await page.locator("#inspectorSidebarTabProject").click();
    await expect(page.locator("#editorProperty-project")).toBeVisible();
  }
  await page.evaluate(() => {
    const exportSection = document.querySelector("#exportProjectSection");
    if (exportSection instanceof HTMLDetailsElement) exportSection.open = true;
  });
  await expect(page.locator("#dockExportBtn")).toBeVisible();

  await page.locator("#dockExportBtn").focus();
  await page.keyboard.press("Enter");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: true });
  await expect(page.locator("#exportWorkbenchTitle")).not.toHaveText("");

  await page.locator("#exportWorkbenchCloseBtn").click();
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator("#dockExportBtn")).toBeFocused();
  await activateSupportTrigger(page, guideTrigger);
  await expectSupportPopoverVisibility(page, { guide: true, reference: false, export: false });

  await page.keyboard.press("Escape");
  await expectSupportPopoverVisibility(page, { guide: false, reference: false, export: false });
  await expect(page.locator(guideTrigger)).toBeFocused();

  await openTransportWorkbench(page);
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  await expect(page.locator("#transportWorkbenchLensTitle")).toBeVisible();
  await expect(page.locator(".transport-workbench-meta-strip")).toBeVisible();
  await expect(page.locator(".transport-workbench-meta-pill")).toHaveCount(4);
  await expect(page.locator("#transportWorkbenchInspectorDetails")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#transportWorkbenchLayerOrderPanel")).toHaveAttribute("aria-live", "polite");

  await page.locator("#transportWorkbenchCloseBtn").click();
  await expect(page.locator("#transportWorkbenchOverlay")).toBeHidden();
  await expect(page.locator("#transportProjectSection #scenarioTransportWorkbenchBtn")).toBeVisible();
});

test("left sidebar scenario and appearance panels keep compact hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  if (await page.locator("body.editor-workspace").count()) {
    await page.locator("#editorTaskLayersBtn").click();
    for (const [tab, property, panel] of [
      ["mapContentTabOcean", "data-map-content-panel-ocean", "appearancePanelOcean"],
      ["appearanceTabBorders", "data-appearance-panel-borders", "appearancePanelBorders"],
      ["appearanceTabPhysical", "data-appearance-panel-physical", "appearancePanelPhysical"],
      ["appearanceTabCityPoints", "data-appearance-panel-citypoints", "appearancePanelCityPoints"],
      ["mapContentTabRivers", "data-map-content-panel-rivers", "mapContentPanelRivers"],
      ["mapContentTabDayNight", "data-map-content-panel-daynight", "appearancePanelDayNight"],
      ["mapContentTabTexture", "data-map-content-panel-texture", "appearancePanelTexture"],
      ["appearanceTabTransport", "data-appearance-panel-transport", "appearancePanelTransport"],
    ]) {
      await page.locator(`#${tab}`).click();
      await expect(page.locator(`#editorProperty-${property} #${panel}`)).toBeVisible();
    }
    await expect(page.locator("#appearancePanelOcean .appearance-control-card")).toHaveCount(4);
    await expect(page.locator("#appearancePanelCityPoints .city-points-toggle-card")).toHaveCount(1);
    await expect(page.locator("#appearancePanelCityPoints .city-points-style-card")).toHaveCount(1);
    await expect(page.locator("#appearancePanelCityPoints .city-points-label-card")).toHaveCount(1);
    expect(await page.locator("#appearancePanelDayNight .appearance-day-night-card").count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator("#appearancePanelTransport .transport-family-section")).toHaveCount(4);
    await page.locator("#editorLayer-special-zones").click();
    await expect(page.locator("#editorProperty-special-zones #specialZonePopover")).toBeVisible();
    await page.locator("#editorTaskPaletteBtn").click();
    await expect(page.locator("#paletteLibraryList")).toBeVisible();
    const layout = await page.evaluate(() => {
      const right = document.querySelector("#rightSidebar")?.getBoundingClientRect();
      const panel = document.querySelector("#editorProperty-special-zones")?.getBoundingClientRect();
      const palette = document.querySelector("#paletteLibraryList")?.getBoundingClientRect();
      const title = document.querySelector("#paletteLibraryList .palette-library-title");
      const subtitle = document.querySelector("#paletteLibraryList .palette-library-subtitle");
      return {
        panelInset: panel && right ? panel.left - right.left : 0,
        paletteWidth: palette?.width || 0,
        titleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
        subtitleSize: subtitle ? Number.parseFloat(getComputedStyle(subtitle).fontSize) : 0,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.panelInset).toBeGreaterThanOrEqual(0);
    expect(layout.paletteWidth).toBeGreaterThan(180);
    expect(layout.titleSize).toBeGreaterThan(layout.subtitleSize);
    expect(layout.pageScrollWidth).toBeLessThanOrEqual(1441);
    return;
  }

  await page.evaluate(() => {
    const scenario = document.querySelector('[aria-labelledby="lblScenario"]');
    const appearance = document.querySelector('[aria-labelledby="appearanceSectionHeading labelMapStyle"]');
    const mapContent = document.querySelector('[aria-labelledby="mapContentSectionHeading labelMapContent"]');
    const special = document.querySelector('#specialZonePopover');
    if (scenario instanceof HTMLDetailsElement) scenario.open = true;
    if (appearance instanceof HTMLDetailsElement) appearance.open = true;
    if (mapContent instanceof HTMLDetailsElement) mapContent.open = true;
    if (special instanceof HTMLDetailsElement) special.open = true;
  });

  await expect(page.locator('#appearanceLayerFilter')).toHaveCount(0);
  await expect(page.locator('#lblTextureInfo')).toHaveCount(0);
  await expect(page.locator('#appearancePanelTexture .info-trigger')).toHaveCount(0);

  const activateAppearanceTab = async (tabSelector, panelSelector) => {
    await expect(page.locator(tabSelector)).toBeVisible();
    await page.locator(tabSelector).click();
    await expect(page.locator(panelSelector)).toBeVisible();
  };

  await activateAppearanceTab('#mapContentTabOcean', '#appearancePanelOcean');
  await expect(page.locator('#appearancePanelOcean .appearance-control-card')).toHaveCount(4);
  const oceanLayout = await page.evaluate(() => {
    const panel = document.querySelector('#appearancePanelOcean')?.getBoundingClientRect();
    const cards = [...document.querySelectorAll('#appearancePanelOcean .appearance-control-card')]
      .map((element) => element.getBoundingClientRect());
    return {
      cardCount: cards.length,
      firstInset: panel && cards[0] ? cards[0].left - panel.left : 0,
      firstRightGap: panel && cards[0] ? panel.right - cards[0].right : 0,
      firstGap: cards[1] ? cards[1].top - cards[0].bottom : 0,
    };
  });
  await activateAppearanceTab('#appearanceTabBorders', '#appearancePanelBorders');
  await activateAppearanceTab('#appearanceTabPhysical', '#appearancePanelPhysical');
  await activateAppearanceTab('#appearanceTabCityPoints', '#appearancePanelCityPoints');
  await activateAppearanceTab('#mapContentTabRivers', '#mapContentPanelRivers');
  await page.evaluate(() => {
    const physical = document.querySelector('#appearancePanelPhysical .appearance-mini-section');
    const cityPoints = document.querySelector('#appearancePanelCityPoints .appearance-mini-section');
    const rivers = document.querySelector('#mapContentPanelRivers');
    if (physical instanceof HTMLDetailsElement) physical.open = true;
    if (cityPoints instanceof HTMLDetailsElement) cityPoints.open = true;
    if (rivers instanceof HTMLDetailsElement) rivers.open = true;
  });
  await expect(page.locator('#cityPointsPresetDensityGroupHint')).toHaveCount(0);
  await expect(page.locator('#cityPointsMarkerDensityHint')).toHaveCount(0);
  await expect(page.locator('#cityPointsLabelDensityHint')).toHaveCount(0);
  await expect(page.locator('#cityPointsHelpTooltip')).toContainText('Pick a city marker style');
  await expect(page.locator('#appearancePanelCityPoints .city-points-toggle-card')).toHaveCount(1);
  await expect(page.locator('#appearancePanelCityPoints .city-points-style-card')).toHaveCount(1);
  await expect(page.locator('#appearancePanelCityPoints .city-points-label-card')).toHaveCount(1);
  await expect(page.locator('#mapContentPanelRivers .rivers-toggle-card')).toHaveCount(1);
  await expect(page.locator('#mapContentPanelRivers .rivers-stroke-card')).toHaveCount(1);
  await expect(page.locator('#mapContentPanelRivers .rivers-outline-card')).toHaveCount(1);
  await page.locator('#riversDashStyle').selectOption('dashed');
  const riverDashState = await page.evaluate(async () => {
    const stateModuleUrl = new URL('./js/core/state.js', globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    return {
      dashStyle: stateModule?.state?.styleConfig?.rivers?.dashStyle || '',
    };
  });
  expect(riverDashState.dashStyle).toBe('dashed');
  const layerLayout = await page.evaluate(() => {
    const details = document.querySelector('#appearancePanelPhysical .appearance-mini-section')?.getBoundingClientRect();
    const content = document.querySelector('#appearancePanelPhysical .appearance-mini-section .ml-5.space-y-2')?.getBoundingClientRect();
    const cityToggle = document.querySelector('#appearancePanelCityPoints .city-points-toggle-card')?.getBoundingClientRect();
    const riverGap = (() => {
      const cards = [...document.querySelectorAll('#mapContentPanelRivers .rivers-panel-stack > .appearance-control-card')]
        .map((element) => element.getBoundingClientRect());
      return cards[1] ? cards[1].top - cards[0].bottom : 0;
    })();
    return {
      contentInset: details && content ? content.left - details.left : 0,
      contentRightGap: details && content ? details.right - content.right : 0,
      contentWidthDelta: details && content ? details.width - content.width : 0,
      cityTogglePaddingTop: cityToggle ? Number.parseFloat(getComputedStyle(document.querySelector('#appearancePanelCityPoints .city-points-toggle-card')).paddingTop) : 0,
      cityTogglePaddingBottom: cityToggle ? Number.parseFloat(getComputedStyle(document.querySelector('#appearancePanelCityPoints .city-points-toggle-card')).paddingBottom) : 0,
      riverGap,
    };
  });
  await activateAppearanceTab('#mapContentTabDayNight', '#appearancePanelDayNight');
  const dayNightLayout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#appearancePanelDayNight .appearance-day-night-card')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.getBoundingClientRect());
    const gaps = cards.slice(1).map((card, index) => card.top - cards[index].bottom);
    const firstCard = document.querySelector('#appearancePanelDayNight .appearance-day-night-card');
    const syncButton = document.querySelector('#dayNightSyncComputerUtcBtn');
    return {
      cardCount: cards.length,
      minGap: gaps.length ? Math.min(...gaps) : 0,
      cardPaddingTop: firstCard ? Number.parseFloat(getComputedStyle(firstCard).paddingTop) : 0,
      syncButtonWidth: syncButton ? syncButton.getBoundingClientRect().width : 0,
    };
  });
  await activateAppearanceTab('#mapContentTabTexture', '#appearancePanelTexture');
  await activateAppearanceTab('#appearanceTabTransport', '#appearancePanelTransport');
  const transportLayout = await page.evaluate(() => {
    const families = [...document.querySelectorAll('#appearancePanelTransport .transport-family-section')];
    const childCards = [...document.querySelectorAll('#appearancePanelTransport .transport-family-body > section')];
    const firstFamily = families[0]?.getBoundingClientRect();
    const firstChild = childCards[0]?.getBoundingClientRect();
    return {
      familyCount: families.length,
      childCardCount: childCards.length,
      familyRadius: families[0] ? Number.parseFloat(getComputedStyle(families[0]).borderRadius) : 0,
      childInset: firstFamily && firstChild ? firstChild.left - firstFamily.left : 0,
      masterTogglePaddingTop: Number.parseFloat(getComputedStyle(document.querySelector('#appearancePanelTransport .transport-master-toggle-card')).paddingTop || '0'),
      masterTogglePaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector('#appearancePanelTransport .transport-master-toggle-card')).paddingBottom || '0'),
    };
  });
  await activateAppearanceTab('#mapContentTabTexture', '#appearancePanelTexture');

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    } : null;
    const fontSize = (selector) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };
    const leftSidebar = document.querySelector('#leftSidebar');
    const leftRect = leftSidebar?.getBoundingClientRect();
    const visibleOverflow = [...document.querySelectorAll('#leftSidebar *')].filter((element) => {
      if (element.closest('#leftSidebarCollapseBtn')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return leftRect && rect.width > 0 && rect.height > 0 && (rect.left < leftRect.left - 1 || rect.right > leftRect.right + 1);
    }).map((element) => element.id || element.className || element.tagName).slice(0, 10);
    return {
      scenarioStatusRect: rectToObject(document.querySelector('#scenarioStatus')?.getBoundingClientRect()),
      scenarioAuditRect: rectToObject(document.querySelector('#scenarioAuditHint')?.getBoundingClientRect()),
      scenarioBodyHeight: document.querySelector('[aria-labelledby="lblScenario"] .sidebar-details-body')?.getBoundingClientRect().height || 0,
      sectionTitle: fontSize('#labelMapStyle'),
      oceanToggle: fontSize('#appearancePanelOcean .toggle-label'),
      borderSummary: fontSize('#appearancePanelBorders .appearance-mini-section > summary'),
      borderLabel: fontSize('#appearancePanelBorders .range-label'),
      textureLabel: fontSize('#appearancePanelTexture .section-header-block'),
      textureSelect: fontSize('#textureSelect'),
      specialOverlayToggle: fontSize('.special-zone-overlay-toggle'),
      specialLabel: fontSize('#specialZonePopover .range-label'),
      paletteTitle: fontSize('#paletteLibraryList .palette-library-title'),
      paletteSubtitle: fontSize('#paletteLibraryList .palette-library-subtitle'),
      layersStackTop: document.querySelector('#appearancePhysicalStack')?.getBoundingClientRect().top || 0,
      layersTitleBottom: document.querySelector('#lblPhysicalTabPanel')?.getBoundingClientRect().bottom || 0,
      textureFirstControlTop: document.querySelector('#lblOverlay')?.getBoundingClientRect().top || 0,
      textureTitleBottom: document.querySelector('#lblTexture')?.getBoundingClientRect().bottom || 0,
      textureStatusBottom: document.querySelector('#appearancePanelTexture .layer-status-strip')?.getBoundingClientRect().bottom || 0,
      scenarioArrowRight: document.querySelector('[aria-labelledby="lblScenario"] > summary')?.getBoundingClientRect().right || 0,
      colorToggleRight: document.querySelector('#paletteLibraryToggle')?.getBoundingClientRect().right || 0,
      visibleOverflow,
    };
  });

  expect(metrics.scenarioStatusRect.height).toBeLessThanOrEqual(1);
  expect(metrics.scenarioAuditRect.height).toBeLessThanOrEqual(1);
  expect(metrics.scenarioBodyHeight).toBeLessThan(230);
  expect(metrics.sectionTitle).toBeGreaterThan(metrics.oceanToggle);
  expect(metrics.sectionTitle).toBeGreaterThan(metrics.borderSummary);
  expect(metrics.borderSummary).toBeGreaterThanOrEqual(metrics.borderLabel);
  expect(Math.abs(metrics.oceanToggle - metrics.textureSelect)).toBeLessThanOrEqual(0.5);
  expect(metrics.specialOverlayToggle).toBeGreaterThan(0);
  expect(metrics.paletteTitle).toBeGreaterThan(metrics.paletteSubtitle);
  expect(metrics.textureFirstControlTop - (metrics.textureStatusBottom || metrics.textureTitleBottom)).toBeLessThan(24);
  expect(metrics.layersStackTop - metrics.layersTitleBottom).toBeLessThan(24);
  expect(Math.abs(metrics.colorToggleRight - metrics.scenarioArrowRight)).toBeLessThanOrEqual(3);
  expect(oceanLayout.cardCount).toBe(4);
  expect(oceanLayout.firstInset).toBeGreaterThanOrEqual(12);
  expect(oceanLayout.firstRightGap).toBeGreaterThanOrEqual(12);
  expect(oceanLayout.firstGap).toBeGreaterThanOrEqual(10);
  expect(layerLayout.contentInset).toBeLessThanOrEqual(14);
  expect(layerLayout.contentRightGap).toBeGreaterThanOrEqual(0);
  expect(layerLayout.contentWidthDelta).toBeGreaterThanOrEqual(layerLayout.contentInset - 1);
  expect(layerLayout.contentWidthDelta).toBeLessThanOrEqual(28);
  expect(layerLayout.cityTogglePaddingTop).toBeGreaterThanOrEqual(0);
  expect(layerLayout.cityTogglePaddingBottom).toBeGreaterThanOrEqual(9);
  expect(layerLayout.riverGap).toBeGreaterThanOrEqual(10);
  expect(dayNightLayout.cardCount).toBeGreaterThanOrEqual(3);
  expect(dayNightLayout.minGap).toBeGreaterThanOrEqual(12);
  expect(dayNightLayout.cardPaddingTop).toBeGreaterThanOrEqual(10);
  expect(dayNightLayout.syncButtonWidth).toBeGreaterThanOrEqual(100);
  expect(transportLayout.familyCount).toBe(4);
  expect(transportLayout.childCardCount).toBeGreaterThanOrEqual(11);
  expect(transportLayout.familyRadius).toBeGreaterThanOrEqual(14);
  expect(transportLayout.childInset).toBeGreaterThanOrEqual(6);
  expect(transportLayout.masterTogglePaddingTop).toBeGreaterThanOrEqual(0);
  expect(transportLayout.masterTogglePaddingBottom).toBeGreaterThanOrEqual(9);
  expect(metrics.visibleOverflow).toEqual([]);
});

test("phase 03 support surfaces restore the requested view from URL", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&view=reference", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  if (await page.locator("body.editor-workspace").count()) {
    await expect(page.locator("#editorProjectBar #inspectorSidebarTabProject")).toBeVisible();
    await expect(page.locator("#editorTaskLayersBtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#editorProperty-reference #dockReferencePopover")).toBeVisible();
    await expect(page.locator("#editorProperty-reference #referenceOpacity")).toBeVisible();
    // 参考底图是图层属性（不是 details），URL 仍要带 view=reference，刷新/分享才能恢复。
    await expect(page).toHaveURL(/view=reference/);
    await page.locator("#editorLayer-legend").click();
    await expect(page.locator("#editorProperty-reference")).toBeHidden();
    await expect(page.locator("#editorProperty-legend")).toBeVisible();
    await expect(page).not.toHaveURL(/view=reference/);
    await page.locator("#editorLayer-reference").click();
    await expect(page).toHaveURL(/view=reference/);
    await page.locator("#editorLayer-legend").click();
    await expect(page).not.toHaveURL(/view=reference/);
    await page.locator("#editorTaskObjectsBtn").click();
    await page.locator("#editorObjects-countries").click();
  } else {
    await expect(page.locator("#inspectorSidebarTabProject")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#inspectorUtilitiesSection")).toHaveJSProperty("open", true);
    await expect(page.locator("#dockReferencePopover")).toBeVisible();
    await expect(page.locator("#dockReferenceBtn")).toHaveAttribute("aria-expanded", "true");
    await page.locator("#inspectorSidebarTabInspector").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#dockReferenceBtn")).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.locator("#dockReferencePopover")).toBeHidden();
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

test("phase 03 direct guide URL opens from the default app path", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?view=guide", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);
  await expect(page.locator("#scenarioGuideBtn")).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("#scenarioGuideBtn")).toBeFocused();
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
  if (await page.locator("body.editor-workspace").count()) {
    await expect(page.locator("#editorProjectBar #inspectorSidebarTabProject")).toBeVisible();
    await expect(page.locator("#exportProjectSection")).toHaveJSProperty("open", true);
  } else {
    await expect(page.locator("#inspectorSidebarTabProject")).toHaveAttribute("aria-selected", "true");
  }
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

test("phase 03 transport preview omits compare controls", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const transportTrigger = page.locator("#transportProjectSection #scenarioTransportWorkbenchBtn");
  const compareBtn = page.locator("#transportWorkbenchCompareBtn");
  const compareStatus = page.locator("#transportWorkbenchCompareStatus");

  await openTransportWorkbench(page);
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  const inspectorTabs = page.locator("#transportWorkbenchInspectorTabs [role=tab]:visible");
  await expect(inspectorTabs).toHaveCount(3);
  expect(await inspectorTabs.evaluateAll((nodes) => nodes.map((node) => node.dataset.transportInspectorTab)))
    .toEqual(["inspect", "display", "data"]);
  const inspectTab = page.locator('[data-transport-inspector-tab="inspect"]');
  const displayTab = page.locator('[data-transport-inspector-tab="display"]');
  const dataTab = page.locator('[data-transport-inspector-tab="data"]');
  await inspectTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(displayTab).toBeFocused();
  await expect(displayTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(dataTab).toBeFocused();
  await expect(dataTab).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-transport-family="layers"]').click();
  await expect(page.locator("#transportWorkbenchInspectorTabs")).toBeHidden();
  await page.locator('[data-transport-family="road"]').click();
  await expect(inspectorTabs).toHaveCount(3);
  await expect(page.locator("#transportWorkbenchPreviewTitle")).toHaveCount(1);
  await expect(page.locator("#transportWorkbenchZoomInBtn")).toHaveCount(1);
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveCount(1);
  await expect(compareBtn).toHaveCount(0);
  await expect(compareStatus).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#transportWorkbenchOverlay")).toBeHidden();
  await expect(transportTrigger).toBeFocused();
});

test("transport visual mode and apply bridge stay aligned across appearance and workbench", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, TNO_TRANSPORT_READY_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 240_000 });

  await page.evaluate(() => {
    const appearance = document.querySelector('[aria-labelledby="appearanceSectionHeading labelMapStyle"]');
    const portCard = document.querySelector('#transportPortCard');
    if (appearance instanceof HTMLDetailsElement) appearance.open = true;
    if (portCard instanceof HTMLDetailsElement) portCard.open = true;
  });
  if (await page.locator("body.editor-workspace").count()) await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabTransport").click();

  await page.locator("#transportAppearanceMasterToggle").uncheck();
  await expect(page.locator("#transportVisualMode")).toBeDisabled();
  await page.locator("#togglePorts").check();
  await expect(page.locator("#transportAppearanceMasterToggle")).toBeChecked();
  await expect(page.locator("#transportVisualMode")).toBeEnabled();
  await page.locator("#transportVisualMode").selectOption("network");

  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      visualMode: String(state.styleConfig?.transportOverview?.visualMode || ""),
      showTransport: !!state.showTransport,
      showPorts: !!state.showPorts,
    };
  }), { timeout: 30_000 }).toMatchObject({
    visualMode: "network",
    showTransport: true,
    showPorts: true,
  });

  await openTransportWorkbench(page);
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();

  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Apply to Main Map", { timeout: 30_000 });
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeEnabled();

  await page.locator('[data-transport-family="airport"]').click();
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Apply to Main Map", { timeout: 30_000 });
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeEnabled();
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.transportWorkbenchUi.familyConfigs.airport.airportTypes = [
      "company_managed",
      "national",
      "specific_local",
      "local",
      "other",
      "shared",
    ];
    state.transportWorkbenchUi.familyConfigs.airport.statuses = [
      "active",
      "paused",
      "unknown",
    ];
    state.refreshTransportWorkbenchUiFn?.();
  });
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Apply to Main Map");
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeEnabled();

  await page.locator('[data-transport-family="layers"]').click();
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Workbench only");
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeDisabled();
  await expect(page.locator("#transportWorkbenchCompareStatus")).toHaveCount(0);

  await page.locator('[data-transport-family="mineral_resources"]').click();
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Preview only");
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeDisabled();

  await page.locator('button[data-transport-family="port"]').click();
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Apply to Main Map");
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeEnabled();

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.transportWorkbenchUi.familyConfigs.port.managerTypes = ["1", "2", "3", "4", "5"];
    state.transportWorkbenchUi.familyConfigs.port.showLabels = false;
    state.transportWorkbenchUi.familyConfigs.port.baseOpacity = 74;
    state.transportWorkbenchUi.displayConfigs.port.coverage = "expanded";
    state.refreshTransportWorkbenchUiFn?.();
  });
  await page.locator("#transportWorkbenchApplyBtn").click();

  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const portConfig = state.styleConfig?.transportOverview?.port || {};
    return {
      visualMode: String(state.styleConfig?.transportOverview?.visualMode || ""),
      showTransport: !!state.showTransport,
      showPorts: !!state.showPorts,
      labelsEnabled: !!portConfig.labelsEnabled,
      scopeLinkMode: String(portConfig.scopeLinkMode || ""),
      hasPortsData: Array.isArray(state.portsData?.features) && state.portsData.features.length > 0,
      visualModeControl: String(document.querySelector("#transportVisualMode")?.value || ""),
    };
  }), { timeout: 30_000 }).toMatchObject({
    visualMode: "network",
    showTransport: true,
    showPorts: true,
    labelsEnabled: false,
    scopeLinkMode: "linked",
    hasPortsData: true,
    visualModeControl: "network",
  });

  const appliedConfig = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const portConfig = state.styleConfig?.transportOverview?.port || {};
    return {
      opacity: Number(portConfig.opacity || 0),
      importanceThreshold: String(portConfig.importanceThreshold || ""),
      coverageReach: Number(portConfig.coverageReach || 0),
    };
  });
  expect(appliedConfig.opacity).toBeCloseTo(0.74, 1);
  expect(appliedConfig.importanceThreshold).toBe("secondary");
  expect(appliedConfig.coverageReach).toBeGreaterThan(0.35);
});


test("adaptive support, transport, and palette surfaces stay contained", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 900, height: 720 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const isWorkspace = await page.locator("body.editor-workspace").count();
  if (isWorkspace) {
    await page.locator("#leftPanelToggle").click();
    await page.locator("#editorTaskLayersBtn").click();
    await page.locator("#editorLayer-reference").click();
    await expect(page.locator("#editorProperty-reference #referenceOpacity")).toBeVisible();
  } else {
    await page.evaluate(() => {
      document.querySelector("#rightPanelToggle")?.click();
      document.querySelector("#inspectorSidebarTabProject")?.click();
      const utilities = document.querySelector("#inspectorUtilitiesSection");
      if (utilities instanceof HTMLDetailsElement) utilities.open = true;
    });
    await page.locator("#dockReferenceBtn").click();
  }
  await expect(page.locator("#dockReferencePopover")).toBeVisible();

  await page.locator("#rightSidebar").evaluate(async (sidebar) => {
    await Promise.all(sidebar.getAnimations().map((animation) => animation.finished));
  });
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

  if (isWorkspace) {
    await page.keyboard.press("Escape");
    await expect(page.locator("#sidebarDrawerBackdrop")).toBeHidden();
    await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
    await page.locator("#leftPanelToggle").click();
    await page.locator("#editorLayer-legend").click();
    await expect(page.locator("#editorProperty-reference")).toBeHidden();
    await expect(page.locator("#editorProperty-legend")).toBeVisible();
  } else {
    await page.keyboard.press("Escape");
  }
  await openTransportWorkbench(page);
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
  if (await page.locator("body.editor-workspace").count()) {
    // 交通入口在右栏：窄屏下关闭工作台会恢复右侧抽屉，先关掉它再打开左栏。
    if (await page.locator("body.right-drawer-open").count()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
    }
    if (await page.locator("#leftSidebar").evaluate((node) => node.inert)) await page.locator("#leftPanelToggle").click();
    await page.locator("#editorTaskPaletteBtn").click();
  }
  const paletteMetrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const list = document.querySelector("#paletteLibraryList");
    const rect = rectToObject(list?.getBoundingClientRect());
    const styles = list ? getComputedStyle(list) : null;
    return {
      rect,
      maxHeight: styles?.getPropertyValue("--palette-library-list-max-block") || "",
      overflowY: styles?.overflowY || "",
    };
  });
  expect(paletteMetrics.maxHeight.trim()).toBe("480px");
  expect(paletteMetrics.rect.height).toBeLessThanOrEqual(480);
  expect(["auto", "scroll"]).toContain(paletteMetrics.overflowY);
});
