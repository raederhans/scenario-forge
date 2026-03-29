const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test("main shell static i18n updates visible labels and aria text", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  const currentTool = page.locator("#lblCurrentTool");
  const leftPanelToggle = page.locator("#leftPanelToggle");
  const rightPanelToggle = page.locator("#rightPanelToggle");
  const dockCollapseBtn = page.locator("#dockCollapseBtn");
  const dockHandleLabel = page.locator("#dockHandleLabel");
  const lakeLink = page.locator("#lblLakeLinkToOcean");
  const textureInfo = page.locator("#lblTextureInfo");
  const workspaceHeading = page.locator(".sidebar-shell-heading").first();
  const languageBtn = page.locator("#btnToggleLang");
  const developerModeBtn = page.locator("#developerModeBtn");
  const recentColors = page.locator("#recentColors");
  const frontlineIntro = page.locator(".inspector-frontline-intro");

  await expect(currentTool).toHaveText("Tools");
  await expect(leftPanelToggle).toHaveText("Panels");
  await expect(leftPanelToggle).toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).toHaveText("Inspector");
  await expect(rightPanelToggle).toHaveAttribute("aria-label", "Toggle right panel");
  await expect(dockHandleLabel).toHaveText("Collapse");
  await expect(dockCollapseBtn).toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).toHaveText("Texture Overlay");
  await expect(workspaceHeading).toHaveText("Workspace");
  await expect(languageBtn).toContainText("EN / ZH");
  await expect(languageBtn).toHaveAttribute("aria-label", "Language");
  await expect(developerModeBtn).toHaveText("Dev");
  await expect(recentColors).toHaveAttribute("aria-label", "Recent colors");
  await expect(frontlineIntro).toHaveText(
    "Derived frontlines stay optional and project-local. Enable them only when you want a conflict view."
  );

  await page.locator("#btnToggleLang").click();

  await expect(currentTool).not.toHaveText("Tools");
  await expect(leftPanelToggle).not.toHaveText("Panels");
  await expect(leftPanelToggle).not.toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).not.toHaveText("Inspector");
  await expect(rightPanelToggle).not.toHaveAttribute("aria-label", "Toggle right panel");
  await expect(dockHandleLabel).not.toHaveText("Collapse");
  await expect(dockCollapseBtn).not.toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).not.toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).not.toHaveText("Texture Overlay");
  await expect(workspaceHeading).not.toHaveText("Workspace");
  await expect(languageBtn).toContainText("ZH / EN");
  await expect(languageBtn).not.toHaveAttribute("aria-label", "Language");
  await expect(recentColors).not.toHaveAttribute("aria-label", "Recent colors");
  await expect(frontlineIntro).not.toHaveText(
    "Derived frontlines stay optional and project-local. Enable them only when you want a conflict view."
  );
});
