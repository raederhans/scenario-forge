const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

const ZH_TRANSPORT_COMPARE = {
  labels: "\u6807\u7b7e",
  compare: "\u6bd4\u8f83\u57fa\u7ebf",
  unavailable: "\u57fa\u7ebf\u4e0d\u53ef\u7528",
  unavailableStatus: "\u8fd9\u4e2a\u5bb6\u65cf\u6ca1\u6709\u53ef\u7528\u57fa\u7ebf",
  preview: "\u57fa\u7ebf\u9884\u89c8\u4e2d",
  live: "\u5f53\u524d\u5de5\u4f5c\u72b6\u6001",
};

const ZH_COLOR_ONLY = {
  summary: "\u4ec5\u989c\u8272",
  note: "\u8fd9\u4e9b\u64cd\u4f5c\u53ea\u4f1a\u6539\u53d8\u89c6\u89c9\u989c\u8272\u3002\u5f52\u5c5e\u3001\u63a7\u5236\u65b9\u548c\u52a8\u6001\u8fb9\u754c\u4fdd\u6301\u4e0d\u53d8\u3002",
};

async function openColorOnlySection(page) {
  try {
    await page.waitForFunction(() => {
      const status = document.querySelector("#scenarioStatus");
      return !!status && String(status.textContent || "").trim().length > 0;
    }, { timeout: 15_000 });
  } catch {
    return null;
  }
  await page.evaluate(() => {
    const details = document.querySelector("details[aria-labelledby='lblScenario']");
    if (details && !details.open) {
      details.open = true;
    }
  });
  const colorOnlySection = page.locator(".scenario-visual-adjustments").first();
  if (await colorOnlySection.count() === 0) {
    return null;
  }
  await expect(colorOnlySection).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const details = document.querySelector(".scenario-visual-adjustments");
    if (details && !details.open) {
      details.open = true;
    }
  });
  return {
    summary: colorOnlySection.locator("summary").first(),
    note: colorOnlySection.locator(".scenario-action-hint").first(),
  };
}

