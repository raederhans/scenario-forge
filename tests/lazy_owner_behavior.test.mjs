import test from "node:test";
import assert from "node:assert/strict";
import { lazyOwner } from "../js/core/map_renderer/lazy_owner.js";

test("lazyOwner creates the owner once, on first use", () => {
  let created = 0;
  const getOwner = lazyOwner(() => ({ id: ++created }));
  assert.equal(getOwner.peek(), null);
  assert.equal(created, 0);
  const first = getOwner();
  assert.deepEqual(first, { id: 1 });
  assert.equal(getOwner(), first);
  assert.equal(getOwner.peek(), first);
  assert.equal(created, 1);
});

test("a failed creation is retried on the next use", () => {
  let attempts = 0;
  const getOwner = lazyOwner(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("not ready");
    return { attempts };
  });
  assert.throws(() => getOwner(), /not ready/);
  assert.equal(getOwner.peek(), null);
  assert.deepEqual(getOwner(), { attempts: 2 });
});
