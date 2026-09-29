import "../../vendor/d3.v7.min.js";
import "../../vendor/topojson-client.min.js";
import "../core/geometry_transfer_codec_shared.js";
import { decodeBathymetryTopology } from "../core/renderer/bathymetry_decode.js";

const tasks = new Map();
const now = () => globalThis.performance?.now?.() ?? Date.now();

self.onmessage = async ({ data: message = {} }) => {
  const { taskId, type } = message;
  if (type === "CANCEL_TASK") {
    tasks.get(taskId)?.abort();
    return;
  }
  if (type !== "LOAD_BATHYMETRY") {
    self.postMessage({ type: "ERROR", taskId, errorKind: "runtime", message: "Unsupported bathymetry task." });
    return;
  }
  const controller = new AbortController();
  tasks.set(taskId, controller);
  try {
    let entry;
    let fetchMs;
    let jsonParseMs;
    try {
      const fetchStartedAt = now();
      const response = await fetch(message.url, { cache: "default", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      fetchMs = now() - fetchStartedAt;
      const parseStartedAt = now();
      const topology = JSON.parse(raw);
      jsonParseMs = now() - parseStartedAt;
      entry = decodeBathymetryTopology(message.url, topology);
    } catch (error) {
      if (!controller.signal.aborted) {
        self.postMessage({ type: "ERROR", taskId, errorKind: "asset", message: String(error?.message || error) });
      }
      return;
    }
    if (controller.signal.aborted) return;
    try {
      const packStartedAt = now();
      const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(entry);
      const timings = { ...entry.timings, fetchMs, jsonParseMs, packMs: now() - packStartedAt };
      self.postMessage({
        type: "BATHYMETRY_READY",
        taskId,
        entry: packed.transferables.length ? null : entry,
        geometryTransport: packed.transferables.length ? packed.payload : null,
        timings,
      }, packed.transferables);
    } catch (error) {
      self.postMessage({ type: "ERROR", taskId, errorKind: "runtime", message: String(error?.message || error) });
    }
  } finally {
    if (tasks.get(taskId) === controller) tasks.delete(taskId);
  }
};
