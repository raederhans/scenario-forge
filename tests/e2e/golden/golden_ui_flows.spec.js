// Golden UI flows: the panels the UI rewrite will move (appearance tabs, transport,
// special zones, export, language, inspector, command palette). Like golden_flows,
// they use only the DOM and window.__scenarioForgeTestApi; see golden-support.js.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const {
  chooseStyledOption,
  collectPageErrors,
  colorShareAround,
  colorShareInPng,
  fillAt,
  openApp,
  parkMouse,
  pixelChangeShare,
  readStatus,
  saveProjectFile,
  screenPoint,
  selectFillTool,
  snapshotAround,
  waitForSettled,
  zoomTo,
} = require("./golden-support");

const FILL = "#e31ac4";
const FILLED = 0.35;
const UNFILLED = 0.05;
// Open South Pacific: ocean in every scenario, far from land, labels and routes.
const OCEAN_LON_LAT = [-130, -40];
// Central Germany: dense road network in the germany_road transport pack.
const GERMANY_LON_LAT = [10.2, 50.8];

const testApi = (page, method) => page.evaluate((name) => globalThis.__scenarioForgeTestApi[name](), method);

async function openLayersTask(page) {
  await page.locator("#editorTaskLayersBtn").click();
  await expect(page.locator("#editorTaskLayersBtn")).toHaveAttribute("aria-pressed", "true");
}

// Select the country under `point` with the default select tool, as a user would.
async function selectCountryAt(page, point) {
  await page.mouse.click(point.x, point.y);
  await parkMouse(page);
  await expect.poll(async () => (await testApi(page, "selection")).selectedInspectorCountryCode).toBeTruthy();
  await waitForSettled(page);
}

async function downloadExport(page, testInfo, name) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("#exportWorkbenchSnapshotBtn").click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const pngPath = testInfo.outputPath(name);
  await download.saveAs(pngPath);
  const bytes = fs.readFileSync(pngPath);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return bytes;
}

// Whether any page of the legend editor (Layers > Legend) lists `hex`.
async function legendHasColor(page, hex) {
  const legend = page.locator("#editorProperty-legend");
  await expect(legend.getByRole("textbox").first()).toBeVisible();
  const previous = legend.getByRole("button", { name: "Previous page" });
  const next = legend.getByRole("button", { name: "Next page" });
  while (await previous.isVisible() && await previous.isEnabled()) await previous.click();
  const entry = legend.getByRole("textbox", { name: new RegExp(`^Legend \\d+: ${hex}$`, "i") });
  for (;;) {
    if (await entry.count()) return true;
    if (!(await next.isVisible()) || !(await next.isEnabled())) return false;
    await next.click();
  }
}

async function settledShare(page, read) {
  await waitForSettled(page);
  return read();
}

