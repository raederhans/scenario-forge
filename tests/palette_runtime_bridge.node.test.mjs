import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/core/palette_runtime_bridge.js", import.meta.url), "utf8");
const runtimeBridge = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
const stateDefaultsSource = await readFile(new URL("../js/core/state_defaults.js", import.meta.url), "utf8");
const stateDefaultsDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stateDefaultsSource)}`;
const colorStateSource = await readFile(new URL("../js/core/state/color_state.js", import.meta.url), "utf8");
const patchedColorStateSource = colorStateSource.replace("../state_defaults.js", stateDefaultsDataUrl);
const colorStateModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(patchedColorStateSource)}`);
const colorResolverSource = await readFile(new URL("../js/core/color_resolver.js", import.meta.url), "utf8");
const colorResolverModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(colorResolverSource)}`);

const {
  buildRuntimeDefaultColorsByIso2,
  buildRuntimeDefaultTagByIso2,
  buildScenarioRuntimeDefaultTagColors,
} = runtimeBridge;
const {
  createDefaultColorState,
  normalizeColorStateForRender,
  replaceResolvedColorsState,
  sanitizeRegionOverrideColors,
  setResolvedColorForFeature,
  bumpColorRevision,
} = colorStateModule;
const { resolveFeatureColor } = colorResolverModule;

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
    specialRegionOverrides: { inland: "#123456" },
  });
  assert.deepEqual(colorRuntimeState.waterRegionOverrides, { ocean: "#abcdef" });
  assert.deepEqual(colorRuntimeState.specialRegionOverrides, { inland: "#123456" });
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
