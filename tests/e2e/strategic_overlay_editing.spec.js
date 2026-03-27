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

async function waitForAppReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return typeof state.updateStrategicOverlayUIFn === "function"
      && typeof state.renderCountryListFn === "function"
      && !!document.querySelector("#inspectorSidebarTabFrontline")
      && !!document.querySelector("#operationGraphicList")
      && !!document.querySelector("#unitCounterList")
      && !!document.querySelector("g.operation-graphics-layer")
      && !!document.querySelector("g.unit-counters-layer")
      && !!document.querySelector("rect.interaction-layer");
  }, { timeout: 120000 });
}

async function openFrontlineTab(page) {
  await expect(page.locator("#inspectorSidebarTabFrontline")).toBeVisible();
  await page.evaluate(async () => {
    const sidebarModule = await import("/js/ui/sidebar.js");
    const mapRendererModule = await import("/js/core/map_renderer.js");
    if (!document.querySelector("#operationGraphicList") || !document.querySelector("#unitCounterList")) {
      sidebarModule.initSidebar({ render: mapRendererModule.render });
    }
  });
  await page.locator("#inspectorSidebarTabFrontline").click();
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    if (!state.ui || typeof state.ui !== "object") {
      state.ui = {};
    }
    state.ui.rightSidebarTab = "frontline";
    document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      const isActive = String(button.getAttribute("data-inspector-tab") || "").trim().toLowerCase() === "frontline";
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-inspector-panel]").forEach((panel) => {
      const isActive = String(panel.getAttribute("data-inspector-panel") || "").trim().toLowerCase() === "frontline";
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  });
  await page.waitForFunction(() => {
    const panel = document.querySelector("#frontlineSidebarPanel");
    const button = document.querySelector("#inspectorSidebarTabFrontline");
    return !!panel && !panel.hidden && button?.getAttribute("aria-selected") === "true";
  });
  await expect(page.locator("#frontlineSidebarPanel")).toBeVisible();
}

async function openCounterEditorModal(page) {
  await expect(page.locator("#unitCounterDetailToggleBtn")).toBeVisible();
  await page.locator("#unitCounterDetailToggleBtn").click();
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeVisible();
  await expect(page.locator("#unitCounterEditorModal")).toBeVisible();
}

async function waitForScenarioUiReady(page) {
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

test("operation graphics support style editing and vertex editing after creation", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
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
  await page.locator("summary", { hasText: "Graphic Style Controls" }).click();
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

  await page.locator("circle.operation-graphics-editor-midpoint").first().dispatchEvent("pointerdown");
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

  await page.locator("circle.operation-graphics-editor-point").first().dispatchEvent("click");
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return Number(state.operationGraphicsEditor?.selectedVertexIndex) === 0;
  });
  await expect(page.locator("#operationGraphicDeleteVertexBtn")).toBeEnabled();
});

test("operational lines support direct command-bar draw entry and style editing", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.locator("#strategicCommandOffensiveBtn").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.operationalLineEditor?.active
      && state.operationalLineEditor.kind === "offensive_line"
      && state.strategicOverlayUi?.activeMode === "offensive_line";
  });

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const mapRenderer = await import("/js/core/map_renderer.js");
    state.operationalLines = [{
      id: "opl_edit_1",
      kind: "frontline",
      label: "Baltic Screen",
      points: [[8, 48], [13, 49], [18, 51]],
      stylePreset: "frontline",
      stroke: "#6b7280",
      width: 2.1,
      opacity: 0.82,
      attachedCounterIds: [],
    }];
    state.operationalLinesDirty = true;
    mapRenderer.cancelOperationalLineDraw();
    mapRenderer.selectOperationalLineById("opl_edit_1");
    mapRenderer.render();
  });

  await expect(page.locator("#operationalLineList")).toHaveValue("opl_edit_1");
  await page.locator("#operationalLineKindSelect").selectOption("spearhead_line");
  await page.locator("#operationalLineLabelInput").fill("Breakthrough Axis");
  await page.locator("#operationalLineLabelInput").blur();
  await page.locator("#operationalLineStrokeInput").evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, "#7f1d1d");
  await page.locator("#operationalLineWidthInput").fill("5.2");
  await page.locator("#operationalLineWidthInput").blur();
  await page.locator("#operationalLineOpacityInput").fill("0.61");
  await page.locator("#operationalLineOpacityInput").blur();

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const line = (state.operationalLines || []).find((entry) => entry.id === "opl_edit_1");
    return line
      && line.kind === "spearhead_line"
      && line.stylePreset === "spearhead_line"
      && line.label === "Breakthrough Axis"
      && line.stroke === "#7f1d1d"
      && Number(line.width) === 5.2
      && Number(line.opacity) === 0.61;
  });
});

