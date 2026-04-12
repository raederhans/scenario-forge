const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);
const APP_URL = getAppUrl();
const EN_LABEL = "Asteria";
const ZH_LABEL = "°¢²â³Ç";
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

async function ensureScenario(page, scenarioId, label) {
  await page.waitForFunction((targetScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${targetScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });

  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });
  if (initialScenarioId !== scenarioId) {
    await page.selectOption("#scenarioSelect", scenarioId);
    const applyButton = page.locator("#applyScenarioBtn");
    if ((await applyButton.isVisible()) && (await applyButton.isEnabled())) {
      await applyButton.click();
    }
  }
  await expect(page.locator("#scenarioStatus")).toContainText(label, { timeout: 20_000 });
  await page.waitForTimeout(800);
}

async function ensureBaseCityDataLoaded(page, reason = "e2e-city-label-i18n") {
  await page.evaluate(async (loadReason) => {
    const { state } = await import("/js/core/state.js");
    if (typeof state.ensureBaseCityDataFn === "function") {
      await state.ensureBaseCityDataFn({ reason: loadReason, renderNow: true });
    }
  }, reason);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return state.baseCityDataState === "loaded"
      && Array.isArray(state.worldCitiesData?.features)
      && state.worldCitiesData.features.length > 0;
  }, { timeout: 120_000 });
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(700);
}

async function waitForStableExactRender(page, { timeout = 20_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

async function ensureLanguage(page, targetLanguage) {
  const currentLanguage = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.currentLanguage || "en");
  });
  if (currentLanguage === targetLanguage) {
    return;
  }
  await page.locator("#btnToggleLang").click();
  await page.waitForFunction(async (expectedLanguage) => {
    const { state } = await import("/js/core/state.js");
    return String(state.currentLanguage || "") === expectedLanguage;
  }, targetLanguage, { timeout: 20_000 });
  await waitForStableExactRender(page);
}

async function clearCityLabelDrawLog(page) {
  await page.evaluate(() => {
    globalThis.__resetE2ECityLabelDraws?.();
  });
}

async function waitForLabelDraw(page, label) {
  await page.waitForFunction((expectedLabel) => {
    const log = Array.isArray(globalThis.__e2eCityLabelDraws) ? globalThis.__e2eCityLabelDraws : [];
    return log.some((entry) => String(entry?.text || "") === expectedLabel);
  }, label, { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const globalKey = "__e2eCityLabelDraws";
    if (!Array.isArray(globalThis[globalKey])) {
      globalThis[globalKey] = [];
    }
    globalThis.__resetE2ECityLabelDraws = () => {
      globalThis[globalKey] = [];
    };
    if (globalThis.__e2eCityLabelDrawHookInstalled) {
      return;
    }
    globalThis.__e2eCityLabelDrawHookInstalled = true;
    const pushEntry = (kind, text) => {
      if (typeof text !== "string") {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const next = Array.isArray(globalThis[globalKey]) ? globalThis[globalKey] : [];
      next.push({ kind, text: trimmed, recordedAt: Date.now() });
      if (next.length > 200) {
        next.splice(0, next.length - 200);
      }
      globalThis[globalKey] = next;
    };
    const patchMethod = (methodName) => {
      const proto = globalThis.CanvasRenderingContext2D?.prototype;
      if (!proto) {
        return;
      }
      const original = proto[methodName];
      if (typeof original !== "function") {
        return;
      }
      proto[methodName] = function patchedCityLabelDraw(text, ...rest) {
        pushEntry(methodName, text);
        return original.call(this, text, ...rest);
      };
    };
    patchMethod("fillText");
    patchMethod("strokeText");
  });
});

