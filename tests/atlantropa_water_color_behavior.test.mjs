import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { resolveAtlantropaSeaFillColor } from "../js/core/scenario/atlantropa_sea_color.js";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const declarations = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body;

function colorHarness(runtimeState) {
  const names = [
    "getAtlantropaSaltFlatManifestFillColor",
    "getAtlantropaShoalManifestFillColor",
    "getAtlantropaRuleColor",
    "getAtlantropaSeaPoliticalFillColor",
    "getAtlantropaSeaFillColor",
    "getOceanBaseFillColor",
  ];
  const functions = names.map((name) => declarations.find((node) =>
    node.type === "FunctionDeclaration" && node.id.name === name));
  assert.ok(functions.every(Boolean), "expected renderer color functions to exist");
  const context = vm.createContext({
    runtimeState,
    resolveAtlantropaSeaFillColor,
    OCEAN_FILL_COLOR: "#aadaff",
    getSafeCanvasColor: (value, fallback) =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback,
  });
  vm.runInContext(functions.map(({ start, end }) => source.slice(start, end)).join("\n"), context);
  return context;
}

test("Atlantropa sea uses its manifest color until the user changes the ocean; salt flats and shoals keep manifest colors", () => {
  const runtimeState = {
    styleConfig: { ocean: { fillColor: "#112233" } },
    activeScenarioManifest: {
      style_defaults: {
        ocean: { fillColor: "#112233" },
        atlantropa_sea: { fillColor: "#203856" },
        atlantropa_salt_flat: { fillColor: "#7c6f53" },
        atlantropa_shoal: { fillColor: "#3a5d70" },
      },
    },
  };
  const colors = colorHarness(runtimeState);

  assert.equal(colors.getAtlantropaRuleColor("atlantropa_sea"), "#203856");
  assert.equal(colors.getAtlantropaSeaPoliticalFillColor(), "#203856");

  runtimeState.styleConfig.ocean.fillColor = "#445566";
  assert.equal(colors.getAtlantropaRuleColor("atlantropa_sea"), "#445566");
  assert.equal(colors.getAtlantropaSeaPoliticalFillColor(), "#445566");
  assert.equal(colors.getAtlantropaRuleColor("salt_flat"), "#7c6f53");
  assert.equal(colors.getAtlantropaRuleColor("shoal_pattern"), "#3a5d70");

  delete runtimeState.activeScenarioManifest.style_defaults.ocean;
  runtimeState.styleConfig.ocean.fillColor = "#112233";
  assert.equal(colors.getAtlantropaRuleColor("atlantropa_sea"), "#112233");
});
