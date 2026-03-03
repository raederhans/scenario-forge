/**
 * Browser visual test: captures screenshots at known boundary gap locations.
 * Verifies QA-044 admin0 background fill + fill-colored stroke fixes.
 */
import puppeteer from "puppeteer";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, "..", "qa", "screenshots_qa044");
const BASE_URL = "http://localhost:8000/?render_profile=auto";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log("Launching browser...");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1600, height: 1000 },
    args: ["--window-size=1600,1000", "--no-sandbox"],
    protocolTimeout: 120000,
  });

  const page = await browser.newPage();

  // Collect console errors
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  console.log("Loading map...");
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for map to fully render
  await page.waitForFunction(
    () => {
      const svg = document.querySelector("#mapContainer svg");
      return svg && svg.querySelectorAll("path").length > 0;
    },
    { timeout: 45000 }
  );
  await delay(3000);

  // Auto-fill countries
  console.log("Running auto-fill...");
  await page.evaluate(() => {
    const btn = document.getElementById("presetPolitical");
    if (btn) btn.click();
  });
  await delay(4000);

  // 1. Overview at default zoom
  console.log("1/4 Overview at default zoom...");
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "01_overview.png"),
    clip: { x: 320, y: 0, width: 960, height: 1000 },
  });

  // 2. Zoom to 300%
  console.log("2/4 Zoomed to 300%...");
  await page.evaluate(() => {
    const input = document.getElementById("zoomPercentInput");
    if (input) {
      input.value = "300%";
      input.dataset.editing = "true";
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }));
    }
  });
  await delay(3000);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "02_zoomed_300.png"),
    clip: { x: 320, y: 0, width: 960, height: 1000 },
  });

  // 3. Zoom to 600%
  console.log("3/4 Zoomed to 600%...");
  await page.evaluate(() => {
    const input = document.getElementById("zoomPercentInput");
    if (input) {
      input.value = "600%";
      input.dataset.editing = "true";
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }));
    }
  });
  await delay(3000);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "03_zoomed_600.png"),
    clip: { x: 320, y: 0, width: 960, height: 1000 },
  });

  // 4. Reset and zoom with mouse wheel (more natural d3 interaction)
  console.log("4/4 Zoom via + button clicks...");
  await page.evaluate(() => {
    const btn = document.getElementById("zoomResetBtn");
    if (btn) btn.click();
  });
  await delay(1500);

  // Click zoom-in button multiple times
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const btn = document.getElementById("zoomInBtn");
      if (btn) btn.click();
    });
    await delay(300);
  }
  await delay(2000);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "04_zoomed_via_buttons.png"),
    clip: { x: 320, y: 0, width: 960, height: 1000 },
  });

  // Report
  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);

  if (errors.length) {
    console.log(`\n${errors.length} console errors detected:`);
    errors.forEach((e) => console.log(`  ERROR: ${e}`));
  } else {
    console.log("\nNo console errors detected.");
  }

  // Verify topojson.merge is available and admin0 cache was populated
  const diagnostics = await page.evaluate(() => {
    const hasMerge = typeof globalThis.topojson?.merge === "function";
    return { hasMerge };
  });
  console.log(`topojson.merge available: ${diagnostics.hasMerge}`);

  console.log("\nBrowser left open for 30s for manual inspection...");
  await delay(30000);
  await browser.close();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
