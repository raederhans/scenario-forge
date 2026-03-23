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

async function waitForAppReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return typeof state.updateStrategicOverlayUIFn === "function"
      && typeof state.renderCountryListFn === "function"
      && !!document.querySelector("#inspectorSidebarTabFrontline")
      && !!document.querySelector("#operationGraphicList")
      && !!document.querySelector("#unitCounterList");
  }, { timeout: 120000 });
}

async function openFrontlineTab(page) {
  await page.locator("#inspectorSidebarTabFrontline").click();
  await expect(page.locator("#frontlineSidebarPanel")).toBeVisible();
}

test("operation graphics support style editing and vertex editing after creation", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const mapRenderer = await import("/js/core/map_renderer.js");
    state.operationGraphics = [{
      id: "opg_edit_1",
      kind: "attack",
      label: "North Push",
      points: [[-3, 48], [1, 50], [6, 52]],
      stylePreset: "attack",
      stroke: "#991b1b",
      width: 4.4,
      opacity: 0.96,
    }];
    state.operationGraphicsDirty = true;
    mapRenderer.selectOperationGraphicById("opg_edit_1");
    mapRenderer.render();
  });

  await expect(page.locator("#operationGraphicList")).toHaveValue("opg_edit_1");
  await page.locator("#operationGraphicPresetSelect").selectOption("naval");
  await page.locator("#operationGraphicLabelInput").fill("Sea Lift");
  await page.locator("#operationGraphicLabelInput").blur();
  await page.locator("#operationGraphicStrokeInput").evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, "#123456");
  await page.locator("#operationGraphicWidthInput").fill("6.5");
  await page.locator("#operationGraphicWidthInput").blur();
  await page.locator("#operationGraphicOpacityInput").fill("0.55");
  await page.locator("#operationGraphicOpacityInput").blur();

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const graphic = (state.operationGraphics || []).find((entry) => entry.id === "opg_edit_1");
    return graphic
      && graphic.stylePreset === "naval"
      && graphic.label === "Sea Lift"
      && graphic.stroke === "#123456"
      && Number(graphic.width) === 6.5
      && Number(graphic.opacity) === 0.55;
  });

  await expect(page.locator("circle.operation-graphics-editor-point")).toHaveCount(3);
  await expect(page.locator("circle.operation-graphics-editor-midpoint")).toHaveCount(2);

  await page.locator("circle.operation-graphics-editor-midpoint").first().click({ force: true });
  await expect(page.locator("circle.operation-graphics-editor-point")).toHaveCount(4);

  const firstPointBefore = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return state.operationGraphics[0].points[0];
  });
  const pointBox = await page.locator("circle.operation-graphics-editor-point").first().boundingBox();
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointBox.x + pointBox.width / 2 + 22, pointBox.y + pointBox.height / 2 + 10, { steps: 10 });
  await page.mouse.up();

  await page.waitForFunction(async (previous) => {
    const { state } = await import("/js/core/state.js");
    const current = state.operationGraphics[0].points[0];
    return Array.isArray(current)
      && (Math.abs(current[0] - previous[0]) > 0.01 || Math.abs(current[1] - previous[1]) > 0.01);
  }, firstPointBefore);

  await page.locator("circle.operation-graphics-editor-point").first().click({ force: true });
  await expect(page.locator("#operationGraphicDeleteVertexBtn")).toBeEnabled();
  await page.locator("#operationGraphicDeleteVertexBtn").click();
  await expect(page.locator("circle.operation-graphics-editor-point")).toHaveCount(3);
});

test("milstd counters render through milsymbol and refresh feature binding after drag", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.unitCounters = [{
      id: "unit_drag_1",
      renderer: "milstd",
      sidc: "130310001412110000000000000000",
      symbolCode: "130310001412110000000000000000",
      label: "1st Corps",
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "INVALID" },
    }];
    state.unitCounterEditor.selectedId = "unit_drag_1";
    state.unitCountersDirty = true;
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  await expect(page.locator('g.unit-counter[data-counter-id="unit_drag_1"]')).toBeVisible();
  const symbolHref = await page.locator('g.unit-counter[data-counter-id="unit_drag_1"] image.unit-counter-milsymbol').getAttribute("href");
  expect(symbolHref).toContain("data:image/svg+xml");

  const counterBox = await page.locator('g.unit-counter[data-counter-id="unit_drag_1"]').boundingBox();
  await page.mouse.move(counterBox.x + counterBox.width / 2, counterBox.y + counterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(counterBox.x + counterBox.width / 2 + 24, counterBox.y + counterBox.height / 2 + 12, { steps: 12 });
  await page.mouse.up();

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const counter = (state.unitCounters || []).find((entry) => entry.id === "unit_drag_1");
    return counter
      && counter.anchor.featureId
      && counter.anchor.featureId !== "INVALID"
      && Number.isFinite(Number(counter.anchor.lon))
      && Number.isFinite(Number(counter.anchor.lat));
  });
});
