import test from "node:test";
import assert from "node:assert/strict";
import { cloneJsonLike } from "../js/core/json_clone.js";
import { cloneJsonLike as clonePerfJsonLike } from "../js/core/perf_probe.js";
import { cloneStateValue } from "../js/core/state/actions/clone_state_value.js";

for (const clone of [cloneJsonLike, cloneStateValue]) {
  test(`${clone.name} preserves primitives and detaches nested values`, () => {
    for (const value of [undefined, null, true, false, 0, -0, 42, "", "text", NaN, Infinity, 1n]) {
      assert.equal(clone(value), value);
    }
    const key = { id: 1 };
    const entry = { nested: [2] };
    const source = {
      array: [{ nested: [1] }],
      date: new Date("2026-01-02T00:00:00Z"),
      map: new Map([[key, entry]]),
      set: new Set([entry]),
    };
    const result = clone(source);
    assert.deepEqual(result, source);
    assert.notEqual(result, source);
    assert.notEqual(result.date, source.date);
    assert.notEqual(result.map, source.map);
    assert.notEqual(result.set, source.set);
    assert.notEqual([...result.map.keys()][0], key);
    result.array[0].nested.push(3);
    [...result.map.values()][0].nested.push(4);
    [...result.set][0].nested.push(5);
    result.date.setUTCFullYear(2030);
    assert.deepEqual(source.array, [{ nested: [1] }]);
    assert.deepEqual(entry, { nested: [2] });
    assert.equal(source.date.getUTCFullYear(), 2026);
  });
}

test("JSON clone preserves cycles and shared references with structuredClone", () => {
  const shared = {};
  const source = { left: shared, right: shared };
  source.self = source;
  const result = cloneJsonLike(source);
  assert.notEqual(result, source);
  assert.equal(result.self, result);
  assert.equal(result.left, result.right);
  assert.notEqual(result.left, shared);
  assert.deepEqual(clonePerfJsonLike(source), result);
});

test("JSON clone falls back for functions and symbols", () => {
  const fn = () => 1;
  const symbol = Symbol("value");
  assert.equal(cloneJsonLike(fn), undefined);
  assert.equal(cloneJsonLike(symbol), undefined);
  assert.deepEqual(cloneJsonLike({ value: 1, fn, symbol }), { value: 1 });
  assert.deepEqual(cloneJsonLike([fn, symbol, undefined]), [null, null, null]);
  const cyclic = { fn };
  cyclic.self = cyclic;
  assert.equal(cloneJsonLike(cyclic), undefined);
});

for (const mode of ["unavailable", "throws"]) {
  test(`JSON fallback behavior when structuredClone ${mode}`, (t) => {
    t.mock.method(globalThis, "structuredClone", () => { throw new Error("clone failed"); });
    if (mode === "unavailable") globalThis.structuredClone = undefined;
    for (const value of [undefined, null, true, false, 0, 42, "", "text"]) {
      assert.equal(cloneJsonLike(value), value);
    }
    assert.equal(cloneJsonLike(-0), 0);
    assert.equal(cloneJsonLike(NaN), null);
    assert.equal(cloneJsonLike(Infinity), null);
    assert.equal(cloneJsonLike(1n), undefined);
    assert.equal(cloneJsonLike(() => 1), undefined);
    assert.equal(cloneJsonLike(Symbol("value")), undefined);
    const source = { array: [{ value: 1 }], missing: undefined };
    const result = cloneJsonLike(source);
    assert.deepEqual(result, { array: [{ value: 1 }] });
    result.array[0].value = 2;
    assert.equal(source.array[0].value, 1);
    assert.deepEqual(cloneJsonLike([undefined, () => 1]), [null, null]);
    assert.equal(cloneJsonLike(new Date("2026-01-02T00:00:00Z")), "2026-01-02T00:00:00.000Z");
    assert.deepEqual(cloneJsonLike(new Map([["key", 1]])), {});
    assert.deepEqual(cloneJsonLike(new Set([1])), {});
    const cyclic = {};
    cyclic.self = cyclic;
    assert.equal(cloneJsonLike(cyclic), undefined);
    assert.equal(cloneJsonLike({ toJSON() { throw new Error("serialization failed"); } }), undefined);
  });
}

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
