import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createQuickFillRecords } from "../tools/verification/catalog/records/quick_fill.mjs";
import { VERIFICATION_METADATA_SOURCE } from "../tools/verification/verification_catalog_source.mjs";
import { buildRouteIndex } from "../tools/test_route_registry.mjs";

test("quick-fill command supplies concrete test files to shell-free CI runners", () => {
  const command = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts["test:node:quick-fill"];
  const [runtime, flag, ...files] = command.split(/\s+/);
  assert.deepEqual([runtime, flag], ["node", "--test"]);
  for (const file of files) assert.ok(fs.existsSync(file), `literal test argument must exist: ${file}`);
  const expected = fs.readdirSync("tests").filter(file => /^quick_fill.*\.test\.mjs$/.test(file)).map(file => `tests/${file}`);
  assert.deepEqual(files.filter(file => file.startsWith("tests/quick_fill")).sort(), expected.sort());
});

test("quick-fill routes append after existing routes without modifying their policies", () => {
  const old = Object.freeze([Object.freeze({ id: "old", selectorOrder: 2000 })]);
  const records = createQuickFillRecords(old);
  assert.equal(records.length, 7);
  assert.equal(new Set(records.map((record) => record.id)).size, 7);
  for (const [index, record] of records.entries()) {
    assert.equal(record.selectorOrder, 2001 + index);
    for (const source of record.sourceRefs) assert.ok(fs.existsSync(source), source);
    if (index < 5) {
      assert.deepEqual(record.executionOwners, ["child-safe"]);
      assert.deepEqual(record.resourceLocks, []);
      assert.equal(record.entrypointPolicyIndex, 5);
    } else {
      assert.deepEqual(record.executionOwners, ["main-thread"]);
      assert.ok(record.resourceLocks.includes(".runtime-output"));
      assert.deepEqual(record.profiles, ["full"]);
    }
  }
});

test("public authority owns the new commands after all earlier precision routes", () => {
  const records = VERIFICATION_METADATA_SOURCE.records;
  const precision = records.filter((record) => record.id.startsWith("local:precision-scaling:") || record.id.startsWith("local:latency-batches:"));
  const quickFill = records.filter((record) => record.id.startsWith("local:quick-fill:") || record.id === "node:test:node:quick-fill");
  assert.equal(quickFill.length, 7);
  assert.ok(Math.min(...quickFill.map((record) => record.selectorOrder)) > Math.max(...precision.map((record) => record.selectorOrder)));
  assert.ok(quickFill.some((record) => record.commandRef === "test:node:quick-fill"));
  assert.ok(quickFill.some((record) => record.commandRef === "test:python:quick-fill"));
  assert.ok(buildRouteIndex().some((route) => route.id === "node:test:node:quick-fill" && route.commandRef === "test:node:quick-fill"));
});

test("quick-fill delivery assets have routes and browser work retains resource ownership", () => {
  const records = createQuickFillRecords([]);
  const sources = new Set(records.flatMap((record) => record.sourceRefs));
  for (const file of [".github/workflows/quick-fill-contract.yml", "data/quick_fill/reference/LICENSE.china-pca.txt", "docs/active/quick-fill-hierarchy-phases-1-3-20260921.md", "tools/audit_quick_fill.mjs", "tools/check_quick_fill_browser.mjs"]) {
    assert.ok(sources.has(file), file);
  }
  const browser = records.find((record) => record.id === "local:quick-fill:browser");
  assert.ok(browser.resourceLocks.includes("playwright-browser"));
  assert.ok(browser.resourceLocks.includes("browser-dev-server"));
});
