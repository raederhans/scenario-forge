const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  beginProjectImportWatch,
  gotoApp,
  primeStateRef,
  waitForAppInteractive,
  waitForProjectImportCompletion,
} = require("./support/playwright-app");

async function exportProjectJson(page, outputPath) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

test("strategic overlay state roundtrips through project import/export", async ({ page }) => {
  test.setTimeout(180000);
  const artifactDir = path.join(".runtime", "tests", "playwright", "strategic-overlay-roundtrip");
  fs.mkdirSync(artifactDir, { recursive: true });

  await gotoApp(page, undefined, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });
  await primeStateRef(page);
  await page.waitForFunction(() => {
    const downloadBtn = document.querySelector("#downloadProjectBtn");
    const projectFileInput = document.querySelector("#projectFileInput");
    return !!downloadBtn
      && !!projectFileInput
      && downloadBtn.dataset.bound === "true"
      && projectFileInput.dataset.bound === "true";
  }, { timeout: 30000 });

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.annotationView = {
      frontlineEnabled: true,
      frontlineStyle: "dual-rail",
      showFrontlineLabels: true,
      labelPlacementMode: "centroid",
      unitRendererDefault: "milstd",
      showUnitLabels: false,
    };
    state.operationalLines = [
      {
        id: "opl_test_1",
        kind: "frontline",
        label: "Central Front",
        points: [[8, 47], [12, 49], [17, 50]],
        stylePreset: "frontline",
        stroke: "#6b7280",
        width: 2.2,
        opacity: 0.84,
        attachedCounterIds: ["unit_test_1"],
      },
    ];
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
        iconId: "infantry",
        layoutAnchor: { kind: "attachment", key: "opl_test_1", slotIndex: 0 },
        attachment: { kind: "operational-line", lineId: "opl_test_1" },
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
        iconId: "armor",
        layoutAnchor: { kind: "feature", key: "", slotIndex: 1 },
        attachment: null,
      },
    ];
    state.frontlineOverlayDirty = true;
    state.operationalLinesDirty = true;
    state.operationGraphicsDirty = true;
    state.unitCountersDirty = true;
  });

  const seededCounts = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      operationalLines: Array.isArray(state.operationalLines) ? state.operationalLines.length : 0,
      operationGraphics: Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0,
      unitCounters: Array.isArray(state.unitCounters) ? state.unitCounters.length : 0,
    };
  });
  expect(seededCounts).toMatchObject({
    operationalLines: 1,
    operationGraphics: 2,
    unitCounters: 2,
  });

  const exportPath = path.join(artifactDir, "strategic-overlay-export.json");
  const exported = await exportProjectJson(page, exportPath);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.annotationView = {
      frontlineEnabled: false,
      frontlineStyle: "clean",
      showFrontlineLabels: false,
      labelPlacementMode: "midpoint",
      unitRendererDefault: "game",
      showUnitLabels: true,
    };
    state.operationalLines = [];
    state.operationGraphics = [];
    state.unitCounters = [];
    state.frontlineOverlayDirty = true;
    state.operationalLinesDirty = true;
    state.operationGraphicsDirty = true;
    state.unitCountersDirty = true;
  });

  const importWatch = await beginProjectImportWatch(page, {
    expectedFileName: path.basename(exportPath),
  });
  await page.evaluate(async ({ fileName, jsonText }) => {
    const { importProjectThroughFunnel } = await import("/js/core/interaction_funnel.js");
    const file = new File([jsonText], fileName, { type: "application/json" });
    importProjectThroughFunnel(file);
  }, {
    fileName: path.basename(exportPath),
    jsonText: JSON.stringify(exported),
  });
  await waitForProjectImportCompletion(page, importWatch, { timeout: 120000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state
      && (state.operationalLines || []).length === 1
      && (state.operationGraphics || []).length === 2
      && (state.unitCounters || []).length === 2;
  }, { timeout: 30000 });

  const runtimeState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      operationalLines: (state.operationalLines || []).map((line) => ({
        id: String(line?.id || ""),
        kind: String(line?.kind || ""),
        label: String(line?.label || ""),
        attachedCounterIds: Array.isArray(line?.attachedCounterIds) ? [...line.attachedCounterIds] : [],
      })),
      unitCounters: (state.unitCounters || []).map((counter) => ({
        id: String(counter?.id || ""),
        iconId: String(counter?.iconId || ""),
        layoutAnchor: counter?.layoutAnchor
          ? {
            kind: String(counter.layoutAnchor.kind || ""),
            key: String(counter.layoutAnchor.key || ""),
            slotIndex: Number.isFinite(Number(counter.layoutAnchor.slotIndex))
              ? Number(counter.layoutAnchor.slotIndex)
              : null,
          }
          : null,
        attachment: counter?.attachment
          ? {
            kind: String(counter.attachment.kind || ""),
            lineId: String(counter.attachment.lineId || ""),
          }
          : null,
      })),
    };
  });

  expect(runtimeState.operationalLines).toEqual([{
    id: "opl_test_1",
    kind: "frontline",
    label: "Central Front",
    attachedCounterIds: ["unit_test_1"],
  }]);
  expect(runtimeState.unitCounters).toEqual([
    {
      id: "unit_test_1",
      iconId: "infantry",
      layoutAnchor: { kind: "attachment", key: "opl_test_1", slotIndex: 0 },
      attachment: { kind: "operational-line", lineId: "opl_test_1" },
    },
    {
      id: "unit_test_2",
      iconId: "armor",
      layoutAnchor: { kind: "feature", key: "", slotIndex: 1 },
      attachment: null,
    },
  ]);
});
