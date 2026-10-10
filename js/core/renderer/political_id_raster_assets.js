// Coverage assets contain stable feature IDs, never colors or palette revisions.
export const POLITICAL_ID_RASTER_ASSET_SCHEMA_VERSION = 1;
const MAGIC = [80, 73, 68, 82, 65, 83, 84, 0]; // PIDRAST\0
const HEADER_BYTES = 48;
const EDGE_FLAG = 0x80000000;
const MAX_CODE = EDGE_FLAG - 1;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const PERSISTENT_READ_BUDGET_MS = 100;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class PoliticalIdRasterAssetValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoliticalIdRasterAssetValidationError';
  }
}
const invalid = (message) => { throw new PoliticalIdRasterAssetValidationError(message); };
function validateIdentity(identity) {
  if (typeof identity !== 'string' || !identity || identity.length > 65536) invalid('Invalid asset identity.');
}
function validateBudget(bytes, name = 'maxBytes') {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError(`${name} must be a non-negative safe integer.`);
}
function lookup(mapping, key) {
  if (typeof mapping === 'function') return mapping(key);
  if (mapping instanceof Map) return mapping.get(key);
  return mapping && Object.hasOwn(mapping, key) ? mapping[key] : undefined;
}
function validateCode(code) {
  if (!Number.isInteger(code) || code < 1 || code > MAX_CODE) invalid('Unknown or invalid feature code.');
  return code;
}
function validateTile(tile) {
  if (!tile || ![tile.width, tile.height].every((n) => Number.isInteger(n) && n > 0 && n <= 0xffffffff)
    || ![tile.originX, tile.originY].every(Number.isSafeInteger)
    || !Number.isSafeInteger(tile.width * tile.height) || tile.width * tile.height > 0xffffffff
    || !(tile.codes instanceof Uint32Array) || !(tile.edgeIds instanceof Uint32Array)
    || !(tile.edgeWeights instanceof Float32Array)
    || tile.codes.length !== tile.width * tile.height || tile.edgeIds.length !== tile.edgeWeights.length
    || tile.edgeIds.length > MAX_CODE) invalid('Invalid tile dimensions or typed-array lengths.');
  const spans = new Set();
  let contributionCount = 0, maxContributors = 0;
  for (let offset = 0; offset < tile.edgeIds.length;) {
    spans.add(offset);
    const count = tile.edgeIds[offset];
    if (!count || count > MAX_CODE || offset + count >= tile.edgeIds.length
      || tile.edgeWeights[offset] !== 0) invalid('Invalid edge span length or header weight.');
    const contributors = new Set();
    let sum = 0;
    for (let at = offset + 1; at <= offset + count; at += 1) {
      const code = validateCode(tile.edgeIds[at]);
      const weight = tile.edgeWeights[at];
      if (contributors.has(code) || !Number.isFinite(weight) || weight <= 0 || weight > 1) invalid('Invalid edge contributor or weight.');
      contributors.add(code);
      sum += weight;
    }
    if (sum > 1 + 1e-6) invalid('Edge coverage exceeds one.');
    contributionCount += count;
    maxContributors = Math.max(maxContributors, count);
    offset += count + 1;
  }
  const used = new Set();
  let edgePixelCount = 0;
  for (const code of tile.codes) {
    if (code >= EDGE_FLAG) {
      const offset = code - EDGE_FLAG;
      if (!spans.has(offset)) invalid('Edge pixel references an invalid span offset.');
      used.add(offset);
      edgePixelCount += 1;
    } else if (code) validateCode(code);
  }
  if (used.size !== spans.size) invalid('Unreferenced edge spans.');
  return { edgePixelCount, contributionCount, maxContributors,
    retainedBytes: tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength };
}

