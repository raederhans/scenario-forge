// 中文国家标签字体按 unicode-range 切片发布：canvas 画字不会自动拉切片，标签 owner 用
// document.fonts.load 显式请求。这里断言真实绘制出来的中文标签最终用上了切片字体，
// 且只下载切片、不下载完整字体。
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(240_000);

const FAMILY = "Map Noto Serif SC";
const FONT = `400 16px "${FAMILY}"`;

test("Chinese country labels render with the sliced map font after the needed slices load", async ({ page }) => {
  const fontRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/vendor/fonts/notoserifsc/")) fontRequests.push(url.replace(/^.*\/vendor\/fonts\//, ""));
  });
  await page.addInitScript((family) => {
    const draws = [];
    globalThis.__e2eChineseLabelDraws = draws;
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(text, ...rest) {
      if (String(this.font || "").includes(family) && /[㐀-鿿]/.test(String(text))) {
        draws.push({ text: String(text), loaded: document.fonts.check(`400 16px "${family}"`, String(text)) });
      }
      return original.call(this, text, ...rest);
    };
  }, FAMILY);

  await gotoApp(page, "/?default_scenario=tno_1962", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 180_000 });
  const language = await page.evaluate(async () => String((await globalThis.__scenarioForgeTestApi.internals()).state.currentLanguage || "en"));
  if (!language.startsWith("zh")) {
    await page.locator("#btnToggleLang").click();
    await page.waitForFunction(async () => String((await globalThis.__scenarioForgeTestApi.internals()).state.currentLanguage || "").startsWith("zh"),
      undefined, { timeout: 30_000, polling: 500 });
  }

  // 标签先可能用回退字体画一次；切片到达后 loadingdone 触发重绘，之后的绘制必须已能用切片字体。
  await page.waitForFunction(() => (globalThis.__e2eChineseLabelDraws || []).some((draw) => draw.loaded),
    undefined, { timeout: 120_000, polling: 500 });
  const result = await page.evaluate((font) => {
    const draws = globalThis.__e2eChineseLabelDraws || [];
    const loadedDraws = draws.filter((draw) => draw.loaded);
    const text = [...new Set(draws.map((draw) => draw.text).join(""))].join("");
    return {
      drawCount: draws.length,
      loadedDrawCount: loadedDraws.length,
      text,
      allGlyphsAvailable: document.fonts.check(font, text),
      loadedFaces: [...document.fonts].filter((face) => face.family.replace(/"/g, "") === "Map Noto Serif SC" && face.status === "loaded").length,
    };
  }, FONT);

  expect(result.drawCount).toBeGreaterThan(0);
  expect(result.loadedDrawCount).toBeGreaterThan(0);
  expect(result.allGlyphsAvailable, `glyphs drawn: ${result.text.slice(0, 80)}`).toBe(true);
  expect(result.loadedFaces).toBeGreaterThan(0);
  expect(fontRequests).toContain("notoserifsc/slices/NotoSerifSC-400.s00.woff2");
  expect(fontRequests.filter((url) => url === "notoserifsc/NotoSerifSC-400.woff2")).toEqual([]);
  expect(fontRequests.every((url) => url.startsWith("notoserifsc/slices/"))).toBe(true);
});
