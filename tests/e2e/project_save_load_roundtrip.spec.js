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
    } catch (error) {
      console.warn("[project-save-load-test] Unable to parse active_server.json:", error);
    }
  }
  return "http://127.0.0.1:18080";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function setInputValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function setSelectValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitForProjectUiReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const downloadBtn = document.querySelector("#downloadProjectBtn");
    const uploadInput = document.querySelector("#projectFileInput");
    const themeSelect = document.querySelector("#themeSelect");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return typeof state.renderCountryListFn === "function"
      && typeof state.updateToolbarInputsFn === "function"
      && !!downloadBtn
      && !!uploadInput
      && !!themeSelect
      && themeSelect.options.length > 1
      && !!scenarioSelect;
  }, { timeout: 120000 });
}

async function exportProjectJson(page, outputPath) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

async function applyScenario(page, scenarioId) {
  await page.evaluate(async (expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const { applyScenarioById } = await import("/js/core/scenario_manager.js");
    await applyScenarioById(expectedScenarioId, {
      renderNow: true,
      markDirtyReason: "playwright-apply-scenario",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId;
  }, scenarioId, { timeout: 120000 });
}

async function getScenarioSplitFeature(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const splitEntry = Object.entries(state.scenarioBaselineControllersByFeatureId || {}).find(([featureId, controller]) => {
      const owner = state.scenarioBaselineOwnersByFeatureId?.[featureId];
      return owner && controller && owner !== controller;
    });
    if (!splitEntry) return null;
    const [featureId, baselineController] = splitEntry;
    const baselineOwner = String(state.scenarioBaselineOwnersByFeatureId?.[featureId] || "");
    const alternateController = Object.keys(state.scenarioCountriesByTag || {}).find((tag) => (
      tag
      && tag !== baselineOwner
      && tag !== baselineController
    )) || "";
    return {
      featureId,
      baselineOwner,
      baselineController: String(baselineController || ""),
      alternateController,
    };
  });
}

