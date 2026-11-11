import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { configureDataBaseUrl } from "../js/core/data_base_url.js";
import { resolveDataAssetUrl } from "../js/core/runtime_asset_registry.js";

afterEach(() => configureDataBaseUrl(""));

for (const base of ["", "https://cdn.example.com/assets/"]) {
  test(`project migration requests both assets through the configured data base: ${base || "same origin"}`, async () => {
    // Fresh module instance isolates the asset promise caches between configurations.
    configureDataBaseUrl("");
    const { migrateFeatureScopedProjectDataToCurrentTopology: migrate } =
      await import(`../js/core/sovereignty_manager.js?migration-base=${encodeURIComponent(base)}`);
    // Configure after importing: URLs must be resolved when fetched, not at module load.
    configureDataBaseUrl(base);
    const requests = [];
    const result = await migrate({ visualOverrides: { LEGACY: "#123456" } }, {
      validFeatureIds: new Set(["CURRENT"]),
      fetchImpl: async (url, options) => {
        requests.push([url, options]);
        return {
          ok: true,
          json: async () => url.endsWith("political_feature_merges.v1.json")
            ? { plans: [] }
            : { LEGACY: ["CURRENT"] },
        };
      },
    });
    assert.deepEqual(result.visualOverrides, { CURRENT: "#123456" });
    assert.deepEqual(requests, [
      [base + resolveDataAssetUrl("feature_migrations:political_feature_merges"), { cache: "no-store" }],
      [base + resolveDataAssetUrl("feature_migrations:by_hybrid_v1"), { cache: "no-store" }],
    ]);
  });
}
