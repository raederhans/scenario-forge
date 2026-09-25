import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const declaration = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
  .find(node => node.type === "FunctionDeclaration" && node.id.name === "evaluateSkipFeature");

test("large-country shell exemption allows valid wide bounds but rejects spherical complements", () => {
  let spherical = { invalid: true, isWorldBounds: true };
  const scope = vm.createContext({
    debugMode: "PROD", getFeatureId: () => "RU_ARCTIC_FB_9426",
    isKnownBadFeatureId: () => false, getFeatureCountryCodeNormalized: () => "RU",
    getProjectedFeatureBounds: () => [[0, 0], [800, 400]],
    GIANT_FEATURE_ALLOWLIST: new Set(["RU"]), isAdmin0ShellFeature: () => true,
    getSphericalFeatureDiagnostics: () => spherical,
    isGiantFeature: () => true, isProjectedWrapArtifact: () => true,
  });
  vm.runInContext(source.slice(declaration.start, declaration.end), scope);
  assert.equal(scope.evaluateSkipFeature({}, 800, 400).reason, "world_bounds");
  spherical = { invalid: true, isWorldBounds: false };
  assert.equal(scope.evaluateSkipFeature({}, 800, 400).reason, "spherical_area");
  spherical = { invalid: false };
  assert.equal(scope.evaluateSkipFeature({}, 800, 400).skip, false);
});
