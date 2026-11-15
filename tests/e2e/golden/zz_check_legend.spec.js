// 临时检查：图例延后到绘制后更新；填色完成后，两个图例与立即同步重绘的结果一致。提交前删除。
const { test, expect } = require("@playwright/test");
const { openApp, selectFillTool, zoomTo, fillAt, waitForSettled, switchScenario } = require("./golden-support");

const snapshot = (page) => page.evaluate(() => ({
  map: document.getElementById("mapLegendControl")?.innerHTML || "",
  editor: document.getElementById("legendEditorList")?.innerHTML || "",
}));

test("填色后两个图例都已是最新", async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await switchScenario(page, "hoi4_1936");
  const point = await zoomTo(page, undefined, { scenarioId: "hoi4_1936" });
  const beforeFill = await snapshot(page);
  await selectFillTool(page, "#12ab34");
  await fillAt(page, point, { scenarioId: "hoi4_1936" });
  await waitForSettled(page, { scenarioId: "hoi4_1936" });
  await page.waitForTimeout(500);
  const deferred = await snapshot(page);
  await page.evaluate(async () => {
    const { renderer, state } = await window.__scenarioForgeTestApi.internals();
    renderer.renderLegend();
    state.updateLegendUI();
  });
  const synchronous = await snapshot(page);
  console.log("LEGEND_CHANGED_BY_FILL", JSON.stringify({ map: beforeFill.map !== deferred.map, editor: beforeFill.editor !== deferred.editor }));
  expect(deferred.map.length).toBeGreaterThan(0);
  expect(deferred.map, "地图图例已是最新").toBe(synchronous.map);
  expect(deferred.editor, "侧栏图例编辑器已是最新").toBe(synchronous.editor);
});
