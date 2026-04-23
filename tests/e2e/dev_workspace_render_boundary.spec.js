const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

test.setTimeout(90_000);

async function gotoDevWorkspace(page) {
  await page.goto(getAppUrl(), { waitUntil: "domcontentloaded" });
  await expect.poll(
    async () => page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      return typeof state.updateDevWorkspaceUIFn === "function";
    }),
    { timeout: 30_000 }
  ).toBe(true);
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.ui.devWorkspaceCategory = "scenario";
  });
  await page.evaluate(() => {
    document.getElementById("devWorkspaceToggleBtn")?.click();
  });
  await expect(page.locator("#devWorkspacePanel")).toBeVisible();
  await expect(page.locator("#devScenarioTagCreatorLabel")).toBeVisible();
}

async function installRenderBoundarySpy(page) {
  await page.evaluate(async () => {
    const { bindRenderBoundary } = await import("/js/core/render_boundary.js");
    const { state } = await import("/js/core/state.js");
    globalThis.__pwDevWorkspaceBoundary = {
      flushes: [],
      schedules: [],
      state,
    };
    bindRenderBoundary({
      scheduleRender(payload = {}) {
        globalThis.__pwDevWorkspaceBoundary.schedules.push({
          reason: String(payload.reason || ""),
          reasons: Array.isArray(payload.reasons) ? [...payload.reasons] : [],
        });
      },
      flushRender(payload = {}) {
        globalThis.__pwDevWorkspaceBoundary.flushes.push(String(payload.reason || ""));
      },
    });
  });
}

async function resetBoundarySpy(page) {
  await page.evaluate(() => {
    globalThis.__pwDevWorkspaceBoundary.flushes = [];
    globalThis.__pwDevWorkspaceBoundary.schedules = [];
  });
}

async function readBoundarySpy(page) {
  return page.evaluate(() => ({
    flushes: [...(globalThis.__pwDevWorkspaceBoundary?.flushes || [])],
    schedules: [...(globalThis.__pwDevWorkspaceBoundary?.schedules || [])],
  }));
}

test("@dev dev workspace local selection and inspector actions flush through render boundary", async ({ page }) => {
  await gotoDevWorkspace(page);
  await installRenderBoundarySpy(page);

  const featureId = await page.evaluate(async () => {
    const state = globalThis.__pwDevWorkspaceBoundary.state;
    const { shouldExcludeScenarioPoliticalFeature } = await import("/js/core/sovereignty_manager.js");
    const nextFeatureId = Array.from(state.landIndex?.entries?.() || []).find(([id, feature]) => (
      !!id && feature && !shouldExcludeScenarioPoliticalFeature(feature, id)
    ))?.[0] || "";
    state.activeScenarioId = "dev_workspace_boundary_test";
    state.activeScenarioManifest = {
      display_name: "Dev Workspace Boundary Test",
    };
    state.scenarioCountriesByTag = {
      AAA: {
        tag: "AAA",
        display_name: "Alpha",
        display_name_en: "Alpha",
        display_name_zh: "阿尔法",
        feature_count: 1,
      },
      BBB: {
        tag: "BBB",
        display_name: "Beta",
        display_name_en: "Beta",
        display_name_zh: "贝塔",
        feature_count: 1,
      },
    };
    state.devSelectionFeatureIds = new Set(nextFeatureId ? [nextFeatureId] : []);
    state.devSelectionOrder = nextFeatureId ? [nextFeatureId] : [];
    state.devSelectedHit = nextFeatureId ? { id: nextFeatureId, targetType: "land" } : null;
    state.devScenarioTagInspector = {
      ...(state.devScenarioTagInspector || {}),
      selectedTag: "AAA",
      threshold: 3,
    };
    state.selectedInspectorCountryCode = "AAA";
    state.inspectorHighlightCountryCode = "AAA";
    state.updateDevWorkspaceUIFn?.();
    return nextFeatureId;
  });

  expect(featureId).not.toBe("");

  await page.evaluate(() => {
    document.getElementById("devScenarioClearTagSelectionBtn")?.click();
  });
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-tag-clear-target"
  );
  expect(
    await page.evaluate(() => globalThis.__pwDevWorkspaceBoundary.state.devSelectedHit)
  ).toBeNull();

  await resetBoundarySpy(page);
  await page.evaluate(() => {
    const select = document.getElementById("devScenarioTagInspectorSelect");
    if (!(select instanceof HTMLSelectElement)) return;
    select.value = "BBB";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-tag-inspector-select"
  );
  await expect.poll(async () => page.evaluate(() => ({
    selected: globalThis.__pwDevWorkspaceBoundary.state.selectedInspectorCountryCode,
    highlight: globalThis.__pwDevWorkspaceBoundary.state.inspectorHighlightCountryCode,
  }))).toEqual({
    selected: "BBB",
    highlight: "BBB",
  });

  await resetBoundarySpy(page);
  await page.evaluate(() => {
    document.getElementById("devScenarioTagInspectorClearHighlightBtn")?.click();
  });
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-tag-inspector-clear-highlight"
  );
  await expect.poll(async () => (
    page.evaluate(() => globalThis.__pwDevWorkspaceBoundary.state.inspectorHighlightCountryCode)
  )).toBe("");
});

