import http from "node:http";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";

const METHODS = {
  Canvas2D: ["drawImage", "fill", "stroke", "clip", "clearRect", "getImageData", "putImageData"],
  OffscreenCanvas2D: ["drawImage", "fill", "stroke", "clip", "clearRect", "getImageData", "putImageData"],
  WebGL1: ["texImage2D", "texSubImage2D", "texStorage2D", "bufferData", "drawArrays", "drawElements", "readPixels", "getProgramParameter", "getShaderParameter", "getParameter", "compileShader", "linkProgram"],
  WebGL2: ["texImage2D", "texSubImage2D", "texStorage2D", "bufferData", "drawArrays", "drawElements", "readPixels", "getProgramParameter", "getShaderParameter", "getParameter", "compileShader", "linkProgram"],
};
const OPERATIONS = new Set([...Object.entries(METHODS).flatMap(([type, names]) => names.map(name => `${type}.${name}`)),
  "Canvas.width", "Canvas.height", "Canvas.getContext", "OffscreenCanvas.width", "OffscreenCanvas.height",
  "OffscreenCanvas.getContext", "OffscreenCanvas.transferToImageBitmap", "Worker.postMessage"]);
const MAX_BODY = 64 * 1024, MAX_EVENTS = 128, MAX_ACTIVE = 64;
const plain = value => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function validateNativeBreadcrumbBatch(value) {
  const validEvent = event => onlyKeys(event, ["seq", "operation", "resourceId", "timestamp", "phase", "dimensions"])
    && Number.isSafeInteger(event.seq) && event.seq > 0 && OPERATIONS.has(event.operation)
    && Number.isSafeInteger(event.resourceId) && event.resourceId > 0 && finite(event.timestamp)
    && ["begin", "end"].includes(event.phase) && Array.isArray(event.dimensions) && event.dimensions.length <= 8
    && event.dimensions.every(finite);
  return onlyKeys(value, ["documentId", "heartbeatAt", "events", "active", "dropped"])
    && typeof value.documentId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value.documentId)
    && finite(value.heartbeatAt) && Number.isSafeInteger(value.dropped) && value.dropped >= 0
    && Array.isArray(value.events) && value.events.length <= MAX_EVENTS && value.events.every(validEvent)
    && Array.isArray(value.active) && value.active.length <= MAX_ACTIVE
    && value.active.every(event => validEvent(event) && event.phase === "begin");
}

function allowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && !url.username && !url.password && url.origin === origin;
  } catch { return false; }
}

// Export the request handler so validation tests need no listening server.
export function createNativeBreadcrumbReceiver({ token, accept, rejected = () => {} }) {
  return (request, response) => {
    const origin = request.headers.origin;
    if (request.url !== `/${token}` || !allowedOrigin(origin)) { rejected(); response.writeHead(403); response.end(); return; }
    const headers = { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Cache-Control": "no-store",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true" };
    if (request.method === "OPTIONS") { response.writeHead(204, headers); response.end(); return; }
    if (request.method !== "POST") { rejected(); response.writeHead(405, headers); response.end(); return; }
    let bytes = 0, chunks = [], complete = false;
    const fail = status => { if (complete) return; complete = true; chunks = []; rejected(); response.writeHead(status, headers); response.end(); };
    request.setTimeout?.(2000, () => { fail(408); request.destroy(); });
    request.on("data", chunk => {
      if (complete) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY) { fail(413); return; }
      chunks.push(Buffer.from(chunk));
    });
    request.on("error", () => fail(400));
    request.on("end", () => {
      if (complete) return;
      try {
        const batch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!validateNativeBreadcrumbBatch(batch)) { fail(400); return; }
        accept(batch); complete = true; chunks = [];
        response.writeHead(204, headers); response.end();
      } catch { fail(400); }
    });
  };
}

