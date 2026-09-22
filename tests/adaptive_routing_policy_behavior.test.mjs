import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticOwnershipClassification,
  buildRepositoryRecommendation,
  nonBehavioralClassification,
} from "../tools/select_verification_targets.mjs";

test("ordinary project documentation is advisory instead of a hard route gap", () => {
  assert.equal(nonBehavioralClassification("docs/active/new-feature/notes.md"), "documentation-advisory");
  assert.equal(nonBehavioralClassification("README.zh-CN.md"), "documentation-advisory");
  assert.equal(nonBehavioralClassification("README.zh-CN.mjs"), null);
  assert.equal(nonBehavioralClassification("docs/perf/baseline.json"), null);
  assert.equal(nonBehavioralClassification("docs/testing/verification-metadata.md"), null);
});

test("published showcase images keep their Pages and map contract routes", () => {
  for (const [file, command] of [
    ["product-workspace.webp", "verify:pages-dist-and-drift"],
    ["social-preview.png", "verify:pages-dist-and-drift"],
    ["social-preview.svg", "verify:pages-dist-and-drift"],
    ["work-atlas-japan-corridor.webp", "test:py:landing-map-asset-contracts"],
    ["work-scenario-switch-europe.webp", "test:py:landing-map-asset-contracts"],
  ]) {
    const report = buildRepositoryRecommendation([`landing/assets/${file}`]);
    assert.deepEqual(report.unmatchedChangedFiles, [], file);
    assert.ok(report.recommendedCommands.some((entry) => entry.commandRef === command), file);
  }
});

test("new renderer files inherit renderer ownership without exact registration", () => {
  assert.deepEqual(
    automaticOwnershipClassification("js/core/renderer/new_runtime_owner.js"),
    { disposition: "auto-owned", domains: ["renderer-runtime"] },
  );
  const report = buildRepositoryRecommendation(["js/core/renderer/new_runtime_owner.js"]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.autoOwnedChangedFiles.some((entry) => entry.changedFile.endsWith("new_runtime_owner.js")));
  assert.ok(report.recommendedCommands.length > 0);
});

test("new UI files inherit shell ownership", () => {
  const ownership = automaticOwnershipClassification("js/ui/new_panel_controller.js");
  assert.deepEqual(ownership, { disposition: "auto-owned", domains: ["main-shell", "dev-workspace"] });
});

test("verification control-plane files remain fail-closed when unregistered", () => {
  const report = buildRepositoryRecommendation([".github/workflows/unregistered.yml"]);
  assert.deepEqual(report.autoOwnedChangedFiles, []);
  assert.deepEqual(report.unmatchedChangedFiles, [".github/workflows/unregistered.yml"]);
});
