import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/core/palette_runtime_bridge.js", import.meta.url), "utf8");
const runtimeBridge = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
const stateDefaultsSource = await readFile(new URL("../js/core/state_defaults.js", import.meta.url), "utf8");
const colorHexUtilsSource = await readFile(new URL("../js/core/color_hex_utils.js", import.meta.url), "utf8");
const colorHexUtilsDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(colorHexUtilsSource)}`;
const transportCapabilityRegistrySource = await readFile(new URL("../js/core/transport_capability_registry.js", import.meta.url), "utf8");
const transportPackResolverSource = await readFile(new URL("../js/core/transport_pack_resolver.js", import.meta.url), "utf8");
const transportPackResolverDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transportPackResolverSource)}`;
const patchedTransportCapabilityRegistrySource = transportCapabilityRegistrySource.replace(
  "./transport_pack_resolver.js",
  transportPackResolverDataUrl,
);
const transportCapabilityRegistryDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(patchedTransportCapabilityRegistrySource)}`;
const countryFeaturePoliciesSource = await readFile(new URL("../js/core/country_feature_policies.js", import.meta.url), "utf8");
const countryFeaturePoliciesJsonSource = await readFile(new URL("../data/country_feature_policies.json", import.meta.url), "utf8");
const countryFeaturePoliciesJsonDataUrl = `data:application/json,${encodeURIComponent(countryFeaturePoliciesJsonSource)}`;
const patchedCountryFeaturePoliciesSource = countryFeaturePoliciesSource.replace(
  "../../data/country_feature_policies.json",
  countryFeaturePoliciesJsonDataUrl,
);
const countryFeaturePoliciesDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(patchedCountryFeaturePoliciesSource)}`;
const patchedStateDefaultsSource = stateDefaultsSource
  .replace("./color_hex_utils.js", colorHexUtilsDataUrl)
  .replace("./transport_capability_registry.js", transportCapabilityRegistryDataUrl)
  .replace("./transport_pack_resolver.js", transportPackResolverDataUrl)
  .replace("./country_feature_policies.js", countryFeaturePoliciesDataUrl);
const stateDefaultsDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(patchedStateDefaultsSource)}`;
const colorStateSource = await readFile(new URL("../js/core/state/color_state.js", import.meta.url), "utf8");
const patchedColorStateSource = colorStateSource
  .replace("../state_defaults.js", stateDefaultsDataUrl)
  .replace("../color_hex_utils.js", colorHexUtilsDataUrl);
const colorStateModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(patchedColorStateSource)}`);
const colorResolverModule = await import(new URL("../js/core/color_resolver.js", import.meta.url));
const colorHexUtilsModule = await import(new URL("../js/core/color_hex_utils.js", import.meta.url));
const colorManagerModule = await import(new URL("../js/core/color_manager.js", import.meta.url));
const countryCodeAliasesSource = await readFile(new URL("../js/core/country_code_aliases.js", import.meta.url), "utf8");
const countryCodeAliasesDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(countryCodeAliasesSource)}`;
const featureIdentitySharedSource = await readFile(new URL("../js/core/feature_identity_shared.js", import.meta.url), "utf8");
const featureIdentitySharedDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(featureIdentitySharedSource)}`;
const featureIdentitySource = await readFile(new URL("../js/core/feature_identity.js", import.meta.url), "utf8");
const patchedFeatureIdentitySource = featureIdentitySource
  .replace("./feature_identity_shared.js", featureIdentitySharedDataUrl)
  .replace("./country_code_aliases.js", countryCodeAliasesDataUrl);
const featureIdentityModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(patchedFeatureIdentitySource)}`);
const startupWorkerSource = await readFile(new URL("../js/workers/startup_boot.worker.js", import.meta.url), "utf8");
const startupWorkerHelperStart = startupWorkerSource.indexOf("const COUNTRY_CODE_ALIASES");
const startupWorkerHelperEnd = startupWorkerSource.indexOf("async function fetchJsonResource", startupWorkerHelperStart);
const startupWorkerHelperSource = `${featureIdentitySharedSource}
${startupWorkerSource.slice(startupWorkerHelperStart, startupWorkerHelperEnd)}
export {
  getFeatureId,
  getFeatureCountryCodeNormalized,
};`;
const startupWorkerFeatureIdentityModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(startupWorkerHelperSource)}`
);

