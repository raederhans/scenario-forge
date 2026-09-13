import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import zlib from "node:zlib";

import "../js/core/json_resource_decoder_shared.js";
import { loadMeasuredJsonResource } from "../js/core/data_loader.js";
import * as fflate from "../vendor/fflate.browser.js";

const sharedDecoder = globalThis.__scenarioForgeJsonResourceDecoderShared;
const workerSource = await readFile(new URL("../js/workers/startup_boot.worker.js", import.meta.url), "utf8");
const sharedSource = await readFile(new URL("../js/core/json_resource_decoder_shared.js", import.meta.url), "utf8");
const dataLoaderSource = await readFile(new URL("../js/core/data_loader.js", import.meta.url), "utf8");

function gzipSync(content) {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return zlib.gzipSync(buf);
}

function createMockResponse({
  ok = true,
  status = 200,
  statusText = "OK",
  bodyBytes = null,
  bodyText = null,
  signal = null,
} = {}) {
  return {
    ok,
    status,
    statusText,
    async arrayBuffer() {
      if (signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      if (bodyBytes != null) {
        return bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength);
      }
      if (bodyText != null) {
        const enc = new TextEncoder().encode(bodyText);
        return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
      }
      return new ArrayBuffer(0);
    },
    async text() {
      if (signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      if (bodyText != null) return bodyText;
      if (bodyBytes != null) return new TextDecoder("utf-8").decode(bodyBytes);
      return "";
    },
  };
}

function createWorkerHarness({ fetchHandler = null, disableNativeDecompression = false } = {}) {
  const posted = [];
  const self = {
    location: {
      href: "https://example.test/js/workers/startup_boot.worker.js",
      origin: "https://example.test",
    },
    postMessage(message) {
      posted.push(message);
    },
    topojson: { feature: () => null },
  };

  const context = {
    AbortController,
    ArrayBuffer,
    Blob,
    Buffer,
    DOMException,
    DecompressionStream: disableNativeDecompression ? undefined : DecompressionStream,
    Error,
    JSON,
    Map,
    Object,
    Promise,
    Response,
    String,
    SyntaxError,
    TextDecoder,
    TextEncoder,
    TypeError,
    Uint8Array,
    URL,
    console,
    performance: { now: () => Date.now() },
    self,
    globalThis: null,
    // Provide fflate fallback reference to worker context
    __scenarioForgeFflate: fflate,
    importScripts(...urls) {
      // Execute shared helper inside worker context
      vm.runInContext(sharedSource, context, { filename: "json_resource_decoder_shared.js" });
      context.__scenarioForgeFeatureIdentityShared = {
        defaultCountryCodeNormalizer: (v) => String(v || "").toUpperCase(),
        getFeatureId: (f) => f?.id || null,
        getCountryCode: () => "",
      };
    },
    fetch(url, options = {}) {
      if (fetchHandler) return fetchHandler(url, options);
      return Promise.resolve(createMockResponse({ bodyText: '{"default":true}' }));
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: "startup_boot.worker.js" });
  return { context, posted, self };
}

test("shared decoder helper follows classic/ESM global helper pattern without export statements", () => {
  assert.ok(sharedDecoder, "Shared decoder must be defined on globalThis");
  assert.equal(typeof sharedDecoder.isExplicitGzipJsonUrl, "function");
  assert.equal(typeof sharedDecoder.hasGzipMagicBytes, "function");
  assert.equal(typeof sharedDecoder.decompressGzip, "function");
  assert.equal(typeof sharedDecoder.decodeResponsePayload, "function");
  assert.equal(typeof sharedDecoder.loadFallbackGunzip, "function");

  // Pure script syntax requirement: no top-level import or export
  assert.doesNotMatch(sharedSource, /^\s*export\s+/m, "Shared helper must not use export keyword so importScripts succeeds");
  assert.doesNotMatch(sharedSource, /^\s*import\s+/m, "Shared helper must not use import keyword");

  // Verify worker and data_loader integration
  assert.match(workerSource, /json_resource_decoder_shared\.js/, "Worker must importScripts json_resource_decoder_shared.js");
  assert.match(dataLoaderSource, /import\s+["']\.\/json_resource_decoder_shared\.js["']/, "data_loader must import json_resource_decoder_shared.js");
  assert.match(sharedSource, /import\(\s*["']\.\.\/\.\.\/vendor\/fflate\.browser\.js["']\s*\)/, "Shared helper must contain literal dynamic import of vendored fflate");
});

test("isExplicitGzipJsonUrl identifies explicit gzip extensions and strips query and hash", () => {
  const { isExplicitGzipJsonUrl } = sharedDecoder;

  // Explicit gzip extensions
  assert.equal(isExplicitGzipJsonUrl("bundle.json.gz"), true);
  assert.equal(isExplicitGzipJsonUrl("chunk.geojson.gz"), true);
  assert.equal(isExplicitGzipJsonUrl("world.topojson.gz"), true);

  // Query parameter suffix
  assert.equal(isExplicitGzipJsonUrl("https://example.com/chunks/chunk.json.gz?v=1.2.3&sig=abc"), true);
  assert.equal(isExplicitGzipJsonUrl("data/detail.geojson.gz?cacheBust=1700000000"), true);

  // Hash fragment suffix
  assert.equal(isExplicitGzipJsonUrl("https://example.com/world.topojson.gz#layer-political"), true);

  // Query and hash combined
  assert.equal(isExplicitGzipJsonUrl("/api/data.json.gz?token=secret#section"), true);

  // Case insensitivity
  assert.equal(isExplicitGzipJsonUrl("data.JSON.GZ"), true);
  assert.equal(isExplicitGzipJsonUrl("data.GeoJSON.GZ?test=1"), true);
  assert.equal(isExplicitGzipJsonUrl("data.TOPOJSON.gz"), true);

  // Plain URLs must NOT be identified as explicit gzip
  assert.equal(isExplicitGzipJsonUrl("bundle.json"), false);
  assert.equal(isExplicitGzipJsonUrl("chunk.geojson"), false);
  assert.equal(isExplicitGzipJsonUrl("world.topojson"), false);
  assert.equal(isExplicitGzipJsonUrl("chunk.json?v=1"), false);
  assert.equal(isExplicitGzipJsonUrl("archive.gz"), false);
  assert.equal(isExplicitGzipJsonUrl("data.tar.gz"), false);
  assert.equal(isExplicitGzipJsonUrl("bundle.json.bak"), false);
  assert.equal(isExplicitGzipJsonUrl(""), false);
  assert.equal(isExplicitGzipJsonUrl(null), false);
  assert.equal(isExplicitGzipJsonUrl(undefined), false);
});

test("hasGzipMagicBytes detects standard RFC 1952 gzip header [0x1f, 0x8b]", () => {
  const { hasGzipMagicBytes } = sharedDecoder;

  const validGz = gzipSync('{"hello":"world"}');
  assert.equal(hasGzipMagicBytes(validGz), true);
  assert.equal(hasGzipMagicBytes(new Uint8Array(validGz)), true);

  // Sub-array view with offset
  const bigBuffer = new Uint8Array(validGz.length + 10);
  bigBuffer.set(validGz, 5);
  const sliceView = new Uint8Array(bigBuffer.buffer, 5, validGz.length);
  assert.equal(hasGzipMagicBytes(sliceView), true);

  // Plain JSON text bytes
  const plainBytes = Buffer.from('{"hello":"world"}', "utf8");
  assert.equal(hasGzipMagicBytes(plainBytes), false);

  // Short or empty buffers
  assert.equal(hasGzipMagicBytes(new Uint8Array([0x1f])), false);
  assert.equal(hasGzipMagicBytes(new Uint8Array([])), false);
  assert.equal(hasGzipMagicBytes(null), false);
});

test("loadMeasuredJsonResource handles plain URLs with non-ASCII and measures actual UTF-8 bytes without speculative .gz probes", async (t) => {
  const payload = {
    city: "München / 北京 / Paris",
    flag: "🇩🇪 🇨🇳 🇫🇷",
    description: "Multi-byte UTF-8 test with unicode characters and emoji",
  };
  const jsonString = JSON.stringify(payload);
  const expectedUtf8Bytes = new TextEncoder().encode(jsonString).byteLength;
  assert.notEqual(jsonString.length, expectedUtf8Bytes, "Non-ASCII text length must differ from UTF-8 byte count");

  const requestedUrls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrls.push(String(url));
    return createMockResponse({ bodyText: jsonString });
  });

  const result = await loadMeasuredJsonResource("data/cities.json", { label: "cities" });
  assert.deepEqual(result.payload, payload);

  // Exactly one request made to the plain URL, NO speculative .gz probes
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], "data/cities.json");

  // Metrics check
  const m = result.metrics;
  assert.equal(m.url, "data/cities.json");
  assert.equal(m.label, "cities");
  assert.equal(m.encodedBytes, expectedUtf8Bytes, "encodedBytes must reflect response body bytes");
  assert.equal(m.decodedBytes, expectedUtf8Bytes, "decodedBytes must reflect actual UTF-8 bytes");
  assert.equal(m.bytes, expectedUtf8Bytes, "bytes metric must match decoded UTF-8 bytes");
  assert.equal(m.compressed, false);
  assert.equal(m.compressedBytes, 0);
  assert.equal(m.decompressMs, 0);
  assert.ok(typeof m.jsonParseMs === "number" && m.jsonParseMs >= 0);
  assert.ok(typeof m.fetchMs === "number" && m.fetchMs >= 0);
  assert.ok(typeof m.transferMs === "number" && m.transferMs >= 0);
  assert.ok(typeof m.totalMs === "number" && m.totalMs >= 0);
});

test("loadMeasuredJsonResource decodes explicit gzip URLs (.json.gz, .geojson.gz, .topojson.gz) with non-ASCII payload", async (t) => {
  const payload = {
    type: "FeatureCollection",
    features: [
      { id: "FR", properties: { name: "France", chefLieu: "Paris", devise: "Liberté, Égalité, Fraternité" } },
      { id: "CN", properties: { name: "中国", capital: "北京", note: "空间分块测试" } },
    ],
  };
  const jsonString = JSON.stringify(payload);
  const uncompressedUtf8Bytes = new TextEncoder().encode(jsonString).byteLength;
  const compressedGz = gzipSync(jsonString);
  const compressedByteLength = compressedGz.byteLength;

  t.mock.method(globalThis, "fetch", async () => {
    return createMockResponse({ bodyBytes: compressedGz });
  });

  for (const testUrl of [
    "data/regions.json.gz",
    "data/chunks/political.geojson.gz?v=2026",
    "https://cdn.example.com/world.topojson.gz#section-1",
  ]) {
    const result = await loadMeasuredJsonResource(testUrl, { label: "geo" });
    assert.deepEqual(result.payload, payload);

    const m = result.metrics;
    assert.equal(m.url, testUrl);
    assert.equal(m.compressed, true);
    assert.equal(m.encodedBytes, compressedByteLength, "encodedBytes must match compressed payload size");
    assert.equal(m.compressedBytes, compressedByteLength, "compressedBytes must match compressed payload size");
    assert.equal(m.decodedBytes, uncompressedUtf8Bytes, "decodedBytes must match uncompressed UTF-8 size");
    assert.equal(m.bytes, uncompressedUtf8Bytes);
    assert.ok(typeof m.decompressMs === "number" && m.decompressMs >= 0);
    assert.ok(typeof m.jsonParseMs === "number" && m.jsonParseMs >= 0);
  }
});

test("loadMeasuredJsonResource avoids double decoding when HTTP Content-Encoding already decompressed explicit gzip URL", async (t) => {
  const payload = { test: "already-decompressed-by-http-layer", note: "no gzip magic bytes in body" };
  const jsonString = JSON.stringify(payload);
  const utf8Bytes = new TextEncoder().encode(jsonString);

  // Server sent chunk.json.gz, but browser/HTTP stack handled Content-Encoding: gzip transparently
  t.mock.method(globalThis, "fetch", async () => {
    return createMockResponse({ bodyBytes: utf8Bytes });
  });

  const result = await loadMeasuredJsonResource("data/chunks/detail.json.gz?cache=1", { label: "chunk" });
  assert.deepEqual(result.payload, payload);

  const m = result.metrics;
  assert.equal(m.compressed, false, "Must not be marked compressed since DecompressionStream was bypassed");
  assert.equal(m.compressedBytes, 0);
  assert.equal(m.decompressMs, 0, "decompressMs must be 0 when double-decoding was avoided");
  assert.equal(m.encodedBytes, utf8Bytes.byteLength);
  assert.equal(m.decodedBytes, utf8Bytes.byteLength);
});

test("loadMeasuredJsonResource throws explicit decompress-failed error on corrupt gzip payload and does not fall through to unchecked fallback", async (t) => {
  // Starts with gzip magic bytes 0x1f, 0x8b, followed by invalid corrupted data
  const corruptGz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0x00, 0x12, 0x34]);

  t.mock.method(globalThis, "fetch", async () => {
    return createMockResponse({ bodyBytes: corruptGz });
  });

  await assert.rejects(
    loadMeasuredJsonResource("data/corrupt.json.gz", { label: "corrupt_test" }),
    (error) => {
      assert.equal(error.code, "decompress-failed");
      assert.match(error.message, /Failed to decompress/);
      return true;
    },
    "Corrupt gzip must throw explicit decompress-failed error and never be swallowed"
  );
});