test("appearance: switching layer tabs shows their settings and a style change repaints the map", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await openLayersTask(page);

  const bordersTab = page.locator("#appearanceTabBorders");
  const oceanTab = page.locator("#mapContentTabOcean");
  await bordersTab.click();
  await expect(bordersTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#oceanFillColor")).toBeHidden();
  await oceanTab.click();
  await expect(oceanTab).toHaveAttribute("aria-selected", "true");
  await expect(bordersTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#oceanFillColor")).toBeVisible();

  const point = await screenPoint(page, OCEAN_LON_LAT);
  await parkMouse(page);
  await waitForSettled(page);
  const before = await snapshotAround(page, point, { radius: 12 });
  await page.locator("#oceanFillColor").fill("#ff00ff");
  await expect.poll(async () => settledShare(page, async () => pixelChangeShare(page, before, await snapshotAround(page, point, { radius: 12 }))), {
    timeout: 30_000,
    message: "ocean fill change did not repaint the ocean",
  }).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});

test("transport: a country pack applied from the workbench turns its family on, and the family toggle hides and shows it on the map", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await openLayersTask(page);
  await page.locator("#appearanceTabTransport").click();
  const roadToggle = page.locator("#toggleRoad");
  await expect(roadToggle).not.toBeChecked();

  await page.locator("#scenarioTransportWorkbenchBtn").click();
  const workbench = page.locator("#transportWorkbenchOverlay");
  await expect(workbench).toBeVisible();
  await page.locator("#transportWorkbenchFamilyTabRoad").click();
  await expect(page.locator("#transportWorkbenchFamilyTabRoad")).toHaveAttribute("aria-selected", "true");
  await chooseStyledOption(page, page.locator("#transportWorkbenchPackSelectAppSelectButton"), "germany_road");
  const apply = page.locator("#transportWorkbenchApplyBtn");
  await expect(apply).toBeEnabled({ timeout: 60_000 });
  await apply.click();
  await page.locator("#transportWorkbenchCloseBtn").click();
  await expect(workbench).toBeHidden();
  await expect(roadToggle).toBeChecked({ timeout: 90_000 });

  // Closing the workbench resets the view, so zoom in only after it is closed.
  const point = await zoomTo(page, GERMANY_LON_LAT, { steps: 3 });
  const snapshot = () => snapshotAround(page, point, { radius: 60 });
  const withRoads = await settledShare(page, snapshot);
  await page.locator("#transportRoadCard").click();
  await roadToggle.uncheck();
  await parkMouse(page);
  await expect.poll(async () => settledShare(page, async () => pixelChangeShare(page, withRoads, await snapshot())), {
    timeout: 30_000,
    message: "roads are still drawn after hiding the road family",
  }).toBeGreaterThan(0.05);
  await roadToggle.check();
  await parkMouse(page);
  await expect.poll(async () => settledShare(page, async () => pixelChangeShare(page, withRoads, await snapshot())), {
    timeout: 30_000,
    message: "roads did not come back after showing the road family",
  }).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test("special zones: a new region with a member shows on the map and survives save and reopen", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  const point = await zoomTo(page);
  expect(await colorShareAround(page, point, FILL)).toBeLessThan(UNFILLED);
  await selectCountryAt(page, point);

  await openLayersTask(page);
  await page.locator("#editorLayer-special-zones").click();
  const panel = page.locator("#editorProperty-special-zones");
  await panel.getByRole("button", { name: "New region", exact: true }).click();
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await panel.getByRole("button", { name: "Add selected country", exact: true }).click();
  await panel.getByLabel("Fill", { exact: true }).fill(FILL);
  await panel.getByLabel("Opacity", { exact: true }).fill("100");
  await panel.getByRole("radio", { name: "Solid", exact: true }).click();
  await panel.getByLabel("Show special zones overlay").check();
  await parkMouse(page);
  await expect.poll(async () => settledShare(page, () => colorShareAround(page, point, FILL)), {
    timeout: 30_000,
    message: "new special zone is not drawn",
  }).toBeGreaterThan(FILLED);

  const savePath = await saveProjectFile(page, testInfo.outputPath("golden-special-zone.project.json"));
  await openApp(page);
  const scenarioId = (await readStatus(page)).scenarioId;
  expect(await colorShareAround(page, await zoomTo(page), FILL)).toBeLessThan(UNFILLED);
  await page.locator("#projectFileInput").setInputFiles(savePath);
  await waitForSettled(page, { scenarioId });
  await parkMouse(page);
  const reopened = await screenPoint(page);
  await expect.poll(async () => settledShare(page, () => colorShareAround(page, reopened, FILL)), {
    timeout: 60_000,
    message: "special zone is gone after reopening the project",
  }).toBeGreaterThan(FILLED);
  expect(errors).toEqual([]);
});

test("export workbench: hiding a layer leaves it out of the exported image", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  const point = await zoomTo(page);
  await selectFillTool(page, FILL);
  expect((await fillAt(page, point)).length).toBeGreaterThan(0);

  await page.locator("#workspaceExportBtn").click();
  await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible();
  await page.locator("#exportWorkbenchAdvancedBtn").click();
  const politicalVisible = page.locator("#exportWorkbenchMainLayerList [data-export-layer-id='political']").getByRole("checkbox");
  await expect(politicalVisible).toBeChecked();

  const withPolitical = await downloadExport(page, testInfo, "golden-export-with-political.png");
  expect(await colorShareInPng(page, withPolitical, FILL), "painted region missing from the export").toBeGreaterThan(0.0005);

  await politicalVisible.uncheck();
  const withoutPolitical = await downloadExport(page, testInfo, "golden-export-without-political.png");
  expect(await colorShareInPng(page, withoutPolitical, FILL), "hidden political layer is still exported").toBeLessThan(0.00005);
  expect(errors).toEqual([]);
});

