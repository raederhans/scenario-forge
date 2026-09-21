import test from "node:test";
import assert from "node:assert/strict";
import { createQuickFillRecords } from "../tools/verification/catalog/records/quick_fill.mjs";
import { VERIFICATION_METADATA_SOURCE } from "../tools/verification/verification_catalog_source.mjs";

test("quick-fill routes append after existing routes without modifying their policies", () => {
  const old = Object.freeze([Object.freeze({ id: "old", selectorOrder: 2000 })]);
  const records = createQuickFillRecords(old);
  assert.equal(records.length, 4);
  assert.equal(new Set(records.map((record) => record.id)).size, 4);
  for (const [index, record] of records.entries()) {
    assert.equal(record.selectorOrder, 2001 + index);
    assert.deepEqual(record.executionOwners, ["child-safe"]);
    assert.deepEqual(record.resourceLocks, []);
    assert.equal(record.entrypointPolicyIndex, 5);
  }
});

test("public authority owns the new commands after all earlier precision routes", () => {
  const records = VERIFICATION_METADATA_SOURCE.records;
  const precision = records.filter((record) => record.id.startsWith("local:precision-scaling:") || record.id.startsWith("local:latency-batches:"));
  const quickFill = records.filter((record) => record.id.startsWith("local:quick-fill:"));
  assert.equal(quickFill.length, 4);
  assert.ok(Math.min(...quickFill.map((record) => record.selectorOrder)) > Math.max(...precision.map((record) => record.selectorOrder)));
  assert.ok(quickFill.some((record) => record.commandRef === "test:node:quick-fill"));
  assert.ok(quickFill.some((record) => record.commandRef === "test:python:quick-fill"));
});
