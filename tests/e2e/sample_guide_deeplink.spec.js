const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  waitForShellReady,
  waitForScenarioApplyIdle,
  waitForProjectImportCompletion,
  readSmokeFailureSnapshot,
  writeFailureContextArtifact,
} = require("./support/playwright-app");

test.setTimeout(180000);

async function readSampleDeeplinkState(page) {
  return page.evaluate(async () => {
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const { state } = await import(stateModuleUrl);
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      currentLanguage: String(state.currentLanguage || "en"),
      status: String(state.sampleProjectDeeplink?.status || ""),
      sampleId: String(state.sampleProjectDeeplink?.sampleId || ""),
      scenarioId: String(state.sampleProjectDeeplink?.scenarioId || ""),
      errorCode: String(state.sampleProjectDeeplink?.errorCode || ""),
    };
  });
}

async function readActiveElementSnapshot(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      id: String(active?.id || ""),
      sampleChoice: String(active?.getAttribute?.("data-sample-guide-choice") || ""),
      text: String(active?.textContent || "").trim(),
    };
  });
}

async function expectActiveElement(page, matcher) {
  await expect.poll(() => readActiveElementSnapshot(page), { timeout: 10000 }).toMatchObject(matcher);
}

async function expectNoHorizontalOverflow(page, selectors) {
  const overflow = await page.evaluate((targetSelectors) => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    return targetSelectors.flatMap((selector) => (
      Array.from(document.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: rect.left,
          right: rect.right,
          viewportWidth,
        };
      })
    )).filter((entry) => (
      entry.clientWidth > 0
      && (
        entry.scrollWidth > entry.clientWidth + 2
        || entry.left < -2
        || entry.right > entry.viewportWidth + 2
      )
    ));
  }, selectors);
  expect(overflow).toEqual([]);
}

function installExportActionIssueTracker(page) {
  const pageErrors = [];
  const actionableConsoleIssues = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.stack || error?.message || error));
  });
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      actionableConsoleIssues.push({ type, text: message.text() });
    }
  });
  return {
    pageErrors,
    actionableConsoleIssues,
    reset() {
      pageErrors.length = 0;
      actionableConsoleIssues.length = 0;
    },
  };
}

function installGoldenRuntimeIssueTracker(page) {
  const unexpectedIssues = [];
  const expectedIssues = [];
  page.on("pageerror", (error) => {
    unexpectedIssues.push({ kind: "pageerror", text: String(error?.stack || error?.message || error) });
  });
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const text = message.text();
    if (/^\[map_renderer\] Removed 2 D3-unsafe water geometry part\(s\): marine_arctic_ocean, marine_southern_ocean$/.test(text)) {
      expectedIssues.push({ kind: `console:${type}`, text });
      return;
    }
    unexpectedIssues.push({ kind: `console:${type}`, text });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    unexpectedIssues.push({ kind: "response", status: response.status(), url: response.url() });
  });
  page.on("requestfailed", (request) => {
    unexpectedIssues.push({
      kind: "requestfailed",
      text: request.failure()?.errorText || "unknown request failure",
      url: request.url(),
    });
  });
  return { expectedIssues, unexpectedIssues };
}

async function readDownloadBuffer(download) {
  const stream = await download.createReadStream();
  expect(stream).toBeTruthy();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function expectExportWorkbenchLayoutReachable(page) {
  const selectors = {
    panel: "#exportWorkbenchPanel",
    footer: ".export-workbench-footer",
    preview: "#exportWorkbenchPreviewCanvas",
    textLayer: "#exportWorkbenchTextElementList",
  };
  const layout = await page.evaluate((targetSelectors) => {
    const elements = Object.fromEntries(Object.entries(targetSelectors).map(([key, selector]) => (
      [key, document.querySelector(selector)]
    )));
    const rects = Object.fromEntries(Object.entries(elements).map(([key, element]) => {
      const rect = element?.getBoundingClientRect?.();
      return [key, rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      } : null];
    }));
    const intersectRects = (first, second) => {
      if (!first || !second) return null;
      const left = Math.max(first.left, second.left);
      const top = Math.max(first.top, second.top);
      const right = Math.min(first.right, second.right);
      const bottom = Math.min(first.bottom, second.bottom);
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const readVisibleRect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const viewportRect = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      let visibleRect = intersectRects(element.getBoundingClientRect(), viewportRect);
      for (let ancestor = element.parentElement; visibleRect && ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const clips = [style.overflow, style.overflowX, style.overflowY]
          .some((value) => /^(auto|clip|hidden|scroll)$/.test(value));
        if (clips) {
          visibleRect = intersectRects(visibleRect, ancestor.getBoundingClientRect());
        }
      }
      return visibleRect;
    };
    const visibleRects = Object.fromEntries(Object.entries(elements).map(([key, element]) => (
      [key, readVisibleRect(element)]
    )));
    const overlapArea = (first, second) => {
      if (!first || !second) return 0;
      const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      return width * height;
    };
    return {
      rects,
      overlaps: {
        footerPreview: overlapArea(visibleRects.footer, visibleRects.preview),
        footerTextLayer: overlapArea(visibleRects.footer, visibleRects.textLayer),
        previewTextLayer: overlapArea(visibleRects.preview, visibleRects.textLayer),
      },
    };
  }, selectors);

  expect(layout.rects.panel?.width).toBeGreaterThan(0);
  expect(layout.rects.panel?.height).toBeGreaterThan(0);
  expect(layout.rects.footer?.height).toBeGreaterThan(0);
  expect(layout.rects.preview?.height).toBeGreaterThan(0);
  expect(layout.rects.textLayer?.height).toBeGreaterThan(0);
  expect(layout.overlaps).toEqual({
    footerPreview: 0,
    footerTextLayer: 0,
    previewTextLayer: 0,
  });
  for (const selector of [selectors.preview, selectors.textLayer, selectors.footer]) {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport();
  }
}