test("loadMeasuredJsonResource seamlessly decodes explicit gzip URLs via vendored fflate fallback when DecompressionStream is unavailable", async (t) => {
  const payload = {
    fallback: true,
    engine: "fflate-vendored",
    cities: ["Berlin", "Wien", "Zürich", "東京"],
  };
  const jsonString = JSON.stringify(payload);
  const uncompressedBytes = new TextEncoder().encode(jsonString).byteLength;
  const compressedGz = gzipSync(jsonString);

  t.mock.method(globalThis, "fetch", async () => {
    return createMockResponse({ bodyBytes: compressedGz });
  });

  const savedDecompressionStream = globalThis.DecompressionStream;
  try {
    // Disable native DecompressionStream to force fflate fallback
    globalThis.DecompressionStream = undefined;

    const result = await loadMeasuredJsonResource("data/fallback.json.gz", { label: "fallback_resource" });
    assert.deepEqual(result.payload, payload);

    const m = result.metrics;
    assert.equal(m.compressed, true);
    assert.equal(m.encodedBytes, compressedGz.byteLength);
    assert.equal(m.compressedBytes, compressedGz.byteLength);
    assert.equal(m.decodedBytes, uncompressedBytes);
    assert.ok(typeof m.decompressMs === "number" && m.decompressMs >= 0);
    assert.ok(typeof m.jsonParseMs === "number" && m.jsonParseMs >= 0);
  } finally {
    globalThis.DecompressionStream = savedDecompressionStream;
  }
});