const {
  buildRuntimeDefaultColorsByIso2,
  buildRuntimeDefaultTagByIso2,
  buildScenarioOwnerColorMap,
  buildScenarioOwnerColorMapDetails,
  buildScenarioRuntimeDefaultTagColors,
} = runtimeBridge;
const {
  collectColorStateConsistencyIssues,
  createDefaultColorState,
  normalizeColorStateForRender,
  replaceResolvedColorsState,
  sanitizeRegionOverrideColors,
  setResolvedColorForFeature,
  bumpColorRevision,
} = colorStateModule;
const { resolveFeatureColor } = colorResolverModule;
const { ColorManager } = colorManagerModule;
const {
  getHexRelativeLuminance,
  mixHexColors,
  normalizeHexColor,
  normalizeHexColorWithFallback,
} = colorHexUtilsModule;
const { getCountryCode, getFeatureId, getStableKey } = featureIdentityModule;
const {
  getFeatureId: getStartupWorkerFeatureId,
  getFeatureCountryCodeNormalized,
} = startupWorkerFeatureIdentityModule;

test("buildRuntimeDefaultTagByIso2 keeps one exposed bridge per iso2", () => {
  assert.deepEqual(
    buildRuntimeDefaultTagByIso2({
      mapped: {
        MAN: { iso2: "CN", expose_as_runtime_default: false },
        CHI: { iso2: "CN" },
        FFR: { iso2: "FR" },
        BRG: { iso2: "FR", expose_as_runtime_default: false },
      },
    }),
    {
      CN: "CHI",
      FR: "FFR",
    },
  );
});

test("buildRuntimeDefaultColorsByIso2 uses exposed palette bridge colors", () => {
  assert.deepEqual(
    buildRuntimeDefaultColorsByIso2(
      {
        entries: {
          CHI: { map_hex: "#ce9f61" },
          FFR: { map_hex: "#464678" },
        },
      },
      {
        mapped: {
          MAN: { iso2: "CN", expose_as_runtime_default: false },
          CHI: { iso2: "CN" },
          FFR: { iso2: "FR" },
          BRG: { iso2: "FR", expose_as_runtime_default: false },
        },
      },
    ),
    {
      CN: "#ce9f61",
      FR: "#464678",
    },
  );
});

test("buildScenarioRuntimeDefaultTagColors pushes canonical bridge colors into scenario tags", () => {
  const { byIso2, byTag } = buildScenarioRuntimeDefaultTagColors(
    {
      CHI: { color_hex: "#ce9f61", base_iso2: "CN", lookup_iso2: "CN" },
      MAN: { color_hex: "#a80043", base_iso2: "CN", lookup_iso2: "CN" },
      GNG: { color_hex: "#7a2e41", base_iso2: "CN", lookup_iso2: "CN" },
      RAJ: { color_hex: "#cc5668", base_iso2: "IN", lookup_iso2: "IN" },
      FRI: { color_hex: "#2a62a2", base_iso2: "IN", lookup_iso2: "IN" },
      RKM: { color_hex: "#4f4554", base_iso2: "RU", lookup_iso2: "RU" },
      SVR: { color_hex: "#8c6e7c", base_iso2: "RU", lookup_iso2: "RU" },
    },
    {
      palettePack: {
        entries: {
          CHI: { map_hex: "#ce9f61" },
          FRI: { map_hex: "#2a62a2" },
          SVR: { map_hex: "#8c6e7c" },
        },
      },
      paletteMap: {
        mapped: {
          CHI: { iso2: "CN" },
          MAN: { iso2: "CN", expose_as_runtime_default: false },
          GNG: { iso2: "CN", expose_as_runtime_default: false },
          FRI: { iso2: "IN" },
          SVR: { iso2: "RU" },
        },
      },
    },
  );

  assert.deepEqual(byIso2, {
    CN: "#ce9f61",
    IN: "#2a62a2",
    RU: "#8c6e7c",
  });
  assert.equal(byTag.CHI, "#ce9f61");
  assert.equal(byTag.MAN, "#ce9f61");
  assert.equal(byTag.GNG, "#ce9f61");
  assert.equal(byTag.RAJ, "#2a62a2");
  assert.equal(byTag.FRI, "#2a62a2");
  assert.equal(byTag.RKM, "#8c6e7c");
  assert.equal(byTag.SVR, "#8c6e7c");
});

