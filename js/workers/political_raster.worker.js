/* Political raster worker shell. Real raster support is gated by the main-thread client. */
const PROTOCOL_VERSION = 1;

function reply(payload) {
  self.postMessage({ protocolVersion: PROTOCOL_VERSION, ...payload });
}

self.onmessage = (event) => {
  const message = event.data || {};
  const taskId = message.taskId || "";
  try {
    if (message.type === "PING") {
      reply({ type: "RASTER_READY", taskId });
      return;
    }
    reply({
      type: "ERROR",
      taskId,
      errorCode: "unsupported-capability",
    });
  } catch (error) {
    reply({
      type: "ERROR",
      taskId,
      errorCode: "raster-failed",
      message: String(error?.message || error || "unknown"),
    });
  }
};
