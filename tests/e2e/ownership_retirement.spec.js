const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

test("ownership editing stays disabled in editor and developer workspace", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/?ui_shell=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#workspaceExportBtn")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#bootOverlay")).toBeHidden();
  await expect(page.locator("#paintModeVisualBtn")).toBeVisible();
  await expect(page.locator("#paintModePoliticalBtn")).toBeHidden();
  await expect(page.locator("#paintModePoliticalBtn")).toBeDisabled();
  await expect(page.locator("#countryInspectorSetActive")).toBeHidden();
  await expect(page.getByRole("button", { name: "Return to Political Ownership Brush", exact: true })).toHaveCount(0);
  await expect(page.locator(".scenario-visual-adjustments").first()).toBeVisible();

  const outcome = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { state } = await load("./js/core/state.js");
    const actions = await load("./js/core/state/actions/scenario_presentation_actions.js");
    const { setFeatureOwnerCode } = await load("./js/core/sovereignty_manager.js");
    const { applyOwnerToFeatureIds } = await load("./js/core/scenario_ownership_editor.js");
    const before = JSON.stringify(state.sovereigntyByFeatureId);
    actions.restoreProjectImportFields(state, { paintMode: "sovereignty" });
    state.updatePaintModeUIFn?.();
    return {
      mode: state.paintMode,
      changed: setFeatureOwnerCode("ui-shell-test", "GER"),
      result: applyOwnerToFeatureIds(["ui-shell-test"], "GER"),
      referenceUnchanged: JSON.stringify(state.sovereigntyByFeatureId) === before,
    };
  });
  expect(outcome.mode).toBe("visual");
  expect(outcome.changed).toBe(false);
  expect(outcome.result.reason).toBe("ownership-editing-disabled");
  expect(outcome.referenceUnchanged).toBe(true);

  await page.locator("#developerModeBtn").click();
  await expect(page.locator("#devWorkspacePanel")).toBeVisible();
  for (const id of ["devQuickOwnerInput", "devQuickUseTagBtn", "devQuickApplyOwnerBtn", "devQuickResetOwnerBtn", "devQuickSaveOwnersBtn"]) {
    await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator("#devScenarioOwnershipPanel")).toBeHidden();
  await expect(page.locator("#devScenarioTagCreatorPanel")).toBeHidden();
  await expect(page.locator("#devQuickRemoveSelectedBtn")).toBeVisible();
  expect(errors).toEqual([]);
});