test("color state accessors replace colors, patch individual entries, and bump revision", () => {
  const colorRuntimeState = createDefaultColorState();

  replaceResolvedColorsState(colorRuntimeState, {
    A: "#112233",
  });
  assert.deepEqual(colorRuntimeState.colors, {
    A: "#112233",
  });
  assert.equal(colorRuntimeState.colorRevision, undefined);

  const applied = setResolvedColorForFeature(colorRuntimeState, "B", "#445566");
  assert.equal(applied, true);
  assert.equal(colorRuntimeState.colors.B, "#445566");

  const deleted = setResolvedColorForFeature(colorRuntimeState, "A", null);
  assert.equal(deleted, false);
  assert.equal("A" in colorRuntimeState.colors, false);

  assert.equal(bumpColorRevision(colorRuntimeState), 1);
  assert.equal(colorRuntimeState.colorRevision, 1);

  const sparseState = {};
  assert.equal(setResolvedColorForFeature(sparseState, "C", "#778899"), true);
  assert.deepEqual(sparseState.colors, { C: "#778899" });
});

test("color state accessor sanitizes water and special overrides through injected mapper", () => {
  const colorRuntimeState = createDefaultColorState();
  colorRuntimeState.waterRegionOverrides = {
    ocean: "#ABCDEF",
  };
  colorRuntimeState.specialRegionOverrides = {
    inland: "#123456",
  };

  const next = sanitizeRegionOverrideColors(colorRuntimeState, {
    sanitizeColorMap(value) {
      const entries = Object.entries(value || {}).map(([key, color]) => [
        key,
        String(color || "").trim().toLowerCase(),
      ]);
      return Object.fromEntries(entries);
    },
  });

  assert.deepEqual(next, {
    waterRegionOverrides: { ocean: "#abcdef" },
    specialRegionOverrides: {},
  });
  assert.deepEqual(colorRuntimeState.waterRegionOverrides, { ocean: "#abcdef" });
  assert.deepEqual(colorRuntimeState.specialRegionOverrides, {});
});

test("normalizeColorStateForRender sanitizes mirrors and resolved colors together", () => {
  const colorRuntimeState = createDefaultColorState();
  colorRuntimeState.sovereignBaseColors = { AAA: "#AABBCC" };
  colorRuntimeState.visualOverrides = { feature_1: "#DDEEFF" };
  colorRuntimeState.colors = { feature_2: "#ABCDEF" };

  normalizeColorStateForRender(colorRuntimeState, {
    sanitizeColorMap(value) {
      return Object.fromEntries(
        Object.entries(value || {}).map(([key, color]) => [key, String(color || "").toLowerCase()]),
      );
    },
    sanitizeCountryColorMap(value) {
      return Object.fromEntries(
        Object.entries(value || {}).map(([key, color]) => [key, String(color || "").toLowerCase()]),
      );
    },
  });

  assert.deepEqual(colorRuntimeState.countryBaseColors, { AAA: "#aabbcc" });
  assert.deepEqual(colorRuntimeState.featureOverrides, { feature_1: "#ddeeff" });
  assert.deepEqual(colorRuntimeState.colors, { feature_2: "#abcdef" });
});

