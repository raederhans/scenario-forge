const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function waitForScenarioManagerIdle(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.scenarioApplyInFlight && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
  }, { timeout: 120000 });
}

async function applyScenario(page, scenarioId) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate(async (expectedScenarioId) => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    await applyScenarioByIdCommand(expectedScenarioId, {
      renderMode: "request",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId, { timeout: 120000 });
}

async function clickWaterRegionByName(page, targetName) {
  await page.evaluate((expectedName) => {
    const rows = Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn"));
    const row = rows.find((node) => node.textContent?.includes(expectedName));
    if (!row) {
      throw new Error(`Missing water region row: ${expectedName}`);
    }
    row.click();
  }, targetName);
}

async function ensureWaterInspectorOpen(page) {
  await page.evaluate(() => {
    document.querySelector("#waterInspectorSection")?.setAttribute("open", "");
  });
  await expect(page.locator("#waterRegionSearch")).toBeVisible();
}

async function selectWaterRegion(page, searchValue, targetName) {
  await ensureWaterInspectorOpen(page);
  await page.fill("#waterRegionSearch", searchValue);
  await page.waitForFunction((expectedName) => {
    return Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn .country-row-title"))
      .some((node) => node.textContent?.includes(expectedName));
  }, targetName, { timeout: 30000 });
  await clickWaterRegionByName(page, targetName);
  await expect.poll(() => page.evaluate(() => {
    const activeTitle = document.querySelector("#waterRegionList .inspector-item-btn.is-active .country-row-title");
    return activeTitle?.textContent || "";
  })).toContain(targetName);
}

async function readWaterInspectorMeta(page) {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#waterInspectorMetaList > div"))
      .map((node) => node.textContent?.trim() || "");
    const meta = {};
    for (let index = 0; index < cells.length; index += 2) {
      meta[cells[index]] = cells[index + 1] || "";
    }
    return meta;
  });
}

function normalizeMetaValue(value) {
  return String(value || "").trim().toLowerCase();
}

test("named waters remain selectable when open-ocean selection is disabled", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");

  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await ensureWaterInspectorOpen(page);

  const selectionState = await page.evaluate(() => ({
    openOceanVisible: Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn")).some((node) => node.textContent?.includes("Northeast Atlantic Ocean")),
    namedWaterVisible: Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn")).some((node) => node.textContent?.includes("North Sea")),
  }));

  expect(selectionState.openOceanVisible).toBe(false);
  expect(selectionState.namedWaterVisible).toBe(true);

  await selectWaterRegion(page, "North Sea", "North Sea");
  const meta = await readWaterInspectorMeta(page);
  expect(meta.ID).toBe("tno_north_sea");
  expect(normalizeMetaValue(meta.Type)).toBe("sea");
  expect(normalizeMetaValue(meta.Group)).toBe("marine macro");
  expect(meta.Source).not.toBe("");
});

test("water inspector batch apply and clear scope propagates to visible family members", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");
  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await ensureWaterInspectorOpen(page);

  await selectWaterRegion(page, "North Sea", "North Sea");
  await page.selectOption("#waterInspectorScopeSelect", "same-parent");
  await page.fill("#waterRegionSearch", "");
  await page.evaluate(() => {
    const input = document.querySelector("#waterInspectorColorInput");
    input.value = "#ff6600";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click("#applyWaterFamilyOverrideBtn");

  const afterApply = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const ids = [
      "tno_north_sea",
      "tno_wadden_sea",
      "tno_thames_estuary",
      "tno_humber_estuary",
    ];
    return ids.map((id) => ({ id, color: state.waterRegionOverrides?.[id] || null }));
  });

  afterApply.forEach((entry) => {
    expect(entry.color).toBe("#ff6600");
  });

  await page.click("#clearWaterFamilyOverrideBtn");
  const afterClear = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const ids = [
      "tno_north_sea",
      "tno_wadden_sea",
      "tno_thames_estuary",
      "tno_humber_estuary",
    ];
    return ids.map((id) => ({ id, color: state.waterRegionOverrides?.[id] || null }));
  });

  afterClear.forEach((entry) => {
    expect(entry.color).toBeNull();
  });
});

