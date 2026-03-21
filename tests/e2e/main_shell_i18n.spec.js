const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function resolveBaseUrl() {
  const runtimeMetaPath = path.join(__dirname, "..", "..", ".runtime", "dev", "active_server.json");
  try {
    const payload = JSON.parse(fs.readFileSync(runtimeMetaPath, "utf8"));
    return String(payload.url || "http://127.0.0.1:18080");
  } catch (_error) {
    return "http://127.0.0.1:18080";
  }
}

test("main shell static i18n updates visible labels and aria text", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const currentTool = page.locator("#lblCurrentTool");
  const leftPanelToggle = page.locator("#leftPanelToggle");
  const rightPanelToggle = page.locator("#rightPanelToggle");
  const dockCollapseBtn = page.locator("#dockCollapseBtn");
  const lakeLink = page.locator("#lblLakeLinkToOcean");
  const textureInfo = page.locator("#lblTextureInfo");
  const workspaceHeading = page.locator(".sidebar-shell-heading").first();
  const dockKicker = page.locator(".dock-shell-kicker");
  const dockHint = page.locator(".dock-shell-hint");

  await expect(currentTool).toHaveText("Tools");
  await expect(leftPanelToggle).toHaveText("Panels");
  await expect(leftPanelToggle).toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).toHaveText("Inspector");
  await expect(rightPanelToggle).toHaveAttribute("aria-label", "Toggle right panel");
  await expect(dockCollapseBtn).toHaveText("Collapse");
  await expect(dockCollapseBtn).toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).toHaveText("Texture Overlay");
  await expect(workspaceHeading).toHaveText("Workspace");
  await expect(dockKicker).toHaveText("Quick Actions");
  await expect(dockHint).toHaveText("Current tool, paint mode, and map actions");

  await page.locator("#btnToggleLang").click();

  await expect(currentTool).not.toHaveText("Tools");
  await expect(leftPanelToggle).not.toHaveText("Panels");
  await expect(leftPanelToggle).not.toHaveAttribute("aria-label", "Toggle left panel");
  await expect(rightPanelToggle).not.toHaveText("Inspector");
  await expect(rightPanelToggle).not.toHaveAttribute("aria-label", "Toggle right panel");
  await expect(dockCollapseBtn).not.toHaveText("Collapse");
  await expect(dockCollapseBtn).not.toHaveAttribute("aria-label", "Collapse quick dock");
  await expect(lakeLink).not.toHaveText("Link Lakes To Ocean");
  await expect(textureInfo).not.toHaveText("Texture Overlay");
  await expect(workspaceHeading).not.toHaveText("Workspace");
  await expect(dockKicker).not.toHaveText("Quick Actions");
  await expect(dockHint).not.toHaveText("Current tool, paint mode, and map actions");
});
