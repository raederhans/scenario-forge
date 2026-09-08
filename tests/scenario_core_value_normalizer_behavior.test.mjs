import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScenarioCoreArrayNormalizer } from "../js/core/scenario/core_value_normalizer.js";
import { normalizeScenarioCoreMap, normalizeScenarioCoreValue } from "../js/core/scenario/shared.js";

const normalizeTag = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const baseline = (values) => [...new Set(values.map(normalizeTag).filter(Boolean))];

test("content reuse keeps caller arrays independent and detects in-place input changes", () => {
  let calls = 0;
  const normalize = createScenarioCoreArrayNormalizer((value) => { calls += 1; return normalizeTag(value); });
  const input = [" sov ", "SOV", "", "s-pr"];
  const first = normalize(input);
  assert.deepEqual(first, ["SOV", "SPR"]);
  first.push("EDITED");
  assert.deepEqual(normalize([...input]), ["SOV", "SPR"]);
  assert.equal(calls, 4);
  input[0] = "GER";
  assert.deepEqual(normalize(input), ["GER", "SOV", "SPR"]);
  assert.equal(calls, 5);
  assert.deepEqual(normalize(["a", "b"]), ["A", "B"]);
  assert.deepEqual(normalize(["a\",\"b"]), ["AB"]);
});

test("bounded FIFO evicts old contents and does not retain oversized or mutable values", () => {
  let calls = 0;
  const normalize = createScenarioCoreArrayNormalizer((value) => { calls += 1; return normalizeTag(value); });
  normalize(["old"]);
  for (let index = 0; index < 512; index += 1) normalize([`tag${index}`]);
  const before = calls;
  normalize(["tag511"]);
  assert.equal(calls, before);
  normalize(["old"]);
  assert.equal(calls, before + 1);
  const mutable = { value: "a", toString() { return this.value; } };
  assert.deepEqual(normalize([mutable]), ["A"]);
  mutable.value = "b";
  assert.deepEqual(normalize([mutable]), ["B"]);
  const huge = ["a".repeat(513)];
  const beforeHuge = calls;
  normalize(huge); normalize(huge);
  assert.equal(calls, beforeHuge + 2);

});

test("public core map normalization preserves all input forms and mutable result ownership", () => {
  const raw = { a: ["SOV", " sov ", "GER"], b: "['spr', 'IBR']", c: " geo ", d: [], e: [null, 7] };
  const first = normalizeScenarioCoreMap(raw);
  assert.deepEqual(first, { a: ["SOV", "GER"], b: ["SPR", "IBR"], c: ["GEO"], e: ["7"] });
  first.a[0] = "EDITED";
  const next = normalizeScenarioCoreMap(raw);
  assert.deepEqual(next.a, ["SOV", "GER"]);
  raw.a.push("FRA");
  assert.deepEqual(normalizeScenarioCoreMap(raw).a, ["SOV", "GER", "FRA"]);
  assert.deepEqual(normalizeScenarioCoreValue([, " sov "]), ["SOV"]);
});

test("real HOI4 core assignments normalize once per distinct tag and reuse on return switch", () => {
  const data = JSON.parse(readFileSync(new URL("../data/scenarios/hoi4_1936/cores.by_feature.json", import.meta.url), "utf8"));
  const values = Object.values(data.cores);
  let calls = 0;
  const normalize = createScenarioCoreArrayNormalizer((value) => { calls += 1; return normalizeTag(value); });
  const distinct = new Set(values.flat());
  for (const value of values) assert.deepEqual(normalize(value), baseline(value));
  const firstPassCalls = calls;
  assert.equal(firstPassCalls, distinct.size);
  const other = JSON.parse(readFileSync(new URL("../data/scenarios/tno_1962/cores.by_feature.json", import.meta.url), "utf8"));
  for (const value of Object.values(other.cores)) assert.deepEqual(normalize(value), baseline(value));
  const modern = JSON.parse(readFileSync(new URL("../data/scenarios/modern_world/cores.by_feature.json", import.meta.url), "utf8"));
  for (const value of Object.values(modern.cores)) assert.deepEqual(normalize(value), baseline(value));
  const beforeReturn = calls;
  for (const value of values) assert.deepEqual(normalize(value), baseline(value));
  assert.equal(calls, beforeReturn);
  assert.ok(firstPassCalls < values.length / 20, `${firstPassCalls} normalizations for ${values.length} features`);
});
