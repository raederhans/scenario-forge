import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { state } from "../js/core/state.js";
import { applyScenarioBundle } from "../js/core/scenario_manager.js";
import { addFeaturesToDevSelection, fillSelectedParcels, selectLandFeatureById } from "../js/core/map_renderer.js";

const region = { bounds: [170, 10, -170, 60], central_meridian: 180 };
const inside = Array.from({ length: 1001 }, (_, i) => `RU-${i}`);
const outside = "US-outside";
const world = [...inside, outside];

function topology(ids) {
  const arcs = ids.map((id, i) => {
    const x = id === outside ? -100 : 170 + (i % 40) / 10;
    const y = 30 + Math.floor(i / 40) / 10;
    return [[x, y], [x, y + 0.09], [x + 0.09, y + 0.09], [x + 0.09, y], [x, y]];
  });
  const geometries = ids.map((id, i) => ({
    type: "Polygon", arcs: [[i]], id, properties: { id, country_code: id === outside ? "US" : "RU" },
  }));
  return { type: "Topology", arcs, objects: { political: { type: "GeometryCollection", geometries } } };
}

function makeBundle(id, ids, regional) {
  const directory = `data/scenarios/${id}`;
  return {
    manifest: {
      scenario_id: id, map_mode: "political", scenario_contract_profile: "lightweight_base",
      baseline_hash: id, source: { runtime_topology_sha256: "f".repeat(64) },
      summary: { feature_count: ids.length }, ...(regional ? { region } : {}),
      runtime_topology_url: `${directory}/runtime.topo.json`,
      countries_url: `${directory}/countries.json`, owners_url: `${directory}/owners.json`,
      cores_url: `${directory}/cores.json`,
    },
    countriesPayload: { countries: { RU: { name: "Russia", color_hex: "#774433" }, US: { name: "USA", color_hex: "#bb3311" } } },
    ownersPayload: { owners: Object.fromEntries(ids.map(id => [id, id === outside ? "US" : "RU"])) },
    coresPayload: { cores: {} },
    bundleLevel: "full",
    runtimeTopologyPayload: topology(ids),
  };
}

const local = makeBundle("regional_fixture", inside, true);
const globalBundle = makeBundle("global_fixture", world, false);
const primary = topology([inside[0], outside]);
const detail = globalBundle.runtimeTopologyPayload;

function setupResources(t) {
  const require = createRequire(import.meta.url);
  const initialState = Object.getOwnPropertyDescriptors(state);
  t.after(() => {
    for (const key of Object.keys(state)) {
      if (!Object.hasOwn(initialState, key)) delete state[key];
    }
    Object.defineProperties(state, initialState);
  });

  const json = async () => ({ type: "FeatureCollection", features: [] });
  const globals = { location: new URL("https://fixture.invalid/"),
    topojson: require("../vendor/topojson-client.min.js"), d3: { ...require("../vendor/d3.v7.min.js"), json },
    fetch: async url => Response.json(await json(url)) };
  for (const [key, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    globalThis[key] = value;
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    });
  }
}

function assertMembership(ids) {
  const expected = new Set(ids);
  assert.deepEqual(new Set(state.landDataFull.features.map(f => f.properties.id)), expected);
  assert.deepEqual(new Set(state.landData.features.map(f => f.properties.id)), expected);
  assert.deepEqual(new Set(state.landIndex.keys()), expected);
}

const apply = (bundle, options) => applyScenarioBundle(bundle, {
  renderNow: false, suppressRender: true, rememberScenario: false, syncPalette: false, markDirtyReason: "", ...options,
});

async function failAfterCommit(bundle) {
  const previous = globalThis.__scenarioTestHooks;
  try {
    globalThis.__scenarioTestHooks = { forceApplyConsistencyFailureOnce: true };
    await assert.rejects(apply(bundle), /Injected apply consistency failure/);
  } finally {
    globalThis.__scenarioTestHooks = previous;
  }
}

async function activateRegion(t, mode) {
  setupResources(t);
  Object.assign(state, { topology: primary, topologyPrimary: primary, topologyBundleMode: mode,
    topologyDetail: mode === "single" ? null : detail,
    defaultRuntimePoliticalTopology: mode === "single" ? null : detail });
  await apply(local);
}

test("regional activation restricts editing to member parcels", async t => {
  await activateRegion(t, "single");
  assertMembership(inside);
  assert.equal(selectLandFeatureById(outside), false);
  assert.equal(addFeaturesToDevSelection([inside[0], outside]), 1);
  assert.deepEqual(fillSelectedParcels({ color: "#123abc" }), { changed: 1, skipped: 0 });
  assert.equal(state.visualOverrides[inside[0]], "#123abc");
  assert.equal(state.visualOverrides[outside], undefined);
});

test("failed scenario switch restores the region, edits and land index", async t => {
  await activateRegion(t, "composite");
  assert.equal(addFeaturesToDevSelection([inside[0], outside]), 1);
  assert.deepEqual(fillSelectedParcels({ color: "#123abc" }), { changed: 1, skipped: 0 });
  await failAfterCommit(globalBundle);
  assert.equal(state.activeScenarioId, local.manifest.scenario_id);
  assertMembership(inside);
  assert.equal(state.visualOverrides[inside[0]], "#123abc");
});
