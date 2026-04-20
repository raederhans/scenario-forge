const { test, expect } = require("@playwright/test");
const {
  applyScenarioAndWaitIdle,
  gotoApp,
  openProjectFrontlineSection,
  primeStateRef,
  waitForAppInteractive,
  waitForScenarioSelectReady,
} = require("./support/playwright-app");

async function getSplitFeature(page) {
  return page.evaluate(async () => {
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

  await gotoApp(page, undefined, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });
  await primeStateRef(page);
  await waitForScenarioSelectReady(page, { scenarioId: "tno_1962", timeout: 120000 });
  await applyScenarioAndWaitIdle(page, "tno_1962", { timeout: 120000 });
  await openProjectFrontlineSection(page, { timeout: 30000 });

  const splitFeature = await getSplitFeature(page);
  expect(splitFeature).not.toBeNull();
  expect(splitFeature.baselineOwner).not.toBe(splitFeature.baselineController);

  await expect(page.locator("#frontlineProjectSection #frontlineOverlayPanel")).toBeVisible();
  await expect(page.locator("#frontlineProjectSection #strategicOverlayPanel")).toBeVisible();
  await expect(page.locator("#frontlineEnabledToggle")).not.toBeChecked();

  const initialSnapshot = await page.evaluate(() => ({
    pathCount: document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length,
    firstPath: document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "",
  }));
  expect(initialSnapshot.pathCount).toBe(0);
  expect(initialSnapshot.firstPath).toBe("");

  await page.waitForFunction(() => document.querySelector("#frontlineEnabledToggle")?.dataset.bound === "true");
  await page.locator("#frontlineEnabledToggle").evaluate((node) => {
    node.checked = true;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length > 0);

  const enabledSnapshot = await page.evaluate(() => ({
    pathCount: document.querySelectorAll(".frontline-overlay-layer path.frontline-path").length,
    firstPath: document.querySelector(".frontline-overlay-layer path.frontline-path")?.getAttribute("d") || "",
  }));
  expect(enabledSnapshot.pathCount).toBeGreaterThan(0);
  expect(enabledSnapshot.firstPath.length).toBeGreaterThan(0);

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
