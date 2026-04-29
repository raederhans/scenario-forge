/* Default-off political raster worker v2 shell.
 * It currently validates the request contract and returns measurable metadata.
 * The main thread keeps the stable political drawing path until bitmap transfer
 * parity is proven under the feature flag.
 */
const PROTOCOL_VERSION = 2;

function nowMs() {
  return self.performance?.now ? self.performance.now() : Date.now();
}

function reply(payload) {
  self.postMessage({ protocolVersion: PROTOCOL_VERSION, ...payload });
}

function normalizeIdentity(identity = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    scenarioId: String(identity.scenarioId || ""),
    selectionVersion: Number(identity.selectionVersion || 0),
    topologyRevision: Number(identity.topologyRevision || 0),
    colorRevision: Number(identity.colorRevision || 0),
    transformBucket: String(identity.transformBucket || ""),
    dpr: Number(identity.dpr || 1),
    viewport: identity.viewport || null,
    passSignature: String(identity.passSignature || ""),
  };
}

function handleRasterPoliticalPass(message) {
  const startedAt = nowMs();
  const taskId = String(message.taskId || "");
  const identity = normalizeIdentity(message.identity || {});
  const hint = message.renderHint && typeof message.renderHint === "object" ? message.renderHint : {};
  reply({
    type: "RASTER_RESULT",
    taskId,
    accepted: true,
    identity,
    reason: "metadata-only",
    rasterMs: Number((nowMs() - startedAt).toFixed(3)),
    encodeMs: 0,
    decodeMs: 0,
    blitMs: 0,
    renderHint: {
      pass: String(hint.pass || "political"),
      surface: String(hint.surface || "main"),
      canvasPxWidth: Math.max(0, Number(hint.canvasPxWidth || 0)),
      canvasPxHeight: Math.max(0, Number(hint.canvasPxHeight || 0)),
    },
  });
}

self.onmessage = (event) => {
  const message = event.data || {};
  const taskId = String(message.taskId || "");
  try {
    if (Number(message.protocolVersion || PROTOCOL_VERSION) !== PROTOCOL_VERSION) {
      reply({
        type: "ERROR",
        taskId,
        errorCode: "protocol-mismatch",
      });
      return;
    }
    if (message.type === "PING") {
      reply({ type: "RASTER_READY", taskId });
      return;
    }
    if (message.type === "RASTER_POLITICAL_PASS") {
      handleRasterPoliticalPass(message);
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