test("color state consistency checker reports mirror drift before normalization", () => {
  const colorRuntimeState = createDefaultColorState();
  colorRuntimeState.sovereignBaseColors = { AAA: "#112233" };
  colorRuntimeState.countryBaseColors = { BBB: "#445566" };
  colorRuntimeState.visualOverrides = { feature_1: "#778899" };
  colorRuntimeState.featureOverrides = { feature_1: "#aabbcc", feature_2: "#ddeeff" };

  const issues = collectColorStateConsistencyIssues(colorRuntimeState);
  const issueLabels = issues.map((issue) => `${issue.mirror}:${issue.key}:${issue.kind}`);
  assert.deepEqual(issueLabels, [
    "sovereignBaseColors<->countryBaseColors:AAA:missing-key",
    "sovereignBaseColors<->countryBaseColors:BBB:missing-key",
    "visualOverrides<->featureOverrides:feature_1:value-mismatch",
    "visualOverrides<->featureOverrides:feature_2:missing-key",
  ]);

  normalizeColorStateForRender(colorRuntimeState, {
    sanitizeColorMap: (value) => value || {},
    sanitizeCountryColorMap: (value) => value || {},
  });
  assert.deepEqual(collectColorStateConsistencyIssues(colorRuntimeState), []);
});

test("color manager cache signature is stable across object key order", () => {
  const left = ColorManager.getOwnerColorCacheSignature({
    featureIds: ["B", "A"],
    sovereigntyByFeatureId: { B: "FR", A: "DE" },
    fixedOwnerColors: { FR: "#112233", DE: "#445566" },
    canonicalCountryByFeatureId: { B: "FR", A: "DE" },
  });
  const right = ColorManager.getOwnerColorCacheSignature({
    featureIds: ["B", "A"],
    sovereigntyByFeatureId: { A: "DE", B: "FR" },
    fixedOwnerColors: { DE: "#445566", FR: "#112233" },
    canonicalCountryByFeatureId: { A: "DE", B: "FR" },
  });

  assert.equal(left, right);
});