async function isSelectorInViewport(page, selector) {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.width > 0
      && rect.height > 0
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < viewportWidth
      && rect.top < viewportHeight;
  }, selector);
}

async function ensureProjectPanelVisible(page) {
  if (!await isSelectorInViewport(page, "#inspectorSidebarTabProject")) {
    await page.locator("#rightPanelToggle").click();
    await expect.poll(() => isSelectorInViewport(page, "#inspectorSidebarTabProject"), { timeout: 30000 }).toBe(true);
  }
  const projectTab = page.locator("#inspectorSidebarTabProject");
  if (await projectTab.getAttribute("aria-selected") !== "true") {
    await projectTab.click();
  }
  await expect(projectTab).toHaveAttribute("aria-selected", "true", { timeout: 30000 });
}

async function expectStackingAboveGuide(page, overlaySelector) {
  const zIndex = await page.evaluate((selector) => {
    const overlay = document.querySelector(selector);
    const guide = document.querySelector("#scenarioGuidePopover");
    return {
      overlay: Number.parseInt(window.getComputedStyle(overlay).zIndex || "0", 10),
      guide: Number.parseInt(window.getComputedStyle(guide).zIndex || "0", 10),
    };
  }, overlaySelector);
  expect(zIndex.overlay).toBeGreaterThan(zIndex.guide);
}

async function ensureGuideVisible(page) {
  if (await page.locator("#scenarioGuidePopover").isHidden()) {
    await page.locator("#scenarioGuideBtn").click();
  }
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });
}

async function writeSampleGuideFailureArtifact(page, testInfo) {
  const snapshot = await readSmokeFailureSnapshot(page, [
    "#scenarioGuidePopover",
    "[data-sample-guide-helper]",
    "[data-sample-guide-title]",
    "[data-sample-guide-recommendation]",
    "[data-sample-guide-choice]",
    "[data-sample-guide-status-message]",
    "[data-sample-guide-open-export]",
    "[data-sample-guide-download-original]",
    "[data-sample-guide-continue]",
    "[data-app-dialog-overlay='true']",
    "#exportWorkbenchOverlay",
    "[data-export-workbench-sample-context]",
    "#scenarioStatus",
  ]);
  try {
    snapshot.scenarioRuntimeState = await page.evaluate(async () => {
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const { state } = await import(stateModuleUrl);
    const countFeatures = (payload) => (
      Array.isArray(payload?.features) ? payload.features.length : 0
    );
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    return {
      scenarioPoliticalChunkFeatureCount: countFeatures(state.scenarioPoliticalChunkData),
      scenarioPoliticalVisibleFeatureCount: Array.isArray(state.scenarioPoliticalVisibleChunkData?.features)
        ? state.scenarioPoliticalVisibleChunkData.features.length
        : null,
      mergedPoliticalFeatureCount: countFeatures(state.activeScenarioChunks?.mergedLayerPayloads?.political),
      cachedMergedPoliticalFeatureCount: countFeatures(loadState.mergedLayerPayloadCache?.political),
      landDataFullFeatureCount: countFeatures(state.landDataFull),
      landDataFeatureCount: countFeatures(state.landData),
      runtimePoliticalTopologyFeatureCount: Array.isArray(state.runtimePoliticalTopology?.objects?.political?.geometries)
        ? state.runtimePoliticalTopology.objects.political.geometries.length
        : 0,
      colorCount: Object.keys(state.colors || {}).length,
      loadedChunkCount: Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
        ? state.activeScenarioChunks.loadedChunkIds.length
        : 0,
      selectionVersion: Number(loadState.selectionVersion || 0),
      lastSelection: {
        requiredChunkIds: Array.isArray(loadState.lastSelection?.requiredChunkIds)
          ? loadState.lastSelection.requiredChunkIds
          : [],
        cacheOnlyChunkIds: Array.isArray(loadState.lastSelection?.cacheOnlyChunkIds)
          ? loadState.lastSelection.cacheOnlyChunkIds
          : [],
        retainedActiveChunkIds: Array.isArray(loadState.lastSelection?.retainedActiveChunkIds)
          ? loadState.lastSelection.retainedActiveChunkIds
          : [],
      },
    };
    });
  } catch (error) {
    snapshot.scenarioRuntimeState = {
      snapshotError: String(error?.message || error || "Unknown scenario runtime snapshot error"),
    };
  }
  await writeFailureContextArtifact(testInfo, snapshot, {
    fileName: "sample-guide-deeplink-failure-context.json",
    attachmentName: "sample-guide-deeplink-failure-context",
  });
}

