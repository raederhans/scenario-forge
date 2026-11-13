const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(60_000);

async function openWorkspace(page, height = 900) {
  await page.setViewportSize({ width: 1440, height });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("body")).toHaveClass(/editor-workspace/);
}

async function expectContext(page, key) {
  await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", key);
  await expect(page.locator(`#editorProperty-${key}`)).toBeVisible();
}

test("the active task returns from Project without duplicate Back entries or scroll loss", async ({ page }) => {
  await openWorkspace(page, 600);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  const right = page.locator("#rightSidebarContent");
  const savedScroll = await right.evaluate(async (element) => {
    element.scrollTop = 120;
    await new Promise(requestAnimationFrame);
    return element.scrollTop;
  });
  expect(savedScroll).toBeGreaterThan(0);
  const layerUrl = page.url();
  await page.locator("#inspectorSidebarTabProject").click();
  await expectContext(page, "project");
  expect(new URL(page.url()).searchParams.get("scope")).toBe("current-project");

  await page.locator("#editorTaskLayersBtn").click();
  await expectContext(page, "data-appearance-panel-citypoints");
  await expect(page.locator("#editorTaskLayersBtn")).toBeFocused();
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBe(savedScroll);
  expect(page.url()).toBe(layerUrl);

  // Selecting an already restored task must retain the no-change DOM fast path.
  await page.evaluate(() => {
    window.__taskContextMutations = 0;
    window.__taskContextObserver = new MutationObserver((records) => {
      window.__taskContextMutations += records.length;
    });
    for (const node of document.querySelectorAll(
      "#rightSidebarContent, #editorPropertiesTitle, #editorPropertiesBackBtn, .editor-property-panel, .editor-task-panel, #editorTaskNav button"
    )) {
      window.__taskContextObserver.observe(node, {
        attributes: true, childList: true, characterData: true,
      });
    }
  });
  await page.locator("#editorTaskLayersBtn").click();
  const mutations = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    window.__taskContextObserver.disconnect();
    const count = window.__taskContextMutations;
    delete window.__taskContextObserver;
    delete window.__taskContextMutations;
    return count;
  });
  expect(mutations).toBe(0);
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBe(savedScroll);

  for (const key of ["project", "data-appearance-panel-citypoints", "data-appearance-panel-borders"]) {
    await page.locator("#editorPropertiesBackBtn").click();
    await expectContext(page, key);
    await expect(page.locator("#editorPropertiesTitle")).toBeFocused();
  }
  await page.locator("#editorTaskObjectsBtn").click();
  await expectContext(page, "countries");
  await page.locator("#inspectorSidebarTabProject").click();
  await expectContext(page, "project");
  await page.locator("#editorTaskObjectsBtn").click();
  await expectContext(page, "countries");
});

test("task context restoration keeps collapsed properties and the narrow task drawer intact", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  await page.locator("#editorTaskObjectsBtn").click();
  await page.locator("#rightSidebarCollapseBtn").click();
  await page.locator("#editorTaskLayersBtn").click();
  await expect(page.locator("body")).toHaveClass(/right-sidebar-collapsed/);
  await expect(page.locator("#rightSidebarCollapseBtn")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", "data-appearance-panel-citypoints");

  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator("#leftPanelToggle").click();
  for (const [task, context] of [["Objects", "countries"], ["Layers", "data-appearance-panel-citypoints"]]) {
    await page.locator(`#editorTask${task}Btn`).click();
    await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", context);
    await expect(page.locator("body")).toHaveClass(/left-drawer-open/);
    await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
    await expect(page.locator("#leftSidebar")).toHaveJSProperty("inert", false);
    await expect(page.locator("#rightSidebar")).toHaveJSProperty("inert", true);
    await expect(page.locator(`#editorTask${task}Btn`)).toBeFocused();
  }
  // A concrete property entry still opens the right drawer through its owner.
  await page.locator("#editorLayer-legend").click();
  await expect(page.locator("body")).toHaveClass(/right-drawer-open/);
  await expect(page.locator("body")).not.toHaveClass(/left-drawer-open/);
  await expectContext(page, "legend");
});

