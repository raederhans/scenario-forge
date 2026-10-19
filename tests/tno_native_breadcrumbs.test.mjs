import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createNativeBreadcrumbReceiver, installNativeBreadcrumbs, nativeBreadcrumbInitScript,
  nativeBreadcrumbWorker, startNativeBreadcrumbCollector, validateNativeBreadcrumbBatch } from "../tools/tno_native_breadcrumbs.mjs";

const event = (seq = 1, phase = "begin") => ({ seq, phase, operation: "Canvas2D.drawImage", resourceId: 1, timestamp: 100, dimensions: [2, 3] });
const batch = (documentId = "document-1") => ({ documentId, heartbeatAt: 101, events: [event()], active: [event()], dropped: 0 });

function request(receiver, value, options = {}) {
  const req = new EventEmitter();
  Object.assign(req, { headers: { origin: "http://localhost:8000" }, method: "POST", url: "/token", setTimeout() {}, destroy() {} }, options);
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} };
  receiver(req, response);
  if (!response.status) { req.emit("data", Buffer.from(typeof value === "string" ? value : JSON.stringify(value))); req.emit("end"); }
  return response;
}

test("collector accepts only bounded dimension-only schema and a token path from localhost origins", () => {
  const accepted = [], receiver = createNativeBreadcrumbReceiver({ token: "token", accept: value => accepted.push(value) });
  assert.equal(validateNativeBreadcrumbBatch(batch()), true);
  assert.equal(request(receiver, batch()).status, 204);
  assert.equal(accepted.length, 1);
  assert.equal(request(receiver, batch(), { headers: { origin: "https://example.com" } }).status, 403);
  assert.equal(request(receiver, batch(), { headers: {} }).status, 403);
  assert.equal(request(receiver, batch(), { url: "/wrong" }).status, 403);
  assert.equal(request(receiver, batch(), { method: "GET" }).status, 405);
  const preflight = request(receiver, "", { method: "OPTIONS" });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers["Access-Control-Allow-Origin"], "http://localhost:8000");
  for (const invalid of [{ ...batch(), secret: "not allowed" }, { ...batch(), documentId: "http://sensitive/path" },
    { ...batch(), events: [{ ...event(), payload: "secret" }] }, { ...batch(), events: [{ ...event(), operation: "unknown" }] },
    { ...batch(), events: [{ ...event(), dimensions: ["business-id"] }] }, { ...batch(), active: [event(1, "end")] },
    { ...batch(), events: Array.from({ length: 129 }, () => event()) }]) {
    assert.equal(request(receiver, invalid).status, 400);
  }
  assert.equal(request(receiver, "bad JSON").status, 400);
  assert.equal(request(receiver, "x".repeat(65537)).status, 413);
  assert.equal(accepted.length, 1);
});

function nativeScope(documentId) {
  const workers = [], nativeCalls = [], revoked = [];
  const nativeError = new Error("native failure");
  class Worker {
    constructor(url) { this.url = url; this.messages = []; workers.push(this); }
    postMessage(...args) { if (this.broken) throw nativeError; this.messages.push(args[0]); nativeCalls.push([this, args]); return 17; }
  }
  class Canvas {
    get width() { return this.w || 0; } set width(value) { if (value < 0) throw nativeError; this.w = value; }
    get height() { return this.h || 0; } set height(value) { this.h = value; }
  }
  class Canvas2D {
    drawImage(...args) { nativeCalls.push([this, args]); return 42; }
    clip() { throw nativeError; }
    getImageData() { return { original: true }; }
  }
  class Offscreen2D { fill() { return "offscreen"; } }
  class WebGL1 { bufferData(...args) { nativeCalls.push([this, args]); return "buffer"; } }
  class WebGL2 { texImage2D(...args) { nativeCalls.push([this, args]); return "texture"; } }
  const scope = { Worker, CanvasRenderingContext2D: Canvas2D, HTMLCanvasElement: Canvas,
    OffscreenCanvasRenderingContext2D: Offscreen2D, WebGLRenderingContext: WebGL1, WebGL2RenderingContext: WebGL2,
    ArrayBuffer, Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:observer", revokeObjectURL: value => revoked.push(value) },
    crypto: { randomUUID: () => documentId }, performance: { timeOrigin: 1000, now: () => 20 } };
  const install = () => new Function("globalThis", `return (${installNativeBreadcrumbs.toString()})({endpoint:"http://127.0.0.1:123/token",workerSource:"worker"});`)(scope);
  return { scope, workers, nativeCalls, nativeError, revoked, install };
}

