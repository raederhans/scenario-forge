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

const BASE_URL = resolveBaseUrl();

async function waitForProjectUiReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return typeof state.renderCountryListFn === "function"
      && !!scenarioSelect
      && !!scenarioSelect.querySelector('option[value="tno_1962"]');
  }, { timeout: 120000 });
}

async function applyScenario(page, scenarioId) {
  await page.evaluate(async (expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const { applyScenarioById } = await import("/js/core/scenario_manager.js");
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await applyScenarioById(expectedScenarioId, {
          renderNow: true,
          markDirtyReason: "playwright-apply-scenario",
          showToastOnComplete: false,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (lastError) {
      throw lastError;
    }
  }, scenarioId);
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId;
  }, scenarioId, { timeout: 120000 });
}

test("strategic frontline overlay reacts to controller changes", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
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

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await waitForProjectUiReady(page);
  await applyScenario(page, "tno_1962");

  const splitFeature = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const splitEntry = Object.entries(state.scenarioBaselineControllersByFeatureId || {}).find(([featureId, controller]) => {
      const owner = state.scenarioBaselineOwnersByFeatureId?.[featureId];
      return owner && controller && owner !== controller;
    });
    if (!splitEntry) return null;
    const [featureId, baselineController] = splitEntry;
    return {
      featureId,
      baselineOwner: String(state.scenarioBaselineOwnersByFeatureId?.[featureId] || ""),
      baselineController: String(baselineController || ""),
    };
  });

  expect(splitFeature).not.toBeNull();
  expect(splitFeature.baselineOwner).not.toBe(splitFeature.baselineController);

  await page.locator("#inspectorSidebarTabFrontline").click();
  await expect(page.locator("#frontlineSidebarPanel #frontlineOverlayPanel")).toBeVisible();
  await expect(page.locator("#frontlineSidebarPanel #strategicOverlayPanel")).toBeVisible();
  await expect(page.locator("#inspectorSidebarPanel #strategicOverlayPanel")).toHaveCount(0);
  await expect(page.locator("#projectLegendStack #strategicOverlayPanel")).toHaveCount(0);
  await expect(page.locator("#frontlineEmptyState")).toBeVisible();
  await expect(page.locator("#frontlineEnabledToggle")).not.toBeChecked();

  const frontlineLayout = await page.evaluate(() => {
    const tabPanel = document.querySelector("#frontlineSidebarPanel");
    const stack = document.querySelector("#frontlineTabStack");
    const frontlineCard = document.querySelector("#frontlineOverlayPanel");
    const strategicCard = document.querySelector("#strategicOverlayPanel");
    const counterPreview = document.querySelector("#unitCounterPreviewCard");
    const detailDrawer = document.querySelector("#unitCounterDetailDrawer");
    const panelRect = tabPanel?.getBoundingClientRect?.();
    const stackRect = stack?.getBoundingClientRect?.();
    const frontlineRect = frontlineCard?.getBoundingClientRect?.();
    const strategicRect = strategicCard?.getBoundingClientRect?.();
    const previewRect = counterPreview?.getBoundingClientRect?.();
    const stackStyle = stack ? globalThis.getComputedStyle(stack) : null;
    return {
      stackPaddingLeft: Number.parseFloat(stackStyle?.paddingLeft || "0") || 0,
      stackGap: Number.parseFloat(stackStyle?.rowGap || stackStyle?.gap || "0") || 0,
      frontlineInset: panelRect && frontlineRect ? frontlineRect.left - panelRect.left : 0,
      strategicInset: panelRect && strategicRect ? strategicRect.left - panelRect.left : 0,
      stackInset: panelRect && stackRect ? stackRect.left - panelRect.left : 0,
      workbenchBlockCount: document.querySelectorAll("#strategicOverlayPanel .frontline-workbench-block").length,
      commandBarButtonCount: document.querySelectorAll("#strategicCommandBar .strategic-command-btn").length,
      styleChoiceCount: document.querySelectorAll("[data-frontline-style-choice]").length,
      counterPreviewWidth: previewRect?.width || 0,
      counterPreviewHeight: previewRect?.height || 0,
      detailDrawerHidden: detailDrawer?.classList.contains("hidden") ?? null,
      counterStatPresetCount: document.querySelectorAll("[data-unit-counter-stats-preset-choice]").length,
      bodyFrontlineModeActive: document.body.classList.contains("frontline-mode-active"),
      bottomDockDisplay: globalThis.getComputedStyle(document.querySelector("#bottomDock")).display,
      commandBarDisplay: globalThis.getComputedStyle(document.querySelector("#strategicCommandBar")).display,
    };
  });

  expect(frontlineLayout.stackPaddingLeft > 0 || frontlineLayout.stackInset >= 8).toBeTruthy();
  expect(frontlineLayout.frontlineInset).toBeGreaterThanOrEqual(0);
  expect(frontlineLayout.strategicInset).toBeGreaterThanOrEqual(0);
  expect(frontlineLayout.stackGap).toBeGreaterThan(0);
  expect(frontlineLayout.workbenchBlockCount).toBe(3);
  expect(frontlineLayout.commandBarButtonCount).toBe(4);
  expect(frontlineLayout.styleChoiceCount).toBe(3);
  expect(frontlineLayout.detailDrawerHidden).toBeTruthy();
  expect(frontlineLayout.counterStatPresetCount).toBe(5);
  expect(frontlineLayout.bodyFrontlineModeActive).toBeTruthy();
  expect(frontlineLayout.bottomDockDisplay).toBe("none");
  expect(frontlineLayout.commandBarDisplay).toBe("flex");

  await expect(page.locator("#accordionLines")).toBeVisible();
  await expect(page.locator("#accordionGraphics")).toBeVisible();
  await expect(page.locator("#accordionCounters")).toBeVisible();
  await expect(page.locator("#accordionLines .strategic-accordion-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#accordionGraphics .strategic-accordion-header")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#accordionCounters .strategic-accordion-header")).toHaveAttribute("aria-expanded", "false");

  await page.locator("#accordionGraphics .strategic-accordion-header").click();
  await page.locator("#accordionCounters .strategic-accordion-header").click();
  await expect(page.locator("#accordionLines .strategic-accordion-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#accordionGraphics .strategic-accordion-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#accordionCounters .strategic-accordion-header")).toHaveAttribute("aria-expanded", "true");
  const expandedPreviewBox = await page.locator("#unitCounterPreviewCard").boundingBox();
  expect(expandedPreviewBox?.width || 0).toBeGreaterThan(60);
  expect(expandedPreviewBox?.width || 0).toBeLessThan(420);
  expect(expandedPreviewBox?.height || 0).toBeLessThan(280);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.operationalLines = [{ id: "spec-line", kind: "frontline", label: "Spec Line" }];
    state.operationGraphics = [{ id: "spec-graphic", kind: "attack", label: "Spec Graphic" }];
    state.unitCounters = [{
      id: "spec-counter",
      label: "Spec Counter",
      nationTag: "USA",
      presetId: "INF",
      renderer: "game",
      echelon: "DIV",
    }];
    state.updateStrategicOverlayUIFn?.();
  });
  await expect(page.locator("#accordionLines .strategic-accordion-badge")).toHaveText("1");
  await expect(page.locator("#accordionGraphics .strategic-accordion-badge")).toHaveText("1");
  await expect(page.locator("#accordionCounters .strategic-accordion-badge")).toHaveText("1");

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.operationalLines = [];
    state.operationGraphics = [];
    state.unitCounters = [];
    state.updateStrategicOverlayUIFn?.();
  });
  await expect(page.locator("#accordionLines .strategic-accordion-badge")).toHaveText("0");
  await expect(page.locator("#accordionGraphics .strategic-accordion-badge")).toHaveText("0");
  await expect(page.locator("#accordionCounters .strategic-accordion-badge")).toHaveText("0");

  await page.locator("#accordionLines .strategic-accordion-header").click();
  await page.locator("#accordionGraphics .strategic-accordion-header").click();
  await expect(page.locator("#accordionLines .strategic-accordion-header")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#accordionGraphics .strategic-accordion-header")).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.strategicOverlayUi = {
      ...(state.strategicOverlayUi || {}),
      modalSection: "line",
      modalEntityType: "",
    };
    state.updateStrategicOverlayUIFn?.();
  });

  await page.locator("#strategicOverlayOpenWorkspaceBtn").click();
  await expect(page.locator("#strategicOverlayIconCloseBtn")).toBeVisible();
  await page.waitForFunction(() => document.body.classList.contains("strategic-workspace-open"));
  const workspaceLineSnapshot = await page.evaluate(() => {
    const isActuallyVisible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    return {
      accordionHeaderDisplay: globalThis.getComputedStyle(document.querySelector("#accordionLines .strategic-accordion-header")).display,
      linesBodyVisible: isActuallyVisible("#accordionLines > .strategic-accordion-body"),
      graphicsBodyVisible: isActuallyVisible("#accordionGraphics > .strategic-accordion-body"),
      countersBodyVisible: isActuallyVisible("#accordionCounters > .strategic-accordion-body"),
      lineSelectVisible: isActuallyVisible("#operationalLineKindSelect"),
      graphicSelectVisible: isActuallyVisible("#operationGraphicKindSelect"),
      counterEditorVisible: isActuallyVisible("#unitCounterEditorShell"),
      panelParentId: document.querySelector("#strategicOverlayPanel")?.parentElement?.id || "",
    };
  });
  expect(workspaceLineSnapshot.accordionHeaderDisplay).toBe("none");
  expect(workspaceLineSnapshot.linesBodyVisible).toBeTruthy();
  expect(workspaceLineSnapshot.graphicsBodyVisible).toBeTruthy();
  expect(workspaceLineSnapshot.countersBodyVisible).toBeFalsy();
  expect(workspaceLineSnapshot.lineSelectVisible).toBeTruthy();
  expect(workspaceLineSnapshot.graphicSelectVisible).toBeTruthy();
  expect(workspaceLineSnapshot.counterEditorVisible).toBeFalsy();
  expect(workspaceLineSnapshot.panelParentId).toBe("frontlineTabStack");
  await page.locator("#strategicOverlayIconCloseBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("strategic-workspace-open"));
  await page.waitForFunction(() => !!document.querySelector("#frontlineTabStack > #strategicOverlayPanel"));

  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeHidden();
  await page.locator("#unitCounterDetailToggleBtn").click();
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeVisible();
  await expect(page.locator("#unitCounterEditorModal")).toBeVisible();
  await expect(page.locator("#unitCounterDetailPreviewCard")).toBeVisible();
  await expect(page.locator("#unitCounterIdentityGroup")).toBeVisible();
  await expect(page.locator("#unitCounterCombatGroup")).toBeVisible();
  await expect(page.locator("#unitCounterFinishGroup")).toBeVisible();
  const counterModalSnapshot = await page.evaluate(() => {
    const modal = document.querySelector("#unitCounterEditorModal");
    const modalRect = modal?.getBoundingClientRect?.();
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    return {
      bodyModalOpen: document.body.classList.contains("counter-editor-modal-open"),
      modalWidth: modalRect?.width || 0,
      modalHeight: modalRect?.height || 0,
      modalCenterDeltaX: modalRect ? Math.abs((modalRect.left + modalRect.right) / 2 - viewportWidth / 2) : 999,
      modalCenterDeltaY: modalRect ? Math.abs((modalRect.top + modalRect.bottom) / 2 - viewportHeight / 2) : 999,
      activeElementId: document.activeElement?.id || "",
    };
  });
  expect(counterModalSnapshot.bodyModalOpen).toBeTruthy();
  expect(counterModalSnapshot.modalWidth).toBeGreaterThan(680);
  expect(counterModalSnapshot.modalHeight).toBeGreaterThan(360);
  expect(counterModalSnapshot.modalCenterDeltaX).toBeLessThan(20);
  expect(counterModalSnapshot.modalCenterDeltaY).toBeLessThan(20);
  expect(counterModalSnapshot.activeElementId).toBe("unitCounterCatalogSearchInput");
  await page.keyboard.press("Escape");
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeHidden();
  await expect(page.locator("#unitCounterDetailToggleBtn")).toBeFocused();

  await page.locator("#strategicOverlayOpenWorkspaceBtn").click();
  await expect(page.locator("#strategicOverlayIconCloseBtn")).toBeVisible();
  await page.waitForFunction(() => document.body.classList.contains("strategic-workspace-open"));
  const workspaceLineModalSnapshot = await page.evaluate(() => {
    const isActuallyVisible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const modal = document.querySelector("#strategicOverlayPanel");
    const modalRect = modal?.getBoundingClientRect?.();
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;
    const closeRow = document.querySelector("#strategicOverlayPanel .strategic-workspace-actions");
    const title = document.querySelector("#strategicOverlayPanel .strategic-workspace-header .sidebar-tool-title");
    const header = document.querySelector("#strategicOverlayPanel .strategic-workspace-header");
    return {
      commandBarDisplay: globalThis.getComputedStyle(document.querySelector("#strategicCommandBar")).display,
      backdropPointerEvents: globalThis.getComputedStyle(document.querySelector("#strategicWorkspaceBackdrop")).pointerEvents,
      backdropFilter: globalThis.getComputedStyle(document.querySelector("#strategicWorkspaceBackdrop")).backdropFilter,
      bodyVisualMode: document.body.classList.contains("strategic-workspace-visual-mode"),
      modalWidth: modalRect?.width || 0,
      modalHeight: modalRect?.height || 0,
      modalLeft: modalRect?.left || 0,
      modalTop: modalRect?.top || 0,
      modalRightMargin: modalRect ? viewportWidth - modalRect.right : 0,
      modalBottomMargin: modalRect ? viewportHeight - modalRect.bottom : 0,
      modalCenterDeltaX: modalRect ? Math.abs((modalRect.left + modalRect.right) / 2 - viewportWidth / 2) : 999,
      modalCenterDeltaY: modalRect ? Math.abs((modalRect.top + modalRect.bottom) / 2 - viewportHeight / 2) : 999,
      headerHeight: header?.getBoundingClientRect?.().height || 0,
      titleWidth: title?.getBoundingClientRect?.().width || 0,
      closeRowDisplay: closeRow ? globalThis.getComputedStyle(closeRow).display : "",
      lineBodyVisible: isActuallyVisible("#accordionLines > .strategic-accordion-body"),
      graphicsBodyVisible: isActuallyVisible("#accordionGraphics > .strategic-accordion-body"),
      counterBodyVisible: isActuallyVisible("#accordionCounters > .strategic-accordion-body"),
      counterEditorVisible: isActuallyVisible("#unitCounterEditorShell"),
      counterModalVisible: isActuallyVisible("#unitCounterEditorModalOverlay"),
      panelParentId: modal?.parentElement?.id || "",
    };
  });
  expect(workspaceLineModalSnapshot.commandBarDisplay).toBe("none");
  expect(workspaceLineModalSnapshot.backdropPointerEvents).toBe("none");
  expect(workspaceLineModalSnapshot.backdropFilter).toContain("blur");
  expect(workspaceLineModalSnapshot.bodyVisualMode).toBeTruthy();
  expect(workspaceLineModalSnapshot.modalWidth).toBeGreaterThan(600);
  expect(workspaceLineModalSnapshot.modalLeft).toBeGreaterThan(24);
  expect(workspaceLineModalSnapshot.modalTop).toBeGreaterThan(24);
  expect(workspaceLineModalSnapshot.modalRightMargin).toBeGreaterThan(24);
  expect(workspaceLineModalSnapshot.modalBottomMargin).toBeGreaterThan(24);
  expect(workspaceLineModalSnapshot.modalCenterDeltaX).toBeLessThan(20);
  expect(workspaceLineModalSnapshot.modalCenterDeltaY).toBeLessThan(20);
  expect(workspaceLineModalSnapshot.headerHeight).toBeLessThan(140);
  expect(workspaceLineModalSnapshot.titleWidth).toBeGreaterThan(100);
  expect(workspaceLineModalSnapshot.closeRowDisplay).toBe("none");
  expect(workspaceLineModalSnapshot.lineBodyVisible).toBeTruthy();
  expect(workspaceLineModalSnapshot.graphicsBodyVisible).toBeTruthy();
  expect(workspaceLineModalSnapshot.counterBodyVisible).toBeFalsy();
  expect(workspaceLineModalSnapshot.counterEditorVisible).toBeFalsy();
  expect(workspaceLineModalSnapshot.counterModalVisible).toBeFalsy();
  expect(workspaceLineModalSnapshot.panelParentId).toBe("frontlineTabStack");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("strategic-workspace-open"));
  await page.waitForFunction(() => !!document.querySelector("#frontlineTabStack > #strategicOverlayPanel"));

  const initialSnapshot = await page.evaluate(() => ({
    pathCount: document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length,
    firstPath: document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "",
  }));

  expect(initialSnapshot.pathCount).toBe(0);
  expect(initialSnapshot.firstPath).toBe("");

  await page.waitForFunction(() => document.querySelector("#frontlineEnabledToggle")?.dataset.bound === "true");
  await page.locator("#frontlineEnabledToggle").check();
  await page.waitForFunction(() => document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length > 0);

  const enabledSnapshot = await page.evaluate(() => ({
    pathCount: document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length,
    firstPath: document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "",
    labelCount: document.querySelectorAll(".frontline-overlay-layer text.frontline-label").length,
  }));

  expect(enabledSnapshot.pathCount).toBeGreaterThan(0);
  expect(enabledSnapshot.firstPath.length).toBeGreaterThan(0);
  expect(enabledSnapshot.labelCount).toBe(0);

  await page.evaluate(async ({ featureId, baselineOwner }) => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.scenarioControllersByFeatureId = state.scenarioControllersByFeatureId || {};
    state.scenarioControllersByFeatureId[featureId] = baselineOwner;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    render();
  }, splitFeature);

  await page.waitForFunction((previousPath) => {
    const currentPath = document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "";
    return !!currentPath && currentPath !== previousPath;
  }, enabledSnapshot.firstPath);

  const updatedSnapshot = await page.evaluate(() => ({
    pathCount: document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length,
    firstPath: document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "",
  }));
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !String(message || "").includes("ERR_CONNECTION_REFUSED"));
  const unexpectedNetworkFailures = networkFailures.filter((failure) => !String(failure?.errorText || "").includes("ERR_CONNECTION_REFUSED"));

  expect(updatedSnapshot.pathCount).toBeGreaterThan(0);
  expect(updatedSnapshot.firstPath).not.toBe(enabledSnapshot.firstPath);
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(unexpectedNetworkFailures).toEqual([]);
});
