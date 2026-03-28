const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

function resolveBaseUrl() {
  return getAppUrl();
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

test("explicit scenario geo locale patch wins over derived city override sync", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const scenarioManagerModuleUrl = new URL("/js/core/scenario_manager.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    const { syncScenarioLocalizationState } = await import(scenarioManagerModuleUrl);

    state.baseGeoLocales = {
      TEST_HOST: { en: "Base Host", zh: "基础主机" },
    };
    state.scenarioGeoLocalePatchData = {
      geo: {
        TEST_HOST: { en: "Patch Host", zh: "补丁主机" },
      },
    };
    state.scenarioCityOverridesData = {
      cities: {
        TEST_CITY: {
          city_id: "TEST_CITY",
          stable_key: "TEST_CITY",
          name_en: "Derived City",
          name_zh: "派生城市",
        },
      },
      featureCollection: null,
    };
    state.worldCitiesData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "TEST_CITY",
          properties: {
            id: "TEST_CITY",
            __city_id: "TEST_CITY",
            __city_stable_key: "TEST_CITY",
            __city_host_feature_id: "TEST_HOST",
          },
          geometry: {
            type: "Point",
            coordinates: [0, 0],
          },
        },
      ],
    };
    state.locales = {
      ...(state.locales || {}),
      geo: {},
    };

    syncScenarioLocalizationState();

    return {
      effectiveEntry: state.locales?.geo?.TEST_HOST || null,
      patchEntry: state.scenarioGeoLocalePatchData?.geo?.TEST_HOST || null,
    };
  });

  expect(result.patchEntry).toEqual({ en: "Patch Host", zh: "补丁主机" });
  expect(result.effectiveEntry).toEqual({ en: "Patch Host", zh: "补丁主机" });
});

test("dev workspace select option labels render injected markup as literal text", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator("#devWorkspaceToggleBtn").click();
  await expect(page.locator("#devScenarioTagGroupSelect")).toHaveCount(1);
  await expect(page.locator("#devScenarioCountrySelect")).toHaveCount(1);
  await expect(page.locator("#devScenarioDistrictSelect")).toHaveCount(1);

  const options = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);

    state.activeScenarioId = "xss_test";
    state.activeScenarioManifest = { display_name: "XSS Test" };
    state.scenarioCountriesByTag = {
      AAA: {
        tag: "AAA",
        display_name: 'Alpha</option><option value="ZZZ">Injected',
        feature_count: 1,
        continent_id: "grp",
        continent_label: 'Group</option><option value="BAD">Injected',
      },
    };
    state.devScenarioCountryEditor = { tag: "AAA", isSaving: false };
    state.devScenarioCapitalEditor = { tag: "AAA", isSaving: false };
    state.devScenarioTagCreator = {
      ...(state.devScenarioTagCreator || {}),
      selectedInspectorGroupId: "grp",
      isSaving: false,
    };
    state.scenarioDistrictGroupsData = {
      version: 1,
      scenario_id: "xss_test",
      tags: {
        AAA: {
          tag: "AAA",
          districts: {
            safe: {
              district_id: "safe",
              name_en: 'District</option><option value="BAD">Injected',
              feature_ids: [],
            },
          },
        },
      },
    };
    state.devScenarioDistrictEditor = {
      ...(state.devScenarioDistrictEditor || {}),
      tagMode: "manual",
      manualTag: "AAA",
      selectedDistrictId: "safe",
      isSaving: false,
      isTemplateApplying: false,
    };
    state.updateDevWorkspaceUIFn?.();

    const readOptions = (selector) => {
      const select = document.querySelector(selector);
      if (!select) {
        return null;
      }
      return Array.from(select.options).map((option) => ({
        value: option.value,
        text: option.text,
      }));
    };

    return {
      group: readOptions("#devScenarioTagGroupSelect"),
      country: readOptions("#devScenarioCountrySelect"),
      district: readOptions("#devScenarioDistrictSelect"),
    };
  });

  expect(options.group).not.toBeNull();
  expect(options.country).not.toBeNull();
  expect(options.district).not.toBeNull();
  expect(options.group).toHaveLength(2);
  expect(options.country).toHaveLength(2);
  expect(options.district).toHaveLength(2);
  expect(options.group[1].text).toContain('</option><option value="BAD">Injected');
  expect(options.country[1].text).toContain('</option><option value="ZZZ">Injected');
  expect(options.district[1].text).toContain('</option><option value="BAD">Injected');
});

