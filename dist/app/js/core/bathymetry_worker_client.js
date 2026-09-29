import { createWorkerTaskClient } from "./worker_task_client.js";
import "./geometry_transfer_codec_shared.js";

const WORKER_URL = new URL("../workers/bathymetry.worker.js", import.meta.url);
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function createBathymetryWorkerClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function",
  timeoutMs = 60_000,
} = {}) {
  let disabled = false;
  let disposed = false;
  const runtimeError = (message) => Object.assign(new Error(message), { kind: "runtime" });
  const client = createWorkerTaskClient({
    createWorker: () => {
      if (disabled || disposed) throw runtimeError("Bathymetry worker unavailable.");
      return createWorker();
    },
    defaultTimeoutMs: timeoutMs,
    createMessageError: (message) => Object.assign(
      new Error(message?.message || "Bathymetry worker task failed."),
      { kind: message?.errorKind === "asset" ? "asset" : "runtime" },
    ),
    createTimeoutError: () => runtimeError("Bathymetry worker timed out."),
    createRecycleError: () => runtimeError("Bathymetry worker recycled after timeout."),
    createWorkerError: (event) => runtimeError(event?.message || event?.error?.message || "Bathymetry worker crashed."),
    resolveMessage: (message) => {
      if (message?.type !== "BATHYMETRY_READY") throw runtimeError("Invalid bathymetry worker response.");
      const unpackStartedAt = now();
      const entry = message.geometryTransport
        ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(message.geometryTransport)
        : message.entry;
      if (!entry || typeof entry !== "object") throw runtimeError("Missing bathymetry worker entry.");
      return { ...entry, timings: { ...entry.timings, ...message.timings, unpackMs: now() - unpackStartedAt } };
    },
  });

  const available = () => !disabled && !disposed && isSupported();
  async function load(url) {
    if (!available()) return null;
    const sourceUrl = String(url || "").trim();
    if (!sourceUrl) throw new TypeError("Bathymetry URL is required.");
    const resolvedUrl = new URL(sourceUrl, globalThis.location?.href || import.meta.url).toString();
    try {
      const entry = await client.dispatchTask("LOAD_BATHYMETRY", { url: resolvedUrl });
      return disabled || disposed ? null : entry;
    } catch (error) {
      if (error?.kind === "asset" && !disposed) throw error;
      disabled = true;
      client.terminate(runtimeError("Bathymetry worker unavailable."));
      return null;
    }
  }
  function dispose() {
    disposed = true;
    client.terminate(runtimeError("Bathymetry worker disposed."));
  }
  return { load, dispose, available };
}
