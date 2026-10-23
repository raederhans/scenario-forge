// Golden flows for the landing page: a first visit, read through the DOM only.
const { test, expect } = require("@playwright/test");

const WORLDS = ["blank", "modern", "1936", "1939", "1962"];

async function openLanding(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => problems.push(`failed ${request.url()}: ${request.failure()?.errorText}`));
  await page.goto("/");
  await expect(page.locator(".world").first()).toBeAttached();
  return problems;
}

async function readLanding(page) {
  return page.evaluate(async () => {
    const { COPY } = await import(new URL("./i18n.js", location.href).toString());
    return COPY;
  });
}

test("the landing page loads everything it asks for and draws the map", async ({ page }) => {
  const problems = await openLanding(page);
  // Walk the whole page so lazily loaded sections fetch their assets too.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let top = 0; top < height; top += 600) {
    await page.evaluate((y) => scrollTo(0, y), top);
    await page.waitForTimeout(60);
  }
  await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector("[data-fills]");
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i]) return true;
    return false;
  })).toBe(true);
  expect(problems).toEqual([]);
});

test("every starting world opens its sample in the editor and offers its project file", async ({ page }) => {
  await openLanding(page);
  const manifest = await (await page.request.get("/assets/sample-runs.json")).json();
  const worlds = await page.locator(".world").evaluateAll((items) => items.map((item) => ({
    world: item.dataset.world,
    open: new URL(item.querySelector("[data-sample-project-open-link]").href),
    download: item.querySelector("[data-sample-project-list-link]"),
  })).map(({ world, open, download }) => ({
    world,
    openPath: `${open.pathname}${open.search}`,
    downloadPath: new URL(download.href).pathname,
    isDownload: download.hasAttribute("download"),
  })));
  expect(worlds.map((entry) => entry.world)).toEqual(WORLDS);
  expect(worlds).toHaveLength(manifest.sample_projects.length);
  for (const project of manifest.sample_projects) {
    const entry = worlds.find((candidate) => candidate.downloadPath === `/${project.project_url.replace(/^\.\//, "")}`);
    expect(entry, `${project.id} has a project file link`).toBeTruthy();
    expect(entry.isDownload).toBe(true);
    expect(entry.openPath).toBe(`/app/?sample=${project.id}&view=guide`);
    expect((await page.request.get(entry.downloadPath)).ok(), `${project.id} project file`).toBe(true);
  }
});

test("picking a starting world shows that world on the map", async ({ page }) => {
  await openLanding(page);
  const copy = await readLanding(page);
  const date = page.locator("[data-state-date]");
  for (const [index, world] of WORLDS.entries()) {
    const pick = page.locator(".world__pick").nth(index);
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(date).toHaveText(copy.en.stateDates[world]);
  }
});

test("with reduced motion the map camera moves without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLanding(page);
  const lens = page.locator("[data-lens]");
  await expect.poll(() => lens.evaluate((node) => getComputedStyle(node).transitionDuration.split(",").every((value) => parseFloat(value) === 0))).toBe(true);
});

async function fillsChecksum(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-fills]");
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4 * 31) sum = (sum * 31 + data[i] + data[i + 1] * 7 + data[i + 2] * 13) % 1_000_000_007;
    return sum;
  });
}

async function jumpToChapter(page, chapter) {
  await page.evaluate((name) => {
    const top = name === "history" ? 0 : document.querySelector(`[data-chapter="${name}"]`).getBoundingClientRect().top + scrollY;
    scrollTo({ top, behavior: "instant" });
  }, chapter);
  await expect(page.locator(`[data-story][data-mode="${chapter}"]`)).toBeAttached();
}

test("leaving history and coming straight back keeps the map on the chosen date", async ({ page }) => {
  await openLanding(page);
  await page.locator("[data-track]").focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-track]")).toHaveAttribute("aria-valuenow", "1962");
  await page.waitForTimeout(2000);
  const settled = await fillsChecksum(page);
  await jumpToChapter(page, "edit");
  await page.waitForTimeout(150);
  await jumpToChapter(page, "history");
  // Longer than the 900 ms recolour the edit chapter started.
  await page.waitForTimeout(1500);
  expect(await fillsChecksum(page)).toBe(settled);
});

test("with reduced motion the history sweep line clears when the chapter changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLanding(page);
  const box = await page.locator("[data-track]").boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  const frontOpacity = () => page.locator("[data-front]").evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(await frontOpacity()).toBeGreaterThan(0.5);
  await jumpToChapter(page, "edit");
  await expect.poll(frontOpacity).toBe(0);
});

test("a resting history sweep line stays on its map position after a resize", async ({ page }) => {
  // The sweep's left edge and width in map units, from what is on screen (the map is slice-fitted).
  const frontOnMap = () => page.evaluate(() => {
    const [, , mapWidth, mapHeight] = document.querySelector("[data-map]").getAttribute("viewBox").split(" ").map(Number);
    const lens = document.querySelector("[data-lens]").getBoundingClientRect();
    const front = document.querySelector("[data-front]");
    const rect = front.getBoundingClientRect();
    const k = Math.max(lens.width / mapWidth, lens.height / mapHeight);
    const ox = (lens.width - mapWidth * k) / 2;
    return { x: (rect.left - lens.left - ox) / k, width: rect.width / k, opacity: Number(getComputedStyle(front).opacity) };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  const box = await page.locator("[data-track]").boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const before = await frontOnMap();
  expect(before.opacity).toBeGreaterThan(0.5);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => Math.abs((await frontOnMap()).x - before.x)).toBeLessThan(1);
  expect(Math.abs((await frontOnMap()).width - before.width)).toBeLessThan(1);
});

test("rail and cities show only in the context chapter", async ({ page }) => {
  await openLanding(page);
  const shown = () => page.evaluate(() => [".map-rail", ".map-cities"].map((selector) => getComputedStyle(document.querySelector(selector)).display !== "none"));
  expect(await shown()).toEqual([false, false]);
  await jumpToChapter(page, "context");
  await expect.poll(shown).toEqual([true, true]);
  await jumpToChapter(page, "worlds");
  await expect.poll(shown).toEqual([false, false]);
});

test("switching to Chinese translates every labelled element", async ({ page }) => {
  await openLanding(page);
  const copy = await readLanding(page);
  await page.locator("[data-lang-toggle]").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  const untranslated = await page.evaluate((zh) => {
    const misses = [];
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const expected = zh[node.dataset.i18n];
      if (typeof expected !== "string" || !expected.trim() || node.textContent !== expected) misses.push(node.dataset.i18n);
    }
    for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
      const expected = zh[node.dataset.i18nAriaLabel];
      if (!expected || node.getAttribute("aria-label") !== expected) misses.push(node.dataset.i18nAriaLabel);
    }
    for (const node of document.querySelectorAll("[data-i18n-alt]")) {
      const expected = zh[node.dataset.i18nAlt];
      if (!expected || node.getAttribute("alt") !== expected) misses.push(node.dataset.i18nAlt);
    }
    for (const node of document.querySelectorAll("[data-i18n-list]")) {
      const items = [...node.children].map((item) => item.textContent);
      if (!zh[node.dataset.i18nList] || items.join("|") !== zh[node.dataset.i18nList]) misses.push(node.dataset.i18nList);
    }
    return misses;
  }, Object.fromEntries(Object.entries(copy.zh).filter(([, value]) => typeof value === "string")));
  expect(untranslated).toEqual([]);
  await expect(page).toHaveTitle(copy.zh.metaTitle);
});
