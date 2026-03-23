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
  const baseUrl = resolveBaseUrl();
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

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
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
    const panelRect = tabPanel?.getBoundingClientRect?.();
    const stackRect = stack?.getBoundingClientRect?.();
    const frontlineRect = frontlineCard?.getBoundingClientRect?.();
    const strategicRect = strategicCard?.getBoundingClientRect?.();
    const stackStyle = stack ? globalThis.getComputedStyle(stack) : null;
    return {
      stackPaddingLeft: Number.parseFloat(stackStyle?.paddingLeft || "0") || 0,
      stackGap: Number.parseFloat(stackStyle?.rowGap || stackStyle?.gap || "0") || 0,
      frontlineInset: panelRect && frontlineRect ? frontlineRect.left - panelRect.left : 0,
      strategicInset: panelRect && strategicRect ? strategicRect.left - panelRect.left : 0,
      stackInset: panelRect && stackRect ? stackRect.left - panelRect.left : 0,
      workbenchBlockCount: document.querySelectorAll("#strategicOverlayPanel .frontline-workbench-block").length,
      styleChoiceCount: document.querySelectorAll("[data-frontline-style-choice]").length,
    };
  });

  expect(frontlineLayout.stackPaddingLeft > 0 || frontlineLayout.stackInset >= 8).toBeTruthy();
  expect(frontlineLayout.frontlineInset).toBeGreaterThanOrEqual(0);
  expect(frontlineLayout.strategicInset).toBeGreaterThanOrEqual(0);
  expect(frontlineLayout.stackGap).toBeGreaterThan(0);
  expect(frontlineLayout.workbenchBlockCount).toBe(2);
  expect(frontlineLayout.styleChoiceCount).toBe(3);

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
