import assert from "node:assert/strict";
import test from "node:test";
import { createStrategicValuesOwner } from "../js/ui/toolbar/strategic_values_owner.js";

class Node {
  constructor() { this.value = ""; this.textContent = ""; this.dataset = {}; this.style = {}; this.options = []; this.listeners = {}; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  replaceChildren(fragment) { this.options = fragment.children; }
  dispatch(type, value) { if (value !== undefined) this.value = value; this.listeners[type]?.({ target: this }); }
}
function document() {
  const nodes = new Map();
  return {
    nodes,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    createElement() { return new Node(); },
    createDocumentFragment() { return { children: [], appendChild(node) { this.children.push(node); } }; },
  };
}
function state() {
  return {
    currentLanguage: "en", activeScenarioId: "hoi4_1936", styleConfig: { strategicValues: { opacity: 0.75, palette: "auto", resourceFilter: "all" } },
    scenarioBundleCacheById: { hoi4_1936: { manifest: { display_name: "HOI4 1936", bookmark_date: "1936.1.1.12", strategic_values_url: "values.json" } } },
  };
}
function payload() {
  return { scenarioId: "hoi4_1936", baselineHash: "hash", metrics: { steel: { min: 0, max: 20, p95: 10 } },
    buckets: { s1: { state_id: 1, owner_tag: "FRA", steel: 0 } }, bucketByFeature: { a: "s1", b: "s1" },
    resourcePoints: { type: "FeatureCollection", features: [] }, diagnostics: { errors: [], warnings: [] } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("owner binds strategic controls, keeps zero distinct and shows real load result", async () => {
  const doc = document();
  const runtimeState = state();
  const calls = [];
  const owner = createStrategicValuesOwner({ runtimeState, documentRef: doc, renderDirty: (reason) => calls.push(reason),
    ensureActiveScenarioOptionalLayerLoaded: async () => { runtimeState.scenarioStrategicValuesData = payload(); return runtimeState.scenarioStrategicValuesData; } });
  owner.bindEvents();
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /available/);
  doc.getElementById("strategicChoroplethMetric").dispatch("change", "steel");
  await tick();
  assert.equal(runtimeState.strategicChoroplethMetric, "steel");
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /zero/);
  assert.match(doc.getElementById("strategicValuesCoverage").textContent, /1\/1/);
  doc.getElementById("strategicValuesInspect").dispatch("change", "s1");
  assert.match(doc.getElementById("strategicValuesInspectValue").textContent, /Steel: 0/);
  doc.getElementById("strategicValuesOpacity").dispatch("input", "40");
  assert.equal(runtimeState.styleConfig.strategicValues.opacity, 0.4);
  doc.getElementById("strategicResourceFilter").dispatch("change", "oil");
  assert.equal(runtimeState.styleConfig.strategicValues.resourceFilter, "oil");
  assert.ok(calls.includes("strategic-resource-filter"));
  assert.ok(calls.includes("strategic-values-loaded"), "a completed load refreshes the resolved color cache through the parent");
  doc.getElementById("strategicValuesSearch").dispatch("input", "ZZZ");
  assert.equal(doc.getElementById("strategicValuesInspect").options.length, 1);
  assert.equal(doc.getElementById("strategicValuesInspect").value, "");
  doc.getElementById("strategicValuesSearch").dispatch("input", "FRA");
  assert.equal(doc.getElementById("strategicValuesInspect").options.length, 2);
});

test("null load is retryable and stale scenario completion cannot change current feedback", async () => {
  const doc = document();
  const runtimeState = state();
  let resolveOld;
  const owner = createStrategicValuesOwner({ runtimeState, documentRef: doc,
    ensureActiveScenarioOptionalLayerLoaded: () => new Promise((resolve) => { resolveOld = resolve; }) });
  owner.bindEvents();
  doc.getElementById("strategicValuesLoad").dispatch("click");
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /Loading/);
  runtimeState.activeScenarioId = "tno_1962";
  runtimeState.scenarioBundleCacheById.tno_1962 = { manifest: { display_name: "TNO 1962" } };
  owner.render();
  resolveOld(null);
  await tick();
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /not connected/);
  assert.equal(doc.getElementById("strategicValuesSource").textContent, "TNO 1962");
  assert.equal(doc.getElementById("strategicResourceFilter").disabled, true);
  assert.equal(doc.getElementById("strategicChoroplethMetric").disabled, true);
  runtimeState.activeScenarioId = "hoi4_1936";
  owner.render();
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /available/);
});

test("null result and rejected load show retry without claiming ready", async () => {
  const doc = document();
  const runtimeState = state();
  let attempts = 0;
  const owner = createStrategicValuesOwner({ runtimeState, documentRef: doc,
    ensureActiveScenarioOptionalLayerLoaded: async () => {
      attempts += 1;
      if (attempts === 1) return null;
      throw new Error("offline");
    } });
  owner.bindEvents();
  doc.getElementById("strategicValuesLoad").dispatch("click");
  await tick();
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /could not be loaded/);
  assert.equal(doc.getElementById("strategicValuesLoad").textContent, "Retry load");
  doc.getElementById("strategicValuesLoad").dispatch("click");
  await tick();
  assert.equal(attempts, 2);
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /could not be loaded/);
});

test("unsupported state still permits clearing an earlier strategic selection", () => {
  const doc = document();
  const runtimeState = state();
  runtimeState.activeScenarioId = "tno_1962";
  runtimeState.scenarioBundleCacheById.tno_1962 = { manifest: { display_name: "TNO 1962" } };
  runtimeState.showStrategicResourceMarkers = true;
  runtimeState.strategicChoroplethMetric = "steel";
  const owner = createStrategicValuesOwner({ runtimeState, documentRef: doc });
  owner.bindEvents();
  assert.equal(doc.getElementById("toggleStrategicResourceMarkers").disabled, false);
  assert.equal(doc.getElementById("strategicChoroplethMetric").disabled, false);
  doc.getElementById("toggleStrategicResourceMarkers").checked = false;
  doc.getElementById("toggleStrategicResourceMarkers").dispatch("change");
  doc.getElementById("strategicChoroplethMetric").dispatch("change", "");
  assert.equal(runtimeState.showStrategicResourceMarkers, false);
  assert.equal(runtimeState.strategicChoroplethMetric, "");
});

test("chunk scheduling with a null immediate result is not reported as a load failure", async () => {
  const doc = document();
  const runtimeState = state();
  delete runtimeState.scenarioBundleCacheById.hoi4_1936.manifest.strategic_values_url;
  runtimeState.scenarioBundleCacheById.hoi4_1936.chunkRegistry = { byLayer: { strategicvalues: ["chunk-1"] } };
  const owner = createStrategicValuesOwner({ runtimeState, documentRef: doc,
    ensureActiveScenarioOptionalLayerLoaded: async () => null });
  owner.bindEvents();
  doc.getElementById("strategicValuesLoad").dispatch("click");
  await tick();
  assert.match(doc.getElementById("strategicValuesStatus").textContent, /available/);
});