test("language toggle redraws city labels immediately without needing pan or zoom", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error") {
      return;
    }
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      return;
    }
    consoleIssues.push({ type, text });
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  });

  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await ensureBaseCityDataLoaded(page);
  await setZoomPercent(page, 320);
  await waitForStableExactRender(page);
  await ensureLanguage(page, "en");

  const targetCityId = await page.evaluate(async ({ enLabel, zhLabel }) => {
    const { state } = await import("/js/core/state.js");
    const { buildCityRevealPlan, getEffectiveCityCollection } = await import("/js/core/map_renderer.js");

    const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const collection = getEffectiveCityCollection();
    const plan = buildCityRevealPlan(collection, Number(transform.k || 1), transform, state.styleConfig?.cityPoints || {});
    const targetEntry = (Array.isArray(plan?.labelEntries) ? plan.labelEntries : []).find(Boolean);
    if (!targetEntry?.feature?.properties) {
      throw new Error("No visible city label entry available for i18n redraw test");
    }
    const targetId = String(targetEntry.cityId || targetEntry.feature.properties.id || targetEntry.feature.id || "");
    const applyOverride = (feature) => {
      if (!feature?.properties) return;
      feature.properties.__city_has_display_name_override = true;
      feature.properties.__city_display_name_override = {
        en: enLabel,
        zh: zhLabel,
      };
    };

    applyOverride(targetEntry.feature);
    (Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : []).forEach((feature) => {
      const props = feature?.properties || {};
      const featureId = String(props.__city_id || props.id || feature?.id || "");
      if (featureId === targetId) {
        applyOverride(feature);
      }
    });
    (Array.isArray(state.scenarioCityOverridesData?.featureCollection?.features)
      ? state.scenarioCityOverridesData.featureCollection.features
      : []).forEach((feature) => {
      const props = feature?.properties || {};
      const featureId = String(props.__city_id || props.id || feature?.id || "");
      if (featureId === targetId) {
        applyOverride(feature);
      }
    });

    state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
    state.renderNowFn?.();
    return targetId;
  }, { enLabel: EN_LABEL, zhLabel: ZH_LABEL });

  expect(targetCityId).toBeTruthy();
  await waitForStableExactRender(page);

  const readLabelState = async () => page.evaluate(async (expectedCityId) => {
    const { state } = await import("/js/core/state.js");
    const { getEffectiveCityCollection } = await import("/js/core/map_renderer.js");
    const feature = (Array.isArray(getEffectiveCityCollection()?.features) ? getEffectiveCityCollection().features : [])
      .find((candidate) => {
        const props = candidate?.properties || {};
        const featureId = String(props.__city_id || props.id || candidate?.id || "");
        return featureId === String(expectedCityId || "");
      }) || null;
    const overrideLabel = feature?.properties?.__city_display_name_override || {};
    return {
      currentLanguage: String(state.currentLanguage || ""),
      label: feature
        ? String(
          state.currentLanguage === "zh"
            ? (overrideLabel.zh || overrideLabel.en || "")
            : (overrideLabel.en || overrideLabel.zh || "")
        )
        : "",
      recordedAt: Number(state.renderPerfMetrics?.drawLabelsPass?.recordedAt || 0),
    };
  }, targetCityId);

  const englishState = await readLabelState();
  expect(englishState.currentLanguage).toBe("en");
  expect(englishState.label).toBe(EN_LABEL);

  await page.locator("#btnToggleLang").click();
  await page.waitForFunction(async (previousRecordedAt) => {
    const { state } = await import("/js/core/state.js");
    return String(state.currentLanguage || "") === "zh"
      && Number(state.renderPerfMetrics?.drawLabelsPass?.recordedAt || 0) > Number(previousRecordedAt || 0);
  }, englishState.recordedAt, { timeout: 20_000 });
  await waitForStableExactRender(page);

  const zhState = await readLabelState();
  expect(zhState.currentLanguage).toBe("zh");
  expect(zhState.label).toBe(ZH_LABEL);

  await page.locator("#btnToggleLang").click();
  await page.waitForFunction(async (previousRecordedAt) => {
    const { state } = await import("/js/core/state.js");
    return String(state.currentLanguage || "") === "en"
      && Number(state.renderPerfMetrics?.drawLabelsPass?.recordedAt || 0) > Number(previousRecordedAt || 0);
  }, zhState.recordedAt, { timeout: 20_000 });
  await waitForStableExactRender(page);

  const finalState = await readLabelState();
  expect(finalState.currentLanguage).toBe("en");
  expect(finalState.label).toBe(EN_LABEL);

  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

