// 控件画廊截图基线：按版块、按 1440 / 375 两个宽度截图并与基线比对。
// 不在 e2e 分层清单里（子目录不被 tools/e2e_layering.mjs 收录），只用
// `npx playwright test tests/e2e/ui_gallery` 直接运行；基线按平台命名，目前只有 win32。
// 更新基线：`npx playwright test tests/e2e/ui_gallery --update-snapshots`。
const { test, expect } = require("@playwright/test");

const GALLERY_PATH = "/app/tests/e2e/ui_gallery/gallery.html";
const SECTIONS = [
  "buttons-global",
  "buttons-sidebar",
  "buttons-dock-zoom",
  "buttons-workbenches",
  "dialogs",
  "toasts",
  "inputs",
  "selects",
  "toggles",
  "ranges-colors",
  "tabs",
  "disclosures",
  "list-rows",
  "component-modifiers",
  "invalid-declaration-sites",
];
const WIDTHS = [1440, 375];

// 关掉 LCD 次像素抗锯齿和次像素定位，避免同一页面两次截图的文字边缘不一致。
test.use({
  launchOptions: {
    args: ["--font-render-hinting=none", "--disable-lcd-text", "--disable-font-subpixel-positioning"],
  },
});

// 用 DevTools 协议把 data-force 标记的节点强制成 :hover / :focus / :focus-visible。
async function forcePseudoStates(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-force]" });
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
    const index = attributes.indexOf("data-force");
    const forced = String(attributes[index + 1] || "").split(/\s+/).filter(Boolean);
    await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: forced });
  }
  return { cdp, count: nodeIds.length };
}

test.describe("控件画廊截图基线", () => {
  for (const width of WIDTHS) {
    test(`画廊 ${width}px`, async ({ page }) => {
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(GALLERY_PATH);
      await page.waitForSelector("html[data-gallery-ready='true']");
      const { cdp, count } = await forcePseudoStates(page);
      expect(count).toBeGreaterThan(40);
      for (const section of SECTIONS) {
        const locator = page.locator(`[data-gallery-section="${section}"]`);
        await expect.soft(locator, `${section} @ ${width}`).toHaveScreenshot(`${section}-${width}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixels: 0,
        });
      }
      await cdp.detach();
      expect(pageErrors).toEqual([]);
    });
  }
});
