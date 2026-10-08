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
    assert.equal(result.runtimePoliticalRequested, true);
    assert.ok(calls.includes("runtime-political"));
    assert.deepEqual(calls.filter((url) => url !== "runtime-political"), [sources.na_v2, sources.na_v1]);
  });
});

test("scenario-owned deferred detail skips the global runtime request without labeling it requested", async () => {
  const valid = { type: "Topology", objects: { political: { type: "GeometryCollection",
    geometries: [{ id: "detail", type: "Polygon", arcs: [[0]] }] } }, arcs: [[[0, 0], [1, 0]]] };
  const runtime = { objects: { political: { geometries: [{ id: "global" }] } } };
  await withFakeLoader({ [sources.na_v2]: valid, "runtime-political": runtime }, async (d3Client, calls) => {
    const partial = await loadDeferredDetailBundle({ d3Client, runtimePoliticalUrl: "runtime-political",
      includeRuntimePolitical: false });
    assert.equal(partial.topologyDetail, valid);
    assert.equal(partial.topologyBundleMode, "composite");
    assert.equal(partial.runtimePoliticalTopology, null);
    assert.equal(partial.runtimePoliticalRequested, false);
    assert.deepEqual(calls, [sources.na_v2]);

    const full = await loadDeferredDetailBundle({ d3Client, runtimePoliticalUrl: "runtime-political" });
    assert.equal(full.topologyDetail, valid);
    assert.equal(full.runtimePoliticalTopology, runtime);
    assert.equal(full.runtimePoliticalRequested, true);
    assert.equal(calls.filter(url => url === "runtime-political").length, 1,
      "a partial result cannot satisfy a later default runtime demand");
  });
});

test("concurrent deferred detail demands do not share a result missing the requested runtime", async () => {
  const valid = { type: "Topology", objects: { political: { type: "GeometryCollection",
    geometries: [{ id: "detail", type: "Polygon", arcs: [[0]] }] } }, arcs: [[[0, 0], [1, 0]]] };
  const runtime = { objects: { political: { geometries: [{ id: "global" }] } } };
  await withFakeLoader({ [sources.na_v2]: valid, "runtime-political": runtime }, async (d3Client, calls) => {
    const [partial, full] = await Promise.all([
      loadDeferredDetailBundle({ d3Client, runtimePoliticalUrl: "runtime-political", includeRuntimePolitical: false }),
      loadDeferredDetailBundle({ d3Client, runtimePoliticalUrl: "runtime-political" }),
    ]);
    assert.equal(partial.topologyDetail, valid);
    assert.equal(full.topologyDetail, valid);
    assert.equal(partial.runtimePoliticalTopology, null);
    assert.equal(full.runtimePoliticalTopology, runtime);
    assert.equal(calls.filter(url => url === "runtime-political").length, 1);
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
