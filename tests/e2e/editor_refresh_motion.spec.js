const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(60_000);

async function openWorkspace(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("body")).toHaveClass(/editor-workspace/);
}

async function readState(page, field) {
  return page.evaluate(async (name) => {
    const { state } = await import("/js/core/state.js");
    return state[name];
  }, field);
}

test("repeated country selection preserves property DOM and URL while switching still works", async ({ page }) => {
  await openWorkspace(page);
  const group = page.locator("#countryList .country-explorer-header").first();
  await expect(group).toBeVisible();
  if (await group.getAttribute("aria-expanded") === "false") await group.click();
  const row = page.locator("#countryList .country-select-row:visible").first();
  const code = await row.getAttribute("data-country-code");
  expect(code).toBeTruthy();
  const country = page.locator(`#countryList .country-select-row[data-country-code="${code}"] .country-select-main-btn`).first();
  await country.click();
  await expect.poll(() => readState(page, "selectedInspectorCountryCode")).toBe(code);
  await expect(page.locator("#editorPropertiesTitle")).toHaveText("Countries");

  await page.evaluate(() => {
    const title = document.getElementById("editorPropertiesTitle");
    const probe = { titleNode: title.firstChild, mutations: [], urlWrites: 0, url: location.href };
    const observer = new MutationObserver((records) => probe.mutations.push(...records));
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    for (const panel of document.querySelectorAll(".editor-property-panel")) {
      observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    }
    const replaceState = history.replaceState;
    history.replaceState = function (...args) {
      probe.urlWrites += 1;
      return replaceState.apply(this, args);
    };
    window.__editorRefreshProbe = { probe, observer, replaceState };
  });
  await page.locator("#editorObjects-countries").click();
  await country.click();
  await page.locator("#editorObjects-countries").click();
  const repeated = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const { probe, observer, replaceState } = window.__editorRefreshProbe;
    probe.mutations.push(...observer.takeRecords());
    observer.disconnect();
    history.replaceState = replaceState;
    delete window.__editorRefreshProbe;
    return {
      sameTitleNode: document.getElementById("editorPropertiesTitle").firstChild === probe.titleNode,
      mutations: probe.mutations.map((record) => ({ id: record.target.id, type: record.type, attribute: record.attributeName })),
      urlWrites: probe.urlWrites,
      sameUrl: location.href === probe.url,
    };
  });
  expect(repeated).toEqual({ sameTitleNode: true, mutations: [], urlWrites: 0, sameUrl: true });
  await expect(country).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => readState(page, "selectedInspectorCountryCode")).toBe(code);

  await page.locator("#editorObjects-water").click();
  await expect(page.locator("#editorProperty-water")).toBeVisible();
  await expect(page.locator("#editorProperty-countries")).toBeHidden();
  await expect(page.locator("#editorPropertiesTitle")).toHaveText("Water Regions");
  await expect(page.locator("#editorObjects-water")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#editorObjects-countries").click();
  await expect(page.locator("#editorProperty-countries")).toBeVisible();
  await expect(page.locator("#editorProperty-water")).toBeHidden();
  await expect(page.locator("#editorPropertiesTitle")).toHaveText("Countries");
  await expect(country).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => readState(page, "selectedInspectorCountryCode")).toBe(code);
  await expect.poll(() => new URL(page.url()).searchParams.get("scope")).toBe("current-object");
});