test("dev workspace reinit keeps one tracked color-popover document click listener", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator("#devWorkspaceToggleBtn").click();

  const stats = await page.evaluate(async () => {
    const workspaceModuleUrl = new URL("/js/ui/dev_workspace.js", window.location.href).href;
    const { initDevWorkspace } = await import(workspaceModuleUrl);
    const trackedClickListeners = new Set();
    const originalAddEventListener = document.addEventListener.bind(document);
    const originalRemoveEventListener = document.removeEventListener.bind(document);

    document.addEventListener = function addEventListenerPatched(type, listener, options) {
      if (type === "click") {
        trackedClickListeners.add(listener);
      }
      return originalAddEventListener(type, listener, options);
    };
    document.removeEventListener = function removeEventListenerPatched(type, listener, options) {
      if (type === "click") {
        trackedClickListeners.delete(listener);
      }
      return originalRemoveEventListener(type, listener, options);
    };

    try {
      initDevWorkspace();
      initDevWorkspace();
      return { trackedClickListenerCount: trackedClickListeners.size };
    } finally {
      document.addEventListener = originalAddEventListener;
      document.removeEventListener = originalRemoveEventListener;
    }
  });

  expect(stats.trackedClickListenerCount).toBe(1);

  await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    state.activeScenarioId = "listener_test";
    state.activeScenarioManifest = { display_name: "Listener Test" };
    state.devSelectionFeatureIds = new Set(["AAA-1"]);
    state.devSelectionOrder = ["AAA-1"];
    state.landIndex = new Map([["AAA-1", { properties: {} }]]);
    state.devScenarioTagCreator = {
      ...(state.devScenarioTagCreator || {}),
      isSaving: false,
    };
    state.updateDevWorkspaceUIFn?.();
  });

  await page.locator("#devScenarioTagColorPreviewBtn").click();
  await expect(page.locator("#devScenarioTagColorPopover")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator("#devScenarioTagColorPopover")).toBeHidden();
});

test("dev workspace Add Hovered only enables land hits and ignores non-land fallbacks", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator("#devWorkspaceToggleBtn").click();

  const featureId = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    return Array.from(state.landIndex?.keys?.() || []).find(Boolean) || "";
  });

  expect(featureId).not.toBe("");

  await page.evaluate(async (selectedFeatureId) => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    state.activeScenarioId = "hover_test";
    state.activeScenarioManifest = { display_name: "Hover Test" };
    state.devSelectionFeatureIds = new Set();
    state.devSelectionOrder = [];
    state.devHoverHit = { id: selectedFeatureId, targetType: "water" };
    state.hoveredId = selectedFeatureId;
    state.updateDevWorkspaceUIFn?.();
  }, featureId);

  const addHoveredBtn = page.locator("#devSelectionAddHoveredBtn");
  await expect(addHoveredBtn).toBeDisabled();

  const invalidSelection = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    document.querySelector("#devSelectionAddHoveredBtn").click();
    return Array.from(state.devSelectionFeatureIds || []);
  });

  expect(invalidSelection).toEqual([]);

  await page.evaluate(async (selectedFeatureId) => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    state.devHoverHit = { id: selectedFeatureId, targetType: "land" };
    state.updateDevWorkspaceUIFn?.();
  }, featureId);

  const validSelection = await page.evaluate(async (selectedFeatureId) => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    const addHoveredButton = document.querySelector("#devSelectionAddHoveredBtn");
    const wasDisabled = !!addHoveredButton?.disabled;
    addHoveredButton?.click();
    return {
      wasDisabled,
      selection: Array.from(state.devSelectionFeatureIds || []),
    };
  }, featureId);

  expect(validSelection.wasDisabled).toBe(false);
  expect(validSelection.selection).toEqual([featureId]);
});

test("dev workspace district remove no-op stays informational instead of error-like", async ({ page }) => {
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator("#devWorkspaceToggleBtn").click();

  const featureId = await page.evaluate(async () => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    return Array.from(state.landIndex?.keys?.() || []).find(Boolean) || "";
  });

  expect(featureId).not.toBe("");

  await page.evaluate(async (selectedFeatureId) => {
    const stateModuleUrl = new URL("/js/core/state.js", window.location.href).href;
    const { state } = await import(stateModuleUrl);
    state.activeScenarioId = "district_test";
    state.activeScenarioManifest = { display_name: "District Test" };
    state.devSelectionFeatureIds = new Set([selectedFeatureId]);
    state.devSelectionOrder = [selectedFeatureId];
    state.sovereigntyByFeatureId = { [selectedFeatureId]: "AAA" };
    state.scenarioDistrictGroupsData = {
      version: 1,
      scenario_id: "district_test",
      tags: {
        AAA: {
          tag: "AAA",
          districts: {
            berlin: {
              district_id: "berlin",
              name_en: "Berlin",
              feature_ids: ["AAA-2"],
            },
          },
        },
      },
    };
    state.devScenarioDistrictEditor = {
      ...(state.devScenarioDistrictEditor || {}),
      tagMode: "manual",
      manualTag: "AAA",
      selectedDistrictId: "berlin",
      isSaving: false,
      isTemplateApplying: false,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    state.updateDevWorkspaceUIFn?.();
  }, featureId);

  const removeBtn = page.locator("#devScenarioDistrictRemoveBtn");
  await expect(removeBtn).toBeEnabled();
  await page.evaluate(() => {
    document.querySelector("#devScenarioDistrictRemoveBtn").click();
  });
  await expect(page.locator("#devScenarioDistrictStatus")).toContainText(
    "Selected features were not assigned to the current district draft."
  );
});
