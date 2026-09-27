import test from "node:test";
import assert from "node:assert/strict";

import { loadDeferredDetailBundle } from "../js/core/data_loader.js";

const sources = {
  na_v2: "data/europe_topology.na_v2.json",
  na_v1: "data/europe_topology.na_v1.json",
  legacy_bak: "data/europe_topology.json.bak",
  highres: "data/europe_topology.highres.json",
};

async function withFakeLoader(detailByUrl, check) {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const calls = [];
  globalThis.fetch = undefined;
  console.warn = () => {};
  try {
    const d3Client = {
      json: async (url) => {
        calls.push(url);
        return detailByUrl[url] ?? null;
      },
    };
    await check(d3Client, calls);
  } finally {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
  }
}

test("deferred detail skips a malformed candidate and accepts the next political topology", async () => {
  const valid = {
    type: "Topology",
    objects: {
      political: { type: "GeometryCollection", geometries: [{ id: "feature-1", type: "Polygon", arcs: [[0]] }] },
      optional: { type: "GeometryCollection", geometries: [] },
    },
    arcs: [[[0, 0], [1, 0]]],
  };
  await withFakeLoader({ [sources.na_v2]: {}, [sources.na_v1]: valid }, async (d3Client, calls) => {
    const result = await loadDeferredDetailBundle({
      d3Client,
      detailSourceKey: "na_v2",
      runtimePoliticalUrl: "runtime-political",
    });
    assert.equal(result.topologyDetail, valid);
    assert.equal(result.topologyBundleMode, "composite");
    assert.equal(result.detailSourceUsed, "na_v1");
    assert.deepEqual(calls.filter((url) => url !== "runtime-political"), [sources.na_v2, sources.na_v1]);
  });
});

test("deferred detail remains single-topology when every candidate lacks political geometry", async () => {
  const invalid = { type: "Topology", objects: { political: { type: "GeometryCollection", geometries: [] } } };
  await withFakeLoader(Object.fromEntries(Object.values(sources).map((url) => [url, invalid])), async (d3Client, calls) => {
    const result = await loadDeferredDetailBundle({
      d3Client,
      detailSourceKey: "na_v2",
      runtimePoliticalUrl: "runtime-political",
    });
    assert.equal(result.topologyDetail, null);
    assert.equal(result.topologyBundleMode, "single");
    assert.deepEqual(calls.filter((url) => url !== "runtime-political"), Object.values(sources));
  });
});
