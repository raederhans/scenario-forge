// 临时截图脚本：TNO 地中海（亚特兰托帕）测深开启时的现状。研究结束后删除。
const fs = require("fs");
const path = require("path");
const { test } = require("@playwright/test");
const { openApp, zoomTo, parkMouse, waitForSettled } = require("./golden-support");

const OUT_DIR = path.join(process.cwd(), ".runtime", "browser", "bathymetry");
const TAG = process.env.CAPTURE_TAG || "atl-before";

test.use({ launchOptions: { args: ["--enable-gpu", "--use-angle=d3d11"] } });

test("截图亚特兰托帕测深", async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await openApp(page);
  await waitForSettled(page, { scenarioId: "tno_1962" });
  await page.evaluate(() => {
    const box = document.getElementById("oceanAdvancedStylesToggle");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(8000);
  await waitForSettled(page, { scenarioId: "tno_1962" });
  await zoomTo(page, [17, 37], { steps: 2, scenarioId: "tno_1962" });
  await page.waitForTimeout(3000);
  await parkMouse(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-med.png`) });
  await zoomTo(page, [20, 36], { steps: 1, scenarioId: "tno_1962" });
  await page.waitForTimeout(3000);
  await parkMouse(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-ionian.png`) });
});
