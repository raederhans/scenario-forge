import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dataServiceSource = await readFile(new URL("../js/core/data_service.js", import.meta.url), "utf8");

const stubCatalogPayload = {
  version: 1,
  generated_at: "2026-05-02T00:00:00Z",
  entries: [
    {
      key: "world_cities",
      url: "data/world_cities.geojson",
      role: "world_cities",
      format: "geojson",
      schemaRef: "schema://geojson/feature_collection/v1",
      hashRef: "manifest",
      owner: "manifest",
      cachePolicy: "default",
      sourceId: "",
      readMode: "json",
    },
    {
      key: "transport_manifest:road",
      url: "data/transport_layers/japan_road/manifest.json",
      role: "transport_manifest",
      format: "json",
      schemaRef: "schema://transport/manifest/v1",
      hashRef: "",
      owner: "builder",
      cachePolicy: "no-cache",
      sourceId: "",
      readMode: "json",
    },
    {
      key: "transport:road:preview:roads",
      url: "data/transport_layers/japan_road/roads.preview.topo.json",
      role: "transport_pack",
      format: "topojson",
      schemaRef: "schema://topojson/line_collection/roads_v1",
      hashRef: "",
      owner: "builder",
      cachePolicy: "no-cache",
      sourceId: "",
      readMode: "json",
    },
    {
      key: "city_lights:historical_1930:asset",
      url: "js/core/city_lights_historical_1930_asset.js",
      role: "city_lights_asset",
      format: "javascript",
      schemaRef: "schema://javascript/module/v1",
      hashRef: "",
      owner: "builder",
      cachePolicy: "module",
      sourceId: "",
      readMode: "module",
    },
    {
      key: "malicious_catalog_module",
      url: "https://attacker.example/payload.js",
      role: "malicious_fixture",
      format: "javascript",
      schemaRef: "schema://javascript/module/v1",
      hashRef: "",
      owner: "test",
      cachePolicy: "module",
      sourceId: "",
      readMode: "module",
    },
    {
      key: "transport:japan_corridor:carrier",
      url: "data/transport_layers/japan_corridor/carrier.json",
      role: "transport_carrier_payload",
      format: "json",
      schemaRef: "schema://transport/carrier_payload/v1",
      hashRef: "",
      owner: "builder",
      cachePolicy: "default",
      sourceId: "",
      readMode: "json",
    },
    {
      key: "unsupported:binary",
      url: "data/unsupported.bin",
      role: "unsupported_fixture",
      format: "binary",
      schemaRef: "schema://binary/fixture",
      hashRef: "",
      owner: "test",
      cachePolicy: "default",
      sourceId: "",
      readMode: "binary",
    },
  ],
};

