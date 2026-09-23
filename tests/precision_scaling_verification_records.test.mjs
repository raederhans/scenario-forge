import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPrecisionScalingRecords } from "../tools/verification/catalog/records/precision_scaling.mjs";

test("precision routes append unique executable targets without modifying existing records", () => {
  const existing = Object.freeze([Object.freeze({ id: "old", selectorOrder: 2000 })]);
  const routes = createPrecisionScalingRecords(existing);
  assert.equal(routes.length, 26);
  assert.equal(routes[6].id, "local:precision-scaling:native-browser", "existing selector order is unchanged");
  assert.equal(new Set(routes.map((r) => r.id)).size, routes.length);
  for (const [i, record] of routes.entries()) {
    assert.equal(record.selectorOrder, 2001 + i);
    assert.ok(record.commandRef.length > 0);
    for (const source of record.sourceRefs) assert.ok(fs.existsSync(source), source);
  }
  for (const browser of [routes[6], routes[10]]) {
  assert.deepEqual(browser.executionOwners, ["main-thread"]);
  assert.ok(browser.resourceLocks.includes("playwright-browser"));
  assert.deepEqual(browser.profiles, ["full"]);
  }
  assert.ok(routes.filter((r) => !r.id.endsWith(":native-browser")).every((r) => r.resourceLocks.length === 0));
});

test("the public authority includes new records after all existing local records", () => {
  const source = fs.readFileSync(new URL("../tools/verification/verification_catalog_source.mjs", import.meta.url), "utf8");
  const closure = fs.readFileSync(new URL("../tools/verification/catalog/source_files.mjs", import.meta.url), "utf8");
  assert.ok(closure.includes("tools/verification/catalog/records/precision_scaling.mjs"));
  assert.match(source, /const existingRecords = \[\.\.\.baseRecords, \.\.\.createLocalFeedbackRecords\(baseRecords\)\]/);
  assert.match(source, /records: \[\.\.\.existingRecords, \.\.\.createPrecisionScalingRecords\(existingRecords\)\]/);
});


test("precision expansion tools route to executable source-specific regressions", () => {
  const routes = createPrecisionScalingRecords([]);
  for (const [source, testFile] of [
    ["tools/adapt_us_county_scenarios.py", "tests/test_us_county_adaptation.py"],
    ["tools/prepare_us_county_adaptation_sidecars.py", "tests/test_us_county_adaptation_sidecars.py"],
    ["tools/stage_us_county_adapted_bundle.py", "tests/test_us_county_adapted_bundle.py"],
    ["tools/prepare_tno_western_precision_sources.py", "tests/test_tno_western_precision_sources.py"],
    ["tools/scenario_topology_decode.py", "tests/test_scenario_topology_decode.py"],
    ["js/core/project_feature_migration.js", "tests/project_feature_migration_behavior.test.mjs"],
    ["js/core/scenario_hierarchy.js", "tests/scenario_hierarchy_behavior.test.mjs"],
  ]) {
    const route = routes.find((record) => record.sourceRefs.includes(source));
    assert.ok(route?.commandRef.includes(testFile)
      || route?.commandRef.includes(testFile.replace("/", ".").replace(/\.py$/, "")), source);
    assert.deepEqual(route.executionOwners, ["child-safe"]);
    assert.deepEqual(route.profiles, ["pr-fast"]);
  }
});