test("fallback decoder validates CRC32 and ISIZE checksums in trailer when native DecompressionStream is unavailable", async (t) => {
  const payload = { checksum: "strict-validation" };
  const jsonString = JSON.stringify(payload);
  const validGz = gzipSync(jsonString);

  const savedDecompressionStream = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;

    // 1. Corrupt CRC32 trailer (last 8 to 5 bytes)
    const corruptCrcGz = Buffer.from(validGz);
    corruptCrcGz[corruptCrcGz.length - 8] ^= 0xff;

    t.mock.method(globalThis, "fetch", async () => {
      return createMockResponse({ bodyBytes: corruptCrcGz });
    });

    await assert.rejects(
      loadMeasuredJsonResource("data/bad_crc.json.gz", { label: "bad_crc" }),
      (err) => {
        assert.equal(err.code, "decompress-failed");
        assert.match(err.message, /CRC32/);
        return true;
      },
      "Fallback decoder must catch CRC32 mismatch and throw explicit decompress-failed error"
    );

    // 2. Corrupt ISIZE trailer (last 4 bytes)
    const corruptISizeGz = Buffer.from(validGz);
    corruptISizeGz[corruptISizeGz.length - 4] ^= 0xff;

    t.mock.method(globalThis, "fetch", async () => {
      return createMockResponse({ bodyBytes: corruptISizeGz });
    });

    await assert.rejects(
      loadMeasuredJsonResource("data/bad_isize.json.gz", { label: "bad_isize" }),
      (err) => {
        assert.equal(err.code, "decompress-failed");
        assert.match(err.message, /ISIZE/);
        return true;
      },
      "Fallback decoder must catch ISIZE mismatch and throw explicit decompress-failed error"
    );
  } finally {
    globalThis.DecompressionStream = savedDecompressionStream;
  }
});

