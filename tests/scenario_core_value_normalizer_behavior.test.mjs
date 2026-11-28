import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioCoreArrayNormalizer } from "../js/core/scenario/core_value_normalizer.js";
import { normalizeScenarioCoreMap, normalizeScenarioCoreValue } from "../js/core/scenario/shared.js";

const normalizeTag = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

test("content reuse keeps caller arrays independent and detects in-place input changes", () => {
  const normalize = createScenarioCoreArrayNormalizer(normalizeTag);

  const input = [" sov ", "SOV", "", "s-pr"];
  const first = normalize(input);
  assert.deepEqual(first, ["SOV", "SPR"]);
  first.push("EDITED");
  assert.deepEqual(normalize([...input]), ["SOV", "SPR"]);

  input[0] = "GER";
  assert.deepEqual(normalize(input), ["GER", "SOV", "SPR"]);
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