test("milstd counters keep attachments on click and detach only after a real drag", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.operationalLines = [{
      id: "line_attach_1",
      kind: "frontline",
      label: "Attached Axis",
      points: [[10, 47], [14, 49], [18, 50]],
      stylePreset: "frontline",
      stroke: "#7f1d1d",
      width: 4.5,
      opacity: 0.9,
      attachedCounterIds: ["unit_drag_1"],
    }];
    state.unitCounters = [{
      id: "unit_drag_1",
      renderer: "milstd",
      sidc: "130310001412110000000000000000",
      symbolCode: "130310001412110000000000000000",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      unitType: "INF",
      echelon: "corps",
      label: "1st Corps",
      subLabel: "Nord",
      organizationPct: 84,
      equipmentPct: 73,
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "INVALID" },
      attachment: { kind: "operational-line", lineId: "line_attach_1" },
      layoutAnchor: { kind: "line", key: "line_attach_1", slotIndex: 0 },
    }];
    state.operationalLinesDirty = true;
    state.unitCountersDirty = true;
    selectUnitCounterById("unit_drag_1");
    state.updateStrategicOverlayUIFn?.();
    render();
  });

  await expect(page.locator('g.unit-counter[data-counter-id="unit_drag_1"]')).toBeVisible();
  const symbolHref = await page.locator('g.unit-counter[data-counter-id="unit_drag_1"] image.unit-counter-milsymbol').getAttribute("href");
  expect(symbolHref).toContain("data:image/svg+xml");

  const counterBox = await page.locator('g.unit-counter[data-counter-id="unit_drag_1"]').boundingBox();
  await page.mouse.move(counterBox.x + counterBox.width / 2, counterBox.y + counterBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const counter = (state.unitCounters || []).find((entry) => entry.id === "unit_drag_1");
    return counter?.attachment?.lineId === "line_attach_1";
  });

  await page.mouse.move(counterBox.x + counterBox.width / 2, counterBox.y + counterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(counterBox.x + counterBox.width / 2 + 24, counterBox.y + counterBox.height / 2 + 12, { steps: 12 });
  await page.mouse.up();

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const counter = (state.unitCounters || []).find((entry) => entry.id === "unit_drag_1");
    return counter
      && !counter.attachment
      && counter.anchor.featureId
      && counter.anchor.featureId !== "INVALID"
      && Number.isFinite(Number(counter.anchor.lon))
      && Number.isFinite(Number(counter.anchor.lat));
  });
});

test("co-located counters render into deterministic slot positions instead of a single stacked badge", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.unitCounters = [
      { id: "stack_1", renderer: "milstd", sidc: "130310001412110000000000000000", symbolCode: "130310001412110000000000000000", nationTag: "GER", nationSource: "manual", presetId: "inf", unitType: "INF", echelon: "corps", label: "I Corps", size: "medium", organizationPct: 83, equipmentPct: 72, zIndex: 0, anchor: { lon: 12, lat: 48, featureId: "stack_demo" } },
      { id: "stack_2", renderer: "game", sidc: "", symbolCode: "MECH", nationTag: "GER", nationSource: "manual", presetId: "mech", unitType: "MECH", echelon: "div", label: "8th Mech", size: "medium", organizationPct: 67, equipmentPct: 61, zIndex: 1, anchor: { lon: 12, lat: 48, featureId: "stack_demo" } },
      { id: "stack_3", renderer: "game", sidc: "", symbolCode: "ARM", nationTag: "GER", nationSource: "manual", presetId: "arm", unitType: "ARM", echelon: "div", label: "12th Arm", size: "medium", organizationPct: 92, equipmentPct: 88, zIndex: 2, anchor: { lon: 12, lat: 48, featureId: "stack_demo" } },
      { id: "stack_4", renderer: "game", sidc: "", symbolCode: "ART", nationTag: "GER", nationSource: "manual", presetId: "art", unitType: "ART", echelon: "reg", label: "21st Art", size: "medium", organizationPct: 55, equipmentPct: 49, zIndex: 3, anchor: { lon: 12, lat: 48, featureId: "stack_demo" } },
    ];
    state.unitCounterEditor.selectedId = "stack_4";
    state.unitCountersDirty = true;
    selectUnitCounterById("stack_4");
    render();
  });

  const stackGroups = page.locator("g.unit-counter");
  await expect(stackGroups).toHaveCount(4);
  await expect(page.locator('g.unit-counter[data-counter-id="stack_4"]')).toBeVisible();
  await expect(page.locator("text.unit-counter-stack-text")).toHaveCount(4);

  const transforms = await page.locator("g.unit-counter").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("transform") || "")
  );
  expect(new Set(transforms).size).toBe(4);
  const hiddenBadgeCount = await page.locator('text.unit-counter-stack-text[display="none"]').count();
  expect(hiddenBadgeCount).toBeGreaterThanOrEqual(4);
});