test("loadMeasuredJsonResource preserves abort before, during, and after fetch/decode", async (t) => {
  // 1. Pre-aborted signal
  const preController = new AbortController();
  preController.abort(new DOMException("Pre-aborted", "AbortError"));
  let fetchCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    return createMockResponse({ bodyText: "{}" });
  });

  await assert.rejects(
    loadMeasuredJsonResource("data/test.json.gz", { signal: preController.signal }),
    { name: "AbortError" }
  );
  assert.equal(fetchCount, 0, "Pre-aborted request must not invoke fetch");

  // 2. Abort during fetch response read
  const duringController = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    duringController.abort(new DOMException("Aborted during read", "AbortError"));
    return createMockResponse({ signal: duringController.signal, bodyBytes: gzipSync("{}") });
  });

  await assert.rejects(
    loadMeasuredJsonResource("data/during.json.gz", { signal: duringController.signal }),
    { name: "AbortError" }
  );
});

test("startup worker fetchJsonResource decodes explicit gzip URLs natively and via fallback", async () => {
  const payload = { worker: true, region: "Europe", accents: "Österreich, España" };
  const jsonString = JSON.stringify(payload);
  const uncompressedBytes = new TextEncoder().encode(jsonString).byteLength;
  const compressedGz = gzipSync(jsonString);

  // 1. Native decompression in worker
  const nativeHarness = createWorkerHarness({
    fetchHandler(url) {
      if (sharedDecoder.isExplicitGzipJsonUrl(String(url))) {
        return Promise.resolve(createMockResponse({ bodyBytes: compressedGz }));
      }
      return Promise.resolve(createMockResponse({ bodyText: jsonString }));
    },
  });

  const gzResult = await vm.runInContext(
    `fetchJsonResource("chunks/detail.json.gz?cacheBust=123", "detailChunk")`,
    nativeHarness.context
  );

  assert.deepEqual(gzResult.payload, payload);
  assert.equal(gzResult.metrics.compressed, true);
  assert.equal(gzResult.metrics.compressedBytes, compressedGz.byteLength);
  assert.equal(gzResult.metrics.encodedBytes, compressedGz.byteLength);
  assert.equal(gzResult.metrics.decodedBytes, uncompressedBytes);
  assert.equal(gzResult.metrics.bytes, uncompressedBytes);
  assert.ok(gzResult.metrics.decompressMs >= 0);
  assert.ok(gzResult.metrics.jsonParseMs >= 0);

  // 2. Fallback decompression in worker when DecompressionStream is disabled
  const fallbackHarness = createWorkerHarness({
    disableNativeDecompression: true,
    fetchHandler(url) {
      if (sharedDecoder.isExplicitGzipJsonUrl(String(url))) {
        return Promise.resolve(createMockResponse({ bodyBytes: compressedGz }));
      }
      return Promise.resolve(createMockResponse({ bodyText: jsonString }));
    },
  });

  const fallbackResult = await vm.runInContext(
    `fetchJsonResource("chunks/detail.json.gz", "fallbackDetailChunk")`,
    fallbackHarness.context
  );

  assert.deepEqual(fallbackResult.payload, payload);
  assert.equal(fallbackResult.metrics.compressed, true);
  assert.equal(fallbackResult.metrics.encodedBytes, compressedGz.byteLength);
  assert.equal(fallbackResult.metrics.decodedBytes, uncompressedBytes);
});

