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

async function inspectFamilyRotation(page, familyId, labelSelector) {
  return page.evaluate(async ({ nextFamilyId, nextLabelSelector }) => {
    const { state } = await import("/js/core/state.js");
    const {
      stepTransportWorkbenchCarrierZoom,
      toggleTransportWorkbenchCarrierQuarterTurn,
      getTransportWorkbenchCarrierViewState,
    } = await import("/js/ui/transport_workbench_carrier.js");
    const {
      renderTransportWorkbenchFamilyPreview,
      warmTransportWorkbenchFamilyPreview,
    } = await import("/js/ui/transport_workbench_family_preview.js");

    const waitForFrames = async (count = 2) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };

    const config = state.transportWorkbenchUi?.familyConfigs?.[nextFamilyId];
    if (config && typeof config === "object") {
      config.labelDensityPreset = "very_dense";
      if ("showLabels" in config) config.showLabels = true;
      if ("showStationLabels" in config) config.showStationLabels = true;
      if ("importanceThreshold" in config) config.importanceThreshold = "broad_major";
    }
    state.transportWorkbenchUi.activeFamily = nextFamilyId;
    state.refreshTransportWorkbenchUiFn?.();
    await waitForFrames(3);
    await warmTransportWorkbenchFamilyPreview(nextFamilyId, { includeFull: nextFamilyId === "rail" });
    await renderTransportWorkbenchFamilyPreview(nextFamilyId, config);
    await waitForFrames(3);

    const viewState = getTransportWorkbenchCarrierViewState() || {};
    if (Number(viewState.quarterTurns || 0) !== 0) {
      toggleTransportWorkbenchCarrierQuarterTurn();
      await waitForFrames(3);
    }
    for (let index = 0; index < 6; index += 1) {
      stepTransportWorkbenchCarrierZoom(1);
      await waitForFrames(2);
    }
    toggleTransportWorkbenchCarrierQuarterTurn();
    await waitForFrames(4);
    await renderTransportWorkbenchFamilyPreview(nextFamilyId, config);
    await waitForFrames(3);

    const screenLayer = document.querySelector(".transport-workbench-carrier-screen-labels");
    const orientationLayer = document.querySelector(".transport-workbench-carrier-orientation");
    const labelNodes = Array.from(document.querySelectorAll(nextLabelSelector));
    const sampledAngles = labelNodes.slice(0, 12).map((node) => {
      const matrix = node.getCTM?.();
      if (!matrix) return null;
      return Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
    }).filter((value) => Number.isFinite(value));
    const maxAbsAngle = sampledAngles.length
      ? Math.max(...sampledAngles.map((value) => Math.abs(value)))
      : null;

    return {
      familyId: nextFamilyId,
      labelCount: labelNodes.length,
      labelsInsideScreenLayer: labelNodes.every((node) => screenLayer?.contains(node)),
      labelsInsideOrientationLayer: labelNodes.some((node) => orientationLayer?.contains(node)),
      roadTextPathCount: nextFamilyId === "road"
        ? document.querySelectorAll(".transport-workbench-road-preview-label-root textPath").length
        : 0,
      sampledAngles,
      maxAbsAngle,
    };
  }, {
    nextFamilyId: familyId,
    nextLabelSelector: labelSelector,
  });
}

test("transport workbench labels stay horizontal after quarter turn", async ({ page }) => {
  test.setTimeout(120000);

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await openTransportWorkbench(page);

  const families = [
    ["road", ".transport-workbench-road-preview-label-root text"],
    ["airport", ".transport-workbench-airport-preview-label-layer text"],
    ["port", ".transport-workbench-port-preview-label-layer text"],
    ["industrial_zones", ".transport-workbench-industrial-zones-preview-label-layer text"],
  ];

  for (const [familyId, labelSelector] of families) {
    const result = await inspectFamilyRotation(page, familyId, labelSelector);
    expect(result.labelCount, `${familyId} should render at least one label`).toBeGreaterThan(0);
    expect(result.labelsInsideScreenLayer, `${familyId} labels should live in the non-rotating screen label layer`).toBe(true);
    expect(result.labelsInsideOrientationLayer, `${familyId} labels should not remain inside the rotating orientation layer`).toBe(false);
    expect(result.maxAbsAngle, `${familyId} labels should remain screen-horizontal after rotation`).not.toBeNull();
    expect(result.maxAbsAngle, `${familyId} labels should remain screen-horizontal after rotation`).toBeLessThan(1);
    if (familyId === "road") {
      expect(result.roadTextPathCount, "road labels should no longer use textPath").toBe(0);
    }
  }
});