/** Stable-ID dictionary indices replace only direct codes and edge contributors. */
export function encodePoliticalIdRasterAsset(tile, { identity, codeToId, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  validateIdentity(identity);
  validateBudget(maxBytes);
  validateTile(tile);
  if (HEADER_BYTES + tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength > maxBytes) invalid('Asset exceeds byte budget.');
  const featureIds = [];
  const indices = new Map();
  const sourceIds = new Map();
  function stableIndex(code) {
    if (!code) return 0;
    if (indices.has(code)) return indices.get(code);
    const id = lookup(codeToId, code);
    if (typeof id !== 'string' || !id || id.length > 65536 || sourceIds.has(id)) invalid('Unknown, invalid, or duplicate stable feature ID.');
    featureIds.push(id);
    sourceIds.set(id, code);
    indices.set(code, featureIds.length);
    return featureIds.length;
  }
  const codes = tile.codes.map((code) => code >= EDGE_FLAG ? code : stableIndex(code));
  const edgeIds = tile.edgeIds.slice();
  for (let offset = 0; offset < edgeIds.length;) {
    const count = edgeIds[offset];
    for (let at = offset + 1; at <= offset + count; at += 1) edgeIds[at] = stableIndex(edgeIds[at]);
    offset += count + 1;
  }
  const metadata = textEncoder.encode(JSON.stringify({ identity, featureIds }));
  const bodyOffset = HEADER_BYTES + Math.ceil(metadata.length / 4) * 4;
  const byteLength = bodyOffset + codes.byteLength + edgeIds.byteLength + tile.edgeWeights.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes || metadata.length > 0xffffffff) invalid('Asset exceeds byte budget.');
  const buffer = new ArrayBuffer(byteLength);
  new Uint8Array(buffer).set(MAGIC);
  const view = new DataView(buffer);
  for (const [at, value] of [[8, 1], [12, metadata.length], [16, codes.length], [20, edgeIds.length], [24, tile.width], [28, tile.height]]) view.setUint32(at, value, true);
  view.setFloat64(32, tile.originX, true);
  view.setFloat64(40, tile.originY, true);
  new Uint8Array(buffer, HEADER_BYTES, metadata.length).set(metadata);
  let at = bodyOffset;
  for (const code of codes) { view.setUint32(at, code, true); at += 4; }
  for (const code of edgeIds) { view.setUint32(at, code, true); at += 4; }
  for (const weight of tile.edgeWeights) { view.setFloat32(at, weight, true); at += 4; }
  return buffer;
}