test("color manager normalizes palette candidates into valid six-digit hex colors", () => {
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(normalizeHexColorWithFallback("bad", "#ABC"), "#aabbcc");
  assert.equal(mixHexColors("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(getHexRelativeLuminance("#000000"), 0);
  assert.equal(getHexRelativeLuminance("#ffffff"), 1);
  assert.equal(ColorManager.normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(ColorManager.normalizeHexColor("#A1B2C3"), "#a1b2c3");
  assert.equal(ColorManager.normalizeHexColor("bad"), null);
  assert.equal(ColorManager.mixHexColors("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(ColorManager.getHexRelativeLuminance("#000000"), 0);
  assert.equal(ColorManager.getHexRelativeLuminance("#ffffff"), 1);
  assert.match(ColorManager.getPoliticalFallbackColor("test-token", 3), /^#[0-9a-f]{6}$/);
});

test("color manager cache helpers trim caches and expose explicit reset", () => {
  const originalRegionLimit = ColorManager.regionColorCacheLimit;
  const originalLabLimit = ColorManager.labCacheLimit;
  ColorManager.clearRuntimeCaches();
  ColorManager.regionColorCacheLimit = 2;
  ColorManager.labCacheLimit = 2;

  ColorManager.getRegionColor("A");
  ColorManager.getRegionColor("B");
  ColorManager.getRegionColor("C");
  ColorManager.colorToLab("#112233");
  ColorManager.colorToLab("#445566");
  ColorManager.colorToLab("#778899");

  assert.equal(ColorManager.regionColorMap.size <= 2, true);
  assert.equal(ColorManager.labCache.size <= 2, true);
  assert.deepEqual(ColorManager.getRuntimeCacheSnapshot(), {
    regionColorEntries: 2,
    regionColorCacheLimit: 2,
    labCacheEntries: 2,
    labCacheLimit: 2,
    ownerColorCacheReady: false,
    ownerColorCacheSignature: "",
  });

  ColorManager.clearRuntimeCaches();
  assert.equal(ColorManager.regionColorMap.size, 0);
  assert.equal(ColorManager.labCache.size, 0);

  ColorManager.regionColorCacheLimit = originalRegionLimit;
  ColorManager.labCacheLimit = originalLabLimit;
});

test("feature identity helper normalizes ids, country codes, and stable keys from shared fallback chains", () => {
  const feature = {
    id: "GB-001",
    properties: {
      NUTS_ID: "GB-ALT",
      iso_a2: "uk",
      stable_key: "stable::gb-001",
    },
  };

  assert.equal(getFeatureId(feature, { fallback: "fallback-id" }), "GB-ALT");
  assert.equal(getCountryCode(feature), "GB");
  assert.equal(getStableKey(feature), "stable::gb-001");
  assert.equal(getCountryCode({ id: "RU_shell_01", properties: {} }), "RU");
  assert.equal(getCountryCode({ id: "ZZ_001", properties: {} }), "");
});

test("startup worker feature identity helpers stay aligned with shared main-thread rules", () => {
  const samples = [
    {
      id: "GB-001",
      properties: {
        NUTS_ID: "GB-ALT",
        iso_a2: "uk",
      },
    },
    {
      id: "CITY::washington",
      properties: {
        countryCode: "us",
        stableKey: "city::washington",
      },
    },
    {
      id: "RU_shell_01",
      properties: {},
    },
    {
      id: "ZZ_001",
      properties: {},
    },
  ];

  for (const feature of samples) {
    assert.equal(getStartupWorkerFeatureId(feature), getFeatureId(feature));
    assert.equal(getFeatureCountryCodeNormalized(feature), getCountryCode(feature));
  }
});

test("buildScenarioOwnerColorMap keeps scenario colors before palette and generates missing tag colors", () => {
  const firstDetails = buildScenarioOwnerColorMapDetails(
    {
      GER: { color_hex: "#111111", base_iso2: "DE", lookup_iso2: "DE" },
      USA: { base_iso2: "US", lookup_iso2: "US" },
      ABC: { display_name: "No Palette Country" },
    },
    {
      palettePack: {
        entries: {
          GER: { map_hex: "#222222" },
          USA: { map_hex: "#333333" },
        },
      },
      paletteMap: {
        mapped: {
          GER: { iso2: "DE" },
          USA: { iso2: "US" },
        },
      },
    },
  );
  const first = firstDetails.byTag;
  const second = buildScenarioOwnerColorMap(
    {
      ABC: { display_name: "No Palette Country" },
    },
    {
      palettePack: { entries: {} },
      paletteMap: { mapped: {} },
    },
  );

  assert.equal(first.GER, "#111111");
  assert.equal(first.USA, "#333333");
  assert.match(first.ABC, /^#[0-9a-f]{6}$/);
  assert.equal(second.ABC, first.ABC);
  assert.deepEqual(firstDetails.generatedTags, ["ABC"]);
});

test("buildScenarioOwnerColorMapDetails keeps seed tag colors above palette and ISO2 bridge", () => {
  const details = buildScenarioOwnerColorMapDetails(
    {
      GER: { color_hex: "#111111", base_iso2: "DE", lookup_iso2: "DE" },
      AUS: { base_iso2: "DE", lookup_iso2: "DE" },
    },
    {
      seedColorByTag: {
        GER: "#444444",
      },
      palettePack: {
        entries: {
          GER: { map_hex: "#222222" },
        },
      },
      paletteMap: {
        mapped: {
          GER: { iso2: "DE" },
          AUS: { iso2: "DE", expose_as_runtime_default: false },
        },
      },
    },
  );

  assert.equal(details.byTag.GER, "#444444");
  assert.equal(details.byTag.AUS, "#222222");
  assert.deepEqual(details.generatedTags, []);
});

test("buildScenarioOwnerColorMapDetails colors owner tags outside country map", () => {
  const ownerCodes = ["CF", "CG", "CM", "CY", "EH", "GA", "MT", "TW", "VA"];
  const details = buildScenarioOwnerColorMapDetails(
    {
      GER: { color_hex: "#111111", base_iso2: "DE", lookup_iso2: "DE" },
    },
    {
      ownerTags: ownerCodes,
      palettePack: {
        entries: {
          CAF: { map_hex: "#224466" },
          CMR: { map_hex: "#335577" },
          MLT: { map_hex: "#446688" },
          TWN: { map_hex: "#557799" },
        },
      },
      paletteMap: {
        mapped: {
          CAF: { iso2: "CF" },
          CMR: { iso2: "CM" },
          MLT: { iso2: "MT" },
          TWN: { iso2: "TW" },
        },
      },
    },
  );

  for (const code of ownerCodes) {
    assert.match(details.byTag[code], /^#[0-9a-f]{6}$/);
  }
  assert.equal(details.byTag.CF, "#224466");
  assert.equal(details.byTag.CM, "#335577");
  assert.equal(details.byTag.MT, "#446688");
  assert.equal(details.byTag.TW, "#557799");
  assert.deepEqual([...details.generatedTags].sort(), ["CG", "CY", "EH", "GA", "VA"]);
});

test("buildScenarioOwnerColorMapDetails keeps explicit colors above owner-universe fallback", () => {
  const details = buildScenarioOwnerColorMapDetails(
    {
      GER: { color_hex: "#111111", base_iso2: "DE", lookup_iso2: "DE" },
      FRA: { color_hex: "#222222", base_iso2: "FR", lookup_iso2: "FR" },
    },
    {
      ownerTags: ["GER", "FRA", "CM"],
      seedColorByTag: {
        GER: "#333333",
      },
      palettePack: {
        entries: {
          GER: { map_hex: "#444444" },
          FRA: { map_hex: "#555555" },
          CMR: { map_hex: "#666666" },
        },
      },
      paletteMap: {
        mapped: {
          GER: { iso2: "DE" },
          FRA: { iso2: "FR" },
          CMR: { iso2: "CM" },
        },
      },
    },
  );

  assert.equal(details.byTag.GER, "#333333");
  assert.equal(details.byTag.FRA, "#222222");
  assert.equal(details.byTag.CM, "#666666");
  assert.deepEqual(details.generatedTags, []);
});

test("buildScenarioOwnerColorMapDetails preserves TNO mixed-policy explicit colors", () => {
  const details = buildScenarioOwnerColorMapDetails(
    {
      CHI: { color_hex: "#ce9f61", base_iso2: "CN", lookup_iso2: "CN" },
      MAN: { color_hex: "#a80043", base_iso2: "CN", lookup_iso2: "CN" },
      GNG: { color_hex: "#7a2e41", base_iso2: "CN", lookup_iso2: "CN" },
      RAJ: { color_hex: "#cc5668", base_iso2: "IN", lookup_iso2: "IN" },
      FRI: { color_hex: "#2a62a2", base_iso2: "IN", lookup_iso2: "IN" },
      RKM: { color_hex: "#4f4554", base_iso2: "RU", lookup_iso2: "RU" },
      SVR: { color_hex: "#8c6e7c", base_iso2: "RU", lookup_iso2: "RU" },
    },
    {
      palettePack: {
        entries: {
          CHI: { map_hex: "#000001" },
          FRI: { map_hex: "#000002" },
          SVR: { map_hex: "#000003" },
        },
      },
      paletteMap: {
        mapped: {
          CHI: { iso2: "CN" },
          MAN: { iso2: "CN", expose_as_runtime_default: false },
          GNG: { iso2: "CN", expose_as_runtime_default: false },
          FRI: { iso2: "IN" },
          SVR: { iso2: "RU" },
        },
      },
    },
  );

  assert.deepEqual(details.byTag, {
    CHI: "#ce9f61",
    MAN: "#a80043",
    GNG: "#7a2e41",
    RAJ: "#cc5668",
    FRI: "#2a62a2",
    RKM: "#4f4554",
    SVR: "#8c6e7c",
  });
  assert.deepEqual(details.generatedTags, []);
});

test("checked-in scenarios declare expected palette and complete colors", async () => {
  const expectedPaletteIds = {
    blank_base: "hoi4_vanilla",
    hoi4_1936: "hoi4_vanilla",
    hoi4_1939: "hoi4_vanilla",
    modern_world: "hoi4_vanilla",
    tno_1962: "tno",
  };
  const scenarioIds = Object.keys(expectedPaletteIds);
  for (const scenarioId of scenarioIds) {
    const manifest = JSON.parse(
      await readFile(new URL(`../data/scenarios/${scenarioId}/manifest.json`, import.meta.url), "utf8"),
    );
    const countriesPayload = JSON.parse(
      await readFile(new URL(`../data/scenarios/${scenarioId}/countries.json`, import.meta.url), "utf8"),
    );
    const missingColorTags = Object.entries(countriesPayload.countries || {})
      .filter(([, entry]) => !/^#[0-9a-f]{6}$/i.test(String(entry?.color_hex || "").trim()))
      .map(([tag]) => tag);

    assert.equal(manifest.palette_id, expectedPaletteIds[scenarioId], `${scenarioId} palette_id`);
    assert.deepEqual(missingColorTags, [], `${scenarioId} missing color_hex tags`);
  }
});

test("resolveFeatureColor reports canonical color source before compatibility mirrors", () => {
  const colorRuntimeState = createDefaultColorState();
  colorRuntimeState.visualOverrides = { feature_1: "#112233" };
  colorRuntimeState.featureOverrides = { feature_1: "#445566" };
  colorRuntimeState.sovereignBaseColors = { AAA: "#778899" };
  colorRuntimeState.countryBaseColors = { AAA: "#aabbcc" };

  assert.deepEqual(
    resolveFeatureColor("feature_1", {
      state: colorRuntimeState,
      getOwnerCode: () => "AAA",
    }),
    {
      color: "#112233",
      source: "visualOverrides",
      featureId: "feature_1",
      ownerCode: "",
    },
  );

  delete colorRuntimeState.visualOverrides.feature_1;
  delete colorRuntimeState.featureOverrides.feature_1;
  assert.deepEqual(
    resolveFeatureColor("feature_1", {
      state: colorRuntimeState,
      getOwnerCode: () => "AAA",
    }),
    {
      color: "#778899",
      source: "sovereignBaseColors",
      featureId: "feature_1",
      ownerCode: "AAA",
    },
  );
});

test("resolveFeatureColor applies strategic choropleth lens when metric data is active", () => {
  const colorRuntimeState = createDefaultColorState();
  colorRuntimeState.strategicChoroplethMetric = "steel";
  colorRuntimeState.scenarioStrategicValuesData = {
    metrics: {
      steel: { kind: "additive", min: 0, max: 12, p95: 10 },
    },
    bucketByFeature: {
      feature_1: "s1",
    },
    buckets: {
      s1: { steel: 5 },
    },
    resourcePoints: {
      type: "FeatureCollection",
      features: [],
    },
    diagnostics: {
      errors: [],
    },
  };
  colorRuntimeState.visualOverrides = { feature_1: "#112233" };
  colorRuntimeState.sovereignBaseColors = { AAA: "#778899" };

  const resolved = resolveFeatureColor("feature_1", {
    state: colorRuntimeState,
    getOwnerCode: () => "AAA",
  });

  assert.equal(resolved.source, "strategic:steel");
  assert.equal(resolved.featureId, "feature_1");
  assert.match(resolved.color, /^#[0-9a-f]{6}$/);

  colorRuntimeState.scenarioStrategicValuesData.diagnostics.errors = [{ code: "baseline_hash_mismatch" }];
  assert.deepEqual(
    resolveFeatureColor("feature_1", {
      state: colorRuntimeState,
      getOwnerCode: () => "AAA",
    }),
    {
      color: "#112233",
      source: "visualOverrides",
      featureId: "feature_1",
      ownerCode: "",
    },
  );
});