const patchedDataServiceSource = dataServiceSource
  // data: URL 里的相对导入无法解析，指向真实的共享模块。
  .replace(
    'from "./json_clone.js";',
    `from ${JSON.stringify(new URL("../js/core/json_clone.js", import.meta.url).href)};`,
  )
  .replace(
    'import catalogPayload from "../../data/CATALOG.json" with { type: "json" };',
    `const catalogPayload = ${JSON.stringify(stubCatalogPayload)};`,
  )
  .replace(
    /import\s+\{\s*loadMeasuredJsonResource\s*\}\s+from\s+"\.\/data_loader\.js";/,
    `const loadMeasuredJsonResource = async (url, { label = "resource", cache = "default" } = {}) => {
      if (typeof globalThis.__testLoadMeasuredJsonResource !== "function") {
        throw new Error("missing __testLoadMeasuredJsonResource stub");
      }
      return globalThis.__testLoadMeasuredJsonResource(url, { label, cache });
    };`,
  )
  .replace(
    /import\s+\{\s*RUNTIME_ASSET_REGISTRY,\s*RUNTIME_ASSET_URLS,\s*\}\s+from\s+"\.\/runtime_asset_registry\.js";/,
    `const RUNTIME_ASSET_REGISTRY = ${JSON.stringify({
      assets: {
        world_cities: {
          url: "data/world_cities.geojson",
          role: "world_cities",
        },
        "transport_manifest:road": {
          url: "data/transport_layers/japan_road/manifest.json",
          role: "transport_manifest",
        },
        "city_lights:historical_1930:asset": {
          url: "js/core/city_lights_historical_1930_asset.js",
          role: "city_lights_asset",
        },
        "malicious_registry_module": {
          url: "data:text/javascript,globalThis.__executed=true;//.js",
          role: "malicious_fixture",
        },
        "malicious_catalog_module": {
          url: "https://attacker.example/payload.js",
          role: "malicious_fixture",
        },
        "transport_carrier:japan_corridor": {
          url: "data/transport_layers/japan_corridor/carrier.json",
          role: "transport_workbench_carrier",
        },
        "unsupported:binary": {
          url: "data/unsupported.bin",
          role: "unsupported_fixture",
        },
      },
    })};
    const RUNTIME_ASSET_URLS = Object.freeze(${JSON.stringify({
      world_cities: "data/world_cities.geojson",
      "transport_manifest:road": "data/transport_layers/japan_road/manifest.json",
      "city_lights:historical_1930:asset": "js/core/city_lights_historical_1930_asset.js",
      "malicious_registry_module": "data:text/javascript,globalThis.__executed=true;//.js",
      "malicious_catalog_module": "https://attacker.example/payload.js",
      "transport_carrier:japan_corridor": "data/transport_layers/japan_corridor/carrier.json",
      "unsupported:binary": "data/unsupported.bin",
    })});`,
  )
  .replace(
    /import\s+\{\s*ensureMapcreatorSnapshotGlobal,\s*registerMapcreatorSnapshotProvider,\s*\}\s+from\s+"\.\/mapcreator_snapshot\.js";/,
    `const __mapcreatorProviders = {
      assets: new Map(),
      loadStatus: new Map(),
      version: new Map(),
    };
    function collectSnapshotSection(sectionName) {
      const section = {};
      const providers = __mapcreatorProviders[sectionName] || new Map();
      for (const [providerKey, provider] of providers.entries()) {
        section[providerKey] = provider();
      }
      return { providers: section };
    }
    function ensureMapcreatorSnapshotGlobal() {
      if (!globalThis.__mapcreator__) {
        globalThis.__mapcreator__ = {
          get assets() { return collectSnapshotSection("assets"); },
          get loadStatus() { return collectSnapshotSection("loadStatus"); },
          get version() { return collectSnapshotSection("version"); },
          snapshot() {
            return {
              assets: this.assets,
              loadStatus: this.loadStatus,
              version: this.version,
            };
          },
        };
      }
      return globalThis.__mapcreator__;
    }
    function registerMapcreatorSnapshotProvider(sectionName, providerKey, provider) {
      ensureMapcreatorSnapshotGlobal();
      __mapcreatorProviders[sectionName].set(providerKey, provider);
      return () => __mapcreatorProviders[sectionName].delete(providerKey);
    }`,
  );

const dataServiceModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(patchedDataServiceSource)}`);

function setJsonLoaderStub(impl) {
  globalThis.__testLoadMeasuredJsonResource = impl;
}

function clearJsonLoaderStub() {
  delete globalThis.__testLoadMeasuredJsonResource;
}

test("data service loads an allowlisted runtime asset key", async () => {
  setJsonLoaderStub(async (url, options = {}) => ({
    payload: {
      ok: true,
      url,
      cache: options.cache,
      label: options.label,
    },
    metrics: {
      url,
      label: options.label,
      cache: options.cache,
      fetchMs: 1,
      jsonParseMs: 1,
      totalMs: 2,
      transferMs: 1,
    },
  }));

  const payload = await dataServiceModule.getAsset("world_cities");
  assert.deepEqual(payload, {
    ok: true,
    url: "data/world_cities.geojson",
    cache: "default",
    label: "asset:world_cities",
  });

  clearJsonLoaderStub();
});

test("data service fail-fast paths reject unknown keys and unsupported read modes", async () => {
  setJsonLoaderStub(async () => ({
    payload: {},
    metrics: {
      fetchMs: 1,
      jsonParseMs: 0,
      totalMs: 1,
      transferMs: 1,
    },
  }));

  await assert.rejects(
    () => dataServiceModule.getAsset("missing_key"),
    (error) => error?.code === "unknown-asset-key",
  );
  await assert.rejects(
    () => dataServiceModule.getCatalogAsset("data/not-registered.json"),
    (error) => error?.code === "catalog-path-not-allowed",
  );
  await assert.rejects(
    () => dataServiceModule.getAsset("unsupported:binary"),
    (error) => error?.code === "unsupported-format",
  );

  clearJsonLoaderStub();
});

test("data service loads module runtime assets through getAsset", async () => {
  const payload = await dataServiceModule.getAsset("city_lights:historical_1930:asset", {
    moduleLoader: async (specifier) => ({
      specifier,
      exported: true,
    }),
  });

  assert.equal(payload.exported, true);
  assert.match(payload.specifier, /js\/core\/city_lights_historical_1930_asset\.js$/);

  const snapshot = dataServiceModule.getStatusSnapshot();
  const requestId = "asset:city_lights:historical_1930:asset";
  assert.equal(snapshot.resources[requestId].status, "ready");
  assert.equal(snapshot.resources[requestId].url, "js/core/city_lights_historical_1930_asset.js");
});

test("data service blocks registry-provided module specifiers outside the runtime module allowlist", async () => {
  let moduleLoaderCalled = false;

  await assert.rejects(
    () => dataServiceModule.getAsset("malicious_registry_module", {
      moduleLoader: async () => {
        moduleLoaderCalled = true;
        return { executed: true };
      },
    }),
    (error) => error?.code === "module-path-not-allowed",
  );

  assert.equal(moduleLoaderCalled, false);
});

test("data service blocks catalog module entries outside the runtime module allowlist", async () => {
  let moduleLoaderCalled = false;

  await assert.rejects(
    () => dataServiceModule.getAsset("malicious_catalog_module", {
      moduleLoader: async () => {
        moduleLoaderCalled = true;
        return { executed: true };
      },
    }),
    (error) => error?.code === "module-path-not-allowed",
  );

  assert.equal(moduleLoaderCalled, false);
});

test("data service records HTTP failures in load status snapshots", async () => {
  setJsonLoaderStub(async (_url, _options = {}) => {
    const error = new Error("server boom");
    error.httpStatus = 500;
    error.httpStatusText = "Server Error";
    throw error;
  });

  await assert.rejects(
    () => dataServiceModule.getTransportAsset("data/transport_layers/japan_road/roads.preview.topo.json"),
    (error) => error?.code === "http-error",
  );

  const snapshot = dataServiceModule.getStatusSnapshot();
  const requestId = "transport:data/transport_layers/japan_road/roads.preview.topo.json";
  assert.equal(snapshot.resources[requestId].status, "error");
  assert.equal(snapshot.resources[requestId].httpStatus, 500);
  assert.equal(snapshot.resources[requestId].errorCode, "http-error");

  clearJsonLoaderStub();
});

test("data service loads transport carrier runtime assets through getAsset", async () => {
  setJsonLoaderStub(async (url, options = {}) => ({
    payload: {
      kind: "carrier",
      url,
      cache: options.cache,
      label: options.label,
    },
    metrics: {
      url,
      label: options.label,
      cache: options.cache,
      fetchMs: 1,
      jsonParseMs: 1,
      totalMs: 2,
      transferMs: 1,
    },
  }));

  const payload = await dataServiceModule.getAsset("transport_carrier:japan_corridor");
  assert.deepEqual(payload, {
    kind: "carrier",
    url: "data/transport_layers/japan_corridor/carrier.json",
    cache: "default",
    label: "asset:transport_carrier:japan_corridor",
  });

  const snapshot = dataServiceModule.getStatusSnapshot();
  const requestId = "asset:transport_carrier:japan_corridor";
  assert.equal(snapshot.resources[requestId].status, "ready");
  assert.equal(snapshot.resources[requestId].url, "data/transport_layers/japan_corridor/carrier.json");

  const metrics = dataServiceModule.getMetricsSnapshot();
  assert.equal(metrics.resources[requestId].label, "asset:transport_carrier:japan_corridor");

  clearJsonLoaderStub();
});

test("__mapcreator__ snapshot stays JSON-serializable", async () => {
  setJsonLoaderStub(async (url, options = {}) => ({
    payload: {
      ok: true,
      url,
      cache: options.cache,
      label: options.label,
    },
    metrics: {
      url,
      label: options.label,
      cache: options.cache,
      fetchMs: 1,
      jsonParseMs: 1,
      totalMs: 2,
      transferMs: 1,
    },
  }));

  await dataServiceModule.getAsset("world_cities");
  const snapshot = globalThis.__mapcreator__.snapshot();
  const roundTrip = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(roundTrip, snapshot);
  assert.equal(roundTrip.assets.providers.data_service.runtimeAssetCount, 7);
  assert.equal(roundTrip.version.providers.data_service.catalogVersion, 1);

  clearJsonLoaderStub();
});
