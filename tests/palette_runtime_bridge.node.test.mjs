import test from "node:test";
import assert from "node:assert/strict";

const runtimeBridge = await import("../js/core/palette_runtime_bridge.js");
const colorHexUtilsModule = await import(new URL("../js/core/color_hex_utils.js", import.meta.url));
const colorManagerModule = await import(new URL("../js/core/color_manager.js", import.meta.url));
const {
  buildRuntimeDefaultTagByIso2,
  buildScenarioOwnerColorMapDetails,
} = runtimeBridge;
const { ColorManager } = colorManagerModule;
const {
  normalizeHexColor,
  normalizeHexColorWithFallback,
} = colorHexUtilsModule;
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

test("color manager normalizes palette candidates into valid six-digit hex colors", () => {
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(normalizeHexColorWithFallback("bad", "#ABC"), "#aabbcc");
  assert.equal(ColorManager.normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(ColorManager.normalizeHexColor("#A1B2C3"), "#a1b2c3");
  assert.equal(ColorManager.normalizeHexColor("bad"), null);
});

test("canonical scenario colors survive legacy alias normalization", () => {
  const details = buildScenarioOwnerColorMapDetails(
    { GB: { color_hex: "#b9364c" }, GR: { color_hex: "#4880b6" } },
    {
      ownerTags: ["UK", "EL"],
      palettePack: { entries: { ENG: { map_hex: "#c9385d" } } },
      paletteMap: { mapped: { ENG: { iso2: "GB" } } },
    },
  );
  // UK has a conflicting palette fallback; EL would otherwise get a generated color.
  assert.deepEqual(details.byTag, {
    GB: "#b9364c", GR: "#4880b6", UK: "#b9364c", EL: "#4880b6",
  });
  assert.deepEqual(details.generatedTags, []);
  const normalized = Object.fromEntries(Object.entries(details.byTag).map(([tag, color]) => [
    runtimeBridge.normalizeRuntimeBridgeIso2(tag), color,
  ]));
  assert.deepEqual(normalized, { GB: "#b9364c", GR: "#4880b6" });

});
