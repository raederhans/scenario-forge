import test from "node:test";
import assert from "node:assert/strict";
import { cloneJsonLike } from "../js/core/json_clone.js";
import { cloneStateValue } from "../js/core/state/actions/clone_state_value.js";

test("JSON clone preserves cycles and shared references with structuredClone", () => {
  const shared = {};
  const source = { left: shared, right: shared };
  source.self = source;
  const result = cloneJsonLike(source);
  assert.notEqual(result, source);
  assert.equal(result.self, result);
  assert.equal(result.left, result.right);
  assert.notEqual(result.left, shared);
});

test("state clone retains functions and symbols and rejects cycles", () => {
  const fn = () => 1;
  const symbol = Symbol("value");
  assert.equal(cloneStateValue(fn), fn);
  assert.equal(cloneStateValue(symbol), symbol);
  assert.deepEqual(cloneStateValue({ fn, symbol }), { fn, symbol });
  const shared = {};
  const result = cloneStateValue([shared, shared]);
  assert.notEqual(result[0], result[1]);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => cloneStateValue(cyclic), RangeError);
});
