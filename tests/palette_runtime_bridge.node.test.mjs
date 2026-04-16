import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/core/palette_runtime_bridge.js", import.meta.url), "utf8");
const runtimeBridge = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);

const {
  buildRuntimeDefaultColorsByIso2,
  buildRuntimeDefaultTagByIso2,
  buildScenarioRuntimeDefaultTagColors,
} = runtimeBridge;

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
