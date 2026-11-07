import test from "node:test";
import assert from "node:assert/strict";
import { overlayStartupManifestPresentationFields } from "../js/core/scenario/startup_manifest_presentation.js";

const bundleManifest = {
  scenario_id: "tno_1962",
  baseline_hash: "bundle-hash",
  runtime_topology_url: "data/scenarios/tno_1962/runtime_topology.topo.json",
  style_defaults: { ocean: { fillColor: "#2d4769" } },
  bookmark_name: "TNO_1962_NAME",
  featured_tags: ["GER"],
};

test("live manifest presentation fields replace the stale startup bundle copy", () => {
  const liveManifest = {
    scenario_id: "tno_1962",
    baseline_hash: "live-hash",
    runtime_topology_url: "data/scenarios/tno_1962/other.topo.json",
    style_defaults: { ocean: { fillColor: "#1f2f45" } },
    bookmark_name: "The New Order",
    featured_tags: ["GER", "JAP"],
    opening_view: { center: [30, 50], zoom: 2 },
  };
  const result = overlayStartupManifestPresentationFields(bundleManifest, liveManifest);
  assert.deepEqual(result.style_defaults, { ocean: { fillColor: "#1f2f45" } });
  assert.equal(result.bookmark_name, "The New Order");
  assert.deepEqual(result.featured_tags, ["GER", "JAP"]);
  assert.deepEqual(result.opening_view, { center: [30, 50], zoom: 2 });
  // 白名单之外的合同字段保持启动包原值。
  assert.equal(result.baseline_hash, "bundle-hash");
  assert.equal(result.runtime_topology_url, bundleManifest.runtime_topology_url);
  // 不改动传入对象，也不与运行时 manifest 共享引用。
  assert.deepEqual(bundleManifest.style_defaults, { ocean: { fillColor: "#2d4769" } });
  liveManifest.style_defaults.ocean.fillColor = "#000000";
  assert.equal(result.style_defaults.ocean.fillColor, "#1f2f45");
});

test("missing, failed or mismatched live manifest keeps the startup bundle values", () => {
  assert.equal(overlayStartupManifestPresentationFields(bundleManifest, null), bundleManifest);
  assert.equal(overlayStartupManifestPresentationFields(bundleManifest, undefined), bundleManifest);
  assert.equal(overlayStartupManifestPresentationFields(bundleManifest, {}), bundleManifest);
  assert.equal(
    overlayStartupManifestPresentationFields(bundleManifest, {
      scenario_id: "hoi4_1936",
      style_defaults: { ocean: { fillColor: "#3b4a55" } },
    }),
    bundleManifest,
  );
});