test("unit counters open a centered modal editor, support symbol search, and still clamp with zoom", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById, setZoomPercent } = await import("/js/core/map_renderer.js");
    state.unitCounters = [{
      id: "unit_size_1",
      renderer: "milstd",
      sidc: "130310001412110000000000000000",
      symbolCode: "130310001412110000000000000000",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      unitType: "INF",
      echelon: "corps",
      subLabel: "Nord",
      baseFillColor: "#e8decd",
      organizationPct: 83,
      equipmentPct: 71,
      statsPresetId: "regular",
      statsSource: "preset",
      label: "1st Corps",
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "" },
    }];
    state.unitCountersDirty = true;
    selectUnitCounterById("unit_size_1");
    state.updateStrategicOverlayUIFn?.();
    render();
    setZoomPercent(700);
  });

  const counterShell = page.locator('g.unit-counter[data-counter-id="unit_size_1"] rect.unit-counter-shell');
  await expect(counterShell).toBeVisible();
  await openCounterEditorModal(page);
  await expect(page.locator("#unitCounterEditorModalStatus")).toBeVisible();
  await expect(page.locator("#unitCounterDetailPreviewCard .unit-counter-preview-card")).toBeVisible();
  await expect(page.locator("#unitCounterOrganizationInput")).toHaveValue("83");
  await expect(page.locator("#unitCounterEquipmentInput")).toHaveValue("71");
  const perfBeforeSearch = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    globalThis.__detailPreviewCardRef = document.querySelector("#unitCounterDetailPreviewCard .unit-counter-preview-card");
    return state.getStrategicOverlayPerfCountersFn?.() || {};
  });
  await page.locator("#unitCounterCatalogSearchInput").fill("carrier");
  await expect(page.locator("#unitCounterCatalogGrid .counter-editor-symbol-card")).toHaveCount(1);
  await expect(page.locator("#unitCounterCatalogGrid .counter-editor-symbol-card-title")).toHaveText("Carrier Group");
  const perfAfterSearch = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      counters: state.getStrategicOverlayPerfCountersFn?.() || {},
      samePreviewCard: globalThis.__detailPreviewCardRef === document.querySelector("#unitCounterDetailPreviewCard .unit-counter-preview-card"),
    };
  });
  expect(perfAfterSearch.samePreviewCard).toBeTruthy();
  expect(perfAfterSearch.counters.counterList || 0).toBe(perfBeforeSearch.counterList || 0);
  expect(perfAfterSearch.counters.operationalLines || 0).toBe(perfBeforeSearch.operationalLines || 0);
  expect(perfAfterSearch.counters.operationGraphics || 0).toBe(perfBeforeSearch.operationGraphics || 0);
  await page.locator("#unitCounterCatalogGrid .counter-editor-symbol-card").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const counter = (state.unitCounters || []).find((entry) => entry.id === "unit_size_1");
    return state.unitCounterEditor?.presetId === "CARRIER"
      && counter?.presetId === "CARRIER"
      && counter?.iconId === "carrier";
  });
  const perfBeforeCombatInput = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    globalThis.__detailPreviewCardRef = document.querySelector("#unitCounterDetailPreviewCard .unit-counter-preview-card");
    return state.getStrategicOverlayPerfCountersFn?.() || {};
  });
  await page.locator("#unitCounterOrganizationInput").evaluate((node) => {
    node.value = "66";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#unitCounterOrganizationInput")).toHaveValue("66");
  await page.waitForFunction(async (previousCounterCombat) => {
    const { state } = await import("/js/core/state.js");
    const counters = state.getStrategicOverlayPerfCountersFn?.() || {};
    return Number(counters.counterCombat || 0) > Number(previousCounterCombat || 0);
  }, perfBeforeCombatInput.counterCombat || 0);
  const perfAfterCombatInput = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      counters: state.getStrategicOverlayPerfCountersFn?.() || {},
      samePreviewCard: globalThis.__detailPreviewCardRef === document.querySelector("#unitCounterDetailPreviewCard .unit-counter-preview-card"),
      previewOrgText: document.querySelector("#unitCounterDetailPreviewCard .unit-counter-preview-stat.is-org .unit-counter-preview-stat-value")?.textContent || "",
    };
  });
  expect(perfAfterCombatInput.samePreviewCard).toBeTruthy();
  expect(perfAfterCombatInput.previewOrgText).toBe("66");
  expect(perfAfterCombatInput.counters.counterCatalog || 0).toBe(perfBeforeCombatInput.counterCatalog || 0);
  expect(perfAfterCombatInput.counters.counterList || 0).toBe(perfBeforeCombatInput.counterList || 0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeHidden();
  await expect(page.locator("#unitCounterDetailToggleBtn")).toBeFocused();
  const counterGroup = page.locator('g.unit-counter[data-counter-id="unit_size_1"]');
  const zoomPercentInput = page.locator("#zoomPercentInput");
  const unitCounterFixedScaleRange = page.locator("#unitCounterFixedScaleRange");
  const unitCounterFixedScaleValue = page.locator("#unitCounterFixedScaleValue");
  const readZoomK = async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return Number(state.zoomTransform?.k || 0);
  });
  const readCounterVisibility = async () => page.evaluate(() => {
    const node = document.querySelector('g.unit-counter[data-counter-id="unit_size_1"]');
    if (!node) return null;
    return {
      display: node.getAttribute("display") || "",
      opacity: Number(node.getAttribute("opacity") || 1),
    };
  });
  const waitForZoomK = async (expectedPercent) => {
    await expect.poll(async () => {
      const zoomK = await readZoomK();
      return Math.round(zoomK * 100);
    }, { timeout: 4000 }).toBe(expectedPercent);
  };
  const setZoomPercentViaApi = async (percent) => {
    await page.evaluate(async (nextPercent) => {
      const { setZoomPercent } = await import("/js/core/map_renderer.js");
      setZoomPercent(nextPercent);
    }, percent);
    await waitForZoomK(percent);
  };
  const setZoomPercentViaInput = async (percent) => {
    await zoomPercentInput.click();
    await zoomPercentInput.fill(String(percent));
    await zoomPercentInput.press("Enter");
    await waitForZoomK(percent);
    await expect.poll(async () => {
      const rawValue = await zoomPercentInput.inputValue();
      return Number(rawValue.replace(/[^0-9.]/g, ""));
    }, { timeout: 4000 }).toBe(percent);
  };

  await setZoomPercentViaApi(50);
  const zoomAt50 = await readZoomK();
  const counterStateAt50 = await readCounterVisibility();

  await setZoomPercentViaApi(100);
  const counterStateAt100 = await readCounterVisibility();

  await setZoomPercentViaApi(500);
  const counterStateAt500 = await readCounterVisibility();

  await setZoomPercentViaInput(600);
  const zoomAt600 = await readZoomK();
  const counterStateAt600 = await readCounterVisibility();

  await setZoomPercentViaApi(700);
  const zoomAt700 = await readZoomK();
  const boxAt700 = await counterShell.boundingBox();
  await expect(unitCounterFixedScaleRange).toHaveValue("150");
  await expect(unitCounterFixedScaleValue).toHaveText("1.50x");

  await page.evaluate(() => {
    const range = document.querySelector("#unitCounterFixedScaleRange");
    range.value = "200";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(unitCounterFixedScaleRange).toHaveValue("200");
  await expect(unitCounterFixedScaleValue).toHaveText("2.00x");
  await expect.poll(
    async () => (await counterShell.boundingBox())?.width ?? 0,
    { timeout: 4000 },
  ).toBeGreaterThan(boxAt700.width);
  const boxAt700ScaledUp = await counterShell.boundingBox();

  await setZoomPercentViaInput(3000);
  const zoomAt3000 = await readZoomK();
  const counterStateAt3000 = await readCounterVisibility();
  const boxAt3000 = await counterShell.boundingBox();

  expect(zoomAt50).toBeCloseTo(0.5, 2);
  expect(
    counterStateAt50 === null
      || counterStateAt50.display === "none"
      || counterStateAt50.opacity <= 0.05,
  ).toBeTruthy();
  expect(
    counterStateAt100 === null
      || counterStateAt100.display === "none"
      || counterStateAt100.opacity <= 0.05,
  ).toBeTruthy();
  expect(
    counterStateAt500 === null
      || counterStateAt500.display === "none"
      || counterStateAt500.opacity <= 0.05,
  ).toBeTruthy();
  expect(zoomAt600).toBeCloseTo(6, 1);
  expect(
    counterStateAt600 === null
      || counterStateAt600.display === "none"
      || counterStateAt600.opacity <= 0.05,
  ).toBeTruthy();
  expect(zoomAt700).toBeCloseTo(7, 1);
  expect(boxAt700.width).toBeGreaterThan(10);
  expect(boxAt700.height).toBeGreaterThan(6);
  expect(boxAt700ScaledUp.width).toBeGreaterThan(boxAt700.width);
  expect(boxAt700ScaledUp.height).toBeGreaterThan(boxAt700.height);
  expect(zoomAt3000).toBeCloseTo(30, 1);
  expect(
    counterStateAt3000 !== null
      && counterStateAt3000.display !== "none"
      && counterStateAt3000.opacity >= 0.95,
  ).toBeTruthy();
  expect(Math.abs(boxAt3000.width - boxAt700ScaledUp.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxAt3000.height - boxAt700ScaledUp.height)).toBeLessThanOrEqual(2);
});

