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

test("dev workspace declarative i18n updates static labels and placeholders", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  await page.locator("#devWorkspaceToggleBtn").click();

  const clipboardLabel = page.locator("#devSelectionClipboardLabel");
  const selectionPreview = page.locator("#devSelectionPreview");
  const selectionSortOption = page.locator('#devSelectionSortMode option[value="selection"]');
  const tagNamePlaceholder = page.locator("#devScenarioTagNameEnInput");

  await expect(clipboardLabel).toHaveText("Selection Clipboard");
  await expect(selectionPreview).toHaveAttribute("aria-label", "Development selection preview");
  await expect(selectionSortOption).toHaveText("Selection Order");
  await expect(tagNamePlaceholder).toHaveAttribute("placeholder", "New Country");

  await page.locator("#btnToggleLang").click();

  await expect(clipboardLabel).not.toHaveText("Selection Clipboard");
  await expect(selectionPreview).not.toHaveAttribute("aria-label", "Development selection preview");
  await expect(selectionSortOption).not.toHaveText("Selection Order");
  await expect(tagNamePlaceholder).not.toHaveAttribute("placeholder", "New Country");
});

test("dev workspace locale helper prefers effective scenario geo locale over raw patch values", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const workspaceModuleUrl = new URL("/js/ui/dev_workspace.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    const { getScenarioGeoLocaleEntry } = await import(workspaceModuleUrl);

    state.baseGeoLocales = {
      TEST_FEATURE: { en: "Base EN", zh: "基础中文" },
    };
    state.scenarioGeoLocalePatchData = {
      geo: {
        TEST_FEATURE: { en: "Patch EN", zh: "补丁中文" },
      },
    };
    state.locales = {
      ...(state.locales || {}),
      geo: {
        ...(state.locales?.geo || {}),
        TEST_FEATURE: { en: "Effective EN", zh: "生效中文" },
      },
    };

    return getScenarioGeoLocaleEntry("TEST_FEATURE");
  });

  expect(result.baseEntry).toEqual({ en: "Base EN", zh: "基础中文" });
  expect(result.patchEntry).toEqual({ en: "Patch EN", zh: "补丁中文" });
  expect(result.effectiveEntry).toEqual({ en: "Effective EN", zh: "生效中文" });
  expect(result.mergedEntry).toEqual({ en: "Effective EN", zh: "生效中文" });
});
