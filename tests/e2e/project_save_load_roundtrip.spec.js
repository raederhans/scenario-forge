const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  readBootStateSnapshot,
  readFailureContextSnapshot,
  waitForAppInteractive,
  writeFailureContextArtifact,
} = require("./support/playwright-app");

const PROJECT_FAILURE_SELECTORS = [
  "#bootOverlay",
  "#scenarioSelect",
  "#scenarioStatus",
  "#downloadProjectBtn",
  "#projectFileInput",
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test.afterEach(async ({ page }, testInfo) => {
  if (!page || testInfo.status === testInfo.expectedStatus) {
    return;
  }
  try {
    const failureContext = await readFailureContextSnapshot(page, PROJECT_FAILURE_SELECTORS);
    await writeFailureContextArtifact(testInfo, failureContext);
  } catch (error) {
    await writeFailureContextArtifact(testInfo, {
      snapshotError: String(error?.message || error),
    });
  }
});

function logProjectSaveLoadStep(step, extra = null) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[project-save-load] ${new Date().toISOString()} ${String(step || "").trim()}${payload}`);
}

async function installStateHandle(page) {
  await page.evaluate(async () => {
    globalThis.__pwProjectSaveLoad = {
      state: (await import(new URL("./js/core/state.js", location.href))).state,
    };
  });
}

async function installInteractionFunnelDebugHandle(page) {
  await installStateHandle(page);
  await page.evaluate(async () => {
    globalThis.__pwProjectSaveLoad = {
      ...(globalThis.__pwProjectSaveLoad || {}),
      getInteractionFunnelDebugState: (await import(new URL("./js/core/interaction_funnel.js", location.href))).getInteractionFunnelDebugState,
    };
  });
}

async function waitForStartupReadonlyUnlocked(page, { timeout = 120000, stableMs = 300 } = {}) {
  await installStateHandle(page);
  logProjectSaveLoadStep("waitForStartupReadonlyUnlocked:start", { timeout, stableMs });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const unlocked = await page.evaluate(() => {
      const state = globalThis.__pwProjectSaveLoad?.state;
      return !!state && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
    });
    if (unlocked) {
      await page.waitForTimeout(stableMs);
      const stillUnlocked = await page.evaluate(() => {
        const state = globalThis.__pwProjectSaveLoad?.state;
        return !!state && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
      });
      if (stillUnlocked) {
        logProjectSaveLoadStep("waitForStartupReadonlyUnlocked:done");
        return;
      }
    } else {
      await page.waitForTimeout(150);
    }
  }
  const snapshot = await readProjectUiSnapshot(page);
  throw new Error(
    `[project-save-load] waitForStartupReadonlyUnlocked timed out after ${timeout}ms: ${JSON.stringify(snapshot)}`
  );
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

async function gotoProjectPage(page, targetPath = "/") {
  logProjectSaveLoadStep("gotoProjectPage:start", { targetPath });
  await gotoApp(page, targetPath, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });
  logProjectSaveLoadStep("gotoProjectPage:interactive");
}

async function readProjectUiSnapshot(page) {
  await installStateHandle(page);
  const boot = await readBootStateSnapshot(page);
  const ui = await page.evaluate(() => {
    const state = globalThis.__pwProjectSaveLoad?.state || null;
    const themeSelect = document.querySelector("#themeSelect");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return {
      activeScenarioId: String(state?.activeScenarioId || ""),
      startupReadonly: !!state?.startupReadonly,
      startupReadonlyUnlockInFlight: !!state?.startupReadonlyUnlockInFlight,
      renderCountryListReady: typeof state?.renderCountryListFn === "function",
      updateToolbarInputsReady: typeof state?.updateToolbarInputsFn === "function",
      d3JsonReady: !!globalThis.d3?.json,
      downloadButtonPresent: !!document.querySelector("#downloadProjectBtn"),
      uploadInputPresent: !!document.querySelector("#projectFileInput"),
      themeOptions: themeSelect?.options?.length || 0,
      scenarioOptions: scenarioSelect?.options?.length || 0,
    };
  });
  return { boot, ui };
}

async function waitForProjectUiReady(page) {
  await installStateHandle(page);
  logProjectSaveLoadStep("waitForProjectUiReady:start");
  try {
    await page.waitForFunction(() => {
      const downloadBtn = document.querySelector("#downloadProjectBtn");
      const uploadInput = document.querySelector("#projectFileInput");
      const themeSelect = document.querySelector("#themeSelect");
      const scenarioSelect = document.querySelector("#scenarioSelect");
      return !!globalThis.d3?.json
        && !!downloadBtn
        && !!uploadInput
        && !!themeSelect
        && themeSelect.options.length > 1
        && !!scenarioSelect;
    }, { timeout: 120000 });
  } catch (_error) {
    const snapshot = await readProjectUiSnapshot(page);
    throw new Error(
      `[project-save-load] waitForProjectUiReady timed out after 120000ms: ${JSON.stringify(snapshot)}`
    );
  }
  await waitForStartupReadonlyUnlocked(page);
  logProjectSaveLoadStep("waitForProjectUiReady:done", await readProjectUiSnapshot(page));
}

async function exportProjectJson(page, outputPath) {
  logProjectSaveLoadStep("exportProjectJson:start", { outputPath });
  await page.getByRole("tablist", { name: "Inspector panels" }).getByRole("tab", { name: "Project" }).click();
  const projectLegendSection = page.locator("#projectLegendSection");
  const projectLegendSummary = page.locator("#lblProjectLegend");
  await expect(projectLegendSummary).toBeVisible();
  const projectLegendOpen = await projectLegendSection.evaluate((details) => details.open);
  if (!projectLegendOpen) {
    await projectLegendSummary.click();
  }
  await expect(projectLegendSection).toHaveJSProperty("open", true);
  await installStateHandle(page);
  await page.evaluate(async () => {
    const state = globalThis.__pwProjectSaveLoad?.state;
    const renderPresetTreeFn = state?.renderPresetTreeFn;
    if (typeof renderPresetTreeFn === "function") {
      const result = renderPresetTreeFn();
      if (result && typeof result.then === "function") {
        await result;
      }
    }
  });
  await expect(projectLegendSection).toHaveJSProperty("open", true);
  await expect.poll(async () => {
    const currentUrl = new URL(page.url());
    const openSections = (currentUrl.searchParams.get("section") || "")
      .split(",")
      .map((section) => section.trim())
      .filter(Boolean);
    return openSections.includes("projectLegendSection");
  }).toBe(true);
  const downloadButton = page.locator("#downloadProjectBtn");
  await downloadButton.scrollIntoViewIfNeeded();
  await expect(downloadButton).toBeVisible({ timeout: 30000 });
  const projectDownloadDestination = page.locator("#projectDownloadDestination");
  await setSelectValue(page, "#projectDownloadDestination", "browser");
  await expect(projectDownloadDestination).toHaveValue("browser");
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await downloadButton.click();
  let download;
  try {
    download = await downloadPromise;
  } catch (_error) {
    const snapshot = await readProjectUiSnapshot(page);
    throw new Error(
      `[project-save-load] download did not start before timeout: ${JSON.stringify(snapshot)}`
    );
  }
  await download.saveAs(outputPath);
  logProjectSaveLoadStep("exportProjectJson:done", { outputPath });
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

async function waitForScenarioApplyIdle(page, { timeout = 120000 } = {}) {
  await installStateHandle(page);
  logProjectSaveLoadStep("waitForScenarioApplyIdle:start", { timeout });
  try {
    await page.waitForFunction(() => {
      const state = globalThis.__pwProjectSaveLoad?.state;
      return !!state && !state.scenarioApplyInFlight;
    }, { timeout });
  } catch (_error) {
    const snapshot = await readProjectUiSnapshot(page);
    throw new Error(
      `[project-save-load] waitForScenarioApplyIdle timed out after ${timeout}ms: ${JSON.stringify(snapshot)}`
    );
  }
  logProjectSaveLoadStep("waitForScenarioApplyIdle:done");
}

async function ensureScenarioActive(page, scenarioId, { timeout = 120000 } = {}) {
  await installStateHandle(page);
  const active = await page.evaluate((expectedScenarioId) => {
    const state = globalThis.__pwProjectSaveLoad?.state;
    return state?.activeScenarioId === expectedScenarioId;
  }, scenarioId);
  if (active) {
    await waitForScenarioApplyIdle(page, { timeout });
    return;
  }
  await applyScenario(page, scenarioId);
}

async function applyScenario(page, scenarioId) {
  logProjectSaveLoadStep("applyScenario:start", { scenarioId });
  await waitForStartupReadonlyUnlocked(page);
  await waitForScenarioApplyIdle(page);
  await page.evaluate(async (expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const { applyScenarioById } = await import(new URL("./js/core/scenario_manager.js", location.href));
    await applyScenarioById(expectedScenarioId, {
      renderNow: true,
      markDirtyReason: "playwright-apply-scenario",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await installStateHandle(page);
  try {
    await page.waitForFunction((expectedScenarioId) => {
      const state = globalThis.__pwProjectSaveLoad?.state;
      return state?.activeScenarioId === expectedScenarioId;
    }, scenarioId, { timeout: 120000 });
  } catch (_error) {
    const snapshot = await readProjectUiSnapshot(page);
    throw new Error(
      `[project-save-load] applyScenario did not reach activeScenarioId=${scenarioId}: ${JSON.stringify(snapshot)}`
    );
  }
  logProjectSaveLoadStep("applyScenario:done", { scenarioId, snapshot: await readProjectUiSnapshot(page) });
}

async function beginProjectImportWait(page, { expectedFileName = "" } = {}) {
  await installInteractionFunnelDebugHandle(page);
  logProjectSaveLoadStep("beginProjectImportWait:start", { expectedFileName });
  const initialDebug = await page.evaluate(() => (
    globalThis.__pwProjectSaveLoad?.getInteractionFunnelDebugState?.() || null
  ));
  logProjectSaveLoadStep("beginProjectImportWait:baseline", {
    expectedFileName,
    importStartCount: Number(initialDebug?.importStartCount || 0),
    importApplyCount: Number(initialDebug?.importApplyCount || 0),
  });
  return {
    expectedFileName: String(expectedFileName || "").trim(),
    initialImportStartCount: Number(initialDebug?.importStartCount || 0),
    initialImportApplyCount: Number(initialDebug?.importApplyCount || 0),
  };
}

async function waitForProjectImportCompletionFrom(page, importWaitState, { timeout = 120000 } = {}) {
  const waitState = importWaitState && typeof importWaitState === "object" ? importWaitState : {};
  await installInteractionFunnelDebugHandle(page);
  logProjectSaveLoadStep("waitForProjectImportCompletionFrom:start", {
    expectedFileName: String(waitState.expectedFileName || "").trim(),
    timeout,
  });
  const deadline = Date.now() + timeout;
  const expectedFileName = String(waitState.expectedFileName || "").trim();
  while (Date.now() < deadline) {
    const debug = await page.evaluate(() => (
      globalThis.__pwProjectSaveLoad?.getInteractionFunnelDebugState?.() || null
    ));
    const importStarted = Number(debug?.importStartCount || 0) > Number(waitState.initialImportStartCount || 0);
    if (importStarted && String(debug?.lastImportError || "").trim()) {
      throw new Error(`Project import failed: ${String(debug.lastImportError).trim()}`);
    }
    const importCompleted = importStarted
      && Number(debug?.importApplyCount || 0) > Number(waitState.initialImportApplyCount || 0)
      && debug?.importPhase === "complete"
      && (!expectedFileName || debug?.lastImportFileName === expectedFileName);
    if (importCompleted) {
      logProjectSaveLoadStep("waitForProjectImportCompletionFrom:done", {
        expectedFileName,
        importStartCount: Number(debug?.importStartCount || 0),
        importApplyCount: Number(debug?.importApplyCount || 0),
      });
      return;
    }
    await page.waitForTimeout(150);
  }
  const snapshot = await readProjectUiSnapshot(page);
  throw new Error(
    `[project-save-load] Project import did not complete before timeout for ${expectedFileName || "selected file"}: ${JSON.stringify({ snapshot, waitState })}`
  );
}

async function getScenarioOwnershipFeature(page) {
  return page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", location.href));
    const featureId = Object.keys(state.scenarioBaselineOwnersByFeatureId || {})[0] || "";
    return {
      featureId,
      baselineOwner: String(state.scenarioBaselineOwnersByFeatureId?.[featureId] || ""),
    };
  });
}

function isAnonymousBackendProbeFailure(entry) {
  if (entry?.status !== 401) return false;
  try {
    return new URL(entry.url).pathname === "/api/backend/auth/me";
  } catch (_error) {
    return false;
  }
}

function filterExpectedBackendProbeConsoleErrors(consoleErrors, networkFailures) {
  const filtered = [...consoleErrors];
  const expectedProbeCount = networkFailures.filter(isAnonymousBackendProbeFailure).length;
  for (let index = 0; index < expectedProbeCount; index += 1) {
    const matchIndex = filtered.indexOf("Failed to load resource: the server responded with a status of 401 (Unauthorized)");
    if (matchIndex === -1) break;
    filtered.splice(matchIndex, 1);
  }
  return filtered;
}

test("project save/load roundtrip preserves extended runtime state", async ({ page }) => {
  test.setTimeout(120000);
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

  await gotoProjectPage(page);
  await waitForProjectUiReady(page);

  await setInputValue(page, "#internalBorderColor", "#123456");
  await setInputValue(page, "#internalBorderOpacity", "42");
  await setInputValue(page, "#internalBorderWidth", "0.88");
  await setInputValue(page, "#empireBorderColor", "#135790");
  await setInputValue(page, "#empireBorderOpacity", "66");
  await setInputValue(page, "#empireBorderWidth", "2.25");
  await setInputValue(page, "#coastlineColor", "#2468ac");
  await setInputValue(page, "#coastlineOpacity", "73");
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

  const legacySpecialZoneStartResult = await page.evaluate(async () => {
    const { startSpecialZoneDraw } = await import(new URL("./js/core/map_renderer.js", location.href));
    return startSpecialZoneDraw({ zoneType: "custom", label: "" });
  });
  expect(legacySpecialZoneStartResult).toBe(false);
  await installStateHandle(page);
  await page.waitForFunction(() => !globalThis.__pwProjectSaveLoad?.state?.specialZoneEditor?.active);

  const initialExportPath = path.join(artifactDir, "initial-export.json");
  const initialExport = await exportProjectJson(page, initialExportPath);

  expect(initialExport.schemaVersion).toBe(22);
  expect(initialExport.styleConfig.internalBorders).toMatchObject({
    color: "#123456",
    opacity: 0.42,
    width: 0.88,
  });
  expect(initialExport.styleConfig.empireBorders).toMatchObject({
    color: "#135790",
    opacity: 0.66,
    width: 2.25,
  });
  expect(initialExport.styleConfig.coastlines).toMatchObject({
    color: "#2468ac",
    opacity: 0.73,
    width: 2.4,
  });
  expect(initialExport.styleConfig.physical).toMatchObject({
    opacity: 0.61,
    blendMode: "overlay",
    atlasOpacity: 0.44,
    preset: "balanced",
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
    opacity: 0.58,
    width: 3.14,
  };
  importedProject.styleConfig.coastlines = {
    color: "#0f8f6f",
    opacity: 0.49,
    width: 2.7,
  };
  importedProject.styleConfig.physical = {
    mode: "atlas_and_contours",
    opacity: 0.44,
    blendMode: "multiply",
  };
  importedProject.styleConfig.transportOverview = {
    ...(importedProject.styleConfig.transportOverview || {}),
    rail: {
      opacity: 0.61,
      visualStrength: 0.68,
      labelsEnabled: true,
      labelDensity: "dense",
      labelMode: "name",
      coverageReach: 0.78,
      scopeLinkMode: "linked",
      scope: "mainline_plus_regional",
      importanceThreshold: "secondary",
    },
  };
  importedProject.layerVisibility.showSpecialZones = true;
  importedProject.layerVisibility.showTransport = false;
  importedProject.layerVisibility.showRail = true;
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

  const importWait = await beginProjectImportWait(page, {
    expectedFileName: path.basename(importedProjectPath),
  });
  await page.locator("#projectFileInput").setInputFiles(importedProjectPath);
  await waitForProjectImportCompletionFrom(page, importWait);
  await installStateHandle(page);
  await page.waitForFunction((expected) => {
    const byId = (id) => document.querySelector(id);
    const recentColors = Array.from(document.querySelectorAll("#recentColors .color-swatch"))
      .map((node) => String(node.dataset.color || "").toLowerCase());
    const state = globalThis.__pwProjectSaveLoad?.state;
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
      && byId("#toggleRail")?.checked === true
      && byId("#railLabelsEnabled")?.checked === true
      && byId("#railLabelDensity")?.value === expected.railLabelDensity
      && byId("#railOpacity")?.value === expected.railOpacity
      && state.interactionGranularity === expected.granularity
      && state.showSpecialZones === true
      && document.querySelector("[data-special-zone-overlay-toggle]")?.checked === true
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
    railLabelDensity: "dense",
    railOpacity: "61",
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

  const roundtripExportPath = path.join(artifactDir, "roundtrip-export.json");
  const roundtripExport = await exportProjectJson(page, roundtripExportPath);

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
    atlasOpacity: 0.44,
    preset: "balanced",
  });
  expect(roundtripExport.styleConfig.transportOverview.rail).toMatchObject({
    opacity: 0.61,
    visualStrength: 0.68,
    labelsEnabled: true,
    labelDensity: "dense",
    coverageReach: 0.78,
    scope: "mainline_plus_regional",
    importanceThreshold: "secondary",
  });
  expect(roundtripExport.layerVisibility.showRail).toBe(true);
  expect(Object.hasOwn(roundtripExport.styleConfig, "specialZones")).toBe(false);
  expect(roundtripExport.specialZoneLayers).toBeTruthy();
  expect(roundtripExport.manualSpecialZones).toEqual({ type: "FeatureCollection", features: [] });
  expect(Object.hasOwn(roundtripExport, "specialRegionOverrides")).toBe(false);
  expect(roundtripExport.customPresets).toEqual({
    ZZZ: [
      {
        name: "Imported Preset",
        ids: ["123", "456"],
      },
    ],
  });
  expect(roundtripExport.annotationView).toMatchObject({
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
  delete legacyProject.layerVisibility.showRail;
  delete legacyProject.layerVisibility.showRoad;
  delete legacyProject.layerVisibility.showSpecialZones;
  const legacyProjectPath = path.join(artifactDir, "legacy-import.json");
  fs.writeFileSync(legacyProjectPath, JSON.stringify(legacyProject, null, 2));

  await page.locator("#specialZonePopover").evaluate((node) => { node.open = true; });
  await page.locator("[data-special-zone-overlay-toggle]").check();
  await setInputValue(page, "#internalBorderColor", "#ffffff");
  await setInputValue(page, "#empireBorderWidth", "4.25");
  await setInputValue(page, "#coastlineWidth", "2.9");
  await setInputValue(page, "#referenceOpacity", "80");
  await setInputValue(page, "#referenceScale", "2.00");
  await setSelectValue(page, "#themeSelect", selectedPaletteId);
  await page.waitForFunction((value) => document.querySelector("#themeSelect")?.value === value, selectedPaletteId);

  const legacyImportWait = await beginProjectImportWait(page, {
    expectedFileName: path.basename(legacyProjectPath),
  });
  await page.locator("#projectFileInput").setInputFiles(legacyProjectPath);
  await waitForProjectImportCompletionFrom(page, legacyImportWait);
  await installStateHandle(page);
  await page.waitForFunction(() => {
    const byId = (id) => document.querySelector(id);
    const recentCount = document.querySelectorAll("#recentColors .color-swatch").length;
    const state = globalThis.__pwProjectSaveLoad?.state;
    return byId("#themeSelect")?.value === "hoi4_vanilla"
      && state.showSpecialZones === false
      && document.querySelector("[data-special-zone-overlay-toggle]")?.checked === false
      && byId("#toggleRail")?.checked === false
      && byId("#toggleRoad")?.checked === false
      && byId("#physicalBlendMode")?.value === "source-over"
      && byId("#physicalOpacity")?.value === "56"
      && !state.specialZoneEditor?.active
      && byId("#frontlineEnabledToggle")?.checked === false
      && byId("#strategicFrontlineStyleSelect")?.value === "clean"
      && byId("#strategicFrontlineLabelsToggle")?.checked === false
      && byId("#operationGraphicList")?.options?.length === 1
      && byId("#unitCounterList")?.options?.length === 1
      && recentCount === 0;
  });

  const legacyExportPath = path.join(artifactDir, "legacy-export.json");
  const legacyExport = await exportProjectJson(page, legacyExportPath);

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
  expect(legacyExport.annotationView).toMatchObject({
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
  expect(legacyExport.layerVisibility.showRail).toBe(false);
  expect(legacyExport.layerVisibility.showRoad).toBe(false);
  expect(legacyExport.styleConfig.internalBorders).toMatchObject({
    color: "#cccccc",
    opacity: 1,
    width: 0.5,
  });
  expect(legacyExport.styleConfig.empireBorders).toMatchObject({
    color: "#666666",
    opacity: 0.9,
    width: 1,
  });
  expect(legacyExport.styleConfig.coastlines).toMatchObject({
    color: "#333333",
    opacity: 0.8,
    width: 1.2,
  });
  expect(legacyExport.styleConfig.physical).toMatchObject({
    opacity: 0.56,
    atlasOpacity: 0.44,
    blendMode: "source-over",
    preset: "balanced",
  });

  const unexpectedConsoleErrors = filterExpectedBackendProbeConsoleErrors(consoleErrors, networkFailures);
  const unexpectedNetworkFailures = networkFailures.filter((entry) => !isAnonymousBackendProbeFailure(entry));

  expect(unexpectedConsoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(unexpectedNetworkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);

});

test("project import/export preserves legacy unit counter controller nation source", async ({ page }) => {
  test.setTimeout(120000);
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await gotoProjectPage(page);
  await waitForProjectUiReady(page);
  await ensureScenarioActive(page, "tno_1962");

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

  const importWait = await beginProjectImportWait(page, {
    expectedFileName: path.basename(importPath),
  });
  await page.locator("#projectFileInput").setInputFiles(importPath);
  await waitForProjectImportCompletionFrom(page, importWait);
  await installStateHandle(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwProjectSaveLoad?.state;
    const counter = Array.isArray(state?.unitCounters) ? state.unitCounters[0] : null;
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

test("scenario project roundtrip omits retired controller maps", async ({ page }) => {
  test.setTimeout(120000);
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await gotoProjectPage(page);
  await waitForProjectUiReady(page);
  await ensureScenarioActive(page, "tno_1962");

  const feature = await getScenarioOwnershipFeature(page);
  expect(feature.featureId).not.toBe("");

  const importPath = path.join(artifactDir, "scenario-retired-controller-roundtrip.json");
  const exported = await exportProjectJson(page, importPath);
  expect(exported.scenarioControllersByFeatureId).toBeUndefined();
});
test("legacy scenario project import ignores retired controller map", async ({ page }) => {
  test.setTimeout(120000);
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await gotoProjectPage(page);
  await waitForProjectUiReady(page);
  await ensureScenarioActive(page, "tno_1962");

  const feature = await getScenarioOwnershipFeature(page);
  const baselineExportPath = path.join(artifactDir, "scenario-legacy-source.json");
  const exported = await exportProjectJson(page, baselineExportPath);
  exported.scenarioControllersByFeatureId = { [feature.featureId]: "LEGACY" };
  const legacyImportPath = path.join(artifactDir, "scenario-legacy-import.json");
  fs.writeFileSync(legacyImportPath, JSON.stringify(exported, null, 2));

  const legacyScenarioImportWait = await beginProjectImportWait(page, { expectedFileName: path.basename(legacyImportPath) });
  await page.locator("#projectFileInput").setInputFiles(legacyImportPath);
  await waitForProjectImportCompletionFrom(page, legacyScenarioImportWait);

  const runtimeState = await page.evaluate(async ({ featureId }) => {
    const { state } = await import(new URL("./js/core/state.js", location.href));
    return {
      activeScenarioId: state.activeScenarioId || "",
      owner: String(state.sovereigntyByFeatureId?.[featureId] || ""),
      hasControllerMap: Object.prototype.hasOwnProperty.call(state, "scenarioControllersByFeatureId"),
    };
  }, { featureId: feature.featureId });

  expect(runtimeState.activeScenarioId).toBe("tno_1962");
  expect(runtimeState.owner).toBe(feature.baselineOwner);
  expect(runtimeState.hasControllerMap).toBeFalsy();
});
test("baseline mismatch acceptance persists scenario import audit", async ({ page }) => {
  test.setTimeout(120000);
  const artifactDir = path.join(".runtime", "tests", "playwright", "project-save-load");
  fs.mkdirSync(artifactDir, { recursive: true });

  await gotoProjectPage(page);
  await waitForProjectUiReady(page);
  await ensureScenarioActive(page, "tno_1962");

  const exportedPath = path.join(artifactDir, "scenario-mismatch-source.json");
  const exported = await exportProjectJson(page, exportedPath);
  exported.scenario.baselineHash = "bogus-baseline-hash";
  const mismatchPath = path.join(artifactDir, "scenario-mismatch-import.json");
  fs.writeFileSync(mismatchPath, JSON.stringify(exported, null, 2));

  const mismatchImportWait = await beginProjectImportWait(page, {
    expectedFileName: path.basename(mismatchPath),
  });
  await page.locator("#projectFileInput").setInputFiles(mismatchPath);
  await installInteractionFunnelDebugHandle(page);
  await page.waitForFunction(() => {
    const debug = globalThis.__pwProjectSaveLoad?.getInteractionFunnelDebugState?.();
    const dialog = document.querySelector("[data-app-dialog-overlay='true']");
    return !!dialog || !!String(debug?.lastImportError || "").trim();
  }, { timeout: 30_000 });
  const mismatchDebug = await page.evaluate(() => (
    globalThis.__pwProjectSaveLoad?.getInteractionFunnelDebugState?.() || null
  ));
  if (String(mismatchDebug?.lastImportError || "").trim()) {
    throw new Error(`Project import failed before confirmation: ${String(mismatchDebug.lastImportError).trim()}`);
  }
  const mismatchDialog = page.locator("[data-app-dialog-overlay='true']").last();
  await expect(mismatchDialog).toBeVisible();
  await expect(mismatchDialog.locator(".app-dialog-title")).toBeVisible();
  await mismatchDialog.locator("[data-dialog-confirm='true']").click();
  await waitForProjectImportCompletionFrom(page, mismatchImportWait);
  await installStateHandle(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwProjectSaveLoad?.state;
    return state?.activeScenarioId === "tno_1962"
      && state?.scenarioImportAudit
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

for (const baseline of [
  { mode: "fresh", scenario: "tno_1962", sample: "tno-1962-atlantropa-briefing" },
  { mode: "fast", scenario: "hoi4_1936", sample: "hoi4-1936-europe-briefing" },
  { mode: "fast", scenario: "hoi4_1936", sample: "hoi4-1936-europe-briefing", roundtripOnly: true },
]) {
  test(`editing baseline ${baseline.mode} ${baseline.scenario} click undo save reload${baseline.roundtripOnly ? " (roundtrip only)" : ""}`, async ({ page }, testInfo) => {
    test.setTimeout(110000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize(baseline.roundtripOnly
      ? { width: 1280, height: 720 }
      : { width: 1600, height: 1000 });
    const { DEFAULT_FAST_APP_OPEN_PATH, DEFAULT_FRESH_APP_OPEN_PATH } = require("./support/startup-paths");
    const { waitForScenarioApplyIdle: waitReady } = require("./support/playwright-app");
    const target = baseline.mode === "fast" ? DEFAULT_FAST_APP_OPEN_PATH : DEFAULT_FRESH_APP_OPEN_PATH;
    await gotoProjectPage(page, `${target}&sample=${baseline.sample}`);
    await waitReady(page, { scenarioId: baseline.scenario, timeout: 60000 });
    await waitForStartupReadonlyUnlocked(page, { timeout: 30000 });
    if (await page.locator("#scenarioGuidePopover").isVisible()) {
      await page.locator("#scenarioGuideCloseBtn").click();
    }
    logProjectSaveLoadStep("baseline:paint-controls");
    await page.locator("#paintModeVisualBtn").click();
    await page.locator("#toolFillBtn").click();
    await page.locator("#customColor").fill("#e31ac4");
    const point = await page.evaluate(async () => {
      const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href));
      const xy = projectGeoToScreen(13.4, 52.5);
      const rect = document.querySelector("#mapContainer").getBoundingClientRect();
      return { x: rect.left + xy[0], y: rect.top + xy[1] };
    });
    await page.keyboard.down("Control");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Control");
    const selected = await page.evaluate(() => {
      const s = globalThis.__pwProjectSaveLoad.state;
      return { id: s.devSelectedHit?.id, count: s.devSelectionFeatureIds.size, before: { ...s.visualOverrides }, history: s.historyPast.length };
    });
    expect(selected.id).toBeTruthy();
    expect(selected.count).toBe(1);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => page.evaluate(() => globalThis.__pwProjectSaveLoad.state.historyPast.length)).toBe(selected.history + 1);
    const painted = await page.evaluate(() => ({ ...globalThis.__pwProjectSaveLoad.state.visualOverrides }));
    expect(painted).not.toEqual(selected.before);
    expect(Object.values(painted)).toContain("#e31ac4");
    if (baseline.roundtripOnly) {
      await page.locator("h1").click();
      await page.keyboard.press("Control+z");
    } else {
      await page.locator("#undoBtn").click();
    }
    expect(await page.evaluate(() => ({ ...globalThis.__pwProjectSaveLoad.state.visualOverrides }))).toEqual(selected.before);
    expect(await page.evaluate(() => globalThis.__pwProjectSaveLoad.state.historyPast.length)).toBe(selected.history);
    if (baseline.roundtripOnly) await page.keyboard.press("Control+y");
    else await page.locator("#redoBtn").click();
    expect(await page.evaluate(() => ({ ...globalThis.__pwProjectSaveLoad.state.visualOverrides }))).toEqual(painted);
    const savePath = testInfo.outputPath("edited.project.json");
    const saved = await exportProjectJson(page, savePath);
    expect(saved.visualOverrides).toEqual(painted);
    await page.locator("h1").click();
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => ({ ...globalThis.__pwProjectSaveLoad.state.visualOverrides }))).toEqual(selected.before);
    if (baseline.roundtripOnly) {
      // Cancellation and parse failure must preserve the actual unsaved edit state.
      // Undo restores its historical dirty snapshot, so make a fresh real edit.
      await page.mouse.click(point.x, point.y);
      expect(await page.evaluate(() => globalThis.__pwProjectSaveLoad.state.isDirty)).toBe(true);
      const cancelledPath = testInfo.outputPath("cancelled.project.json");
      const beforeCancelledImport = await page.evaluate(() => {
        const s = globalThis.__pwProjectSaveLoad.state;
        return JSON.stringify({ past: s.historyPast, future: s.historyFuture,
          dirty: s.isDirty, dirtyRevision: s.dirtyRevision, overrides: s.visualOverrides,
          scenario: s.activeScenarioId });
      });
      fs.writeFileSync(cancelledPath, JSON.stringify({ ...saved, scenario: { ...saved.scenario, baselineHash: "u1-mismatch" } }));
      await page.locator("#projectFileInput").setInputFiles(cancelledPath);
      await page.locator("[data-app-dialog-overlay='true'] [data-dialog-cancel='true']").click();
      await expect(page.locator("#projectSaveStatus")).toHaveText("Project import cancelled.");
      expect(await page.evaluate(() => globalThis.__pwProjectSaveLoad.state.isDirty)).toBe(true);
      expect(await page.evaluate(() => {
        const s = globalThis.__pwProjectSaveLoad.state;
        return JSON.stringify({ past: s.historyPast, future: s.historyFuture,
          dirty: s.isDirty, dirtyRevision: s.dirtyRevision, overrides: s.visualOverrides,
          scenario: s.activeScenarioId });
      })).toBe(beforeCancelledImport);
      const invalidPath = testInfo.outputPath("invalid.project.json");
      fs.writeFileSync(invalidPath, "{invalid-json");
      await page.locator("#projectFileInput").setInputFiles(invalidPath);
      await expect(page.locator("#projectSaveStatus")).toContainText("Project import failed before completion.");
      expect(await page.evaluate(() => globalThis.__pwProjectSaveLoad.state.isDirty)).toBe(true);
      fs.writeFileSync(savePath, JSON.stringify({ ...saved, visualOverrides: { ...saved.visualOverrides, U1_FORGED_FEATURE: "#00ff00" } }));
    }
    const watch = await beginProjectImportWait(page, { expectedFileName: path.basename(savePath) });
    await page.locator("#projectFileInput").setInputFiles(savePath);
    await waitForProjectImportCompletionFrom(page, watch, { timeout: 30000 });
    expect(await page.evaluate(() => ({ ...globalThis.__pwProjectSaveLoad.state.visualOverrides }))).toEqual(painted);
    if (baseline.roundtripOnly) {
      await expect(page.locator("#projectSaveStatus")).toContainText("Project imported: HOI4 1936.");
      await expect(page.locator("#projectSaveStatus")).toContainText("Ignored 1 entries");
      expect(await page.evaluate(() => globalThis.__pwProjectSaveLoad.state.isDirty)).toBe(false);
    }
    const reexported = await exportProjectJson(page, testInfo.outputPath("reloaded.project.json"));
    expect(reexported.visualOverrides).toEqual(saved.visualOverrides);
    await applyScenario(page, "modern_world");
    const afterSwitch = await page.evaluate(() => {
      const s = globalThis.__pwProjectSaveLoad.state;
      return { scenario: s.activeScenarioId, overrides: { ...s.visualOverrides }, past: s.historyPast.length, future: s.historyFuture.length, selection: s.devSelectionFeatureIds.size };
    });
    expect(afterSwitch).toEqual({ scenario: "modern_world", overrides: {}, past: 0, future: 0, selection: 0 });
    // The generated-product gate also catches missing published Modern World
    // topology. The broader cross-scenario reimport/raster regression remains.
    if (baseline.roundtripOnly) return;
    // Import from another active scenario: current target baseline must authorize
    // unloaded real IDs, while an ID invented by the project stays invalid.
    const foreignPath = testInfo.outputPath("foreign-id.project.json");
    fs.writeFileSync(foreignPath, JSON.stringify({
      ...saved,
      visualOverrides: { ...painted, M0_FORGED_FEATURE: "#00ff00" },
    }));
    const foreignWatch = await beginProjectImportWait(page, { expectedFileName: path.basename(foreignPath) });
    await page.locator("#projectFileInput").setInputFiles(foreignPath);
    await waitForProjectImportCompletionFrom(page, foreignWatch, { timeout: 30000 });
    const restored = await page.evaluate((id) => {
      const s = globalThis.__pwProjectSaveLoad.state;
      return { scenario: s.activeScenarioId, overrides: { ...s.visualOverrides }, baselineOwnsId: Object.hasOwn(s.scenarioBaselineOwnersByFeatureId, id) };
    }, selected.id);
    expect(restored).toEqual({ scenario: baseline.scenario, overrides: painted, baselineOwnsId: true });
    await exportProjectJson(page, testInfo.outputPath("cross-scenario-reloaded.project.json"));
    // Reload resets the view to the globe. Enlarge the edited district before
    // asserting exact raster color so resampling a two-pixel feature is not the oracle.
    const exportPoint = await page.evaluate(async () => {
      const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href));
      const xy = projectGeoToScreen(13.4, 52.5);
      const rect = document.querySelector("#mapContainer").getBoundingClientRect();
      return { x: rect.left + xy[0], y: rect.top + xy[1] };
    });
    await page.mouse.move(exportPoint.x, exportPoint.y);
    await page.mouse.wheel(0, -1600);
    await require("./support/playwright-app").waitForRenderIdle(page, { scenarioId: baseline.scenario, timeout: 30000 });
    await page.locator("#dockExportBtn").click();
    await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible();
    const pngDownload = page.waitForEvent("download");
    await page.locator("#exportWorkbenchSnapshotBtn").click();
    const png = await pngDownload;
    expect(await png.failure()).toBeNull();
    const pngPath = testInfo.outputPath("edited-map.png");
    await png.saveAs(pngPath);
    const bytes = fs.readFileSync(pngPath);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(1024);
    const paintedPixels = await page.evaluate(async (encoded) => {
      const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 227 && pixels[i + 1] === 26 && pixels[i + 2] === 196 && pixels[i + 3] > 0) count++;
      }
      bitmap.close();
      return count;
    }, bytes.toString("base64"));
    logProjectSaveLoadStep("baseline:export-pixels", { paintedPixels, state: await page.evaluate((id) => {
      const s = globalThis.__pwProjectSaveLoad.state;
      return { color: s.colors?.[id], override: s.visualOverrides?.[id], runtimeCount: s.runtimeFeatureIds?.length,
        landCount: s.landData?.features?.length, politicalCount: s.scenarioPoliticalChunkData?.features?.length,
        scenario: s.activeScenarioId, exportUi: s.exportWorkbenchUi };
    }, selected.id) });
    expect(paintedPixels).toBeGreaterThan(0);
    await testInfo.attach("editing-baseline-state", { body: JSON.stringify({ baseline, selected, painted, afterSwitch }, null, 2), contentType: "application/json" });
  });
}