test("language: switching updates the top bar, both sidebars and the transport workbench, and switching back restores them", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await openLayersTask(page);
  await page.locator("#appearanceTabTransport").click();
  const shell = {
    topBar: page.locator("#workspaceExportBtn"),
    leftSidebar: page.locator("#editorTaskLayersBtn"),
    rightSidebar: page.locator("#editorSegmentInspector"),
    layerPanel: page.locator("#scenarioTransportWorkbenchBtn"),
  };
  const workbench = {
    familyTab: page.locator("#transportWorkbenchFamilyTabRoad"),
    applyButton: page.locator("#transportWorkbenchApplyBtn"),
  };
  const readTexts = async (surfaces) => Object.fromEntries(await Promise.all(
    Object.entries(surfaces).map(async ([key, locator]) => [key, (await locator.innerText()).trim()]),
  ));
  // The workbench is modal (it covers the language button), so read it by opening it.
  const read = async () => {
    await page.locator("#scenarioTransportWorkbenchBtn").click();
    await expect(page.locator("#transportWorkbenchOverlay")).toBeVisible();
    const texts = { ...await readTexts(shell), ...await readTexts(workbench) };
    await page.locator("#transportWorkbenchCloseBtn").click();
    await expect(page.locator("#transportWorkbenchOverlay")).toBeHidden();
    return texts;
  };

  const english = await read();
  for (const text of Object.values(english)) expect(text).toMatch(/[A-Za-z]/);

  const language = page.locator("#btnToggleLang");
  const englishShell = await readTexts(shell);
  await language.click();
  await expect.poll(() => readTexts(shell)).not.toEqual(englishShell);
  const chinese = await read();
  for (const [key, text] of Object.entries(chinese)) {
    expect(text, `${key} is not translated`).toMatch(/[一-鿿]/);
    expect(text, `${key} did not change`).not.toBe(english[key]);
  }

  await language.click();
  await expect.poll(() => readTexts(shell)).toEqual(englishShell);
  expect(await read()).toEqual(english);
  expect(errors).toEqual([]);
});

// The blank base map leaves most countries uncolored and its legend short, so a color
// picked in the inspector and painted onto the selected country shows in both.
test("inspector: a palette color picked for the selected country paints the map and joins the legend", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectPageErrors(page);
  await openApp(page, { scenarioId: "blank_base" });
  const point = await zoomTo(page, undefined, { scenarioId: "blank_base" });
  await selectCountryAt(page, point);

  const inspector = page.locator("#rightSidebar");
  const suggestions = inspector.getByRole("button", { name: "Palette color suggestions" });
  await expect(suggestions).toBeEnabled({ timeout: 30_000 });
  await suggestions.click();
  const options = page.locator(`#${await suggestions.getAttribute("aria-controls")} [role="option"]`);
  await expect(options.first()).toBeVisible();
  const pick = (await options.allInnerTexts())
    .map((text, index) => ({ index, hex: (text.match(/#[0-9a-f]{6}/i) || [""])[0].toLowerCase() }))
    .find(({ hex }) => hex);
  expect(pick, "the inspector offers no palette color for the selected country").toBeTruthy();
  await options.nth(pick.index).click();
  await expect(page.locator("#customColor")).toHaveValue(pick.hex);
  await openLayersTask(page);
  await page.locator("#editorLayer-legend").click();
  expect(await legendHasColor(page, pick.hex), `legend already lists ${pick.hex}`).toBe(false);

  await page.locator("#paintModeVisualBtn").click();
  await page.locator("#toolFillBtn").click();
  await waitForSettled(page);
  const target = await screenPoint(page);
  expect(await colorShareAround(page, target, pick.hex), `the map already shows ${pick.hex}`).toBeLessThan(UNFILLED);
  expect((await fillAt(page, target, { scenarioId: "blank_base" })).length).toBeGreaterThan(0);
  expect(await colorShareAround(page, target, pick.hex), `selected country is not drawn in ${pick.hex}`).toBeGreaterThan(FILLED);

  await openLayersTask(page);
  await page.locator("#editorLayer-legend").click();
  await expect.poll(() => legendHasColor(page, pick.hex), { message: `legend does not list ${pick.hex}` }).toBe(true);
  expect(errors).toEqual([]);
});

test("command palette: Ctrl+K runs a command and Escape returns focus to where it was opened", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  const trigger = page.locator("#editorTaskLayersBtn");
  await trigger.focus();
  expect((await testApi(page, "selection")).currentTool).toBe("select");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await search.fill("Fill tool");
  await expect(palette.getByRole("option").first()).toContainText("Fill tool");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect.poll(async () => (await testApi(page, "selection")).currentTool).toBe("fill");

  await trigger.focus();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
