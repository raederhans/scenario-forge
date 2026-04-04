const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function openTransportWorkbench(page) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.openTransportWorkbenchFn?.();
  });
  await page.waitForSelector(".transport-workbench-carrier-screen-labels", { timeout: 120000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector(".transport-workbench-overlay");
    return !!panel && panel.getAttribute("aria-hidden") === "false";
  }, { timeout: 120000 });
}

test("transport workbench industrial variants load from the shared manifest contract", async ({ page }) => {
  test.setTimeout(120000);

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await openTransportWorkbench(page);

  const result = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      getTransportWorkbenchFamilyPreviewSnapshot,
    } = await import("/js/ui/transport_workbench_family_preview.js");
    const {
      getTransportWorkbenchCarrierViewState,
      resetTransportWorkbenchCarrierView,
      stepTransportWorkbenchCarrierZoom,
    } = await import("/js/ui/transport_workbench_carrier.js");

    const waitForFrames = async (count = 3) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };

    const moveToLowZoom = async () => {
      resetTransportWorkbenchCarrierView();
      await waitForFrames(4);
      let scale = Number(getTransportWorkbenchCarrierViewState()?.scale || 1);
      let safety = 0;
      while (scale >= 1.22 && safety < 12) {
        stepTransportWorkbenchCarrierZoom(-1);
        await waitForFrames(2);
        scale = Number(getTransportWorkbenchCarrierViewState()?.scale || 1);
        safety += 1;
      }
      return scale;
    };

    const applyIndustrialScenario = async ({ variant }) => {
      state.transportWorkbenchUi.activeFamily = "industrial_zones";
      const familyConfig = state.transportWorkbenchUi.familyConfigs.industrial_zones;
      familyConfig.variant = variant;
      familyConfig.siteClasses = ["industrial_complex", "industrial_landuse"];
      familyConfig.coastalModes = ["coastal", "inland"];
      familyConfig.showLabels = false;

      const scale = await moveToLowZoom();
      state.refreshTransportWorkbenchUiFn?.();
      await waitForFrames(4);

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const snapshot = getTransportWorkbenchFamilyPreviewSnapshot("industrial_zones");
        if (
          snapshot?.status === "ready"
          && snapshot.activeVariant === variant
          && snapshot.packMode === "preview"
        ) {
          return {
            activeVariant: snapshot.activeVariant,
            packMode: snapshot.packMode,
            totalFeatures: Number(snapshot.stats?.totalFeatures || 0),
            visibleFeatures: Number(snapshot.stats?.visibleFeatures || 0),
            manifestDefaultVariant: String(snapshot.manifest?.default_variant || ""),
            scale,
          };
        }
        await waitForFrames(2);
      }

      const snapshot = getTransportWorkbenchFamilyPreviewSnapshot("industrial_zones");
      throw new Error(`Industrial preview did not settle for ${variant}: ${JSON.stringify(snapshot)}`);
    };

    return {
      internal: await applyIndustrialScenario({ variant: "internal" }),
      open: await applyIndustrialScenario({ variant: "open" }),
    };
  });

  expect(result.internal.manifestDefaultVariant).toBe("internal");
  expect(result.internal.activeVariant).toBe("internal");
  expect(result.internal.packMode).toBe("preview");
  expect(result.internal.totalFeatures).toBe(3458);
  expect(result.internal.visibleFeatures).toBeGreaterThan(0);

  expect(result.open.activeVariant).toBe("open");
  expect(result.open.packMode).toBe("preview");
  expect(result.open.totalFeatures).toBe(31976);
  expect(result.open.visibleFeatures).toBeGreaterThan(result.internal.visibleFeatures);
});