async function bounded(action, timeoutMs, label) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms watchdog`)), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

export async function startNativeBreadcrumbCollector({ file, files = fs, createServer = http.createServer, timeoutMs = 5000 } = {}) {
  const token = randomBytes(24).toString("hex"), documents = new Map();
  const evidence = { enabled: true, performanceBaselineEligible: false,
    accounting: "Native-call instrumentation perturbs execution; not performance baseline evidence. An unmatched BEGIN is an observation, not proof of a GPU root cause.",
    batches: 0, eventsReceived: 0, rejected: 0, documentsEvicted: 0, lastHeartbeatReceivedAt: null, errors: [] };
  let dirty = true, writing = null, stopped = false, closing;
  const snapshot = () => ({ ...evidence,
    coverage: evidence.lastHeartbeatReceivedAt === null ? "NO OBSERVER HEARTBEAT RECEIVED: no native-call coverage established."
      : "Only explicitly wrapped main-thread APIs are covered; missing events cannot exclude other work or an observer that stopped.",
    documents: [...documents.values()].map(value => ({ ...value, events: [...value.events], active: [...value.active] })) });
  const persist = async () => {
    if (writing) await writing;
    if (!dirty) return;
    dirty = false;
    const body = JSON.stringify(snapshot());
    writing = bounded(() => files.writeFile(file, body), timeoutMs, "native breadcrumb snapshot")
      .catch(() => { evidence.errors.push("snapshot write failed or exceeded watchdog"); evidence.errors = evidence.errors.slice(-8); dirty = true; })
      .finally(() => { writing = null; });
    await writing;
  };
  const server = createServer(createNativeBreadcrumbReceiver({ token,
    rejected: () => { evidence.rejected++; dirty = true; },
    accept(batch) {
      if (stopped) return;
      let document = documents.get(batch.documentId);
      if (!document) {
        if (documents.size >= 8) { documents.delete(documents.keys().next().value); evidence.documentsEvicted++; }
        document = { documentId: batch.documentId, events: [], batches: 0 };
        documents.set(batch.documentId, document);
      }
      document.events = [...document.events, ...batch.events].slice(-256);
      document.active = batch.active;
      document.heartbeatAt = batch.heartbeatAt; document.dropped = batch.dropped; document.batches++;
      document.receivedAt = evidence.lastHeartbeatReceivedAt = Date.now();
      evidence.batches++; evidence.eventsReceived += batch.events.length; dirty = true;
    } }));
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  try {
    await bounded(() => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    }), timeoutMs, "native breadcrumb collector listen");
  } catch (error) { server.closeAllConnections?.(); server.close(); throw error; }
  server.on("error", () => { evidence.errors.push("collector server error"); evidence.errors = evidence.errors.slice(-8); dirty = true; });
  const endpoint = `http://127.0.0.1:${server.address().port}/${token}`;
  await persist();
  const timer = setInterval(() => { void persist(); }, 500);
  timer.unref?.();
  return { endpoint, snapshot, persist,
    close() {
      if (closing) return closing;
      stopped = true; clearInterval(timer);
      closing = (async () => {
        dirty = true;
        await Promise.all([persist(), bounded(() => new Promise(resolve => {
          server.close(resolve); server.closeAllConnections?.();
        }), timeoutMs, "native breadcrumb collector close")]);
        return snapshot();
      })();
      return closing;
    } };
}

// Runs in an independent Worker. Its timers and network uploads do not need
// the page event loop after the last BEGIN message has been delivered.
export function nativeBreadcrumbWorker() {
  let endpoint, documentId, events = [], dropped = 0, sending = false;
  const active = new Map();
  const send = async heartbeat => {
    if (!endpoint || sending || (!heartbeat && !events.length)) return;
    sending = true;
    const batch = { documentId, heartbeatAt: Date.now(), events, active: [...active.values()], dropped };
    events = [];
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1500);
    try {
      const response = await fetch(endpoint, { method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "text/plain" }, body: JSON.stringify(batch), signal: abort.signal });
      if (!response.ok) dropped += batch.events.length;
    } catch { dropped += batch.events.length; }
    finally { clearTimeout(timer); sending = false; }
  };
  self.onmessage = ({ data }) => {
    if (data.kind === "init" && !endpoint) {
      endpoint = data.endpoint; documentId = data.documentId;
      setInterval(() => { void send(false); }, 100);
      setInterval(() => { void send(true); }, 500);
      void send(true); return;
    }
    if (!endpoint || !["begin", "end"].includes(data.phase)) return;
    if (events.length === 128) { events.shift(); dropped++; }
    events.push(data);
    if (data.phase === "begin") {
      if (active.size === 64) { active.delete(active.keys().next().value); dropped++; }
      active.set(data.seq, data);
    } else active.delete(data.seq);
  };
}