test("project save/load roundtrip preserves extended runtime state", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const consoleErrors = [];
  const consoleWarnings = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error") {
      consoleErrors.push(msg.text());
    } else if (type === "warning") {
      consoleWarnings.push(msg.text());
    }
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  });

  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });

  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await waitForProjectUiReady(page);

  await setInputValue(page, "#internalBorderColor", "#123456");
  await setInputValue(page, "#internalBorderOpacity", "42");
  await setInputValue(page, "#internalBorderWidth", "0.88");
  await setInputValue(page, "#empireBorderColor", "#135790");
  await setInputValue(page, "#empireBorderWidth", "2.25");
  await setInputValue(page, "#coastlineColor", "#2468ac");
  await setInputValue(page, "#coastlineWidth", "2.4");
  await setInputValue(page, "#physicalOpacity", "61");
  await setSelectValue(page, "#physicalBlendMode", "overlay");

  const selectedPaletteId = await page.locator("#themeSelect").evaluate((select) => {
    const options = Array.from(select.options)
      .map((option) => option.value)
      .filter(Boolean);
    return options.find((value) => value !== select.value) || String(select.value || "");
  });
  expect(selectedPaletteId).not.toBe("");
  await setSelectValue(page, "#themeSelect", selectedPaletteId);
  await page.waitForFunction((value) => document.querySelector("#themeSelect")?.value === value, selectedPaletteId);

  await page.evaluate(async () => {
    const { startSpecialZoneDraw } = await import("/js/core/map_renderer.js");
    startSpecialZoneDraw({ zoneType: "custom", label: "" });
  });
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.specialZoneEditor?.active;
  });

  const initialDownloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const initialDownload = await initialDownloadPromise;
  const initialExportPath = path.join(artifactDir, "initial-export.json");
  await initialDownload.saveAs(initialExportPath);
  const initialExport = JSON.parse(fs.readFileSync(initialExportPath, "utf8"));

  expect(initialExport.schemaVersion).toBe(18);
  expect(initialExport.styleConfig.internalBorders).toEqual({
    color: "#123456",
    opacity: 0.42,
    width: 0.88,
  });
  expect(initialExport.styleConfig.empireBorders).toEqual({
    color: "#135790",
    width: 2.25,
  });
  expect(initialExport.styleConfig.coastlines).toEqual({
    color: "#2468ac",
    width: 2.4,
  });
  expect(initialExport.styleConfig.physical).toMatchObject({
    opacity: 0.61,
    blendMode: "overlay",
    atlasOpacity: 0.52,
  });
  expect(initialExport.activePaletteId).toBe(selectedPaletteId);
  expect(initialExport.interactionGranularity).toBe("subdivision");
  expect(initialExport.batchFillScope).toBe("parent");
  expect(initialExport).toHaveProperty("customPresets");
  expect(initialExport).toHaveProperty("referenceImageState");
  expect(initialExport).toHaveProperty("recentColors");
  expect(initialExport).toHaveProperty("annotationView");
  expect(initialExport).toHaveProperty("operationGraphics");
  expect(initialExport).toHaveProperty("unitCounters");

  const importedProject = cloneJson(initialExport);
  importedProject.styleConfig.internalBorders = {
    color: "#654321",
    opacity: 0.37,
    width: 1.11,
  };
  importedProject.styleConfig.empireBorders = {
    color: "#02468a",
    width: 3.14,
  };
  importedProject.styleConfig.coastlines = {
    color: "#0f8f6f",
    width: 2.7,
  };
  importedProject.styleConfig.physical = {
    mode: "atlas_and_contours",
    opacity: 0.44,
    blendMode: "multiply",
  };
  importedProject.layerVisibility.showSpecialZones = true;
  importedProject.recentColors = ["#112233", "#445566"];
  importedProject.interactionGranularity = "country";
  importedProject.batchFillScope = "country";
  importedProject.referenceImageState = {
    opacity: 0.33,
    scale: 1.23,
    offsetX: 45,
    offsetY: -18,
  };
  importedProject.customPresets = {
    ZZZ: [
      {
        name: "Imported Preset",
        ids: ["123", "456"],
      },
    ],
  };
  importedProject.annotationView = {
    frontlineEnabled: true,
    frontlineStyle: "dual-rail",
    showFrontlineLabels: true,
    labelPlacementMode: "centroid",
    unitRendererDefault: "milstd",
    showUnitLabels: false,
  };
  importedProject.operationGraphics = [
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
  importedProject.unitCounters = [
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
      subLabel: "Northern Group",
      strengthText: "76%",
      label: "1st Corps",
      size: "large",
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
      anchor: { lon: 15, lat: 46, featureId: "" },
    },
  ];
  const importedProjectPath = path.join(artifactDir, "roundtrip-import.json");
  fs.writeFileSync(importedProjectPath, JSON.stringify(importedProject, null, 2));

  await setInputValue(page, "#internalBorderColor", "#abcdef");
  await setInputValue(page, "#empireBorderWidth", "1.50");
  await setInputValue(page, "#coastlineWidth", "1.3");
  await setInputValue(page, "#physicalOpacity", "77");
  await setSelectValue(page, "#physicalBlendMode", "overlay");
  await setSelectValue(page, "#themeSelect", "hoi4_vanilla");
  await page.waitForFunction(() => document.querySelector("#themeSelect")?.value === "hoi4_vanilla");

  await page.locator("#projectFileInput").setInputFiles(importedProjectPath);
  await page.waitForFunction(async (expected) => {
    const byId = (id) => document.querySelector(id);
    const recentColors = Array.from(document.querySelectorAll("#recentColors .color-swatch"))
      .map((node) => String(node.dataset.color || "").toLowerCase());
    const { state } = await import("/js/core/state.js");
    return byId("#themeSelect")?.value === expected.palette
      && byId("#internalBorderColor")?.value.toLowerCase() === expected.internalColor
      && byId("#internalBorderOpacity")?.value === expected.internalOpacity
      && byId("#internalBorderWidth")?.value === expected.internalWidth
      && byId("#empireBorderColor")?.value.toLowerCase() === expected.empireColor
      && byId("#empireBorderWidth")?.value === expected.empireWidth
      && byId("#coastlineColor")?.value.toLowerCase() === expected.coastColor
      && byId("#coastlineWidth")?.value === expected.coastWidth
      && byId("#physicalOpacity")?.value === expected.physicalOpacity
      && byId("#physicalBlendMode")?.value === expected.physicalBlendMode
      && byId("#paintGranularitySelect")?.value === expected.granularity
      && byId("#toggleSpecialZones")?.checked === true
      && byId("#referenceOpacity")?.value === expected.referenceOpacity
      && byId("#referenceScale")?.value === expected.referenceScale
      && byId("#referenceOffsetX")?.value === expected.referenceOffsetX
      && byId("#referenceOffsetY")?.value === expected.referenceOffsetY
      && !state.specialZoneEditor?.active
      && byId("#frontlineEnabledToggle")?.checked === expected.frontlineEnabled
      && byId("#strategicFrontlineStyleSelect")?.value === expected.frontlineStyle
      && byId("#strategicFrontlineLabelsToggle")?.checked === expected.showFrontlineLabels
      && byId("#strategicLabelPlacementSelect")?.value === expected.labelPlacementMode
      && byId("#unitCounterRendererSelect")?.value === expected.unitRendererDefault
      && byId("#unitCounterLabelsToggle")?.checked === expected.showUnitLabels
      && byId("#operationGraphicList")?.options?.length === expected.operationGraphicOptionCount
      && byId("#unitCounterList")?.options?.length === expected.unitCounterOptionCount
      && recentColors.join(",") === expected.recentColors.join(",");
  }, {
    palette: selectedPaletteId,
    internalColor: "#654321",
    internalOpacity: "37",
    internalWidth: "1.11",
    empireColor: "#02468a",
    empireWidth: "3.14",
    coastColor: "#0f8f6f",
    coastWidth: "2.7",
    physicalOpacity: "44",
    physicalBlendMode: "multiply",
    granularity: "country",
    referenceOpacity: "33",
    referenceScale: "1.23",
    referenceOffsetX: "45",
    referenceOffsetY: "-18",
    frontlineEnabled: true,
    frontlineStyle: "dual-rail",
    showFrontlineLabels: true,
    labelPlacementMode: "centroid",
    unitRendererDefault: "milstd",
    showUnitLabels: false,
    operationGraphicOptionCount: 3,
    unitCounterOptionCount: 3,
    recentColors: ["#112233", "#445566"],
  });

  const roundtripDownloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const roundtripDownload = await roundtripDownloadPromise;
  const roundtripExportPath = path.join(artifactDir, "roundtrip-export.json");
  await roundtripDownload.saveAs(roundtripExportPath);
  const roundtripExport = JSON.parse(fs.readFileSync(roundtripExportPath, "utf8"));

  expect(roundtripExport.activePaletteId).toBe(selectedPaletteId);
  expect(roundtripExport.interactionGranularity).toBe("country");
  expect(roundtripExport.batchFillScope).toBe("country");
  expect(roundtripExport.referenceImageState).toEqual({
    opacity: 0.33,
    scale: 1.23,
    offsetX: 45,
    offsetY: -18,
  });
  expect(roundtripExport.recentColors).toEqual(["#112233", "#445566"]);
  expect(roundtripExport.styleConfig.physical).toMatchObject({
    opacity: 0.44,
    blendMode: "multiply",
    atlasOpacity: 0.52,
  });
  expect(roundtripExport.customPresets).toEqual({
    ZZZ: [
      {
        name: "Imported Preset",
        ids: ["123", "456"],
      },
    ],
  });
  expect(roundtripExport.annotationView).toEqual({
    frontlineEnabled: true,
    frontlineStyle: "dual-rail",
    showFrontlineLabels: true,
    labelPlacementMode: "centroid",
    unitRendererDefault: "milstd",
    showUnitLabels: false,
  });
  expect(roundtripExport.operationGraphics).toHaveLength(2);
  expect(roundtripExport.operationGraphics[0]).toMatchObject({
    id: "opg_test_1",
    kind: "attack",
    label: "North Push",
  });
  expect(roundtripExport.unitCounters).toHaveLength(2);
  expect(roundtripExport.unitCounters[0]).toMatchObject({
    id: "unit_test_1",
    renderer: "milstd",
    sidc: "130310001412110000000000000000",
    symbolCode: "130310001412110000000000000000",
    nationTag: "GER",
    nationSource: "manual",
    presetId: "inf",
    unitType: "INF",
    echelon: "corps",
    subLabel: "Northern Group",
    strengthText: "76%",
    label: "1st Corps",
    size: "large",
  });
  const legacyProject = cloneJson(roundtripExport);
  legacyProject.schemaVersion = 13;
  delete legacyProject.activePaletteId;
  delete legacyProject.customPresets;
  delete legacyProject.referenceImageState;
  delete legacyProject.recentColors;
  delete legacyProject.annotationView;
  delete legacyProject.operationGraphics;
  delete legacyProject.unitCounters;
  delete legacyProject.interactionGranularity;
  delete legacyProject.batchFillScope;
  delete legacyProject.styleConfig.internalBorders;
  delete legacyProject.styleConfig.empireBorders;
  delete legacyProject.styleConfig.coastlines;
  delete legacyProject.styleConfig.physical;
  delete legacyProject.layerVisibility.showSpecialZones;
  const legacyProjectPath = path.join(artifactDir, "legacy-import.json");
  fs.writeFileSync(legacyProjectPath, JSON.stringify(legacyProject, null, 2));

  await page.locator("#toggleSpecialZones").check();
  await setInputValue(page, "#internalBorderColor", "#ffffff");
  await setInputValue(page, "#empireBorderWidth", "4.25");
  await setInputValue(page, "#coastlineWidth", "2.9");
  await setInputValue(page, "#referenceOpacity", "80");
  await setInputValue(page, "#referenceScale", "2.00");
  await setSelectValue(page, "#themeSelect", selectedPaletteId);
  await page.waitForFunction((value) => document.querySelector("#themeSelect")?.value === value, selectedPaletteId);

  await page.locator("#projectFileInput").setInputFiles(legacyProjectPath);
  await page.waitForFunction(async () => {
    const byId = (id) => document.querySelector(id);
    const recentCount = document.querySelectorAll("#recentColors .color-swatch").length;
    const { state } = await import("/js/core/state.js");
    return byId("#themeSelect")?.value === "hoi4_vanilla"
      && byId("#toggleSpecialZones")?.checked === false
      && byId("#physicalBlendMode")?.value === "soft-light"
      && byId("#physicalOpacity")?.value === "50"
      && !state.specialZoneEditor?.active
      && byId("#frontlineEnabledToggle")?.checked === false
      && byId("#strategicFrontlineStyleSelect")?.value === "clean"
      && byId("#strategicFrontlineLabelsToggle")?.checked === false
      && byId("#operationGraphicList")?.options?.length === 1
      && byId("#unitCounterList")?.options?.length === 1
      && recentCount === 0;
  });

  const legacyDownloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const legacyDownload = await legacyDownloadPromise;
  const legacyExportPath = path.join(artifactDir, "legacy-export.json");
  await legacyDownload.saveAs(legacyExportPath);
  const legacyExport = JSON.parse(fs.readFileSync(legacyExportPath, "utf8"));

  expect(legacyExport.activePaletteId).toBe("hoi4_vanilla");
  expect(legacyExport.interactionGranularity).toBe("subdivision");
  expect(legacyExport.batchFillScope).toBe("parent");
  expect(legacyExport.recentColors).toEqual([]);
  expect(legacyExport.customPresets).toEqual({});
  expect(legacyExport.referenceImageState).toEqual({
    opacity: 0.6,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  expect(legacyExport.annotationView).toEqual({
    frontlineEnabled: false,
    frontlineStyle: "clean",
    showFrontlineLabels: false,
    labelPlacementMode: "midpoint",
    unitRendererDefault: "game",
    showUnitLabels: true,
  });
  expect(legacyExport.operationGraphics).toEqual([]);
  expect(legacyExport.unitCounters).toEqual([]);
  expect(legacyExport.layerVisibility.showSpecialZones).toBe(false);
  expect(legacyExport.styleConfig.internalBorders).toEqual({
    color: "#cccccc",
    opacity: 1,
    width: 0.5,
  });
  expect(legacyExport.styleConfig.empireBorders).toEqual({
    color: "#666666",
    width: 1,
  });
  expect(legacyExport.styleConfig.coastlines).toEqual({
    color: "#333333",
    width: 1.2,
  });
  expect(legacyExport.styleConfig.physical).toMatchObject({
    opacity: 0.5,
    atlasOpacity: 0.52,
    blendMode: "soft-light",
  });

  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);

  console.log(JSON.stringify({
    baseUrl,
    selectedPaletteId,
    consoleWarnings,
    artifacts: {
      initialExportPath,
      importedProjectPath,
      roundtripExportPath,
      legacyProjectPath,
      legacyExportPath,
    },
  }, null, 2));
});