test("main shell static i18n updates visible labels and aria text", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#leftPanelToggle", { state: "attached", timeout: 30_000 });
  await page.waitForSelector("#btnToggleLang", { state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => {
    const button = document.getElementById("btnToggleLang");
    const text = String(button?.textContent || "").trim();
    return text && text !== "Language";
  }, { timeout: 180_000 });

  const currentTool = page.locator("#lblCurrentTool");
  const leftPanelToggle = page.locator("#leftPanelToggle");
  const rightPanelToggle = page.locator("#rightPanelToggle");
  const inspectorTab = page.locator("#inspectorSidebarTabInspector");
  const projectTab = page.locator("#inspectorSidebarTabProject");
  const dockCollapseBtn = page.locator("#dockCollapseBtn");
  const dockHandleLabel = page.locator("#dockHandleLabel");
  const lakeLink = page.locator("#lblLakeLinkToOcean");
  const textureInfo = page.locator("#lblTextureInfo");
  const workspaceHeading = page.locator(".sidebar-shell-heading").first();
  const languageBtn = page.locator("#btnToggleLang");
  const developerModeBtn = page.locator("#developerModeBtn");
  const recentColors = page.locator("#recentColors");
  const frontlineIntro = page.locator(".inspector-frontline-intro");
  const viewportGroup = page.locator("#zoomUtilityViewportGroup");
  const systemGroup = page.locator("#zoomUtilitySystemGroup");
  const workspaceGroup = page.locator("#zoomUtilityWorkspaceGroup");
  const colorOnlySection = await openColorOnlySection(page);

  await page.evaluate(() => {
    document.getElementById("inspectorSidebarTabProject")?.click();
  });
  await page.evaluate(() => {
    const utilities = document.querySelector("#inspectorUtilitiesSection");
    if (utilities && "open" in utilities) {
      utilities.open = true;
    }
  });
  const supportGuideBtn = page.locator("#utilitiesGuideBtn");
  const supportReferenceBtn = page.locator("#dockReferenceBtn");
  const supportExportBtn = page.locator("#dockExportBtn");
  const supportGuideTitle = page.locator("#scenarioGuideTitle");
  const supportReferenceTitle = page.locator("#lblReferenceImage");
  const frontlineProjectTitle = page.locator("#lblFrontlineProject .sidebar-section-title");
  const transportLabelsTab = page.locator('[data-transport-inspector-tab="labels"]');
  const transportRoadTab = page.locator('[data-transport-family="road"]');
  const transportLayersTab = page.locator('[data-transport-family="layers"]');
  const transportCompareBtn = page.locator("#transportWorkbenchCompareBtn");
  const transportCompareStatus = page.locator("#transportWorkbenchCompareStatus");

  await expect(currentTool).toHaveText("Tools");
  await expect(leftPanelToggle).toHaveText("Panels");
  await expect(leftPanelToggle).toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).toHaveText("Inspector");
  await expect(rightPanelToggle).toHaveAttribute("aria-label", "Toggle right panel");
  await expect(inspectorTab).toHaveText("Inspector");
  await expect(projectTab).toHaveText("Project");
  await expect(dockHandleLabel).toHaveText("Collapse");
  await expect(dockCollapseBtn).toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).toHaveText("Texture Overlay");
  await expect(workspaceHeading).toHaveText("Workspace");
  await expect(languageBtn).toContainText("EN / ZH");
  await expect(languageBtn).toHaveAttribute("aria-label", "Language");
  await expect(developerModeBtn).toHaveText("Dev");
  await expect(recentColors).toHaveAttribute("aria-label", "Recent colors");
  await expect(viewportGroup).toHaveAttribute("aria-label", "Viewport controls");
  await expect(systemGroup).toHaveAttribute("aria-label", "System status");
  await expect(workspaceGroup).toHaveAttribute("aria-label", "Workspace entry");
  await expect(supportGuideBtn).toHaveText("Guide");
  await expect(supportReferenceBtn).toHaveText("Reference");
  await expect(supportExportBtn).toHaveText("Open workbench");
  await expect(supportGuideTitle).toHaveText("Scenario Quick Start");
  await expect(supportReferenceTitle).toHaveText("Reference Image");
  await expect(frontlineProjectTitle).toHaveText("Frontline");
  await page.evaluate(() => {
    document.querySelector("#zoomControls #scenarioTransportWorkbenchBtn")?.click();
  });
  await expect(transportLabelsTab).toHaveText("Labels");
  await expect(transportCompareBtn).toHaveText("Compare baseline");
  await expect(transportCompareStatus).toHaveText("Live working state");
  await transportCompareBtn.focus();
  await page.keyboard.down("Enter");
  await expect(transportCompareStatus).toHaveText("Baseline preview");
  await page.keyboard.up("Enter");
  await expect(transportCompareStatus).toHaveText("Live working state");
  await page.evaluate(() => {
    document.querySelector('[data-transport-family="layers"]')?.click();
  });
  await expect(transportCompareBtn).toHaveText("Baseline unavailable");
  await expect(transportCompareStatus).toHaveText("Baseline unavailable for this family");
  await page.evaluate(() => {
    document.querySelector('[data-transport-family="road"]')?.click();
  });
  await page.evaluate(() => {
    document.getElementById("transportWorkbenchCloseBtn")?.click();
  });
  await expect(frontlineIntro).toHaveText(
    "Use Frontline after you apply a scenario. This section combines the derived conflict overlay with the project-local strategic workspace for operational lines, graphics, and unit counters."
  );
  if (colorOnlySection) {
    await expect(colorOnlySection.summary).toHaveText("Color Only");
    await expect(colorOnlySection.note).toHaveText(
      "These actions only change visual color. Ownership, controllers, and dynamic borders stay unchanged."
    );
  }

  await page.evaluate(() => {
    document.getElementById("btnToggleLang")?.click();
  });

  await expect(currentTool).not.toHaveText("Tools");
  await expect(leftPanelToggle).not.toHaveText("Panels");
  await expect(leftPanelToggle).not.toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).not.toHaveText("Inspector");
  await expect(rightPanelToggle).not.toHaveAttribute("aria-label", "Toggle right panel");
  await expect(inspectorTab).not.toHaveText("Inspector");
  await expect(projectTab).not.toHaveText("Project");
  await expect(dockHandleLabel).not.toHaveText("Collapse");
  await expect(dockCollapseBtn).not.toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).not.toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).not.toHaveText("Texture Overlay");
  await expect(workspaceHeading).not.toHaveText("Workspace");
  await expect(languageBtn).toContainText("ZH / EN");
  await expect(languageBtn).not.toHaveAttribute("aria-label", "Language");
  await expect(recentColors).not.toHaveAttribute("aria-label", "Recent colors");
  await expect(viewportGroup).not.toHaveAttribute("aria-label", "Viewport controls");
  await expect(systemGroup).not.toHaveAttribute("aria-label", "System status");
  await expect(workspaceGroup).not.toHaveAttribute("aria-label", "Workspace entry");
  await expect(supportGuideBtn).not.toHaveText("Guide");
  await expect(supportReferenceBtn).not.toHaveText("Reference");
  await expect(supportExportBtn).not.toHaveText("Export");
  await expect(supportGuideTitle).not.toHaveText("Scenario Quick Start");
  await expect(supportReferenceTitle).not.toHaveText("Reference Image");
  await expect(frontlineProjectTitle).not.toHaveText("Frontline");
  await page.evaluate(() => {
    document.querySelector("#zoomControls #scenarioTransportWorkbenchBtn")?.click();
  });
  await expect(transportLabelsTab).toHaveText(ZH_TRANSPORT_COMPARE.labels);
  await expect(transportCompareBtn).toHaveText(ZH_TRANSPORT_COMPARE.compare);
  await expect(transportCompareStatus).toHaveText(ZH_TRANSPORT_COMPARE.live);
  await transportCompareBtn.focus();
  await page.keyboard.down("Enter");
  await expect(transportCompareStatus).toHaveText(ZH_TRANSPORT_COMPARE.preview);
  await page.keyboard.up("Enter");
  await expect(transportCompareStatus).toHaveText(ZH_TRANSPORT_COMPARE.live);
  await page.evaluate(() => {
    document.querySelector('[data-transport-family="layers"]')?.click();
  });
  await expect(transportCompareBtn).toHaveText(ZH_TRANSPORT_COMPARE.unavailable);
  await expect(transportCompareStatus).toHaveText(ZH_TRANSPORT_COMPARE.unavailableStatus);
  await page.evaluate(() => {
    document.querySelector('[data-transport-family="road"]')?.click();
  });
  await page.evaluate(() => {
    document.getElementById("transportWorkbenchCloseBtn")?.click();
  });
  await expect(frontlineIntro).not.toHaveText(
    "Use Frontline after you apply a scenario. This section combines the derived conflict overlay with the project-local strategic workspace for operational lines, graphics, and unit counters."
  );
  if (colorOnlySection) {
    await expect(colorOnlySection.summary).toHaveText(ZH_COLOR_ONLY.summary);
    await expect(colorOnlySection.note).toHaveText(ZH_COLOR_ONLY.note);
  }
});
