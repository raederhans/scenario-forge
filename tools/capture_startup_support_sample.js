#!/usr/bin/env node

const { chromium } = require("playwright");

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:8000/app/",
    scenarioId: "tno_1962",
    language: "en",
    sampleLabel: "default",
    mode: "default",
    timeoutMs: 30000,
    settleMs: 12000,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--base-url" && next) {
      args.baseUrl = next;
      index += 1;
    } else if (token === "--scenario-id" && next) {
      args.scenarioId = next;
      index += 1;
    } else if (token === "--language" && next) {
      args.language = next;
      index += 1;
    } else if (token === "--sample-label" && next) {
      args.sampleLabel = next;
      index += 1;
    } else if (token === "--mode" && next) {
      args.mode = next;
      index += 1;
    } else if (token === "--timeout-ms" && next) {
      args.timeoutMs = Number(next) || args.timeoutMs;
      index += 1;
    } else if (token === "--settle-ms" && next) {
      args.settleMs = Number(next) || args.settleMs;
      index += 1;
    }
  }
  return args;
}

function buildTargetUrl(baseUrl, { sampleLabel, scenarioId }) {
  const url = new URL(baseUrl);
  if (scenarioId) {
    url.searchParams.set("default_scenario", String(scenarioId).trim());
  }
  url.searchParams.set("startup_support_audit", "1");
  url.searchParams.set("startup_support_audit_defer", "1");
  if (sampleLabel) {
    url.searchParams.set("startup_support_audit_label", sampleLabel);
  }
  return url.toString();
}

async function runProbe(page, mode) {
  return page.evaluate(async ({ mode }) => {
    const { state } = await import("/js/core/state.js");
    const i18n = await import("/js/ui/i18n.js");
    const {
      getGeoFeatureDisplayLabel,
      getTooltipText,
      getPreferredGeoLabel,
      getStrictGeoLabel,
      consumeStartupSupportKeyUsageAuditReport,
    } = i18n;

    const probe = (value) => {
      if (!value) return;
      getPreferredGeoLabel([value], "");
      getStrictGeoLabel([value], "");
    };

    const countryNames = Object.values(state.countryNames || {}).slice(0, 240);
    countryNames.forEach(probe);

    const waterFeatures = Array.isArray(state.scenarioWaterRegionsData?.features)
      ? state.scenarioWaterRegionsData.features.slice(0, 160)
      : [];
    waterFeatures.forEach((feature) => {
      const props = feature?.properties || {};
      [props.id, props.label, props.name, props.parent_id].forEach(probe);
    });
    const baseWaterFeatures = Array.isArray(state.waterRegionsData?.features)
      ? state.waterRegionsData.features.slice(0, 240)
      : [];

    if (mode === "alias-probe" || mode === "full") {
      const aliasEntries = Object.entries(state.baseGeoAliasToStableKey || {}).slice(0, 400);
      aliasEntries.forEach(([alias]) => probe(alias));
    }

    if (mode === "city-probe" || mode === "full") {
      const cityFeatures = Array.isArray(state.worldCitiesData?.features)
        ? state.worldCitiesData.features.slice(0, 160)
        : [];
      cityFeatures.forEach((feature) => {
        const props = feature?.properties || {};
        [
          props.name,
          props.name_en,
          props.name_zh,
          props.__city_host_feature_id,
          ...(Array.isArray(props.__city_aliases) ? props.__city_aliases.slice(0, 4) : []),
        ].forEach(probe);
      });
    }

    if (mode === "tooltip-probe" || mode === "full") {
      const landFeatures = Array.isArray(state.landData?.features)
        ? state.landData.features.slice(0, 180)
        : [];
      landFeatures.forEach((feature) => {
        getTooltipText(feature);
        getGeoFeatureDisplayLabel(feature, "");
      });
      waterFeatures.slice(0, 80).forEach((feature) => {
        getTooltipText(feature);
        getGeoFeatureDisplayLabel(feature, "");
      });
    }

    if (mode === "inspector-probe" || mode === "full") {
      const countryCodes = Object.keys(state.scenarioCountriesByTag || {}).slice(0, 120);
      countryCodes.forEach(probe);
      const runtimeFeatureIds = Array.isArray(state.runtimeFeatureIds) ? state.runtimeFeatureIds.slice(0, 160) : [];
      runtimeFeatureIds.forEach(probe);
    }

    if (mode === "water-family-probe" || mode === "full") {
      waterFeatures.forEach((feature) => {
        const props = feature?.properties || {};
        [
          props.id,
          props.label,
          props.name,
          props.parent_id,
          props.source_id,
        ].forEach(probe);
      });
      baseWaterFeatures.forEach((feature) => {
        const props = feature?.properties || {};
        [
          props.id,
          props.label,
          props.name,
          props.parent_id,
          props.source_id,
        ].forEach(probe);
      });
    }

    const usage = consumeStartupSupportKeyUsageAuditReport();
    return {
      usage,
      activeScenarioId: String(state.activeScenarioId || ""),
    };
  }, { mode });
}

async function postUsage(page, { scenarioId, sampleLabel, usage }) {
  return page.evaluate(async ({ scenarioId, sampleLabel, usage }) => {
    const response = await fetch("/__dev/startup-support/key-usage-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId,
        source: "sampling-harness",
        sampleLabel,
        usage,
      }),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, { scenarioId, sampleLabel, usage });
}

async function main() {
  const args = parseArgs(process.argv);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  if (String(args.language).trim().toLowerCase() === "zh") {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("map_lang", "zh");
      } catch (_error) {
        // Ignore storage failures during sampling.
      }
    });
  }

  page.on("console", (msg) => {
    console.log(`[console] ${msg.type()} ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      console.log(`[http] ${response.status()} ${response.url()}`);
    }
  });

  const targetUrl = buildTargetUrl(args.baseUrl, {
    sampleLabel: args.sampleLabel,
    scenarioId: args.scenarioId,
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: args.timeoutMs });
  await page.waitForTimeout(args.settleMs);

  const { usage, activeScenarioId } = await runProbe(page, args.mode);
  if (!usage) {
    throw new Error("No startup support usage payload was captured.");
  }
  const postResult = await postUsage(page, {
    scenarioId: activeScenarioId || args.scenarioId,
    sampleLabel: args.sampleLabel,
    usage,
  });
  if (!postResult.ok) {
    throw new Error(`Unable to persist startup support sample: ${postResult.status} ${postResult.body}`);
  }

  console.log(JSON.stringify({
    scenarioId: activeScenarioId || args.scenarioId,
    language: args.language,
    sampleLabel: args.sampleLabel,
    mode: args.mode,
    queryKeyCount: Array.isArray(usage.queryKeys) ? usage.queryKeys.length : 0,
    directLocaleKeyCount: Array.isArray(usage.directLocaleKeys) ? usage.directLocaleKeys.length : 0,
    aliasKeyCount: Array.isArray(usage.aliasKeys) ? usage.aliasKeys.length : 0,
    aliasTargetKeyCount: Array.isArray(usage.aliasTargetKeys) ? usage.aliasTargetKeys.length : 0,
    missKeyCount: Array.isArray(usage.missKeys) ? usage.missKeys.length : 0,
  }, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
