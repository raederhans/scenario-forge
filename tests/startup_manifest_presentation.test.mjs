import test from "node:test";
import assert from "node:assert/strict";
import { overlayStartupManifestPresentationFields } from "../js/core/scenario/startup_manifest_presentation.js";

const bundleManifest = {
  scenario_id: "tno_1962",
  baseline_hash: "bundle-hash",
  runtime_topology_url: "data/scenarios/tno_1962/runtime_topology.topo.json",
  style_defaults: { ocean: { fillColor: "#2d4769" } },
};

test("live manifest presentation fields replace the stale startup bundle copy", () => {
  const liveManifest = {
    scenario_id: "tno_1962",
    baseline_hash: "live-hash",
    runtime_topology_url: "data/scenarios/tno_1962/other.topo.json",
    style_defaults: { ocean: { fillColor: "#1f2f45" } },
    bookmark_name: "The New Order",
  };
  const result = overlayStartupManifestPresentationFields(bundleManifest, liveManifest);
  assert.deepEqual(result.style_defaults, { ocean: { fillColor: "#1f2f45" } });
  assert.equal(result.bookmark_name, "The New Order");
  assert.equal(result.baseline_hash, "bundle-hash");
  assert.equal(result.runtime_topology_url, bundleManifest.runtime_topology_url);
});

test("a mismatched live scenario keeps the startup resource identity", () => {
  assert.equal(
    overlayStartupManifestPresentationFields(bundleManifest, {
      scenario_id: "hoi4_1936",
      style_defaults: { ocean: { fillColor: "#3b4a55" } },
    }),
    bundleManifest,
  );
});
