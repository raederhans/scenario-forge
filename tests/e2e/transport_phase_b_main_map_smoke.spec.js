const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("./support/playwright-app");

const SMOKE_CASES = [
  { family: "road", packId: "germany_road", keys: ["roads", "road_labels"] },
  { family: "rail", packId: "france_rail", keys: ["railways", "rail_stations_major"] },
  { family: "airport", packId: "usa_airport", keys: ["airports"] },
];

async function openTransportWorkbench(page) {
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabTransport").click();
  await page.locator("#transportProjectSection #scenarioTransportWorkbenchBtn").click();
}

async function applyPack(page, { family, packId, keys }) {
  await page.locator(`button[data-transport-family="${family}"]`).click();
  await page.locator("#transportWorkbenchPackSelect").selectOption(packId);
  await expect(page.locator("#transportWorkbenchApplyBtn")).toHaveText("Apply to Main Map", { timeout: 60_000 });
  await expect(page.locator("#transportWorkbenchApplyBtn")).toBeEnabled();
  await page.locator("#transportWorkbenchApplyBtn").click();
  await page.waitForFunction(({ expectedPackId, expectedFamily, expectedKeys }) => {
    const state = globalThis.__playwrightStateRef || null;
    const overlay = state?.transportCountryOverlayState || null;
    const familyOverlay = overlay?.overlaysByFamily?.[expectedFamily] || overlay;
    if (familyOverlay?.status !== "ready" || familyOverlay.activePackId !== expectedPackId || familyOverlay.family !== expectedFamily) return false;
    return expectedKeys.every((key) => Array.isArray(familyOverlay.collectionsByLayer?.[key]?.features) && familyOverlay.collectionsByLayer[key].features.length > 0);
  }, { expectedPackId: packId, expectedFamily: family, expectedKeys: keys }, { timeout: 90_000 });
  await waitForRenderIdle(page, { timeout: 60_000 });
  return page.evaluate(({ expectedPackId, expectedFamily, expectedKeys }) => {
    const state = globalThis.__playwrightStateRef || {};
    const overlay = state.transportCountryOverlayState || {};
    const familyOverlay = overlay.overlaysByFamily?.[expectedFamily] || overlay;
    return {
      activePackId: familyOverlay.activePackId,
      family: familyOverlay.family,
      status: familyOverlay.status,
      sourceKeys: Object.keys(familyOverlay.sourceSignature || {}),
      persistedPackId: state.styleConfig?.transportOverview?.activePackIdByFamily?.[expectedFamily] || "",
      counts: Object.fromEntries(expectedKeys.map((key) => [key, familyOverlay.collectionsByLayer?.[key]?.features?.length || 0])),
      appliedFamilies: Object.keys(overlay.activePackIdByFamily || {}),
      showTransport: !!state.showTransport,
      showRoad: !!state.showRoad,
      showRail: !!state.showRail,
      showAirports: !!state.showAirports,
    };
  }, { expectedPackId: packId, expectedFamily: family, expectedKeys: keys });
}

test("transport Phase B country packs apply to the main map", async ({ page }) => {
  test.setTimeout(240_000);
  await gotoApp(page, "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120_000 });

  await openTransportWorkbench(page);
  await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
  await expect(page.locator("#transportWorkbenchPackSelect")).toBeVisible();

  const snapshots = [];
  for (const smokeCase of SMOKE_CASES) {
    snapshots.push(await applyPack(page, smokeCase));
  }

  expect(snapshots.map((entry) => entry.activePackId)).toEqual(SMOKE_CASES.map((entry) => entry.packId));
  expect(snapshots.at(-1).appliedFamilies.sort()).toEqual(["airport", "rail", "road"]);
  for (const snapshot of snapshots) {
    expect(snapshot.status).toBe("ready");
    expect(snapshot.persistedPackId).toBe(snapshot.activePackId);
    expect(snapshot.sourceKeys.length).toBeGreaterThan(0);
    for (const count of Object.values(snapshot.counts)) expect(count).toBeGreaterThan(0);
  }
});