test("startup worker fetchJsonResourceWithOptionalGzip restores original fallback on candidate failure, while explicit .gz remains error", async () => {
  const payload = { bundle: "startup", id: "tno_1962" };
  const jsonString = JSON.stringify(payload);
  const validGz = gzipSync(jsonString);
  const corruptGz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);

  // Scenario 1: .gz candidate exists and is valid -> decodes gzip
  let harness = createWorkerHarness({
    fetchHandler(url) {
      if (String(url).includes(".gz")) {
        return Promise.resolve(createMockResponse({ bodyBytes: validGz }));
      }
      return Promise.resolve(createMockResponse({ bodyText: jsonString }));
    },
  });
  let res = await vm.runInContext(
    `fetchJsonResourceWithOptionalGzip("startup.bundle.en.json", "startupBundle")`,
    harness.context
  );
  assert.deepEqual(res.payload, payload);
  assert.equal(res.metrics.compressed, true);

  // Scenario 2: .gz candidate returns 404 -> falls back to plain JSON
  harness = createWorkerHarness({
    fetchHandler(url) {
      if (String(url).includes(".gz")) {
        return Promise.resolve(createMockResponse({ ok: false, status: 404, statusText: "Not Found" }));
      }
      return Promise.resolve(createMockResponse({ bodyText: jsonString }));
    },
  });
  res = await vm.runInContext(
    `fetchJsonResourceWithOptionalGzip("startup.bundle.en.json", "startupBundle")`,
    harness.context
  );
  assert.deepEqual(res.payload, payload);
  assert.equal(res.metrics.compressed, false);

  // Scenario 3: .gz candidate exists (200 OK) but is CORRUPT -> original behavior restored: falls back to plain JSON!
  harness = createWorkerHarness({
    fetchHandler(url) {
      if (String(url).includes(".gz")) {
        return Promise.resolve(createMockResponse({ bodyBytes: corruptGz }));
      }
      return Promise.resolve(createMockResponse({ bodyText: jsonString }));
    },
  });
  res = await vm.runInContext(
    `fetchJsonResourceWithOptionalGzip("startup.bundle.en.json", "startupBundle")`,
    harness.context
  );
  assert.deepEqual(res.payload, payload, "Optional candidate failure must fall back to plain JSON");
  assert.equal(res.metrics.compressed, false);

  // Scenario 4: EXPLICIT .gz URL failure remains an explicit error (never falls back!)
  harness = createWorkerHarness({
    fetchHandler() {
      return Promise.resolve(createMockResponse({ bodyBytes: corruptGz }));
    },
  });
  await assert.rejects(
    vm.runInContext(`fetchJsonResource("chunks/explicit_fail.json.gz", "explicitChunk")`, harness.context),
    (err) => {
      assert.match(String(err), /Failed to decompress/);
      return true;
    },
    "Explicit .gz resource failures must throw explicit error and never be swallowed"
  );
});