test("water inspector shows hierarchy and jump-to-parent for detail waters", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");
  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await ensureWaterInspectorOpen(page);

  await selectWaterRegion(page, "Gulf of Riga", "Gulf of Riga");
  await expect(page.locator("#waterInspectorJumpToParentBtn")).toContainText("Baltic Sea");
  await page.click("#waterInspectorJumpToParentBtn");
  await expect.poll(async () => {
    const meta = await readWaterInspectorMeta(page);
    return meta.ID || "";
  }).toContain("tno_baltic_sea");
  await expect(page.locator("#waterInspectorChildrenList .inspector-item-btn")).toHaveCount(8);
});

test("tracked named waters expose stable inspector metadata", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");
  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await ensureWaterInspectorOpen(page);

  const targets = [
    {
      search: "Sea of Azov",
      name: "Sea of Azov",
      id: "tno_sea_of_azov",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions seavox v19",
    },
    {
      search: "Bo Hai",
      name: "Bo Hai",
      id: "tno_bo_hai",
      group: "marine detail",
      type: "gulf",
      parent: "tno_yellow_sea",
      source: "marine regions seavox v19",
    },
    {
      search: "Gulf of Thailand",
      name: "Gulf of Thailand",
      id: "tno_gulf_of_thailand",
      group: "marine detail",
      type: "gulf",
      parent: "tno_south_china_sea",
      source: "marine regions seavox v19",
    },
    {
      search: "Arabian Sea",
      name: "Arabian Sea",
      id: "tno_arabian_sea",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions seavox v19",
    },
    {
      search: "Sea of Okhotsk",
      name: "Sea of Okhotsk",
      id: "tno_sea_of_okhotsk",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions seavox v19",
    },
    {
      search: "Bass Strait",
      name: "Bass Strait",
      id: "tno_bass_strait",
      group: "marine detail",
      type: "strait",
      parent: "tno_tasman_sea",
      source: "marine regions seavox v19",
    },
    {
      search: "Bering Sea",
      name: "Bering Sea",
      id: "tno_bering_sea",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions seavox v19",
    },
    {
      search: "Gulf of Alaska",
      name: "Gulf of Alaska",
      id: "tno_gulf_of_alaska",
      group: "marine macro",
      type: "gulf",
      parent: "None",
      source: "marine regions iho v3",
    },
    {
      search: "Hudson Bay",
      name: "Hudson Bay",
      id: "tno_hudson_bay",
      group: "marine macro",
      type: "bay",
      parent: "None",
      source: "marine regions iho v3",
    },
    {
      search: "Caribbean Sea",
      name: "Caribbean Sea",
      id: "tno_caribbean_sea",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions iho v3",
    },
    {
      search: "Gulf of Mexico",
      name: "Gulf of Mexico",
      id: "tno_gulf_of_mexico",
      group: "marine macro",
      type: "gulf",
      parent: "None",
      source: "marine regions iho v3",
    },
    {
      search: "Norwegian Sea",
      name: "Norwegian Sea",
      id: "tno_norwegian_sea",
      group: "marine macro",
      type: "sea",
      parent: "None",
      source: "marine regions seavox v19",
    },
    {
      search: "Solent",
      name: "Solent",
      id: "tno_solent",
      group: "marine detail",
      type: "strait",
      parent: "tno_english_channel",
      source: "marine regions seavox v19",
    },
  ];

  for (const target of targets) {
    await selectWaterRegion(page, target.search, target.name);
    const meta = await readWaterInspectorMeta(page);
    expect(meta.ID).toBe(target.id);
    expect(normalizeMetaValue(meta.Group)).toBe(target.group);
    expect(normalizeMetaValue(meta.Type)).toBe(target.type);
    expect(meta.Parent).toBe(target.parent);
    expect(normalizeMetaValue(meta.Source)).toBe(target.source);
  }
});
