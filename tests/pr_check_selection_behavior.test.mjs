import assert from "node:assert/strict";
import test from "node:test";
import { CORE_TESTS, selectPrChecks, runPrChecks } from "../tools/ci/run_pr_checks.mjs";

// Verify affected coverage, not command-count targets.
test("authored river and city mappings supplement the fixed core", () => {
  const river = selectPrChecks(["js/core/river_paint/runtime.js"]);
  for (const file of CORE_TESTS) assert.ok(river.nodeTests.includes(file));
  assert.ok(river.nodeTests.includes("tests/river_paint_runtime.test.mjs"));
  assert.ok(river.browserTests.includes("tests/e2e/river_overlap_visibility.spec.js"));
  for (const [source, expected] of [
    ["js/core/json_resource_decoder_shared.js", "json_resource_decoder_behavior"],
    ["js/core/cooperative_geometry_transport.js", "cooperative_geometry_transport_behavior"],
    ["js/core/geometry_transfer_codec_shared.js", "geometry_transfer_codec_behavior"],
    ["js/core/scenario/bundle_cache.js", "scenario_cache_efficiency_behavior"],
    ["js/core/scenario/bundle_cache.js", "scenario_cache_byte_budget_behavior"],
    ["js/core/renderer/political_id_raster_assets.js", "political_id_raster_runtime_assets_behavior"],
  ]) assert.ok(selectPrChecks([source]).nodeTests.includes(`tests/${expected}.test.mjs`), source);
  const city = selectPrChecks(["js/core/renderer/city_points_render_owner.js"]);
  assert.ok(city.nodeTests.includes("tests/city_points_render_owner_behavior.test.mjs"));
});

test("related data and generators keep their original pytest collection", () => {
  const plan = selectPrChecks(["tests/test_extension_admin1_coverage.py"]);
  assert.ok(plan.commands.some(command => command.runner === "python-pytest" && command.args.includes("tests/test_extension_admin1_coverage.py")));
  const generator = selectPrChecks(["map_builder/processors/north_america.py"]);
  assert.deepEqual(generator.unmatchedChangedFiles, []);
  assert.ok(generator.commands.some(command => command.args.includes("tests/test_north_america_processing.py")));
});

test("UI and export changes select the full sample-guide layout regression", () => {
  for (const file of ["js/ui/toolbar.js", "css/editor-workspace.css", "js/core/state/actions/export_workbench_actions.js"]) {
    const plan = selectPrChecks([file]);
    assert.ok(plan.browserTests.includes("tests/e2e/sample_guide_deeplink.spec.js"), file);
    assert.ok(plan.commands.some(command => command.lane === "browser" && command.args.includes("tests/e2e/sample_guide_deeplink.spec.js") && !command.args.includes("--grep")), file);
  }
});

test("generated E2E lists retain their exact layer integrity check", () => {
  const plan = selectPrChecks(["tests/e2e/test-lists/all.txt", "tests/e2e/test-lists/regression.txt"]);
  assert.deepEqual(plan.unmatchedChangedFiles, []);
  assert.ok(plan.commands.some(command => command.args.includes("tools/e2e_layering.mjs") && command.args.includes("check")));
});

test("boundary-named behavior is not filtered, while exact historical audits are explicit", () => {
  const plan = selectPrChecks(["tests/map_data_boundary_behavior.test.mjs", "tests/state_target_private_cache_contract_behavior.test.mjs"]);
  assert.ok(plan.nodeTests.includes("tests/map_data_boundary_behavior.test.mjs"));
  assert.ok(plan.deferred.includes("tests/state_target_private_cache_contract_behavior.test.mjs"));
  assert.ok(!plan.nodeTests.includes("tests/state_target_private_cache_contract_behavior.test.mjs"));
});

test("unknown executable paths fail before any checks run; docs and mirrors are explicit exceptions", () => {
  assert.deepEqual(selectPrChecks(["README.md", "dist/app/js/main.js"]).commands, []);
  assert.deepEqual(selectPrChecks(["new_unmapped_runtime.js"]).unmatchedChangedFiles, ["new_unmapped_runtime.js"]);
  assert.deepEqual(selectPrChecks(["tools/ci/unmapped_new_tool.mjs"]).unmatchedChangedFiles, ["tools/ci/unmapped_new_tool.mjs"]);
  let calls = 0;
  assert.throws(() => runPrChecks(["--changed-file", "new_unmapped_runtime.js"], { runner: () => { calls++; } }), /Unmapped changed files/);
  assert.equal(calls, 0);
});

test("invalid input and real command failures propagate", () => {
  assert.throws(() => selectPrChecks(["../outside.test.mjs"]), /repository-relative/);
  assert.throws(() => runPrChecks(["--changed-file"]), /Missing value/);
  assert.throws(() => runPrChecks(["--unknown"]), /Unknown argument/);
  assert.equal(runPrChecks(["--changed-file", "tests/pr_check_selection_behavior.test.mjs", "--lane", "unit"], { runner: () => ({ status: 7 }) }), 7);
});