export function installNativeBreadcrumbs({ endpoint, workerSource }) {
  const scope = globalThis;
  if (scope.__tnoNativeBreadcrumbs || typeof scope.Worker !== "function") return;
  const nativePost = scope.Worker.prototype.postMessage;
  const documentId = scope.crypto?.randomUUID?.() || `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const url = scope.URL.createObjectURL(new scope.Blob([workerSource], { type: "text/javascript" }));
  let observer;
  try { observer = new scope.Worker(url); } finally { scope.URL.revokeObjectURL(url); }
  const post = nativePost.bind(observer), resources = new WeakMap();
  let sequence = 0, resourceSequence = 0;
  post({ kind: "init", endpoint, documentId });
  scope.__tnoNativeBreadcrumbs = { documentId };
  const shape = value => {
    for (const name of ["HTMLCanvasElement", "OffscreenCanvas", "ImageBitmap", "ImageData", "HTMLImageElement", "HTMLVideoElement"]) {
      if (typeof scope[name] === "function" && value instanceof scope[name]) return [value.width, value.height];
    }
    return [];
  };
  const dimensions = (name, args) => {
    if (name === "width" || name === "height") return [args[0]];
    if (name === "drawImage") return [...shape(args[0]), ...(args.length === 9 ? [args[3], args[4], args[7], args[8]] : args.length === 5 ? [args[3], args[4]] : [])];
    if (name === "getImageData" || name === "readPixels" || name === "clearRect") return [args[2], args[3]];
    if (name === "putImageData") return shape(args[0]);
    if (name === "texStorage2D") return [args[3], args[4]];
    if (name === "texImage2D") return args.length >= 9 ? [args[3], args[4]] : shape(args[5]);
    if (name === "texSubImage2D") return args.length >= 9 ? [args[4], args[5]] : shape(args[6]);
    if (name === "bufferData") return [typeof args[1] === "number" ? args[1] : scope.ArrayBuffer.isView(args[1]) || args[1] instanceof scope.ArrayBuffer ? args[1].byteLength : 0];
    if (name === "drawArrays") return [args[2]];
    if (name === "drawElements") return [args[1]];
    if (name === "postMessage") return scope.ArrayBuffer.isView(args[0]) || args[0] instanceof scope.ArrayBuffer ? [args[0].byteLength] : [];
    return [];
  };
  function wrap(prototype, name, operation, setter = false) {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name), original = setter ? descriptor?.set : descriptor?.value;
    if (typeof original !== "function") return;
    const replacement = function (...args) {
      if (this === observer) return Reflect.apply(original, this, args);
      let event;
      try {
        let resourceId = resources.get(this);
        if (!resourceId) { resourceId = ++resourceSequence; resources.set(this, resourceId); }
        const sizes = dimensions(name, args).filter(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER).slice(0, 8);
        event = { seq: ++sequence, operation, resourceId, timestamp: scope.performance.timeOrigin + scope.performance.now(), phase: "begin", dimensions: sizes };
        post(event);
      } catch { /* An observation failure must not prevent the native call. */ }
      try { return Reflect.apply(original, this, args); }
      finally {
        try { if (event) post({ ...event, phase: "end", timestamp: scope.performance.timeOrigin + scope.performance.now() }); }
        catch { /* Preserve the native exception and return value. */ }
      }
    };
    try { Object.defineProperty(prototype, name, { ...descriptor, [setter ? "set" : "value"]: replacement }); }
    catch { /* An unsupported descriptor remains untouched. */ }
  }
  for (const [constructor, prefix] of [["CanvasRenderingContext2D", "Canvas2D"], ["OffscreenCanvasRenderingContext2D", "OffscreenCanvas2D"]]) {
    for (const name of ["drawImage", "fill", "stroke", "clip", "clearRect", "getImageData", "putImageData"]) wrap(scope[constructor]?.prototype, name, `${prefix}.${name}`);
  }
  for (const [constructor, prefix] of [["WebGLRenderingContext", "WebGL1"], ["WebGL2RenderingContext", "WebGL2"]]) {
    for (const name of ["texImage2D", "texSubImage2D", "texStorage2D", "bufferData", "drawArrays", "drawElements", "readPixels", "getProgramParameter", "getShaderParameter", "getParameter", "compileShader", "linkProgram"]) wrap(scope[constructor]?.prototype, name, `${prefix}.${name}`);
  }
  for (const [constructor, prefix] of [["HTMLCanvasElement", "Canvas"], ["OffscreenCanvas", "OffscreenCanvas"]]) {
    for (const name of ["width", "height"]) wrap(scope[constructor]?.prototype, name, `${prefix}.${name}`, true);
    wrap(scope[constructor]?.prototype, "getContext", `${prefix}.getContext`);
  }
  wrap(scope.OffscreenCanvas?.prototype, "transferToImageBitmap", "OffscreenCanvas.transferToImageBitmap");
  wrap(scope.Worker.prototype, "postMessage", "Worker.postMessage");
}

export function nativeBreadcrumbInitScript(endpoint) {
  return { content: `(${installNativeBreadcrumbs.toString()})(${JSON.stringify({ endpoint, workerSource: `(${nativeBreadcrumbWorker.toString()})();` })});` };
}
