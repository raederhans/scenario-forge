// 这份 helper 必须同时兼容：
// 1. 主线程 ESM import
// 2. startup_boot.worker.js 里的 importScripts
// 所以这里保持纯脚本语法，并把 API 挂到 globalThis。
//
// 指标说明：
// - encodedBytes: HTTP 响应体实际接收字节（解压前，来源于 response.arrayBuffer().byteLength 或 response.text() 的 UTF-8 字节）。
//   若传输层已自动处理 Content-Encoding: gzip，则该值反映递交给 JS 的已解压响应体大小，不必然等同于网络传输包体积。
// - decodedBytes: UTF-8 解码后的真实字节大小（在 non-ASCII 下反映真实 UTF-8 字节，而非 UTF-16 字符串长度）。
// - decompressMs: 客户端实际执行 gzip 解压的耗时毫秒（未解压或传输层已解压时为 0）。
// - jsonParseMs: JSON.parse 耗时毫秒。

var SCENARIO_FORGE_JSON_RESOURCE_DECODER_SHARED = globalThis.__scenarioForgeJsonResourceDecoderShared || (() => {
  const EXPLICIT_GZIP_EXTENSIONS = Object.freeze([
    ".json.gz",
    ".geojson.gz",
    ".topojson.gz",
  ]);

  const GZIP_MAGIC_BYTE_0 = 0x1f;
  const GZIP_MAGIC_BYTE_1 = 0x8b;
  const GZIP_MAGIC_BYTES = Object.freeze([GZIP_MAGIC_BYTE_0, GZIP_MAGIC_BYTE_1]);

  let cachedTextEncoder = null;
  let cachedTextDecoder = null;
  let cachedGunzipSync = null;
  let crcTable = null;

  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function isExplicitGzipJsonUrl(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    const clean = trimmed.split(/[?#]/)[0].toLowerCase();
    return EXPLICIT_GZIP_EXTENSIONS.some((ext) => clean.endsWith(ext));
  }

  function hasGzipMagicBytes(bytes) {
    if (!bytes) return false;
    const view = bytes instanceof Uint8Array
      ? bytes
      : ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : null;
    if (!view || view.byteLength < 2) return false;
    return view[0] === GZIP_MAGIC_BYTE_0 && view[1] === GZIP_MAGIC_BYTE_1;
  }

  function isDecompressionStreamSupported() {
    return typeof globalThis.DecompressionStream === "function";
  }

  function getCrcTable() {
    if (!crcTable) {
      crcTable = new Int32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c;
      }
    }
    return crcTable;
  }

  function calculateCrc32(bytes) {
    const table = getCrcTable();
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc = table[(crc & 255) ^ bytes[i]] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
  }

  function readUint32LE(view, offset) {
    return (
      (view[offset]) |
      (view[offset + 1] << 8) |
      (view[offset + 2] << 16) |
      ((view[offset + 3] << 24) >>> 0)
    ) >>> 0;
  }

  async function loadFallbackGunzip() {
    if (cachedGunzipSync) return cachedGunzipSync;
    if (globalThis.__scenarioForgeFflate?.gunzipSync) {
      cachedGunzipSync = globalThis.__scenarioForgeFflate.gunzipSync;
      return cachedGunzipSync;
    }
    // Lazy literal dynamic import reusing existing vendored fflate
    const mod = await import("../../vendor/fflate.browser.js");
    if (!mod || typeof mod.gunzipSync !== "function") {
      throw new Error("[json_resource_decoder] Failed to load gunzipSync from vendor/fflate.browser.js.");
    }
    cachedGunzipSync = mod.gunzipSync;
    return cachedGunzipSync;
  }

  function setFallbackGunzip(fn) {
    cachedGunzipSync = typeof fn === "function" ? fn : null;
  }

  function createAbortError(reason = null) {
    if (reason && typeof reason === "object" && reason.name === "AbortError") {
      return reason;
    }
    if (typeof DOMException === "function") {
      return new DOMException(
        typeof reason === "string" ? reason : (reason?.message || "The operation was aborted."),
        "AbortError"
      );
    }
    const error = new Error(
      typeof reason === "string" ? reason : (reason?.message || "The operation was aborted.")
    );
    error.name = "AbortError";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  function createUnsupportedDecompressorError(label = "resource") {
    const error = new Error(`[json_resource_decoder] DecompressionStream is not available to decode ${label}.`);
    error.code = "unsupported-decompressor";
    return error;
  }

  function createDecompressError(label = "resource", cause = null) {
    const detail = cause?.message ? `: ${cause.message}` : "";
    const error = new Error(`[json_resource_decoder] Failed to decompress ${label}${detail}.`);
    error.name = "DecompressError";
    error.code = "decompress-failed";
    if (cause) error.cause = cause;
    return error;
  }

  function getUtf8ByteLength(text) {
    if (!text) return 0;
    // Fast path: avoid allocating full UTF-8 buffer when Blob size is available
    if (typeof Blob === "function") {
      try {
        return new Blob([text]).size;
      } catch (_e) {
        // Fall back to TextEncoder
      }
    }
    if (!cachedTextEncoder && typeof TextEncoder === "function") {
      cachedTextEncoder = new TextEncoder();
    }
    if (cachedTextEncoder) {
      return cachedTextEncoder.encode(text).byteLength;
    }
    return text.length;
  }

  function decodeUtf8Bytes(buffer) {
    if (!cachedTextDecoder && typeof TextDecoder === "function") {
      cachedTextDecoder = new TextDecoder("utf-8");
    }
    if (cachedTextDecoder) {
      return cachedTextDecoder.decode(buffer);
    }
    throw new Error("[json_resource_decoder] TextDecoder is not available.");
  }

  async function decompressGzip(compressedBytes, { signal = null, label = "resource" } = {}) {
    throwIfAborted(signal);

    const inputView = compressedBytes instanceof Uint8Array
      ? compressedBytes
      : ArrayBuffer.isView(compressedBytes)
        ? new Uint8Array(compressedBytes.buffer, compressedBytes.byteOffset, compressedBytes.byteLength)
        : compressedBytes instanceof ArrayBuffer
          ? new Uint8Array(compressedBytes)
          : null;

    if (!inputView || inputView.byteLength < 18) {
      throw createDecompressError(label, new Error("Buffer too short or invalid for gzip decompression."));
    }

    // 1. Native DecompressionStream path
    if (isDecompressionStreamSupported()) {
      let stream;
      try {
        if (typeof Blob === "function") {
          stream = new Blob([inputView]).stream().pipeThrough(new globalThis.DecompressionStream("gzip"), signal ? { signal } : undefined);
        } else {
          stream = new Response(inputView).body.pipeThrough(new globalThis.DecompressionStream("gzip"), signal ? { signal } : undefined);
        }
      } catch (error) {
        throw createDecompressError(label, error);
      }

      let decompressedBuffer;
      if (!signal) {
        try {
          decompressedBuffer = await new Response(stream).arrayBuffer();
        } catch (error) {
          // Native corrupt gzip error must NOT fall through to unchecked fallback!
          throw createDecompressError(label, error);
        }
      } else {
        let onAbort;
        const abortPromise = new Promise((_, reject) => {
          onAbort = () => reject(createAbortError(signal.reason));
          signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          decompressedBuffer = await Promise.race([
            new Response(stream).arrayBuffer(),
            abortPromise,
          ]);
        } catch (error) {
          throwIfAborted(signal);
          if (isAbortError(error)) throw error;
          // Native corrupt gzip error must NOT fall through to unchecked fallback!
          throw createDecompressError(label, error);
        } finally {
          if (onAbort) {
            signal.removeEventListener("abort", onAbort);
          }
        }
      }
      throwIfAborted(signal);
      return decompressedBuffer;
    }

    // 2. Fallback path when native DecompressionStream is unavailable:
    // Lazy literal dynamic import of vendored fflate with CRC32 and ISIZE validation.
    throwIfAborted(signal);
    let gunzipSync;
    try {
      gunzipSync = await loadFallbackGunzip();
    } catch (loadError) {
      throwIfAborted(signal);
      throw createUnsupportedDecompressorError(label);
    }
    throwIfAborted(signal);

    let decompressedBytes;
    try {
      decompressedBytes = gunzipSync(inputView);
    } catch (error) {
      throwIfAborted(signal);
      if (isAbortError(error)) throw error;
      throw createDecompressError(label, error);
    }
    throwIfAborted(signal);

    if (!decompressedBytes || !(decompressedBytes instanceof Uint8Array)) {
      throw createDecompressError(label, new Error("Invalid output from fallback gunzip."));
    }

    // Validate ISIZE and CRC32 because fflate gunzipSync does not verify checksum trailer
    const expectedCrc = readUint32LE(inputView, inputView.length - 8);
    const expectedISize = readUint32LE(inputView, inputView.length - 4);
    if ((decompressedBytes.byteLength >>> 0) !== expectedISize) {
      throw createDecompressError(
        label,
        new Error(`Gzip ISIZE mismatch: expected ${expectedISize} but got ${decompressedBytes.byteLength}.`)
      );
    }
    const actualCrc = calculateCrc32(decompressedBytes);
    if (actualCrc !== expectedCrc) {
      throw createDecompressError(
        label,
        new Error(`Gzip CRC32 checksum mismatch: expected ${expectedCrc} but got ${actualCrc}.`)
      );
    }

    return decompressedBytes.buffer.slice(
      decompressedBytes.byteOffset,
      decompressedBytes.byteOffset + decompressedBytes.byteLength
    );
  }

  async function decodeResponsePayload(response, { url = "", label = "resource", signal = null } = {}) {
    throwIfAborted(signal);
    const isExplicitGzip = isExplicitGzipJsonUrl(url);

    if (!isExplicitGzip) {
      // Plain URL path: preserve standard behavior, never probe .gz speculatively.
      // Fast path: use response.text() directly, avoiding extra array buffer allocations.
      let rawText = "";
      let decodedBytes = 0;
      let bodyReadAt = 0;
      if (typeof response.text === "function") {
        rawText = await response.text();
        bodyReadAt = nowMs();
        throwIfAborted(signal);
        decodedBytes = getUtf8ByteLength(rawText);
      } else if (typeof response.arrayBuffer === "function") {
        const buffer = await response.arrayBuffer();
        bodyReadAt = nowMs();
        throwIfAborted(signal);
        decodedBytes = buffer.byteLength;
        rawText = decodeUtf8Bytes(buffer);
      } else {
        throw new Error(`[json_resource_decoder] Response missing readable body methods for ${label}.`);
      }

      throwIfAborted(signal);
      const parseStartedAt = nowMs();
      let payload = null;
      if (rawText) {
        payload = JSON.parse(rawText);
      }
      const parseCompletedAt = nowMs();
      throwIfAborted(signal);

      return {
        payload,
        rawText,
        bodyReadAt,
        decompressMs: 0,
        jsonParseMs: parseCompletedAt - parseStartedAt,
        encodedBytes: decodedBytes,
        decodedBytes,
        compressedBytes: 0,
        compressed: false,
      };
    }

    // Explicit gzip URL path (.json.gz, .geojson.gz, .topojson.gz)
    let buffer;
    if (typeof response.arrayBuffer === "function") {
      buffer = await response.arrayBuffer();
    } else if (typeof response.text === "function") {
      const text = await response.text();
      if (!cachedTextEncoder && typeof TextEncoder === "function") {
        cachedTextEncoder = new TextEncoder();
      }
      buffer = cachedTextEncoder ? cachedTextEncoder.encode(text).buffer : new TextEncoder().encode(text).buffer;
    } else {
      throw new Error(`[json_resource_decoder] Response missing readable body methods for ${label}.`);
    }

    throwIfAborted(signal);
    const bodyReadAt = nowMs();

    const isGzip = hasGzipMagicBytes(buffer);
    let rawText = "";
    let encodedBytes = buffer.byteLength;
    let decodedBytes = 0;
    let decompressMs = 0;
    let compressed = false;
    let compressedBytes = 0;

    if (isGzip) {
      const decompressStartedAt = nowMs();
      const decompressedBuffer = await decompressGzip(buffer, { signal, label });
      const decompressCompletedAt = nowMs();
      decompressMs = decompressCompletedAt - decompressStartedAt;
      throwIfAborted(signal);

      decodedBytes = decompressedBuffer.byteLength;
      rawText = decodeUtf8Bytes(decompressedBuffer);
      compressed = true;
      compressedBytes = buffer.byteLength;
    } else {
      // Body has no gzip magic bytes: HTTP Content-Encoding already transparently decompressed it!
      // Do not double-decode. Treat the received buffer as decoded UTF-8 JSON.
      decodedBytes = buffer.byteLength;
      encodedBytes = decodedBytes;
      rawText = decodeUtf8Bytes(buffer);
      decompressMs = 0;
      compressed = false;
      compressedBytes = 0;
    }

    throwIfAborted(signal);
    const parseStartedAt = nowMs();
    let payload = null;
    if (rawText) {
      payload = JSON.parse(rawText);
    }
    const parseCompletedAt = nowMs();
    throwIfAborted(signal);

    return {
      payload,
      rawText,
      bodyReadAt,
      decompressMs,
      jsonParseMs: parseCompletedAt - parseStartedAt,
      encodedBytes,
      decodedBytes,
      compressedBytes,
      compressed,
    };
  }

  return Object.freeze({
    EXPLICIT_GZIP_EXTENSIONS,
    GZIP_MAGIC_BYTE_0,
    GZIP_MAGIC_BYTE_1,
    GZIP_MAGIC_BYTES,
    calculateCrc32,
    createAbortError,
    createDecompressError,
    createUnsupportedDecompressorError,
    decodeResponsePayload,
    decodeUtf8Bytes,
    decompressGzip,
    getUtf8ByteLength,
    hasGzipMagicBytes,
    isAbortError,
    isDecompressionStreamSupported,
    isExplicitGzipJsonUrl,
    loadFallbackGunzip,
    nowMs,
    readUint32LE,
    setFallbackGunzip,
    throwIfAborted,
  });
})();

globalThis.__scenarioForgeJsonResourceDecoderShared = SCENARIO_FORGE_JSON_RESOURCE_DECODER_SHARED;
