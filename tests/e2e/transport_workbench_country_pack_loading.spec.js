const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

const TARGET_PACKS = [
  ["road", "germany_road", "germany"],
  ["industrial_zones", "germany_industrial_zones", "germany"],
  ["road", "usa_road", "usa"],
  ["road", "france_road", "france"],
  ["rail", "france_rail", "france"],
  ["rail", "uk_rail", "uk"],
  ["rail", "usa_rail", "usa"],
  ["airport", "usa_airport", "usa"],
  ["energy_facilities", "china_energy_facilities", "china"],
  ["industrial_zones", "china_industrial_zones", "china"],
  ["logistics_hubs", "china_logistics_hubs", "china"],
  ["mineral_resources", "china_mineral_resources", "china"],
  ["mineral_resources", "uk_mineral_resources", "uk"],
  ["energy_facilities", "russia_energy_facilities", "russia"],
  ["industrial_zones", "russia_industrial_zones", "russia"],
  ["logistics_hubs", "russia_logistics_hubs", "russia"],
  ["mineral_resources", "russia_mineral_resources", "russia"],
];

test.setTimeout(900000);

async function openTransportWorkbench(page) {
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabTransport").click();
  await page.locator("#transportProjectSection #scenarioTransportWorkbenchBtn").click();
  await page.waitForFunction(() => {
    const panel = document.querySelector("#transportWorkbenchOverlay");
    return !!panel && panel.getAttribute("aria-hidden") === "false";
  }, { timeout: 120000 });
  await page.waitForSelector(".transport-workbench-carrier-screen-labels", { timeout: 120000 });
}

