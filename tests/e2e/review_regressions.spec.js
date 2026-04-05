const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(180000);

const APP_URL = getAppUrl();

test("startup partial cache hit keeps cached topology and skips topology refetch", async ({ page, context }) => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  const cacheSetup = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      clearStartupCache,
      createStartupBaseTopologyCacheKey,
      createStartupLocalizationCacheKey,
      loadBuildManifest,
      readStartupCacheEntry,
    } = await import("/js/core/startup_cache.js");
    const { loadStartupBootArtifacts } = await import("/js/core/data_loader.js");

    const topologyUrl = "data/europe_topology.json";
    const localesUrl = "data/locales.startup.json";
    const geoAliasesUrl = "data/geo_aliases.startup.json";

    await clearStartupCache({ force: true });
    await loadStartupBootArtifacts({
      topologyUrl,
      localesUrl,
      geoAliasesUrl,
      localeLevel: "startup",
      useWorker: true,
      useStartupCache: true,
    });

    const buildManifest = await loadBuildManifest();
    const topologyCacheKey = createStartupBaseTopologyCacheKey({
      topologyUrl,
      buildManifest,
    });
    const localizationCacheKey = createStartupLocalizationCacheKey({
      localeLevel: "startup",
      currentLanguage: state.currentLanguage || "en",
      localesUrl,
      geoAliasesUrl,
      buildManifest,
    });

    return {
      topologyUrl,
      localesUrl,
      geoAliasesUrl,
      topologyCacheKey,
      localizationCacheKey,
    };
  });

  await expect.poll(async () => page.evaluate(async ({ topologyCacheKey, localizationCacheKey }) => {
    const { readStartupCacheEntry } = await import("/js/core/startup_cache.js");
    return {
      hasTopologyEntry: !!(await readStartupCacheEntry(topologyCacheKey)),
      hasLocalizationEntry: !!(await readStartupCacheEntry(localizationCacheKey)),
    };
  }, cacheSetup), { timeout: 30000 }).toEqual({
    hasTopologyEntry: true,
    hasLocalizationEntry: true,
  });

  await page.evaluate(async ({ localizationCacheKey }) => {
    const { deleteStartupCacheEntry } = await import("/js/core/startup_cache.js");
    await deleteStartupCacheEntry(localizationCacheKey);
  }, cacheSetup);

  const secondPage = await context.newPage();
  await secondPage.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(secondPage);
  const secondLoadResult = await secondPage.evaluate(async ({ topologyUrl, localesUrl, geoAliasesUrl }) => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    let topologyFetchCount = 0;
    globalThis.fetch = async (...args) => {
      const requestUrl = String(args[0]?.url || args[0] || "");
      if (requestUrl.includes("/data/europe_topology.json")) {
        topologyFetchCount += 1;
      }
      return originalFetch(...args);
    };
    try {
      const { loadStartupBootArtifacts } = await import("/js/core/data_loader.js");
      const result = await loadStartupBootArtifacts({
        topologyUrl,
        localesUrl,
        geoAliasesUrl,
        localeLevel: "startup",
        useWorker: true,
        useStartupCache: true,
      });
      return {
        topologyFetchCount,
        baseTopology: String(result.startupBootCacheState?.baseTopology || ""),
        localization: String(result.startupBootCacheState?.localization || ""),
      };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, cacheSetup);

  expect(secondLoadResult.baseTopology).toBe("hit");
  expect(secondLoadResult.topologyFetchCount).toBe(0);
  expect(secondLoadResult.localization).not.toBe("hit");
  await secondPage.close();
});