test("project import/export preserves legacy unit counter controller nation source", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await waitForProjectUiReady(page);

  const baselinePath = path.join(artifactDir, "unit-counter-controller-baseline.json");
  const baselineExport = await exportProjectJson(page, baselinePath);
  const importedProject = cloneJson(baselineExport);
  importedProject.unitCounters = [{
    id: "unit_controller_legacy",
    renderer: "game",
    symbolCode: "INF",
    nationTag: "ENG",
    nationSource: "controller",
    presetId: "inf",
    unitType: "INF",
    echelon: "div",
    label: "Legacy Controller Counter",
    size: "medium",
    anchor: { lon: 12, lat: 48, featureId: "" },
  }];

  const importPath = path.join(artifactDir, "unit-counter-controller-legacy-import.json");
  fs.writeFileSync(importPath, JSON.stringify(importedProject, null, 2));

  await page.locator("#projectFileInput").setInputFiles(importPath);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const counter = Array.isArray(state.unitCounters) ? state.unitCounters[0] : null;
    return !!counter
      && counter.id === "unit_controller_legacy"
      && counter.nationSource === "controller";
  });

  const exportPath = path.join(artifactDir, "unit-counter-controller-legacy-export.json");
  const exported = await exportProjectJson(page, exportPath);
  expect(exported.unitCounters).toHaveLength(1);
  expect(exported.unitCounters[0]).toMatchObject({
    id: "unit_controller_legacy",
    nationTag: "ENG",
    nationSource: "controller",
    presetId: "inf",
    unitType: "INF",
  });
});

