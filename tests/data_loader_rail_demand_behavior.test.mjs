import test from "node:test";
import assert from "node:assert/strict";

let loaderId = 0;
async function fixture(check) {
  const { loadContextLayerPack, resolveDataAssetUrl } = await import(
    `../js/core/data_loader.js?rail-demand=${++loaderId}`
  );
  const catalogUrl = resolveDataAssetUrl("transport_catalog:rail");
  const calls = [];
  const decodes = [];
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
    calls.push(url);
    const payload = payloads[url];
    if (payload instanceof Error) throw payload;
    return typeof payload === "function" ? payload() : payload;
  } };
  globalThis.topojson = { feature: (_, object) => {
    decodes.push(object.id);
    return { type: "FeatureCollection", features: [{ id: object.id }] };
  } };
  console.warn = () => {};
  try {
    await check({ load: (layer) => loadContextLayerPack(layer, d3Client),
      calls, decodes, payloads, catalogUrl });
  } finally {
    globalThis.topojson = previousTopojson;
    console.warn = previousWarn;
  }
}

test("station demand neither fetches nor decodes railway geometry and needs no topojson", async () => {
  await fixture(async ({ load, calls, decodes }) => {
    globalThis.topojson = undefined;
    const collection = await load("rail_stations_major");
    assert.deepEqual(collection, { type: "FeatureCollection", features: [{ id: "station-a" }] });
    assert.equal(calls.some((url) => url.endsWith("/rails")), false);
    assert.deepEqual(decodes, []);
    const callCount = calls.length;
    assert.equal(await load("rail_stations_major"), collection);
    assert.equal(calls.length, callCount);
  });
});

test("railway demand skips station payloads and concurrent callers share the collection", async () => {
  await fixture(async ({ load, calls, decodes }) => {
    const [first, second] = await Promise.all([load("railways"), load("railways")]);
    assert.equal(first, second);
    assert.deepEqual(first.features.map(({ id }) => id), ["rail-a", "rail-b"]);
    assert.equal(calls.some((url) => url.endsWith("/stations")), false);
    assert.deepEqual(decodes, ["rail-a", "rail-b"]);
  });
});

test("paired demand shares metadata even when station loading overtakes railway decoding", async () => {
  await fixture(async ({ load, calls, payloads, catalogUrl }) => {
    let releaseRail;
    const railPayload = payloads["a/rails"];
    payloads["a/rails"] = () => new Promise((resolve) => { releaseRail = () => resolve(railPayload); });
    const rails = load("railways");
    const stations = await load("rail_stations_major");
    assert.deepEqual(stations.features.map(({ id }) => id), ["station-a"]);
    releaseRail();
    assert.equal((await rails).features.length, 2);
    for (const url of [catalogUrl, "a/manifest", "b/manifest", "a/rails", "b/rails", "a/stations", "b/stations"]) {
      assert.equal(calls.filter((call) => call === url).length, 1, url);
    }
  });
});

test("a failed railway request does not discard loaded stations and can retry with fresh metadata", async () => {
  await fixture(async ({ load, calls, payloads, catalogUrl }) => {
    const railPayload = payloads["a/rails"];
    payloads["a/rails"] = new Error("transient rail failure");
    const [rails, stations] = await Promise.all([load("railways"), load("rail_stations_major")]);
    assert.equal(rails, null);
    assert.equal(stations.features.length, 1);
    payloads["a/rails"] = railPayload;
    assert.equal((await load("railways")).features.length, 2);
    assert.equal(calls.filter((url) => url === catalogUrl).length, 2);
    assert.equal(await load("rail_stations_major"), stations);
  });
});

test("an empty station layer preserves FeatureCollection shape without speculative rail fetches", async () => {
  await fixture(async ({ load, payloads, calls }) => {
    delete payloads["a/manifest"].paths.preview.rail_stations_major;
    delete payloads["b/manifest"].paths.preview.rail_stations_major;
    assert.deepEqual(await load("rail_stations_major"), { type: "FeatureCollection", features: [] });
    assert.equal(calls.some((url) => /\/(rails|stations)$/.test(url)), false);
  });
});

test("failed metadata retries immediately while an unrelated station request is pending", async () => {
  await fixture(async ({ load, calls, payloads }) => {
    let releaseStations;
    const stationPayload = payloads["a/stations"];
    const manifestPayload = payloads["b/manifest"];
    payloads["a/stations"] = () => new Promise((resolve) => {
      releaseStations = () => resolve(stationPayload);
    });
    payloads["b/manifest"] = new Error("transient manifest failure");
    const stations = load("rail_stations_major");
    try {
      assert.equal(await load("railways"), null);
      payloads["b/manifest"] = manifestPayload;
      assert.equal((await load("railways")).features.length, 2);
      assert.equal(calls.filter((url) => url === "b/manifest").length, 2);
    } finally {
      releaseStations();
      await stations;
    }
  });
});
