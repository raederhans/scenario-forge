const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

test.setTimeout(90_000);

async function gotoDevWorkspace(page) {
  await page.goto(getAppUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const overlay = document.getElementById("bootOverlay");
    return !overlay || overlay.classList.contains("hidden");
  });
  await expect.poll(
    async () => page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      return typeof state.updateDevWorkspaceUIFn === "function";
    }),
    { timeout: 30_000 }
  ).toBe(true);
  const developerModeBtn = page.locator("#developerModeBtn");
  if ((await developerModeBtn.getAttribute("aria-pressed")) !== "true") {
    await developerModeBtn.click();
  }
  await expect(page.locator("#devWorkspacePanel")).toBeVisible();
  await page.locator("#devWorkspaceTabScenario").click();
  await expect(page.locator("#devScenarioTagCreatorPanel")).toHaveCount(0);
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

test("@dev dev workspace selection and visible tag inspector actions preserve behavior", async ({ page }) => {
  await gotoDevWorkspace(page);
  await installRenderBoundarySpy(page);

  const { featureId, nextTag } = await page.evaluate(async () => {
    const state = globalThis.__pwDevWorkspaceBoundary.state;
    const { shouldExcludeScenarioPoliticalFeature, getFeatureIdsForOwner } = await import("/js/core/sovereignty_manager.js");
    const nextFeatureId = Array.from(state.landIndex?.entries?.() || []).find(([id, feature]) => (
      !!id && feature && !shouldExcludeScenarioPoliticalFeature(feature, id)
    ))?.[0] || "";
    const tags = Object.keys(state.scenarioCountriesByTag || {})
      .filter(tag => getFeatureIdsForOwner(tag).length > 0);
    if (tags.length < 2) throw new Error("Tag inspector requires two populated scenario countries.");
    state.devSelectionFeatureIds = new Set(nextFeatureId ? [nextFeatureId] : []);
    state.devSelectionOrder = nextFeatureId ? [nextFeatureId] : [];
    state.devSelectedHit = nextFeatureId ? { id: nextFeatureId, targetType: "land" } : null;
    state.devScenarioTagInspector = {
      ...(state.devScenarioTagInspector || {}),
      selectedTag: tags[0],
      threshold: state.landIndex.size,
    };
    state.selectedInspectorCountryCode = tags[0];
    state.inspectorHighlightCountryCode = tags[0];
    state.updateDevWorkspaceUIFn?.();
    return { featureId: nextFeatureId, nextTag: tags[1] };
  });

  expect(featureId).not.toBe("");

  await expect(page.locator("#devScenarioCountryPanel")).toBeVisible();
  await page.locator("#devWorkspaceTabSelection").click();
  await expect(page.locator("#devSelectionToggleSelectedBtn")).toBeVisible();
  await expect(page.locator("#devScenarioTagInspectorPanel")).toBeVisible();
  await page.locator("#devSelectionToggleSelectedBtn").click();
  await expect.poll(async () => page.evaluate((selectedFeatureId) => (
    globalThis.__pwDevWorkspaceBoundary.state.devSelectionFeatureIds.has(selectedFeatureId)
  ), featureId)).toBe(false);

  await page.locator("#devWorkspaceTabScenario").click();
  await expect(page.locator("#devScenarioCountryPanel")).toBeVisible();
  await page.locator("#devWorkspaceTabSelection").click();
  await expect(page.locator("#devScenarioTagInspectorPanel")).toBeVisible();
  await resetBoundarySpy(page);

  await page.locator("#devScenarioTagInspectorSelect").selectOption(nextTag);
  await expect.poll(async () => (await readBoundarySpy(page)).flushes).toContain(
    "dev-workspace-tag-inspector-select"
  );
  await expect.poll(async () => page.evaluate(() => ({
    selected: globalThis.__pwDevWorkspaceBoundary.state.selectedInspectorCountryCode,
    highlight: globalThis.__pwDevWorkspaceBoundary.state.inspectorHighlightCountryCode,
  }))).toEqual({
    selected: nextTag,
    highlight: nextTag,
  });

  await resetBoundarySpy(page);
  await page.locator("#devScenarioTagInspectorClearHighlightBtn").click();
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
        publishedPath: "/__test/dev-workspace-geo-locale.json",
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