/** Identity mismatch is a cache miss. Malformed assets and unknown IDs throw. */
export function decodePoliticalIdRasterAsset(buffer, { identity, idToCode, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  validateIdentity(identity);
  validateBudget(maxBytes);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES || buffer.byteLength > maxBytes) invalid('Invalid asset buffer or byte budget.');
  if (MAGIC.some((value, at) => new Uint8Array(buffer)[at] !== value)) invalid('Invalid asset magic.');
  const view = new DataView(buffer);
  if (view.getUint32(8, true) !== POLITICAL_ID_RASTER_ASSET_SCHEMA_VERSION) invalid('Unsupported asset schema version.');
  const metadataLength = view.getUint32(12, true), codeLength = view.getUint32(16, true), edgeLength = view.getUint32(20, true);
  const bodyOffset = HEADER_BYTES + Math.ceil(metadataLength / 4) * 4;
  if (bodyOffset + codeLength * 4 + edgeLength * 8 !== buffer.byteLength) invalid('Asset lengths do not match buffer.');
  let metadata;
  try { metadata = JSON.parse(textDecoder.decode(new Uint8Array(buffer, HEADER_BYTES, metadataLength))); }
  catch { invalid('Invalid UTF-8 asset metadata.'); }
  if (!metadata || typeof metadata !== 'object' || !Array.isArray(metadata.featureIds)) invalid('Invalid feature dictionary.');
  validateIdentity(metadata.identity);
  if (metadata.identity !== identity) return null;
  if (metadata.featureIds.length > MAX_CODE) invalid('Feature dictionary exceeds index capacity.');
  const seenIds = new Set(), seenCodes = new Set();
  const remap = [0];
  for (const id of metadata.featureIds) {
    if (typeof id !== 'string' || !id || id.length > 65536 || seenIds.has(id)) invalid('Invalid or duplicate stable feature ID.');
    const code = validateCode(lookup(idToCode, id));
    if (seenCodes.has(code)) invalid('Stable feature IDs map to duplicate palette codes.');
    seenIds.add(id); seenCodes.add(code); remap.push(code);
  }
  const width = view.getUint32(24, true), height = view.getUint32(28, true);
  if (!width || !height || width * height !== codeLength) invalid('Invalid asset dimensions.');
  const tile = { width, height, originX: view.getFloat64(32, true), originY: view.getFloat64(40, true),
    codes: new Uint32Array(codeLength), edgeIds: new Uint32Array(edgeLength), edgeWeights: new Float32Array(edgeLength) };
  let at = bodyOffset;
  for (let i = 0; i < codeLength; i += 1, at += 4) tile.codes[i] = view.getUint32(at, true);
  for (let i = 0; i < edgeLength; i += 1, at += 4) tile.edgeIds[i] = view.getUint32(at, true);
  for (let i = 0; i < edgeLength; i += 1, at += 4) tile.edgeWeights[i] = view.getFloat32(at, true);
  tile.stats = validateTile(tile);
  const usedIndices = new Set();
  function featureCode(index) {
    if (!index) return 0;
    if (index >= remap.length) invalid('Unknown feature dictionary index.');
    usedIndices.add(index);
    return remap[index];
  }
  for (let i = 0; i < codeLength; i += 1) if (tile.codes[i] < EDGE_FLAG) tile.codes[i] = featureCode(tile.codes[i]);
  for (let offset = 0; offset < edgeLength;) {
    const count = tile.edgeIds[offset];
    for (let i = offset + 1; i <= offset + count; i += 1) tile.edgeIds[i] = featureCode(tile.edgeIds[i]);
    offset += count + 1;
  }
  if (usedIndices.size !== metadata.featureIds.length) invalid('Unused feature dictionary entries.');
  return tile;
}

function abortError() {
  const error = new Error('Political ID raster asset operation cancelled.');
  error.name = 'AbortError';
  return error;
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function abortable(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Every persistent touch/write prunes in one readwrite transaction. This also
// enforces a smaller budget when reopening a database created by another store.
function createIndexedDbBackend(indexedDB, dbName) {
  let opening, database, closed = false;
  function open() {
    if (closed) return Promise.reject(new Error('Asset database closed.'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('tiles', { keyPath: 'identity' });
        request.result.createObjectStore('metadata', { keyPath: 'identity' });
      };
      request.onerror = () => reject(request.error ?? new Error('Asset database open failed.'));
      request.onblocked = () => reject(new Error('Asset database open blocked.'));
      request.onsuccess = () => {
        if (closed) { request.result.close(); reject(new Error('Asset database closed.')); return; }
        database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
    });
    return opening;
  }
  async function operation(identity, entry, maxBytes, signal, remove = false) {
    const db = await open();
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      let result = null;
      const transaction = db.transaction(['tiles', 'metadata'], 'readwrite');
      const abort = () => { try { transaction.abort(); } catch {} };
      signal?.addEventListener('abort', abort, { once: true });
      const store = transaction.objectStore('tiles');
      const metadataStore = transaction.objectStore('metadata');
      const request = metadataStore.getAll();
      request.onsuccess = () => {
        try {
          const records = request.result.filter((record) => {
            const valid = Number.isSafeInteger(record?.byteLength) && record.byteLength >= HEADER_BYTES
              && Number.isFinite(record.touched) && typeof record.identity === 'string';
            if (!valid) { store.delete(record?.identity); metadataStore.delete(record?.identity); }
            return valid;
          });
          const previous = records.find((record) => record.identity === identity);
          const keep = records.filter((record) => record.identity !== identity);
          if (remove) { store.delete(identity); metadataStore.delete(identity); }
          else if (entry || previous) {
            const touched = records.reduce((latest, record) => Math.max(latest, record.touched), Date.now()) + 1;
            const current = { identity, byteLength: (entry ?? previous).byteLength, touched };
            keep.push(current);
            if (entry) { result = entry.payload; store.put({ identity, payload: entry.payload }); }
            else {
              const payloadRequest = store.get(identity);
              payloadRequest.onsuccess = () => {
                const payload = payloadRequest.result?.payload;
                if (payload instanceof ArrayBuffer && payload.byteLength === previous.byteLength && retained) result = payload;
                else { store.delete(identity); metadataStore.delete(identity); }
              };
            }
            metadataStore.put(current);
          }
          keep.sort((a, b) => a.touched - b.touched || a.identity.localeCompare(b.identity));
          let bytes = keep.reduce((total, record) => total + record.byteLength, 0);
          let retained = true;
          while (bytes > maxBytes && keep.length) {
            const oldest = keep.shift();
            bytes -= oldest.byteLength;
            store.delete(oldest.identity);
            metadataStore.delete(oldest.identity);
            if (oldest.identity === identity) { result = null; retained = false; }
          }
        } catch (error) { transaction.abort(); reject(error); }
      };
      const release = () => signal?.removeEventListener('abort', abort);
      transaction.oncomplete = () => { release(); resolve(result); };
      transaction.onabort = transaction.onerror = () => { release(); reject(signal?.aborted ? abortError() : transaction.error ?? new Error('Asset database transaction failed.')); };
    });
  }
  return { read: (identity, maxBytes, signal) => operation(identity, null, maxBytes, signal),
    writeBounded: (entry, maxBytes, signal) => operation(entry.identity, entry, maxBytes, signal),
    remove: (identity, maxBytes, signal) => operation(identity, null, maxBytes, signal, true),
    close() { closed = true; database?.close(); } };
}

function manifestUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value || value.includes('\\')) invalid('Invalid manifest asset URL.');
  let url, base;
  try {
    base = baseUrl ? new URL(baseUrl) : new URL('http://localhost/');
    url = new URL(value, base);
  } catch { invalid('Invalid manifest asset URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password
    || (!baseUrl && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value))) invalid('Manifest assets must use same-origin or relative URLs.');
  return baseUrl ? url.href : value;
}

async function responseBuffer(response, byteLength, signal) {
  if (!response?.ok) throw new Error('Asset fetch failed.');
  const announced = response.headers?.get?.('content-length');
  if (announced != null && (!/^\d+$/.test(announced) || Number(announced) !== byteLength)) invalid('Asset Content-Length mismatch.');
  if (!response.body?.getReader) {
    const buffer = await abortable(response.arrayBuffer(), signal);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== byteLength) invalid('Fetched asset byte length mismatch.');
    return buffer;
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(byteLength);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || offset + value.byteLength > byteLength) invalid('Fetched asset exceeds byte budget.');
      buffer.set(value, offset); offset += value.byteLength;
    }
    if (offset !== byteLength) invalid('Fetched asset byte length mismatch.');
    return buffer.buffer;
  } catch (error) { Promise.resolve(reader.cancel()).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

async function readManifestPayload(response, entry, signal) {
  if (entry.compression !== "gzip") return responseBuffer(response, entry.byteLength, signal);
  if (!response?.ok) throw new Error("Asset fetch failed.");
  const httpDecoded = /gzip/i.test(response.headers?.get?.("content-encoding") || "");
  const announced = response.headers?.get?.("content-length");
  if (announced != null && Number(announced) !== entry.compressedByteLength) invalid("Compressed asset Content-Length mismatch.");
  // Browsers transparently decode HTTP Content-Encoding. Explicit .gz static
  // files without that header are decoded here; never decompress twice.
  const bytes = await responseBuffer(new Response(response.body), httpDecoded ? entry.byteLength : entry.compressedByteLength, signal);
  let payload = bytes;
  if (!httpDecoded) {
    if (typeof DecompressionStream !== "function") throw new Error("Gzip assets require DecompressionStream.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    payload = await responseBuffer(new Response(stream), entry.byteLength, signal);
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== entry.sha256) invalid("Asset payload digest mismatch.");
  checkAbort(signal);
  return payload;
}

/** Optional persistent coverage cache. No registered manifest means no network. */
export function createPoliticalIdRasterAssetStore({
  indexedDB = globalThis.indexedDB, fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_BYTES, memoryMaxBytes = 0,
  baseUrl = globalThis.location?.href, dbName = 'political-id-raster-assets-v1', backend,
} = {}) {
  validateBudget(maxBytes); validateBudget(memoryMaxBytes, 'memoryMaxBytes');
  const persistent = backend ?? (indexedDB ? createIndexedDbBackend(indexedDB, dbName) : null);
  const memory = new Map();
  let manifest = new Map(), disposed = false, memoryBytes = 0, serial = Promise.resolve(), sequence = 0;
  const controllers = new Set();
  const counts = { memoryHits: 0, indexedDBHits: 0, manifestHits: 0, misses: 0, saves: 0,
    failures: 0, evictions: 0, cacheReadTimeouts: 0, pendingReads: 0, pendingWrites: 0, pendingBytes: 0, lastError: null };
  function recordError(error) { counts.failures += 1; counts.lastError = { name: error.name, message: String(error.message) }; }
  function remember(identity, payload) {
    const previous = memory.get(identity);
    if (previous) { memoryBytes -= previous.byteLength; memory.delete(identity); }
    if (disposed || payload.byteLength > memoryMaxBytes) return false;
    memory.set(identity, payload); memoryBytes += payload.byteLength;
    while (memoryBytes > memoryMaxBytes) {
      const oldest = memory.keys().next().value;
      memoryBytes -= memory.get(oldest).byteLength; memory.delete(oldest); counts.evictions += 1;
    }
    return memory.has(identity);
  }
  function queue(action) {
    const operation = serial.then(() => disposed ? null : action());
    serial = operation.catch(() => {});
    return operation;
  }
  function operationSignal(signal) {
    checkAbort(signal);
    if (disposed) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    controllers.add(controller);
    return { signal: controller.signal, release() { controllers.delete(controller); signal?.removeEventListener('abort', abort); } };
  }
  async function persist(identity, payload, signal) {
    if (!persistent || payload.byteLength > maxBytes) return false;
    try {
      const result = await abortable(queue(() => {
        checkAbort(signal);
        return persistent.writeBounded({ identity, payload, byteLength: payload.byteLength,
          touched: Date.now() + (++sequence) }, maxBytes, signal);
      }), signal);
      checkAbort(signal);
      return result !== false && result !== null;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      recordError(error); return false;
    }
  }
  function persistManifestInBackground(identity, payload) {
    // Display validated coverage immediately. Retain at most one optional write
    // buffer; a slow disk must not stall tile admission or queue more buffers.
    if (!persistent || counts.pendingWrites || payload.byteLength > maxBytes) return;
    const operation = operationSignal();
    counts.pendingWrites += 1;
    counts.pendingBytes += payload.byteLength;
    void persist(identity, payload, operation.signal).catch(error => {
      if (error.name !== 'AbortError') recordError(error);
    }).finally(() => {
      counts.pendingWrites -= 1;
      counts.pendingBytes -= payload.byteLength;
      operation.release();
    });
  }
  return {
    registerManifest(value) {
      if (disposed) throw abortError();
      if (value?.schemaVersion !== POLITICAL_ID_RASTER_ASSET_SCHEMA_VERSION || !Array.isArray(value.tiles)) invalid('Invalid asset manifest schema.');
      const next = new Map();
      let bytes = 0;
      for (const entry of value.tiles) {
        validateIdentity(entry?.identity);
        if (next.has(entry.identity) || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < HEADER_BYTES || entry.byteLength > maxBytes) invalid('Invalid or oversized manifest entry.');
        const url = manifestUrl(entry.url, baseUrl);
        bytes += textEncoder.encode(entry.identity + url).length + 16;
        if (bytes > maxBytes) invalid('Manifest exceeds byte budget.');
        if (entry.compression != null && entry.compression !== "gzip") invalid("Unsupported asset compression.");
        if (entry.compression === "gzip" && (!Number.isSafeInteger(entry.compressedByteLength)
          || entry.compressedByteLength <= 0 || entry.compressedByteLength > maxBytes
          || !/^[a-f0-9]{64}$/.test(entry.sha256 || ""))) invalid("Invalid compressed asset metadata.");
        next.set(entry.identity, { url, byteLength: entry.byteLength,
          compression: entry.compression, compressedByteLength: entry.compressedByteLength, sha256: entry.sha256 });
      }
      manifest = next;
      return manifest.size;
    },
    async load(identity, { idToCode, signal } = {}) {
      validateIdentity(identity);
      const operation = operationSignal(signal);
      counts.pendingReads += 1;
      const decode = (payload) => decodePoliticalIdRasterAsset(payload, { identity, idToCode, maxBytes });
      try {
        const cached = memory.get(identity);
        if (cached) {
          try {
            const tile = decode(cached);
            if (tile) { memory.delete(identity); memory.set(identity, cached); counts.memoryHits += 1; return tile; }
          } catch (error) { recordError(error); }
          memory.delete(identity); memoryBytes -= cached.byteLength;
        }
        const entry = manifest.get(identity);
        if (persistent && !(counts.pendingWrites && entry)) {
          const cacheController = new AbortController();
          const cacheSignal = AbortSignal.any([operation.signal, cacheController.signal]);
          // A published tile has a network source. Do not make a slow optional
          // disk lookup consume the producer's entire display deadline.
          const timer = entry ? setTimeout(() => cacheController.abort(), PERSISTENT_READ_BUDGET_MS) : null;
          try {
            const payload = await abortable(queue(() => { checkAbort(cacheSignal); return persistent.read(identity, maxBytes, cacheSignal); }), cacheSignal);
            checkAbort(operation.signal);
            if (payload) {
              const tile = decode(payload);
              if (tile) { remember(identity, payload); counts.indexedDBHits += 1; return tile; }
            }
          } catch (error) {
            if (error.name === 'AbortError') {
              if (operation.signal.aborted || !cacheController.signal.aborted) throw error;
              counts.cacheReadTimeouts += 1;
            } else recordError(error);
          } finally { if (timer !== null) clearTimeout(timer); }
        }
        if (entry && fetchImpl) {
          try {
            const response = await abortable(Promise.resolve(fetchImpl(entry.url, { signal: operation.signal, credentials: 'same-origin', mode: 'same-origin' })), operation.signal);
            // Redirects must retain the same origin as the registered asset URL.
            if (response.url) manifestUrl(response.url, baseUrl ?? 'http://localhost/');
            const payload = await readManifestPayload(response, entry, operation.signal);
            checkAbort(operation.signal);
            const tile = decode(payload);
            if (tile) {
              remember(identity, payload);
              persistManifestInBackground(identity, payload);
              counts.manifestHits += 1;
              return tile;
            }
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            recordError(error);
          }
        }
        counts.misses += 1;
        return null;
      } finally { counts.pendingReads -= 1; operation.release(); }
    },
    async save(identity, tile, { codeToId, signal } = {}) {
      validateIdentity(identity);
      const operation = operationSignal(signal);
      counts.pendingWrites += 1;
      let payload;
      try {
        payload = encodePoliticalIdRasterAsset(tile, { identity, codeToId, maxBytes });
        counts.pendingBytes += payload.byteLength;
        checkAbort(operation.signal);
        const persisted = await persist(identity, payload, operation.signal);
        checkAbort(operation.signal);
        const retained = remember(identity, payload);
        if (retained || persisted) counts.saves += 1;
        return retained || persisted;
      } finally {
        counts.pendingWrites -= 1;
        if (payload) counts.pendingBytes -= payload.byteLength;
        operation.release();
      }
    },
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      memory.clear(); memoryBytes = 0; manifest.clear(); persistent?.close?.();
    },
    stats() { return { ...counts, lastError: counts.lastError && { ...counts.lastError },
      memoryBytes, memoryEntries: memory.size, manifestEntries: manifest.size, maxBytes, memoryMaxBytes, disposed }; },
  };
}