test("@dev dev workspace country save and locale save success flush through render boundary", async ({ page }) => {
  await gotoDevWorkspace(page);
  await installRenderBoundarySpy(page);

  let localeFeatureId = "";

  await page.route("**/__dev/scenario/country/save", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        savedAt: "2026-03-30T12:00:00Z",
        filePath: "/tmp/scenario_country.json",
        countryEntry: {
          tag: "AAA",
          display_name: "Alpha",
          display_name_en: "Alpha",
          display_name_zh: "阿尔法",
        },
      }),
    });
  });
  await page.route("**/__dev/scenario/geo-locale/save", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        savedAt: "2026-03-30T12:05:00Z",
        filePath: "/tmp/geo_locale_patch.json",
      }),
    });
  });
  await page.route("**/__test/dev-workspace-geo-locale.json*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        geo: {
          [localeFeatureId]: {
            en: "Boundary Locale EN",
            zh: "边界地名",
          },
        },
      }),
    });
  });

  localeFeatureId = await page.evaluate(async () => {
    const state = globalThis.__pwDevWorkspaceBoundary.state;
    const { shouldExcludeScenarioPoliticalFeature } = await import("/js/core/sovereignty_manager.js");
    const nextFeatureId = Array.from(state.landIndex?.entries?.() || []).find(([id, feature]) => (
      !!id && feature && !shouldExcludeScenarioPoliticalFeature(feature, id)
    ))?.[0] || "";
    state.activeScenarioId = "dev_workspace_save_test";
    state.activeScenarioManifest = {
      display_name: "Dev Workspace Save Test",
      geo_locale_patch_url: "/__test/dev-workspace-geo-locale.json",
    };
    state.scenarioCountriesByTag = {
      AAA: {
        tag: "AAA",
        display_name: "Alpha",
        display_name_en: "Alpha",
        display_name_zh: "阿尔法",
        feature_count: 1,
        lookup_iso2: "AA",
        base_iso2: "AA",
      },
    };
    state.devScenarioCountryEditor = {
      ...(state.devScenarioCountryEditor || {}),
      tag: "AAA",
      nameEn: "Alpha",
      nameZh: "阿尔法",
      isSaving: false,
    };
    state.devSelectionFeatureIds = new Set(nextFeatureId ? [nextFeatureId] : []);
    state.devSelectionOrder = nextFeatureId ? [nextFeatureId] : [];
    state.devSelectedHit = nextFeatureId ? { id: nextFeatureId, targetType: "land" } : null;
    state.devLocaleEditor = {
      ...(state.devLocaleEditor || {}),
      featureId: nextFeatureId,
      en: "Boundary Locale EN",
      zh: "边界地名",
      isSaving: false,
    };
    state.updateDevWorkspaceUIFn?.();
    return nextFeatureId;
  });

  expect(localeFeatureId).not.toBe("");

  await page.evaluate(() => {
    document.getElementById("devScenarioSaveCountryBtn")?.click();
  });
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-country-save"
  );
  await expect(page.locator("#devScenarioCountryStatus")).toContainText("Saved");

  await resetBoundarySpy(page);
  await page.evaluate(() => {
    document.getElementById("devScenarioSaveLocaleBtn")?.click();
  });
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-locale-save"
  );
  await expect(page.locator("#devScenarioLocaleStatus")).toContainText("Saved");
});