test("unit counter placement cancels on escape or tab switch, resets after delete, and keeps compact sidebar overflow-safe", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openFrontlineTab(page);

  const longLabel = "Army Group Center Counter Title That Should Never Spill Outside The Compact Preview Shell";
  await page.evaluate(async (label) => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.unitCounters = [{
      id: "unit_delete_1",
      renderer: "game",
      sidc: "ARM",
      symbolCode: "ARM",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "ARM",
      iconId: "armor",
      unitType: "ARM",
      echelon: "army",
      label,
      subLabel: "Panzergruppe Nord With Extended Metadata",
      organizationPct: 88,
      equipmentPct: 79,
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 11, lat: 47, featureId: "" },
    }];
    state.unitCountersDirty = true;
    selectUnitCounterById("unit_delete_1");
    state.updateStrategicOverlayUIFn?.();
    render();
  }, longLabel);

  await expect(page.locator("#unitCounterList")).toHaveValue("unit_delete_1");
  const compactPreviewSnapshot = await page.evaluate(() => {
    const title = document.querySelector("#unitCounterPreviewCard .unit-counter-preview-title");
    const meta = document.querySelector("#unitCounterPreviewCard .unit-counter-preview-meta");
    const actions = document.querySelector(".strategic-counter-management-actions");
    const styles = (node) => node ? globalThis.getComputedStyle(node) : null;
    return {
      titleWhiteSpace: styles(title)?.whiteSpace || "",
      titleOverflow: styles(title)?.overflow || "",
      titleTextOverflow: styles(title)?.textOverflow || "",
      metaWhiteSpace: styles(meta)?.whiteSpace || "",
      actionColumns: styles(actions)?.gridTemplateColumns || "",
    };
  });
  expect(compactPreviewSnapshot.titleWhiteSpace).toBe("nowrap");
  expect(compactPreviewSnapshot.titleOverflow).toBe("hidden");
  expect(compactPreviewSnapshot.titleTextOverflow).toBe("ellipsis");
  expect(compactPreviewSnapshot.metaWhiteSpace).toBe("nowrap");
  expect(compactPreviewSnapshot.actionColumns.split(" ").length).toBeGreaterThanOrEqual(3);

  await page.locator("#unitCounterPlaceBtn").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.unitCounterEditor?.active && !state.unitCounterEditor?.selectedId;
  });
  await expect(page.locator("#unitCounterPlacementStatus")).toContainText("Placing");
  await page.keyboard.press("Escape");
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.unitCounterEditor?.active;
  });

  await page.locator("#unitCounterPlaceBtn").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.unitCounterEditor?.active;
  });
  await page.locator("#inspectorSidebarTabInspector").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return state.ui?.rightSidebarTab === "inspector" && !state.unitCounterEditor?.active;
  });

  await openFrontlineTab(page);
  await expect(page.locator("#unitCounterList")).toHaveValue("unit_delete_1");
  await page.locator("#unitCounterDeleteBtn").click();
  await page.getByRole("button", { name: "Delete Counter" }).click();
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !(state.unitCounters || []).some((entry) => entry.id === "unit_delete_1")
      && !state.unitCounterEditor?.selectedId
      && !state.unitCounterEditor?.label
      && !state.unitCounterEditor?.sidc
      && state.unitCounterEditor?.presetId === "inf";
  });
  await expect(page.locator("#unitCounterList")).toHaveValue("");
});