test("desktop sidebar content keeps its width throughout collapse and restores access", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openWorkspace(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const side of ["left", "right"]) {
      const sidebar = page.locator(`#${side}Sidebar`);
      const content = page.locator(`#${side}SidebarContent`);
      const collapse = page.locator(`#${side}SidebarCollapseBtn`);
      await expect(collapse).toHaveAttribute("aria-expanded", "true");
      // Settle any resize transition before taking the expanded baseline.
      await sidebar.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const baseline = await sidebar.evaluate((element, name) => ({
        shell: element.getBoundingClientRect().width,
        content: document.getElementById(`${name}SidebarContent`).getBoundingClientRect().width,
        declared: parseFloat(getComputedStyle(document.body).getPropertyValue(`--editor-${name}-width`)),
      }), side);
      expect(baseline.shell).toBeCloseTo(baseline.declared, 1);
      expect(baseline.content).toBeCloseTo(baseline.declared - 1, 1);

      await page.evaluate((name) => {
        const shell = document.getElementById(`${name}Sidebar`);
        const content = document.getElementById(`${name}SidebarContent`);
        // Capture actual transitions immediately after the native click handler.
        document.getElementById(`${name}SidebarCollapseBtn`).addEventListener("click", () => {
          const animations = [...shell.getAnimations(), ...content.getAnimations()];
          animations.forEach((animation) => animation.pause());
          window.__editorCollapseAnimations = animations;
        }, { once: true });
      }, side);
      await collapse.click();
      const samples = await page.evaluate((name) => {
        const shell = document.getElementById(`${name}Sidebar`);
        const content = document.getElementById(`${name}SidebarContent`);
        const animations = window.__editorCollapseAnimations;
        try {
          return [0.25, 0.5, 0.75].map((fraction) => {
            for (const animation of animations) {
              animation.currentTime = Number(animation.effect.getTiming().duration) * fraction;
            }
            return {
              animationCount: animations.length,
              shell: shell.getBoundingClientRect().width,
              content: content.getBoundingClientRect().width,
              inert: content.inert,
            };
          });
        } finally {
          animations.forEach((animation) => animation.finish());
          delete window.__editorCollapseAnimations;
        }
      }, side);
      for (const sample of samples) {
        expect(sample.animationCount).toBeGreaterThan(0);
        expect(sample.shell).toBeGreaterThan(0);
        expect(sample.shell).toBeLessThan(baseline.shell);
        expect(sample.content, `${side} content at ${width}px`).toBeCloseTo(baseline.content, 1);
        expect(sample.inert).toBe(true);
      }
      // The transparent one-pixel border can remain in the collapsed shell.
      await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
      await expect(content).toHaveJSProperty("inert", true);
      await expect(content).toHaveAttribute("aria-hidden", "true");
      expect(await content.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(baseline.content, 1);
      await collapse.click();
      await expect(collapse).toHaveAttribute("aria-expanded", "true");
      await expect(content).toHaveJSProperty("inert", false);
      await expect(content).toHaveAttribute("aria-hidden", "false");
      await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(baseline.shell, 1);
      await expect(content).toBeVisible();
    }
  }
});

async function captureEntryAnimation(page, trigger, target) {
  await page.evaluate(({ trigger, target }) => {
    const button = document.querySelector(trigger);
    // Native summary activation changes `open` after click listeners run.
    const disclosure = button.tagName === "SUMMARY" ? button.parentElement : null;
    window.__editorEntryAnimationReady = new Promise((resolve) => {
      (disclosure || button).addEventListener(disclosure ? "toggle" : "click", () => {
        const animations = document.querySelector(target).getAnimations().filter((animation) => "animationName" in animation);
        const result = animations.map((animation) => ({
          duration: animation.effect.getTiming().duration,
          frames: animation.effect.getKeyframes().map((frame) => ({
            opacity: Number(frame.opacity),
            hasTransform: Object.hasOwn(frame, "transform"),
            y: frame.transform ? new DOMMatrix(frame.transform).m42 : 0,
          })),
        }));
        animations.forEach((animation) => animation.finish());
        resolve(result);
      }, { once: true });
    });
  }, { trigger, target });
  await page.locator(trigger).click();
  return page.evaluate(async () => {
    const result = await window.__editorEntryAnimationReady;
    delete window.__editorEntryAnimationReady;
    return result;
  });
}

test("entry motion respects reduced motion and mobile drawers retain keyboard focus and Escape", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openWorkspace(page);
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    await page.locator("#editorTaskObjectsBtn").click();
    await page.locator("#editorObjects-countries").click();
    for (const [trigger, target, duration, displaced] of [
      ["#editorTaskLayersBtn", "#editorTask-layers", 140, false],
      ["#appearanceTabCityPoints", "#editorProperty-data-appearance-panel-citypoints", 140, false],
      ["#editorProjectBar .editor-scenario-menu > summary", "#editorProjectBar .editor-scenario-menu > .sidebar-details-body", 160, true],
    ]) {
      const animations = await captureEntryAnimation(page, trigger, target);
      await expect(page.locator(target)).toBeVisible();
      if (reducedMotion === "reduce") {
        expect(animations).toEqual([]);
      } else {
        expect(animations).toHaveLength(1);
        expect(animations[0].duration).toBe(duration);
        const frames = animations[0].frames;
        expect(frames[0].opacity).toBeLessThan(1);
        expect(frames.at(-1).opacity).toBe(1);
        if (displaced) {
          expect(frames[0].y).toBe(-4);
          expect(frames.at(-1).y).toBe(0);
        } else {
          expect(frames.every((frame) => !frame.hasTransform)).toBe(true);
        }
      }
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("#editorProjectBar .editor-scenario-menu")).toHaveJSProperty("open", false);
    await page.setViewportSize({ width: 768, height: 900 });
    for (const side of ["left", "right"]) {
      const toggle = page.locator(`#${side}PanelToggle`);
      const close = page.locator(`[data-close-drawer="${side}"]`);
      await toggle.click();
      await expect(close).toBeFocused();
      await expect(page.locator(`#${side}Sidebar`)).toHaveJSProperty("inert", false);
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate((name) => document.getElementById(`${name}Sidebar`).contains(document.activeElement), side)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(page.locator(`#${side}Sidebar`)).toHaveJSProperty("inert", true);
      await expect(page.locator("body")).not.toHaveClass(new RegExp(`${side}-drawer-open`));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