test("sample guide default route shows starter choices without sample state", async ({ page }, testInfo) => {
  try {
    await gotoApp(page, "/app/?view=guide", { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
    await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });

    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      status: "idle",
      sampleId: "",
      scenarioId: "",
    });

    const guideCard = page.locator("[data-sample-guide-helper]");
    await expect(guideCard).toBeVisible({ timeout: 30000 });
    await expect(guideCard).toHaveAttribute("data-sample-guide-status", "starter");
    await expect(page.locator("[data-sample-guide-title]")).toContainText(/Load a starter sample/i);
    await expect(page.locator("[data-sample-guide-recommendation]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-open-export]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-download-original]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-choices]")).toHaveAttribute("role", "group");
    await expect(page.locator("[data-sample-guide-choice]")).toHaveCount(5, { timeout: 30000 });
    await expect(page.locator("[data-sample-guide-choice*='hgo']")).toHaveCount(0);
  } catch (error) {
    await writeSampleGuideFailureArtifact(page, testInfo);
    throw error;
  }
});

test("@golden-demo sample guide card opens export from the TNO sample deeplink", async ({ page }, testInfo) => {
  const runtimeIssues = installGoldenRuntimeIssueTracker(page);
  const exportActionIssues = installExportActionIssueTracker(page);
  try {
    await gotoApp(page, "/app/?sample=tno-1962-atlantropa-briefing&view=guide", { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
    await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });

    // A fresh navigation starts with no imports. Default TNO startup can be idle
    // before the sample import begins; wait for that actual project operation.
    await waitForProjectImportCompletion(page, {
      initialImportStartCount: 0,
      initialImportApplyCount: 0,
      expectedFileName: "tno-1962-atlantropa-briefing.project.json",
    }, { timeout: 120000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      activeScenarioId: "tno_1962",
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
    });

    const guideCard = page.locator("[data-sample-guide-helper]");
    await expect(guideCard).toBeVisible({ timeout: 30000 });
    await expect(guideCard).toHaveAttribute("data-sample-guide-status", "success");
    await expect(page.locator("[data-sample-guide-title]")).toContainText(/TNO 1962 Atlantropa briefing/i);
    await expect(page.locator("[data-sample-guide-recommendation]")).toContainText(/Recommended export: 2x PNG briefing map/i);
    await expect(page.locator("[data-sample-guide-download-original]")).toHaveAttribute(
      "href",
      /\.\.\/assets\/sample-projects\/tno-1962-atlantropa-briefing\.project\.json$/,
    );

    const sampleChoices = page.locator("[data-sample-guide-choice]");
    await expect(sampleChoices).toHaveCount(5, { timeout: 30000 });
    await expect(page.locator("[data-sample-guide-choice='hgo-1936-atlas-preview']")).toHaveCount(0);
    await expect(page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.locator("[data-sample-guide-open-export]").click();
    await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#exportWorkbenchPanel")).toBeVisible();
    await expect(page.locator("[data-export-workbench-sample-context]")).toBeVisible();
    await expect(page.locator("[data-export-workbench-sample-title]")).toContainText(/Exporting sample: TNO 1962 Atlantropa briefing/i);
    await expect(page.locator("[data-export-workbench-sample-recommendation]")).toContainText(/Recommended: PNG · 2x · Composite image/i);
    const snapshotButton = page.locator("#exportWorkbenchSnapshotBtn");
    await expect(snapshotButton).toBeVisible();
    exportActionIssues.reset();
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
    await snapshotButton.click();
    const download = await downloadPromise;
    const snapshotSuccessToast = page
      .locator("#toastViewport .toast-message")
      .filter({ hasText: "Map snapshot downloaded." })
      .last();
    await expect(snapshotSuccessToast).toBeVisible();
    expect(download.suggestedFilename()).toBe("map_snapshot.png");
    expect(await download.failure()).toBeNull();
    const pngBuffer = await readDownloadBuffer(download);
    expect(pngBuffer.length).toBeGreaterThan(1024);
    expect(pngBuffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    await expect(snapshotSuccessToast).toBeHidden({ timeout: 10000 });
    expect(runtimeIssues.unexpectedIssues).toEqual([]);
    expect({
      pageErrors: [...exportActionIssues.pageErrors],
      actionableConsoleIssues: [...exportActionIssues.actionableConsoleIssues],
    }).toEqual({
      pageErrors: [],
      actionableConsoleIssues: [],
    });
    await page.locator("#exportWorkbenchCloseBtn").click();
    await expect(page.locator("#exportWorkbenchOverlay")).toBeHidden({ timeout: 30000 });
    await expectActiveElement(page, { id: /^(scenarioGuideBtn|utilitiesGuideBtn)$/ });
    await ensureGuideVisible(page);

    await page.locator("[data-sample-guide-choice='modern-world-japan-corridor']").click();
    await waitForScenarioApplyIdle(page, { scenarioId: "modern_world", timeout: 120000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      activeScenarioId: "modern_world",
      status: "success",
      sampleId: "modern-world-japan-corridor",
      scenarioId: "modern_world",
    });
    await expect(page).toHaveURL(/sample=modern-world-japan-corridor/);
    await expect(page).toHaveURL(/view=guide/);
    await expect(page.locator("[data-sample-guide-choice='modern-world-japan-corridor']")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expectActiveElement(page, { sampleChoice: "modern-world-japan-corridor" });

    await page.evaluate(async () => {
      const { markDirty } = await import("/js/core/dirty_state.js");
      markDirty("playwright-sample-switch-cancel");
    });
    await ensureGuideVisible(page);
    await page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']").click();
    const dirtyDialog = page.locator("[data-app-dialog-overlay='true']");
    await expect(dirtyDialog).toBeVisible({ timeout: 30000 });
    await expectStackingAboveGuide(page, "[data-app-dialog-overlay='true']");
    await expect(dirtyDialog.locator(".app-dialog-title")).toContainText(/Load another sample\?/i);
    await dirtyDialog.locator("[data-dialog-cancel='true']").click();
    await expect(dirtyDialog).toBeHidden({ timeout: 30000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      activeScenarioId: "modern_world",
      status: "success",
      sampleId: "modern-world-japan-corridor",
      scenarioId: "modern_world",
    });
    await expect(page).toHaveURL(/sample=modern-world-japan-corridor/);
    await expectActiveElement(page, { sampleChoice: "modern-world-japan-corridor" });

    await page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']").click();
    const confirmDialog = page.locator("[data-app-dialog-overlay='true']");
    await expect(confirmDialog).toBeVisible({ timeout: 30000 });
    await confirmDialog.locator("[data-dialog-confirm='true']").click();
    await waitForScenarioApplyIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      activeScenarioId: "tno_1962",
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
    });
    await expect(page).toHaveURL(/sample=tno-1962-atlantropa-briefing/);
    await expect(page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.locator("#scenarioStatus")).not.toContainText(
      /Detail topology not fully loaded/i,
    );
    await expectActiveElement(page, { sampleChoice: "tno-1962-atlantropa-briefing" });

    await page.keyboard.press("Escape");
    await expect(page.locator("#scenarioGuidePopover")).toBeHidden({ timeout: 30000 });
    await expectActiveElement(page, { id: /^(scenarioGuideBtn|utilitiesGuideBtn)$/ });
    expect(runtimeIssues.unexpectedIssues).toEqual([]);
  } catch (error) {
    await writeSampleGuideFailureArtifact(page, testInfo);
    throw error;
  }
});

test("sample guide remains usable across public mobile and desktop widths", async ({ page }, testInfo) => {
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await gotoApp(page, "/app/?sample=tno-1962-atlantropa-briefing&view=guide", { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
    await waitForScenarioApplyIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
    });

    for (const viewport of [
      { width: 375, height: 760 },
      { width: 768, height: 900 },
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await ensureGuideVisible(page);
      await expect(page.locator("[data-sample-guide-helper]")).toBeVisible({ timeout: 30000 });
      await expect(page.locator("[data-sample-guide-choice]")).toHaveCount(5, { timeout: 30000 });
      await expect(page.locator("[data-sample-guide-open-export]")).toBeVisible();
      await expectNoHorizontalOverflow(page, [
        "[data-sample-guide-helper]",
        "[data-sample-guide-choices]",
        "[data-sample-guide-choice]",
        ".scenario-guide-sample-card__actions",
      ]);

      await page.locator("[data-sample-guide-open-export]").click();
      await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible({ timeout: 30000 });
      await expect(page.locator("[data-export-workbench-sample-context]")).toBeVisible();
      await expectNoHorizontalOverflow(page, [
        "#exportWorkbenchPanel",
        "[data-export-workbench-sample-context]",
      ]);
      await expectExportWorkbenchLayoutReachable(page);
      await page.locator("#exportWorkbenchCloseBtn").click();
      await expect(page.locator("#exportWorkbenchOverlay")).toBeHidden({ timeout: 30000 });

      await ensureProjectPanelVisible(page);
      const sampleProjectBanner = page.locator("#sampleProjectBanner");
      await expect(sampleProjectBanner).toBeVisible({ timeout: 30000 });
      await expect(page.locator("#sampleProjectBannerOpenExportBtn")).toBeVisible();
      await expect(page.locator("#sampleProjectBannerDownloadOriginalLink")).toBeVisible();
      await expectNoHorizontalOverflow(page, [
        "#sampleProjectBanner",
        "#sampleProjectBannerOpenExportBtn",
        "#sampleProjectBannerDownloadOriginalLink",
      ]);
    }
  } catch (error) {
    await writeSampleGuideFailureArtifact(page, testInfo);
    throw error;
  }
});

test("sample guide and export context localize on the Chinese TNO path", async ({ page }, testInfo) => {
  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("map_lang", "zh");
    });
    await gotoApp(page, "/app/?sample=tno-1962-atlantropa-briefing&view=guide", { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
    await waitForScenarioApplyIdle(page, { scenarioId: "tno_1962", timeout: 120000 });
    await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });
    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      activeScenarioId: "tno_1962",
      currentLanguage: "zh",
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
    });

    await expect(page.locator("[data-sample-guide-title]")).toContainText(/示例已加载/);
    await expect(page.locator("[data-sample-guide-recommendation]")).toContainText(/推荐导出/);
    await expect(page.locator(".scenario-guide-sample-card__switcher-title")).toContainText(/公开起步示例/);
    await expect(page.locator("[data-sample-guide-open-export]")).toContainText(/打开导出/);
    await expect(page.locator("[data-sample-guide-choice]")).toHaveCount(5, { timeout: 30000 });
    await expect(page.locator("[data-sample-guide-choice*='hgo']")).toHaveCount(0);

    await page.locator("[data-sample-guide-open-export]").click();
    await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("[data-export-workbench-sample-context]")).toBeVisible();
    await expect(page.locator("[data-export-workbench-sample-title]")).toContainText(/正在导出示例/);
    await expect(page.locator("[data-export-workbench-sample-recommendation]")).toContainText(/推荐/);
  } catch (error) {
    await writeSampleGuideFailureArtifact(page, testInfo);
    throw error;
  }
});