test("native wrappers preserve receiver, arguments, return, exception and setters without payloads or observer recursion", () => {
  const h = nativeScope("document-a"); h.install(); h.install();
  assert.equal(h.workers.length, 1, "installation is idempotent per document");
  assert.deepEqual(h.revoked, ["blob:observer"]);
  const observer = h.workers[0], context = new h.scope.CanvasRenderingContext2D(), canvas = new h.scope.HTMLCanvasElement();
  canvas.width = 2; canvas.height = 3;
  const args = [canvas, 10, 20, 8, 9];
  assert.equal(context.drawImage(...args), 42);
  assert.equal(h.nativeCalls.at(-2)[0], context);
  assert.deepEqual(h.nativeCalls.at(-2)[1], args);
  const calls = observer.messages.filter(value => value.operation === "Canvas2D.drawImage");
  assert.deepEqual(calls.map(value => value.phase), ["begin", "end"]);
  assert.deepEqual(calls[0].dimensions, [2, 3, 8, 9]);
  assert.equal(calls[0].seq, calls[1].seq);
  assert.equal(calls[0].timestamp, 1020);
  assert.throws(() => context.clip(), error => error === h.nativeError);
  assert.deepEqual(observer.messages.slice(-2).map(value => value.phase), ["begin", "end"]);
  assert.throws(() => { canvas.width = -1; }, error => error === h.nativeError);
  assert.equal(canvas.width, 2);
  assert.equal(new h.scope.OffscreenCanvasRenderingContext2D().fill(), "offscreen");
  assert.equal(new h.scope.WebGLRenderingContext().bufferData(1, new Uint8Array(12), 2), "buffer");
  assert.deepEqual(observer.messages.at(-1).dimensions, [12]);
  assert.equal(new h.scope.WebGL2RenderingContext().texImage2D(1, 0, 1, 4, 5, 0, 1, 1, null), "texture");
  assert.deepEqual(observer.messages.at(-1).dimensions, [4, 5]);
  const applicationWorker = new h.scope.Worker("app"), payload = { secret: "never record this", array: [1, 2, 3] }, transfer = [];
  assert.equal(applicationWorker.postMessage(payload, transfer), 17);
  assert.equal(h.nativeCalls.at(-2)[0], applicationWorker);
  assert.equal(h.nativeCalls.at(-2)[1][0], payload); assert.equal(h.nativeCalls.at(-2)[1][1], transfer);
  assert.equal(observer.messages.at(-1).operation, "Worker.postMessage");
  assert.ok(!JSON.stringify(observer.messages).includes("never record"));
  const count = observer.messages.length; observer.postMessage({ kind: "manual" });
  assert.equal(observer.messages.length, count + 1, "observer transport is never wrapped recursively");
  observer.broken = true;
  assert.equal(context.drawImage(canvas, 0, 0), 42, "observer failures do not alter native success");
  assert.throws(() => context.clip(), error => error === h.nativeError);
});

test("reload receives a new document identity and initialization needs no application object", () => {
  const first = nativeScope("document-a"), second = nativeScope("document-b"); first.install(); second.install();
  assert.equal(first.workers[0].messages[0].documentId, "document-a");
  assert.equal(second.workers[0].messages[0].documentId, "document-b");
  assert.ok(nativeBreadcrumbInitScript("http://127.0.0.1:123/token").content.includes("nativeBreadcrumbWorker"));
});

test("independent Worker heartbeats retain an unmatched BEGIN after the page stops sending", async () => {
  const scope = {}, intervals = new Map(), uploads = [];
  new Function("self", "setInterval", "fetch", `return (${nativeBreadcrumbWorker.toString()})();`)(scope,
    (callback, interval) => intervals.set(interval, callback), async (_url, options) => { uploads.push(JSON.parse(options.body)); return { ok: true }; });
  scope.onmessage({ data: { kind: "init", endpoint: "http://127.0.0.1:123/token", documentId: "doc" } });
  await new Promise(resolve => setImmediate(resolve));
  scope.onmessage({ data: event() }); intervals.get(100)();
  await new Promise(resolve => setImmediate(resolve));
  intervals.get(500)(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(uploads.at(-1).active, [event()]);
  assert.deepEqual(uploads.at(-1).events, []);
  assert.equal(validateNativeBreadcrumbBatch(uploads.at(-1)), true);
  scope.onmessage({ data: event(1, "end") }); intervals.get(100)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(uploads.at(-1).active, []);
  for (let seq = 2; seq < 300; seq++) scope.onmessage({ data: event(seq) });
  intervals.get(500)(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads.at(-1).events.length, 128); assert.equal(uploads.at(-1).active.length, 64);
  assert.ok(uploads.at(-1).dropped > 0);
});

test("collector stores bounded document histories before failure and closes independently of a page", async () => {
  let receiver, server, closeCalls = 0;
  const writes = [];
  const collector = await startNativeBreadcrumbCollector({ file: "fixture.json", files: { async writeFile(_file, body) { writes.push(JSON.parse(body)); } },
    createServer(handler) {
      receiver = handler; server = new EventEmitter();
      server.listen = (port, host, callback) => { assert.equal(port, 0); assert.equal(host, "127.0.0.1"); callback(); };
      server.address = () => ({ port: 123 }); server.close = callback => { closeCalls++; callback(); };
      server.closeAllConnections = () => {}; return server;
    } });
  const url = new URL(collector.endpoint);
  assert.equal(url.hostname, "127.0.0.1"); assert.match(url.pathname, /^\/[0-9a-f]{48}$/);
  for (let index = 0; index < 10; index++) request(receiver, batch(`doc-${index}`), { url: url.pathname });
  for (let index = 0; index < 300; index++) request(receiver, batch("doc-9"), { url: url.pathname });
  await collector.persist();
  assert.equal(writes.at(-1).documents.length, 8);
  assert.equal(writes.at(-1).documentsEvicted, 2);
  assert.equal(writes.at(-1).documents.at(-1).events.length, 256);
  assert.equal(writes.at(-1).eventsReceived, 310);
  assert.ok(writes.at(-1).lastHeartbeatReceivedAt);
  assert.ok(!JSON.stringify(writes).includes(url.pathname), "token and request data are excluded from report evidence");
  const closing = collector.close(); assert.equal(collector.close(), closing);
  await closing; assert.equal(closeCalls, 1);
});

test("collector cleanup deadline does not depend on a responding server or renderer", async () => {
  const collector = await startNativeBreadcrumbCollector({ file: "fixture.json", timeoutMs: 20, files: { async writeFile() {} },
    createServer() {
      const server = new EventEmitter(); server.listen = (_port, _host, callback) => callback();
      server.address = () => ({ port: 123 }); server.close = () => {}; server.closeAllConnections = () => {}; return server;
    } });
  await assert.rejects(collector.close(), /collector close exceeded 20ms watchdog/);
});
