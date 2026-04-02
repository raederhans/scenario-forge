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

test("transport workbench port coverage tiers load the matching variant packs", async ({ page }) => {
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
      while (scale >= 1.18 && safety < 12) {
        stepTransportWorkbenchCarrierZoom(-1);
        await waitForFrames(2);
        scale = Number(getTransportWorkbenchCarrierViewState()?.scale || 1);
        safety += 1;
      }
      return scale;
    };

    const moveToHighZoom = async () => {
      let scale = await moveToLowZoom();
      let safety = 0;
      while (scale < 1.18 && safety < 12) {
        stepTransportWorkbenchCarrierZoom(1);
        await waitForFrames(2);
        scale = Number(getTransportWorkbenchCarrierViewState()?.scale || 1);
        safety += 1;
      }
      return scale;
    };

    const applyPortScenario = async ({
      coverageTier,
      importanceThreshold,
      legalDesignations,
      expectedPackMode,
      zoom = "low",
    }) => {
      state.transportWorkbenchUi.activeFamily = "port";
      const familyConfig = state.transportWorkbenchUi.familyConfigs.port;
      const displayConfig = state.transportWorkbenchUi.displayConfigs.port;
      familyConfig.legalDesignations = [...legalDesignations];
      familyConfig.managerTypes = ["1", "2", "3", "4", "5"];
      familyConfig.importanceThreshold = importanceThreshold;
      familyConfig.showLabels = true;
      displayConfig.coverage = coverageTier;

      const scale = zoom === "high"
        ? await moveToHighZoom()
        : await moveToLowZoom();

      state.refreshTransportWorkbenchUiFn?.();
      await waitForFrames(4);

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const snapshot = getTransportWorkbenchFamilyPreviewSnapshot("port");
        if (
          snapshot?.status === "ready"
          && snapshot.activeVariant === coverageTier
          && snapshot.packMode === expectedPackMode
        ) {
          return {
            activeVariant: snapshot.activeVariant,
            packMode: snapshot.packMode,
            visibleFeatures: Number(snapshot.stats?.visibleFeatures || 0),
            totalFeatures: Number(snapshot.stats?.totalFeatures || 0),
            scale,
          };
        }
        await waitForFrames(2);
      }

      const snapshot = getTransportWorkbenchFamilyPreviewSnapshot("port");
      throw new Error(`Port preview did not settle for ${coverageTier}/${expectedPackMode}: ${JSON.stringify(snapshot)}`);
    };

    return {
      core: await applyPortScenario({
        coverageTier: "core",
        importanceThreshold: "regional_core",
        legalDesignations: ["important"],
        expectedPackMode: "preview",
        zoom: "low",
      }),
      expanded: await applyPortScenario({
        coverageTier: "expanded",
        importanceThreshold: "local_connector",
        legalDesignations: ["important", "local"],
        expectedPackMode: "preview",
        zoom: "low",
      }),
      fullOfficial: await applyPortScenario({
        coverageTier: "full_official",
        importanceThreshold: "local_connector",
        legalDesignations: ["important", "local", "shelter"],
        expectedPackMode: "full",
        zoom: "high",
      }),
    };
  });

  expect(result.core.activeVariant).toBe("core");
  expect(result.core.packMode).toBe("preview");
  expect(result.core.visibleFeatures).toBe(12);

  expect(result.expanded.activeVariant).toBe("expanded");
  expect(result.expanded.packMode).toBe("preview");
  expect(result.expanded.visibleFeatures).toBeGreaterThan(result.core.visibleFeatures);
  expect(result.expanded.totalFeatures).toBe(295);

  expect(result.fullOfficial.activeVariant).toBe("full_official");
  expect(result.fullOfficial.packMode).toBe("full");
  expect(result.fullOfficial.visibleFeatures).toBeGreaterThan(result.expanded.visibleFeatures);
  expect(result.fullOfficial.totalFeatures).toBe(317);
});
