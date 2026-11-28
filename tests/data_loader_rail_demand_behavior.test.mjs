import test from "node:test";
import assert from "node:assert/strict";
import { resolveDataAssetUrl } from "../js/core/data_loader.js";

import { loadContextLayerPack } from "../js/core/data_loader/context_pack_loader.js";

async function fixture(check) {
  const catalogUrl = resolveDataAssetUrl("transport_catalog:rail");
  const previousTopojson = globalThis.topojson;
  const previousWarn = console.warn;
  const payloads = {
    [catalogUrl]: { entries: ["a", "b"].map((id) => ({
      manifest_path: `${id}/manifest`, feature_counts: { preview: { railways: 1 } },
    })) },
    "a/manifest": { paths: { preview: { railways: "a/rails", rail_stations_major: "a/stations" } } },
    "b/manifest": { paths: { preview: { railways: "b/rails", rail_stations_major: "b/stations" } } },
    "a/rails": { objects: { railways: { id: "rail-a" } } },
    "b/rails": { objects: { railways: { id: "rail-b" } } },
    "a/stations": { features: [{ id: "station-a" }] },
    "b/stations": { features: [] },
  };
  const d3Client = { json: async (url) => {
    const payload = payloads[url];
    if (payload instanceof Error) throw payload;
    return payload;
  } };
  globalThis.topojson = { feature: (_, object) => {
    return { type: "FeatureCollection", features: [{ id: object.id }] };
  } };
  console.warn = () => {};
  try {
    await check({ load: (layer) => loadContextLayerPack(layer, d3Client),
      payloads });
  } finally {
    globalThis.topojson = previousTopojson;
    console.warn = previousWarn;
  }
}

test("a failed railway request does not discard loaded stations and can retry with fresh metadata", async () => {
  await fixture(async ({ load, payloads }) => {
    const railPayload = payloads["a/rails"];
    payloads["a/rails"] = new Error("transient rail failure");
    const [rails, stations] = await Promise.all([load("railways"), load("rail_stations_major")]);
    assert.equal(rails, null);
    assert.equal(stations.features.length, 1);
    payloads["a/rails"] = railPayload;
    assert.equal((await load("railways")).features.length, 2);
    assert.equal(await load("rail_stations_major"), stations);
  });
});