test("scenario project roundtrip preserves controller overrides", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await waitForProjectUiReady(page);
  await applyScenario(page, "tno_1962");

  const splitFeature = await getScenarioSplitFeature(page);
  expect(splitFeature).not.toBeNull();
  expect(splitFeature.alternateController).not.toBe("");

  await page.evaluate(async ({ featureId, baselineOwner, alternateController }) => {
    const { state } = await import("/js/core/state.js");
    state.sovereigntyByFeatureId = state.sovereigntyByFeatureId || {};
    state.scenarioControllersByFeatureId = state.scenarioControllersByFeatureId || {};
    state.sovereigntyByFeatureId[featureId] = baselineOwner;
    state.scenarioControllersByFeatureId[featureId] = alternateController;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  }, splitFeature);

  const importPath = path.join(artifactDir, "scenario-controller-roundtrip.json");
  const exported = await exportProjectJson(page, importPath);
  expect(exported.scenarioControllersByFeatureId?.[splitFeature.featureId]).toBe(splitFeature.alternateController);

  await page.locator("#projectFileInput").setInputFiles(importPath);
  await page.waitForFunction(async ({ featureId, expectedController }) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === "tno_1962"
      && state.scenarioControllersByFeatureId?.[featureId] === expectedController;
  }, {
    featureId: splitFeature.featureId,
    expectedController: splitFeature.alternateController,
  });

  const runtimeState = await page.evaluate(async ({ featureId }) => {
    const { state } = await import("/js/core/state.js");
    return {
      owner: String(state.sovereigntyByFeatureId?.[featureId] || ""),
      controller: String(state.scenarioControllersByFeatureId?.[featureId] || ""),
    };
  }, { featureId: splitFeature.featureId });

  expect(runtimeState.owner).toBe(splitFeature.baselineOwner);
  expect(runtimeState.controller).toBe(splitFeature.alternateController);
});

