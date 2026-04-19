import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pureHelpersPath = new URL("../js/core/scenario/pure_helpers.js", import.meta.url);
const pureHelpersSource = await readFile(pureHelpersPath, "utf8");
const inlinedSource = pureHelpersSource.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*"\.\.\/scenario_runtime_queries\.js";/,
  `const getRuntimeGeometryFeatureId = (geometry) => String(geometry?.properties?.id || geometry?.id || "").trim();
const getScenarioRuntimeGeometryCountryCode = (geometry) => String(geometry?.properties?.cntr_code || "").trim().toUpperCase();
const hasExplicitScenarioAssignment = (featureMap, featureId) => !!(featureMap && Object.prototype.hasOwnProperty.call(featureMap, featureId));
const shouldApplyHoi4FarEastSovietBackfill = (scenarioId) => {
  const normalizedId = String(scenarioId || "").trim();
  return normalizedId === "hoi4_1936" || normalizedId === "hoi4_1939";
};`
);
const pureHelpers = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(inlinedSource)}`);

test("getHoi4FarEastSovietRuntimeCandidateFeatureIds uses topology identity cache on repeated calls", () => {
  const topology = {
    objects: {
      political: {
        geometries: [
          { properties: { id: "RU-1", cntr_code: "RU" } },
          { properties: { id: "RU-2", cntr_code: "RU" } },
          { properties: { id: "JP-1", cntr_code: "JP" } },
        ],
      },
    },
  };

  const first = pureHelpers.getHoi4FarEastSovietRuntimeCandidateFeatureIds(topology);
  const second = pureHelpers.getHoi4FarEastSovietRuntimeCandidateFeatureIds(topology);

  assert.equal(second, first);
  assert.deepEqual(second, ["RU-1", "RU-2"]);
});

test("buildHoi4FarEastSovietOwnerBackfill reuses cached candidate ids and respects explicit assignments", () => {
  const topology = {
    objects: {
      political: {
        geometries: [
          { properties: { id: "RU-1", cntr_code: "RU" } },
          { properties: { id: "RU-2", cntr_code: "RU" } },
        ],
      },
    },
  };

  const firstBackfill = pureHelpers.buildHoi4FarEastSovietOwnerBackfill("hoi4_1939", {
    runtimeTopology: topology,
    ownersByFeatureId: { "RU-1": "SOV" },
    controllersByFeatureId: {},
  });
  const secondBackfill = pureHelpers.buildHoi4FarEastSovietOwnerBackfill("hoi4_1939", {
    runtimeTopology: topology,
    ownersByFeatureId: {},
    controllersByFeatureId: {},
  });

  assert.deepEqual(firstBackfill, { "RU-2": "SOV" });
  assert.deepEqual(secondBackfill, { "RU-1": "SOV", "RU-2": "SOV" });
});
