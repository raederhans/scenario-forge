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
  await page.waitForFunction(() => {
    const downloadBtn = document.querySelector("#downloadProjectBtn");
    const uploadInput = document.querySelector("#projectFileInput");
    const themeSelect = document.querySelector("#themeSelect");
    return !!downloadBtn && !!uploadInput && !!themeSelect && themeSelect.options.length > 1;
  });

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
    return options.find((value) => value !== select.value) || "";
  });
  expect(selectedPaletteId).not.toBe("");
  await setSelectValue(page, "#themeSelect", selectedPaletteId);
  await page.waitForFunction((value) => document.querySelector("#themeSelect")?.value === value, selectedPaletteId);

  await page.locator("#specialZoneStartBtn").click();
  await expect(page.locator("#specialZoneStartBtn")).toBeDisabled();

  const initialDownloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const initialDownload = await initialDownloadPromise;
  const initialExportPath = path.join(artifactDir, "initial-export.json");
  await initialDownload.saveAs(initialExportPath);
  const initialExport = JSON.parse(fs.readFileSync(initialExportPath, "utf8"));

  expect(initialExport.schemaVersion).toBe(14);
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
  });
  expect(initialExport.activePaletteId).toBe(selectedPaletteId);
  expect(initialExport.interactionGranularity).toBe("subdivision");
  expect(initialExport.batchFillScope).toBe("parent");
  expect(initialExport).toHaveProperty("customPresets");
  expect(initialExport).toHaveProperty("referenceImageState");
  expect(initialExport).toHaveProperty("recentColors");

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
    ...cloneJson(importedProject.styleConfig.physical || {}),
    opacity: 0.44,
    blendMode: "multiply",
    atlasOpacity: 0.52,
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
  await page.waitForFunction((expected) => {
    const byId = (id) => document.querySelector(id);
    const recentColors = Array.from(document.querySelectorAll("#recentColors .color-swatch"))
      .map((node) => String(node.dataset.color || "").toLowerCase());
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
      && byId("#specialZoneStartBtn")?.disabled === false
      && byId("#specialZoneFinishBtn")?.disabled === true
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

  const legacyProject = cloneJson(roundtripExport);
  legacyProject.schemaVersion = 13;
  delete legacyProject.activePaletteId;
  delete legacyProject.customPresets;
  delete legacyProject.referenceImageState;
  delete legacyProject.recentColors;
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
  await page.waitForFunction(() => {
    const byId = (id) => document.querySelector(id);
    const recentCount = document.querySelectorAll("#recentColors .color-swatch").length;
    return byId("#themeSelect")?.value === "hoi4_vanilla"
      && byId("#toggleSpecialZones")?.checked === false
      && byId("#physicalBlendMode")?.value === "soft-light"
      && byId("#physicalOpacity")?.value === "50"
      && byId("#specialZoneStartBtn")?.disabled === false
      && byId("#specialZoneFinishBtn")?.disabled === true
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
