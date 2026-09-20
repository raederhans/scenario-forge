import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerTaskClient } from "../js/core/worker_task_client.js";

test("worker task client resolves matching task replies and clears timeouts", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeoutCallback = null;
  const clearedTimeouts = [];
  const postedMessages = [];

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(message) {
      postedMessages.push(message);
    }

    terminate() {
      this.terminated = true;
    }
  }

  try {
    globalThis.setTimeout = (callback) => {
      timeoutCallback = callback;
      return "timeout-1";
    };
    globalThis.clearTimeout = (timeoutId) => {
      clearedTimeouts.push(timeoutId);
    };
    const client = createWorkerTaskClient({
      createWorker: () => new FakeWorker(),
      defaultTimeoutMs: 1000,
      createTaskId: (type, sequence) => `${type}:${sequence}`,
      resolveMessage: (message) => ({ ok: true, value: message.value }),
    });

    await client.ensureWorker();
    const resultPromise = client.dispatchTask("LOAD", { value: 7 });
    await Promise.resolve();
    assert.equal(postedMessages.length, 1);
    assert.equal(postedMessages[0].taskId, "LOAD:1");
    assert.equal(postedMessages[0].value, 7);

    FakeWorker.instance.onmessage({
      data: {
        type: "READY",
        taskId: "LOAD:1",
        value: 11,
      },
    });

    assert.deepEqual(await resultPromise, { ok: true, value: 11 });
    assert.deepEqual(clearedTimeouts, ["timeout-1"]);
    assert.equal(typeof timeoutCallback, "function");
    assert.equal(client.getPendingTaskCount(), 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("worker task client recycles worker and rejects pending work on timeout", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeoutCallback = null;

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage() {}

    terminate() {
      this.terminated = true;
    }
  }

  try {
    globalThis.setTimeout = (callback) => {
      timeoutCallback = callback;
      return "timeout-2";
    };
    globalThis.clearTimeout = () => {};
    const client = createWorkerTaskClient({
      createWorker: () => new FakeWorker(),
      defaultTimeoutMs: 1000,
      createTaskId: (type, sequence) => `${type}:${sequence}`,
      createTimeoutError: (type) => new Error(`timed out: ${type}`),
    });

    await client.ensureWorker();
    const resultPromise = client.dispatchTask("LOAD", {});
    await Promise.resolve();
    timeoutCallback();

    await assert.rejects(resultPromise, /timed out: LOAD/);
    assert.equal(FakeWorker.instance.terminated, true);
    assert.equal(client.getPendingTaskCount(), 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("worker task client gives timeout and recycled pending tasks separate errors", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timeoutCallbacks = [];

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage() {}

    terminate() {
      this.terminated = true;
    }
  }

  try {
    globalThis.setTimeout = (callback) => {
      timeoutCallbacks.push(callback);
      return `timeout-${timeoutCallbacks.length}`;
    };
    globalThis.clearTimeout = () => {};
    const client = createWorkerTaskClient({
      createWorker: () => new FakeWorker(),
      defaultTimeoutMs: 1000,
      createTaskId: (type, sequence) => `${type}:${sequence}`,
      createTimeoutError: (type) => new Error(`timed out: ${type}`),
      createRecycleError: (type) => new Error(`recycled after timeout: ${type}`),
    });

    await client.ensureWorker();
    const firstPromise = client.dispatchTask("LOAD_A", {});
    const secondPromise = client.dispatchTask("LOAD_B", {});
    await Promise.resolve();
    timeoutCallbacks[0]();

    await assert.rejects(firstPromise, /timed out: LOAD_A/);
    await assert.rejects(secondPromise, /recycled after timeout: LOAD_A/);
    assert.equal(FakeWorker.instance.terminated, true);
    assert.equal(client.getPendingTaskCount(), 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("worker task client rejects task-specific ERROR messages", async () => {
  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage() {}
  }

  const client = createWorkerTaskClient({
    createWorker: () => new FakeWorker(),
    createTaskId: (type, sequence) => `${type}:${sequence}`,
    createMessageError: (message) => new Error(`message failed: ${message.reason}`),
  });

  await client.ensureWorker();
  const resultPromise = client.dispatchTask("LOAD", {});
  await Promise.resolve();
  FakeWorker.instance.onmessage({
    data: {
      type: "ERROR",
      taskId: "LOAD:1",
      reason: "decode",
    },
  });

  await assert.rejects(resultPromise, /message failed: decode/);
  assert.equal(client.getPendingTaskCount(), 0);
});

test("worker task client rejects pending work on worker error", async () => {
  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage() {}

    terminate() {
      this.terminated = true;
    }
  }

  const client = createWorkerTaskClient({
    createWorker: () => new FakeWorker(),
    createTaskId: (type, sequence) => `${type}:${sequence}`,
    createWorkerError: (event) => new Error(`worker crashed: ${event.message}`),
  });

  await client.ensureWorker();
  const resultPromise = client.dispatchTask("LOAD", {});
  await Promise.resolve();
  FakeWorker.instance.onerror({ message: "boom" });

  await assert.rejects(resultPromise, /worker crashed: boom/);
  assert.equal(FakeWorker.instance.terminated, true);
  assert.equal(client.getPendingTaskCount(), 0);
});

test("worker task client cancels one task without recycling its shared worker", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const clearedTimeouts = [];
  const postedMessages = [];
  const abortListeners = new Set();
  const signal = {
    aborted: false,
    reason: null,
    addEventListener(type, listener) {
      if (type === "abort") abortListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") abortListeners.delete(listener);
    },
  };

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(message) {
      postedMessages.push(message);
    }

    terminate() {
      this.terminated = true;
    }
  }

  try {
    let timerSequence = 0;
    globalThis.setTimeout = () => `timeout-${++timerSequence}`;
    globalThis.clearTimeout = (timeoutId) => clearedTimeouts.push(timeoutId);
    const client = createWorkerTaskClient({
      createWorker: () => new FakeWorker(),
      createTaskId: (type, sequence) => `${type}:${sequence}`,
    });

    await client.ensureWorker();
    const abortedTask = client.dispatchTask("LOAD_A", {}, { signal });
    const successfulTask = client.dispatchTask("LOAD_B", {});
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(postedMessages.map((message) => message.taskId), ["LOAD_A:1", "LOAD_B:2"]);
    assert.equal(abortListeners.size, 1);

    signal.aborted = true;
    signal.reason = new DOMException("cancelled", "AbortError");
    for (const listener of [...abortListeners]) listener();

    await assert.rejects(abortedTask, (error) => error?.name === "AbortError");
    assert.deepEqual(postedMessages.at(-1), { type: "CANCEL_TASK", taskId: "LOAD_A:1" });
    assert.equal(FakeWorker.instance.terminated, undefined);
    assert.equal(client.getPendingTaskCount(), 1);
    assert.equal(abortListeners.size, 0);
    assert.deepEqual(clearedTimeouts, ["timeout-1"]);

    FakeWorker.instance.onmessage({ data: { type: "READY", taskId: "LOAD_A:1", value: "late" } });
    assert.equal(client.getPendingTaskCount(), 1);
    FakeWorker.instance.onmessage({ data: { type: "READY", taskId: "LOAD_B:2", value: "kept" } });
    assert.equal((await successfulTask).value, "kept");
    assert.equal(client.getPendingTaskCount(), 0);
    assert.deepEqual(clearedTimeouts, ["timeout-1", "timeout-2"]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("worker task client skips worker dispatch for an already aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let workersCreated = 0;
  const client = createWorkerTaskClient({
    createWorker: () => {
      workersCreated += 1;
      return {};
    },
  });

  await assert.rejects(
    client.dispatchTask("LOAD", {}, { signal: controller.signal }),
    (error) => error?.name === "AbortError",
  );
  assert.equal(workersCreated, 0);
  assert.equal(client.getPendingTaskCount(), 0);
});

test("worker task client cleans pending state when postMessage throws", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const clearedTimeouts = [];

  try {
    globalThis.setTimeout = () => "timeout-post-failure";
    globalThis.clearTimeout = (timeoutId) => clearedTimeouts.push(timeoutId);
    const client = createWorkerTaskClient({
      createWorker: () => ({
        postMessage() {
          throw new Error("post failed");
        },
      }),
    });

    await assert.rejects(client.dispatchTask("LOAD"), /post failed/);
    assert.equal(client.getPendingTaskCount(), 0);
    assert.deepEqual(clearedTimeouts, ["timeout-post-failure"]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("startup worker client restores transferred geometry and preserves serialized AbortError names", async () => {
  const originalWorker = globalThis.Worker;
  const postedMessages = [];
  let startupWorkerClient = null;

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(message) {
      postedMessages.push(message);
    }

    terminate() {
      this.terminated = true;
    }
  }

  try {
    globalThis.Worker = FakeWorker;
    startupWorkerClient = await import(
      new URL(`../js/core/startup_worker_client.js?abort-error=${Date.now()}`, import.meta.url),
    );
    const geometryResult = startupWorkerClient.decodeRuntimeChunkViaWorker({ chunkUrl: "/geometry.json", chunkType: "political" });
    await new Promise((resolve) => setImmediate(resolve));
    const original = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-0, 2, 3] } }] };
    const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(original, { minCoordinateCount: 0 });
    FakeWorker.instance.onmessage({ data: { type: "RUNTIME_CHUNK_READY", taskId: postedMessages[0].taskId,
      geometryTransport: { field: "chunkPayload", payload: structuredClone(packed.payload, { transfer: packed.transferables }) } } });
    assert.deepEqual((await geometryResult).chunkPayload, original);
    const resultPromise = startupWorkerClient.decodeRuntimeChunkViaWorker({
      runtimeTopologyUrl: "/runtime.json",
      chunkUrl: "/chunk.json",
    });
    await new Promise((resolve) => setImmediate(resolve));
    FakeWorker.instance.onmessage({
      data: {
        type: "ERROR",
        taskId: postedMessages[1].taskId,
        message: "cancelled",
        name: "AbortError",
      },
    });

    await assert.rejects(resultPromise, (error) => error?.name === "AbortError");
  } finally {
    startupWorkerClient?.terminateStartupWorker();
    globalThis.Worker = originalWorker;
  }
});