test("startup worker fetchJsonResource avoids double decoding on HTTP-decompressed gzip URL", async () => {
  const payload = { transparent: true, origin: "cdn" };
  const jsonString = JSON.stringify(payload);
  const utf8Bytes = new TextEncoder().encode(jsonString);

  const { context } = createWorkerHarness({
    fetchHandler() {
      // Body has already been decompressed by the transport layer
      return Promise.resolve(createMockResponse({ bodyBytes: utf8Bytes }));
    },
  });

  const res = await vm.runInContext(
    `fetchJsonResource("chunks/decompressed.json.gz?version=1", "decompressedChunk")`,
    context
  );

  assert.deepEqual(res.payload, payload);
  assert.equal(res.metrics.compressed, false);
  assert.equal(res.metrics.compressedBytes, 0);
  assert.equal(res.metrics.decompressMs, 0);
  assert.equal(res.metrics.encodedBytes, utf8Bytes.byteLength);
  assert.equal(res.metrics.decodedBytes, utf8Bytes.byteLength);
});

test("startup worker fetchJsonResource aborts when signal is aborted", async () => {
  const { context } = createWorkerHarness({
    fetchHandler() {
      return Promise.resolve(createMockResponse({ bodyBytes: gzipSync('{"ok":true}') }));
    },
  });

  const controller = new AbortController();
  controller.abort(new DOMException("Worker task aborted", "AbortError"));
  context.testSignal = controller.signal;

  await assert.rejects(
    vm.runInContext(`fetchJsonResource("chunks/abort.json.gz", "abortChunk", { signal: testSignal })`, context),
    (err) => {
      assert.equal(err.name, "AbortError");
      return true;
    },
    "Worker fetchJsonResource must throw AbortError when signal is aborted"
  );
});