test("legacy scenario project import keeps baseline controllers when controller map is absent", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await waitForProjectUiReady(page);
  await applyScenario(page, "tno_1962");

  const splitFeature = await getScenarioSplitFeature(page);
  expect(splitFeature).not.toBeNull();

  const baselineExportPath = path.join(artifactDir, "scenario-legacy-source.json");
  const exported = await exportProjectJson(page, baselineExportPath);
  delete exported.scenarioControllersByFeatureId;
  const legacyImportPath = path.join(artifactDir, "scenario-legacy-import.json");
  fs.writeFileSync(legacyImportPath, JSON.stringify(exported, null, 2));

  await page.evaluate(async ({ featureId, baselineOwner }) => {
    const { state } = await import("/js/core/state.js");
    state.sovereigntyByFeatureId = state.sovereigntyByFeatureId || {};
    state.scenarioControllersByFeatureId = state.scenarioControllersByFeatureId || {};
    state.sovereigntyByFeatureId[featureId] = baselineOwner;
    state.scenarioControllersByFeatureId[featureId] = baselineOwner;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  }, splitFeature);

  await page.locator("#projectFileInput").setInputFiles(legacyImportPath);
  await page.waitForFunction(async ({ featureId, expectedController }) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === "tno_1962"
      && state.scenarioControllersByFeatureId?.[featureId] === expectedController;
  }, {
    featureId: splitFeature.featureId,
    expectedController: splitFeature.baselineController,
  });

  const runtimeState = await page.evaluate(async ({ featureId }) => {
    const { state } = await import("/js/core/state.js");
    return {
      owner: String(state.sovereigntyByFeatureId?.[featureId] || ""),
      controller: String(state.scenarioControllersByFeatureId?.[featureId] || ""),
    };
  }, { featureId: splitFeature.featureId });

  expect(runtimeState.owner).toBe(splitFeature.baselineOwner);
  expect(runtimeState.controller).toBe(splitFeature.baselineController);
});

