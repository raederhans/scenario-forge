const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function resolveBaseUrl() {
  if (process.env.MAPCREATOR_BASE_URL) {
    return process.env.MAPCREATOR_BASE_URL;
  }
  const metadataPath = path.join(process.cwd(), ".runtime", "dev", "active_server.json");
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata && typeof metadata.url === "string" && metadata.url.trim()) {
        return metadata.url.trim();
      }
    } catch (_error) {
      // Fall through to default.
    }
  }
  return "http://127.0.0.1:18080";
}

async function waitForAppReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const downloadBtn = document.getElementById("downloadProjectBtn");
    const projectFileInput = document.getElementById("projectFileInput");
    return typeof state.renderCountryListFn === "function"
      && typeof state.updateStrategicOverlayUIFn === "function"
      && !!downloadBtn
      && !!projectFileInput
      && downloadBtn.dataset.bound === "true"
      && projectFileInput.dataset.bound === "true";
  }, { timeout: 120000 });
}

async function exportProjectJson(page, outputPath) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

test("strategic overlay state roundtrips through project import/export", async ({ page }) => {
  test.setTimeout(90000);
  const baseUrl = resolveBaseUrl();
  const artifactDir = path.join(".runtime", "tests", "playwright", "strategic-overlay-roundtrip");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.annotationView = {
      frontlineEnabled: true,
      frontlineStyle: "dual-rail",
      showFrontlineLabels: true,
      labelPlacementMode: "centroid",
      unitRendererDefault: "milstd",
      showUnitLabels: false,
    };
    state.operationGraphics = [
      {
        id: "opg_test_1",
        kind: "attack",
        label: "North Push",
        points: [[-3, 48], [1, 50], [6, 52]],
      },
      {
        id: "opg_test_2",
        kind: "encirclement",
        label: "Pocket",
        points: [[10, 45], [14, 45], [14, 48], [10, 48]],
      },
    ];
    state.unitCounters = [
      {
        id: "unit_test_1",
        renderer: "milstd",
        sidc: "130310001412110000000000000000",
        symbolCode: "130310001412110000000000000000",
        nationTag: "GER",
        nationSource: "manual",
        presetId: "inf",
        unitType: "INF",
        echelon: "corps",
        subLabel: "Nord",
        strengthText: "76%",
        label: "1st Corps",
        size: "large",
        facing: 0,
        zIndex: 0,
        anchor: { lon: 12, lat: 48, featureId: "" },
      },
      {
        id: "unit_test_2",
        renderer: "game",
        symbolCode: "ARM",
        nationTag: "ENG",
        nationSource: "manual",
        presetId: "arm",
        unitType: "ARM",
        echelon: "army",
        subLabel: "Reserve",
        strengthText: "Ready",
        label: "2nd Army",
        size: "medium",
        facing: 0,
        zIndex: 1,
        anchor: { lon: 15, lat: 46, featureId: "" },
      },
    ];
    state.frontlineOverlayDirty = true;
    state.operationGraphicsDirty = true;
    state.unitCountersDirty = true;
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return (state.operationGraphics || []).length === 2 && (state.unitCounters || []).length === 2;
  });

  const exportPath = path.join(artifactDir, "strategic-overlay-export.json");
  const exported = await exportProjectJson(page, exportPath);

  expect(exported.schemaVersion).toBe(18);
  expect(exported.annotationView).toEqual({
    frontlineEnabled: true,
    frontlineStyle: "dual-rail",
    showFrontlineLabels: true,
    labelPlacementMode: "centroid",
    unitRendererDefault: "milstd",
    showUnitLabels: false,
  });
  expect(exported.operationGraphics).toHaveLength(2);
  expect(exported.unitCounters).toHaveLength(2);
  expect(exported.unitCounters[0].sidc).toBe("130310001412110000000000000000");
  expect(exported.unitCounters[0]).toMatchObject({
    nationTag: "GER",
    nationSource: "manual",
    presetId: "inf",
    unitType: "INF",
    echelon: "corps",
    subLabel: "Nord",
    strengthText: "76%",
  });

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.annotationView = {
      frontlineEnabled: false,
      frontlineStyle: "clean",
      showFrontlineLabels: false,
      labelPlacementMode: "midpoint",
      unitRendererDefault: "game",
      showUnitLabels: true,
    };
    state.operationGraphics = [];
    state.unitCounters = [];
    state.frontlineOverlayDirty = true;
    state.operationGraphicsDirty = true;
    state.unitCountersDirty = true;
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  await page.locator("#projectFileInput").setInputFiles(exportPath);
  await page.waitForTimeout(8000);

  const runtimeState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      annotationView: state.annotationView,
      operationGraphics: state.operationGraphics,
      unitCounters: state.unitCounters,
    };
  });

  expect(runtimeState.annotationView).toEqual(exported.annotationView);
  expect(runtimeState.operationGraphics).toEqual(exported.operationGraphics);
  expect(runtimeState.unitCounters).toEqual(exported.unitCounters);
});
