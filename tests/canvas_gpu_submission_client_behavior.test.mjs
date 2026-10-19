import test from "node:test";
import assert from "node:assert/strict";
import { createCanvasGpuSubmissionClient } from "../js/core/canvas_gpu_submission_client.js";

const turn = () => new Promise(resolve => setImmediate(resolve));
function bitmap(width = 20, height = 10) {
  return { width, height, closes: 0, close() { this.closes++; } };
}
function harness(options = {}) {
  const messages = [], worker = { terminated: 0,
    postMessage(message, transfer = []) {
      messages.push({ message, transfer });
      if (message.type === "DISPOSE_CANVAS_GPU_SESSION") queueMicrotask(() => {
        worker.onmessage({ data: { type: "CANVAS_GPU_DISPOSED", taskId: message.taskId } });
      });
    },
    terminate() { this.terminated++; },
  };
  let creations = 0;
  const client = createCanvasGpuSubmissionClient({ isSupported: () => true,
    createWorker: () => { creations++; return worker; }, ...options });
  function reply(type = "CANVAS_GPU_RESULT", extra = {}) {
    const request = messages.findLast(entry => entry.message.type === "CONSUME_CANVAS_BITMAP").message;
    worker.onmessage({ data: { type, taskId: request.taskId, stats: { width: request.width, height: request.height }, ...extra } });
  }
  return { client, worker, messages, reply, get creations() { return creations; } };
}

test("a session transfers one bitmap at a time, reuses its worker and terminates on disposal", async () => {
  const h = harness(), first = bitmap(), request = h.client.consume(first);
  await turn();
  assert.equal(h.client.getPendingTaskCount(), 1);
  assert.deepEqual(h.messages[0].transfer, [first]);
  const rejected = bitmap();
  await assert.rejects(h.client.consume(rejected), /active task/);
  assert.equal(rejected.closes, 1); assert.equal(h.messages.length, 1, "busy work is never queued");
  h.reply(); await request;
  const next = h.client.consume(bitmap()); await turn(); h.reply(); await next;
  assert.equal(h.creations, 1); assert.equal(h.client.getPendingTaskCount(), 0);
  await h.client.dispose(); await h.client.dispose(); assert.equal(h.worker.terminated, 1);
  const late = bitmap(); await assert.rejects(h.client.consume(late), /unavailable/); assert.equal(late.closes, 1);
});

test("abort preserves the active reservation until a matching cleanup acknowledgement arrives", async () => {
  const h = harness(), controller = new AbortController();
  let settled = false;
  const request = h.client.consume(bitmap(), { signal: controller.signal });
  request.then(() => { settled = true; }, () => { settled = true; });
  await turn(); controller.abort(); await turn();
  assert.equal(settled, false); assert.equal(h.client.getPendingTaskCount(), 1);
  assert.equal(h.messages.at(-1).message.type, "CANCEL_TASK");
  h.worker.onmessage({ data: { type: "CANVAS_GPU_CANCELLED", taskId: "unknown" } });
  await turn(); assert.equal(settled, false, "unrelated acknowledgements cannot free the slot");
  h.reply("CANVAS_GPU_CANCELLED"); await assert.rejects(request, { name: "AbortError" });
  assert.equal(h.client.getPendingTaskCount(), 0); await h.client.dispose();
});

test("abort before dispatch closes the bitmap without creating a worker", async () => {
  const h = harness(), controller = new AbortController(), source = bitmap(); controller.abort();
  await assert.rejects(h.client.consume(source, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(source.closes, 1); assert.equal(h.creations, 0); await h.client.dispose();
});

test("disposal during worker startup aborts cleanly, and startup failures close the untransferred bitmap", async () => {
  const h = harness(), source = bitmap(), request = h.client.consume(source);
  const disposal = h.client.dispose();
  await assert.rejects(request, { name: "AbortError" }); await disposal;
  assert.equal(h.creations, 0); assert.equal(source.closes, 1); assert.equal(h.client.getPendingTaskCount(), 0);
  const failure = harness({ createWorker: () => { throw new Error("worker startup failed"); } }), other = bitmap();
  await assert.rejects(failure.client.consume(other), /startup failed/);
  assert.equal(other.closes, 1); await failure.client.dispose();
});

test("disposal cancels active work and waits for cleanup before terminating", async () => {
  const h = harness(), request = h.client.consume(bitmap()); request.catch(() => {});
  await turn(); let disposed = false;
  const disposal = h.client.dispose().then(() => { disposed = true; });
  await turn(); assert.equal(disposed, false); assert.equal(h.worker.terminated, 0);
  h.reply("CANVAS_GPU_CANCELLED"); await disposal;
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(h.worker.terminated, 1); assert.equal(h.client.getPendingTaskCount(), 0);
  assert.deepEqual(h.messages.slice(-2).map(value => value.message.type), ["CANCEL_TASK", "DISPOSE_CANVAS_GPU_SESSION"]);
});

test("worker errors, invalid replies, failed transfers and timeouts reject instead of publishing", async () => {
  for (const failure of ["gpu", "dimensions", "reply", "crash", "transfer", "timeout"]) {
    const h = harness(failure === "timeout" ? { timeoutMs: 5 } : {}), source = bitmap();
    if (failure === "transfer") h.worker.postMessage = () => { throw new Error("transfer failed"); };
    const request = h.client.consume(source); request.catch(() => {}); await turn();
    if (failure === "gpu") h.reply("ERROR", { message: "GPU upload error", name: "OperationError" });
    else if (failure === "dimensions") h.reply("CANVAS_GPU_RESULT", { stats: { width: 99, height: 10 } });
    else if (failure === "reply") h.reply("UNEXPECTED");
    else if (failure === "crash") h.worker.onerror({ message: "worker crashed" });
    await assert.rejects(request, /GPU upload error|dimensions|acknowledgement|crashed|transfer failed|timed out/);
    assert.equal(source.closes, 1); assert.equal(h.client.getPendingTaskCount(), 0);
    await h.client.dispose(); assert.equal(h.worker.terminated, 1);
  }
});

test("three RGBA surfaces fit the original cap, oversized and unsupported sessions close their inputs", async () => {
  const h = harness(), tooLarge = bitmap(4096, 4096);
  await assert.rejects(h.client.consume(tooLarge), /Invalid/);
  assert.equal(tooLarge.closes, 1); assert.equal(h.creations, 0); await h.client.dispose();
  const unsupported = harness({ isSupported: () => false }), source = bitmap();
  await assert.rejects(unsupported.client.consume(source), /unavailable/);
  assert.equal(source.closes, 1); assert.equal(unsupported.creations, 0); await unsupported.client.dispose();
});

test("idle session disposal waits for its own acknowledgement and a timeout terminates it", async () => {
  const h = harness({ timeoutMs: 5 });
  h.worker.postMessage = (message, transfer = []) => { h.messages.push({ message, transfer }); };
  const request = h.client.consume(bitmap()); await turn(); h.reply(); await request;
  const disposal = h.client.dispose(); disposal.catch(() => {});
  await assert.rejects(disposal, /timed out/);
  assert.equal(h.worker.terminated, 1);
  assert.equal(h.messages.at(-1).message.type, "DISPOSE_CANVAS_GPU_SESSION");
  await assert.rejects(h.client.consume(bitmap()), /unavailable/);
});