test("baseline mismatch acceptance persists scenario import audit", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await waitForProjectUiReady(page);
  await applyScenario(page, "tno_1962");

  const exportedPath = path.join(artifactDir, "scenario-mismatch-source.json");
  const exported = await exportProjectJson(page, exportedPath);
  exported.scenario.baselineHash = "bogus-baseline-hash";
  const mismatchPath = path.join(artifactDir, "scenario-mismatch-import.json");
  fs.writeFileSync(mismatchPath, JSON.stringify(exported, null, 2));

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#projectFileInput").setInputFiles(mismatchPath);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === "tno_1962"
      && state.scenarioImportAudit
      && state.scenarioImportAudit.savedBaselineHash === "bogus-baseline-hash";
  });

  const reexportPath = path.join(artifactDir, "scenario-mismatch-export.json");
  const reexported = await exportProjectJson(page, reexportPath);
  const importAudit = reexported.scenario?.importAudit || null;

  expect(importAudit).toMatchObject({
    scenarioId: "tno_1962",
    savedVersion: Number(exported.scenario.version || 1) || 1,
    currentVersion: expect.any(Number),
    savedBaselineHash: "bogus-baseline-hash",
    currentBaselineHash: expect.any(String),
    acceptedAt: expect.any(String),
  });
  expect(importAudit.currentBaselineHash).not.toBe("bogus-baseline-hash");
});
