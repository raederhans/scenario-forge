import { createDeferredPromise as deferred } from "./helpers/deferred_promise.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { createLatestRequestQueue } from "../js/ui/toolbar/latest_request_queue.js";

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("runs at most one request and keeps only the latest pending request", async () => {
  const firstExecution = deferred();
  const executed = [];
  const settled = [];
  let activeExecutions = 0;
  let maximumActiveExecutions = 0;
  const queue = createLatestRequestQueue({
    isSameRequest: (left, right) => left.context === right.context,
    execute: async (request) => {
      executed.push(request.value);
      activeExecutions += 1;
      maximumActiveExecutions = Math.max(maximumActiveExecutions, activeExecutions);
      if (request.value === "first") await firstExecution.promise;
      activeExecutions -= 1;
    },
    settle: (waiter) => settled.push(waiter),
  });

  const first = queue.enqueue({ context: "a", value: "first" }, "first-waiter");
  const olderPending = queue.enqueue({ context: "a", value: "older" }, "older-waiter");
  const latestPending = queue.enqueue({ context: "a", value: "latest" }, "latest-waiter");
  await nextTurn();

  assert.deepEqual(executed, ["first"]);
  assert.deepEqual(settled, []);

  firstExecution.resolve();
  await Promise.all([first, olderPending, latestPending]);

  assert.deepEqual(executed, ["first", "latest"]);
  assert.deepEqual(settled, ["first-waiter", "older-waiter", "latest-waiter"]);
  assert.equal(maximumActiveExecutions, 1);
});

test("replacing a pending request from another context settles its waiters immediately", async () => {
  const firstExecution = deferred();
  const executed = [];
  const settled = [];
  const queue = createLatestRequestQueue({
    isSameRequest: (left, right) => left.context === right.context,
    execute: async (request) => {
      executed.push(request.value);
      if (request.value === "active") await firstExecution.promise;
    },
    settle: (waiter) => settled.push(waiter),
  });

  const active = queue.enqueue({ context: "active", value: "active" }, "active-waiter");
  const replaced = queue.enqueue({ context: "old", value: "old-pending" }, "old-waiter");
  const replacement = queue.enqueue({ context: "new", value: "new-pending" }, "new-waiter");

  await replaced;
  assert.deepEqual(settled, ["old-waiter"]);
  assert.deepEqual(executed, ["active"]);

  firstExecution.resolve();
  await Promise.all([active, replacement]);

  assert.deepEqual(executed, ["active", "new-pending"]);
  assert.deepEqual(settled, ["old-waiter", "active-waiter", "new-waiter"]);
});

test("settles active waiters and continues pumping after execute rejects", async () => {
  const unhandled = [];
  const onUnhandledRejection = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const executed = [];
    const settled = [];
    const queue = createLatestRequestQueue({
      isSameRequest: (left, right) => left.context === right.context,
      execute: async (request) => {
        executed.push(request.value);
        if (request.value === "failure") throw new Error("expected failure");
      },
      settle: (waiter) => settled.push(waiter),
    });

    await Promise.all([
      queue.enqueue({ context: "a", value: "failure" }, "failed-waiter"),
      queue.enqueue({ context: "b", value: "success" }, "success-waiter"),
    ]);
    await nextTurn();

    assert.deepEqual(executed, ["failure", "success"]);
    assert.deepEqual(settled, ["failed-waiter", "success-waiter"]);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});