test("sample guide card shows a non-fatal error for a bad sample deeplink", async ({ page }, testInfo) => {
  try {
    await gotoApp(page, "/app/?sample=not-a-real-sample&view=guide", { waitUntil: "domcontentloaded" });
    await waitForShellReady(page, { timeout: 120000 });
    await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });

    await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
      status: "error",
      sampleId: "not-a-real-sample",
      errorCode: "unknown-sample-id",
    });

    const guideCard = page.locator("[data-sample-guide-helper]");
    await expect(guideCard).toBeVisible({ timeout: 30000 });
    await expect(guideCard).toHaveAttribute("data-sample-guide-status", "error");
    await expect(page.locator("[data-sample-guide-title]")).toContainText(/Sample unavailable/i);
    await expect(guideCard).toContainText(/not in the public sample list/i);
    await expect(page.locator("[data-sample-guide-recommendation]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-open-export]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-download-original]")).toBeHidden();
    await expect(page.locator("[data-sample-guide-continue]")).toBeVisible();

    await page.locator("[data-sample-guide-continue]").click();
    await expect(page.locator("#scenarioGuideSectionQuick")).toBeVisible();
    await expect(page.locator("#scenarioGuideStepApply")).toBeVisible();
  } catch (error) {
    await writeSampleGuideFailureArtifact(page, testInfo);
    throw error;
  }
});