test("unit counter auto nation follows displayed political code and keeps legacy/controller/manual compatibility", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await waitForAppReady(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, "tno_1962");
  await openFrontlineTab(page);

  await expect(page.locator("#unitCounterNationModeSelect")).toHaveValue("display");

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

  const result = await page.evaluate(async ({ featureId, baselineOwner, baselineController }) => {
    const { state } = await import("/js/core/state.js");
    const {
      resolveUnitCounterNationForPlacement,
      startUnitCounterPlacement,
    } = await import("/js/core/map_renderer.js");

    state.sovereigntyByFeatureId = {
      ...(state.sovereigntyByFeatureId || {}),
      [featureId]: baselineOwner,
    };
    state.scenarioControllersByFeatureId = {
      ...(state.scenarioControllersByFeatureId || {}),
      [featureId]: baselineController,
    };
    state.activeSovereignCode = baselineOwner;
    state.scenarioViewMode = "ownership";

    const displayOwnership = resolveUnitCounterNationForPlacement(featureId, "", "display");
    const explicitOwner = resolveUnitCounterNationForPlacement(featureId, "", "owner");
    const explicitController = resolveUnitCounterNationForPlacement(featureId, "", "controller");
    const activeFallback = resolveUnitCounterNationForPlacement("", "", "controller");
    const manual = resolveUnitCounterNationForPlacement(featureId, baselineController, "manual");

    startUnitCounterPlacement({
      presetId: "inf",
      nationSource: "display",
      nationTag: "",
    });
    const displayEditor = {
      nationSource: String(state.unitCounterEditor?.nationSource || ""),
      nationTag: String(state.unitCounterEditor?.nationTag || ""),
    };

    state.scenarioViewMode = "frontline";
    const displayFrontline = resolveUnitCounterNationForPlacement(featureId, "", "display");

    startUnitCounterPlacement({
      presetId: "inf",
      nationSource: "controller",
      nationTag: "",
    });
    const legacyEditor = {
      nationSource: String(state.unitCounterEditor?.nationSource || ""),
      nationTag: String(state.unitCounterEditor?.nationTag || ""),
    };

    return {
      displayOwnership,
      displayFrontline,
      explicitOwner,
      explicitController,
      activeFallback,
      manual,
      displayEditor,
      legacyEditor,
    };
  }, splitFeature);

  expect(result.displayOwnership).toEqual({
    tag: splitFeature.baselineOwner,
    source: "display",
  });
  expect(result.displayFrontline).toEqual({
    tag: splitFeature.baselineController,
    source: "display",
  });
  expect(result.explicitOwner).toEqual({
    tag: splitFeature.baselineOwner,
    source: "owner",
  });
  expect(result.explicitController).toEqual({
    tag: splitFeature.baselineController,
    source: "controller",
  });
  expect(result.activeFallback).toEqual({
    tag: splitFeature.baselineOwner,
    source: "controller",
  });
  expect(result.manual).toEqual({
    tag: splitFeature.baselineController,
    source: "manual",
  });
  expect(result.displayEditor).toEqual({
    nationSource: "display",
    nationTag: "",
  });
  expect(result.legacyEditor).toEqual({
    nationSource: "controller",
    nationTag: "",
  });
});
