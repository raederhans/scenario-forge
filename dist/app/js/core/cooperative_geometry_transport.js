import "./geometry_transfer_codec_shared.js";

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Geometry packing cancelled.");
  error.name = "AbortError";
  throw error;
}

// Each codec call scans only one bounded feature batch. A single very large
// feature remains indivisible and may still occupy one main-thread slice.
export async function packGeometryCooperatively(updates, {
  signal,
  batchSize = 32,
  sliceBudgetMs = 4,
  pack = (batch) => globalThis.__scenarioForgeGeometryTransferCodecShared.pack(batch),
  now = () => performance.now(),
  yieldTask = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  if (!Array.isArray(updates) || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError("Invalid geometry packing batch.");
  }
  const batches = [], transferables = [];
  let sliceStartedAt = now();
  for (let index = 0; index < updates.length; index += batchSize) {
    abortIfNeeded(signal);
    const packed = pack(updates.slice(index, index + batchSize));
    const transport = packed?.then ? await packed : packed;
    abortIfNeeded(signal);
    batches.push(transport.payload);
    transferables.push(...transport.transferables);
    if (index + batchSize < updates.length && now() - sliceStartedAt >= sliceBudgetMs) {
      await yieldTask();
      sliceStartedAt = now();
    }
  }
  abortIfNeeded(signal);
  return { payload: { encoding: "geo-f64-batches-v1", batches }, transferables };
}
