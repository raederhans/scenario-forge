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
    for (const node of document.querySelectorAll("[data-i18n-list]")) {
      const items = [...node.children].map((item) => item.textContent);
      if (!zh[node.dataset.i18nList] || items.join("|") !== zh[node.dataset.i18nList]) misses.push(node.dataset.i18nList);
    }
    return misses;
  }, Object.fromEntries(Object.entries(copy.zh).filter(([, value]) => typeof value === "string")));
  expect(untranslated).toEqual([]);
  await expect(page).toHaveTitle(copy.zh.metaTitle);
});