async function selectPackAndWaitForPreview(page, familyId, packId, expectedCarrierCountry) {
  await page.locator(`.transport-workbench-family-tab[data-transport-family="${familyId}"]`).click();
  await page.waitForFunction(
    ({ expectedPackId }) => Array.from(document.querySelector("#transportWorkbenchPackSelect")?.options || [])
      .some((option) => option.value === expectedPackId),
    { expectedPackId: packId },
    { timeout: 120000 },
  );
  await page.locator("#transportWorkbenchPackSelect").selectOption(packId);
  await page.waitForFunction(
    async ({ nextFamilyId, nextPackId }) => {
      const { state } = await import("/js/core/state.js");
      const ui = state?.transportWorkbenchUi || {};
      const selectedValue = document.querySelector("#transportWorkbenchPackSelect")?.value || "";
      return ui.activeFamily === nextFamilyId
        && selectedValue === nextPackId
        && (ui.activePackIdByFamily?.[nextFamilyId] || ui.activePackId) === nextPackId;
    },
    { nextFamilyId: familyId, nextPackId: packId },
    { timeout: 120000 },
  );

  return page.evaluate(async ({ nextFamilyId, nextPackId, expectedCarrierCountry }) => {
    const { state } = await import("/js/core/state.js");
    const {
      getTransportWorkbenchFamilyPreviewSnapshot,
      renderTransportWorkbenchFamilyPreview,
      warmTransportWorkbenchFamilyPreview,
    } = await import("/js/ui/transport_workbench_family_preview.js");
    const { getTransportWorkbenchCarrierAssetState } = await import("/js/ui/transport_workbench_carrier.js");

    const waitForFrames = async (count = 3) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };

    const activePackId = state.transportWorkbenchUi?.activePackIdByFamily?.[nextFamilyId]
      || state.transportWorkbenchUi?.activePackId
      || "";
    if (state.transportWorkbenchUi?.activeFamily !== nextFamilyId || activePackId !== nextPackId) {
      throw new Error(`UI selection did not activate ${nextPackId}: ${JSON.stringify({
        activeFamily: state.transportWorkbenchUi?.activeFamily,
        activePackId,
      })}`);
    }
    const familyConfig = state.transportWorkbenchUi.familyConfigs[nextFamilyId] || {};
    familyConfig.showLabels = true;
    familyConfig.showStationLabels = true;
    await waitForFrames(4);

    const config = {
      ...(state.transportWorkbenchUi.familyConfigs[nextFamilyId] || {}),
      activePackId,
    };
    let lastRenderError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await warmTransportWorkbenchFamilyPreview(nextFamilyId, { includeFull: false });
        await renderTransportWorkbenchFamilyPreview(nextFamilyId, config);
        lastRenderError = null;
        break;
      } catch (error) {
        lastRenderError = error;
        if (!String(error?.message || error).includes("carrier geometry is not ready")) {
          throw error;
        }
        state.refreshTransportWorkbenchUiFn?.();
        await waitForFrames(5);
      }
    }
    if (lastRenderError) throw lastRenderError;
    await waitForFrames(4);

    const readFeatureStats = (snapshot) => {
      const stats = snapshot?.stats || {};
      const total = Object.entries(stats)
        .filter(([key, value]) => key.startsWith("total") && Number(value) > 0)
        .reduce((sum, [, value]) => sum + Number(value || 0), 0);
      const visible = Object.entries(stats)
        .filter(([key, value]) => key.startsWith("visible") && Number(value) > 0)
        .reduce((sum, [, value]) => sum + Number(value || 0), 0);
      return { total, visible };
    };

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const snapshot = getTransportWorkbenchFamilyPreviewSnapshot(nextFamilyId, config);
      const featureStats = readFeatureStats(snapshot);
      if (
        snapshot?.status === "ready"
        && featureStats.total > 0
        && featureStats.visible > 0
      ) {
        const carrierState = getTransportWorkbenchCarrierAssetState();
        if (carrierState.country !== expectedCarrierCountry) {
          throw new Error(`Carrier country mismatch for ${nextPackId}: ${JSON.stringify(carrierState)}`);
        }
        const domSelectorsByFamily = {
          road: ".transport-workbench-road-preview-roads [data-road-id], .transport-workbench-road-preview-labels [data-label-id]",
          rail: ".transport-workbench-rail-preview-lines [data-rail-line-id], .transport-workbench-rail-preview-stations [data-rail-station-id]",
          industrial_zones: ".transport-workbench-industrial-zones-preview-layer [data-feature-id], .transport-workbench-industrial-zones-preview-label-layer [data-feature-id]",
        };
        const defaultSelector = `.transport-workbench-${nextFamilyId}-preview-layer [data-feature-id], .transport-workbench-${nextFamilyId}-preview-label-layer [data-feature-id]`;
        const visibleDomNodes = document.querySelectorAll(domSelectorsByFamily[nextFamilyId] || defaultSelector).length;
        if (visibleDomNodes <= 0) {
          throw new Error(`Preview DOM did not render feature nodes for ${nextPackId}: ${JSON.stringify(snapshot)}`);
        }
        return {
          familyId: nextFamilyId,
          packId: nextPackId,
          status: snapshot.status,
          totalFeatures: featureStats.total,
          visibleFeatures: featureStats.visible,
          visibleDomNodes,
          carrierCountry: carrierState.country,
          carrierAssetKey: carrierState.assetKey,
          activeVariant: snapshot.activeVariant || "",
          packMode: snapshot.packMode || "",
        };
      }
      await waitForFrames(2);
    }

    const snapshot = getTransportWorkbenchFamilyPreviewSnapshot(nextFamilyId, config);
    throw new Error(`Preview did not settle for ${nextPackId}: ${JSON.stringify(snapshot)}`);
  }, {
    nextFamilyId: familyId,
    nextPackId: packId,
    expectedCarrierCountry,
  });
}

test("transport workbench switches target country packs with matching carriers", async ({ page }) => {
  test.setTimeout(900000);

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await openTransportWorkbench(page);

  const previewResults = [];
  for (const [familyId, packId, expectedCarrierCountry] of TARGET_PACKS) {
    previewResults.push(await selectPackAndWaitForPreview(page, familyId, packId, expectedCarrierCountry));
  }

  const screenshotPath = path.join(process.cwd(), ".runtime", "browser", "mcp-artifacts", "transport-workbench-country-pack-smoke.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });

  expect(previewResults).toHaveLength(TARGET_PACKS.length);
  for (const result of previewResults) {
    expect(result.status, `${result.packId} preview status`).toBe("ready");
    expect(result.totalFeatures, `${result.packId} total features`).toBeGreaterThan(0);
    expect(result.visibleFeatures, `${result.packId} visible features`).toBeGreaterThan(0);
    expect(result.visibleDomNodes, `${result.packId} visible DOM nodes`).toBeGreaterThan(0);
    expect(result.carrierCountry, `${result.packId} carrier country`).toBe(
      TARGET_PACKS.find(([, packId]) => packId === result.packId)?.[2],
    );
  }
});
