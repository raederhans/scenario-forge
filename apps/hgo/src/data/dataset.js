const MAX_ASSET = 160 * 1024 * 1024;
function assert(ok, message) { if (!ok) throw new Error(message); }
export function validateCore(core, width, height) {
  assert(core?.schemaVersion === 1 && Array.isArray(core.states) && Array.isArray(core.entities), 'Invalid HGO metadata');
  assert(Array.isArray(core.provinceIds) && core.provinceIds.length <= 65536 && core.provinceIds[0] === null, 'Invalid province table');
  assert(Array.isArray(core.provinceStateIds) && core.provinceStateIds.length === core.provinceIds.length && core.provinceStateIds[0] === null, 'Invalid state table');
  const stateById = new Map(), entityByTag = new Map();
  for (const e of core.entities) { assert(typeof e.tag === 'string' && !entityByTag.has(e.tag) && /^#[0-9a-f]{6}$/i.test(e.color), 'Invalid entity'); entityByTag.set(e.tag, e); }
  for (const s of core.states) {
    assert(Number.isSafeInteger(s.id) && !stateById.has(String(s.id)) && typeof s.name === 'string' && entityByTag.has(s.entityTag), 'Invalid state');
    assert(Array.isArray(s.anchor) && s.anchor.length === 2 && s.anchor.every(Number.isFinite) && s.anchor[0] >= 0 && s.anchor[0] < width && s.anchor[1] >= 0 && s.anchor[1] < height, 'Invalid state anchor');
    stateById.set(String(s.id), s);
  }
  const seen = new Set();
  for (let i = 1; i < core.provinceIds.length; i++) {
    assert(Number.isSafeInteger(core.provinceIds[i]) && !seen.has(core.provinceIds[i]) && (core.provinceStateIds[i] === null || stateById.has(String(core.provinceStateIds[i]))), 'Invalid province coverage');
    seen.add(core.provinceIds[i]);
  }
  return {stateById, entityByTag};
}
export async function loadDataset(manifestUrl, {signal, onProgress = () => {}, fetchImpl = fetch} = {}) {
  const base = new URL(manifestUrl, globalThis.location?.href || 'http://localhost/');
  const response = await fetchImpl(base.href, {signal});
  assert(response.ok, `Dataset manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  const {width, height, kind, origin, wrapX} = manifest.coordinateSpace || {};
  assert(manifest.format === 'hgo-native-dataset' && manifest.schemaVersion === 1 && typeof manifest.id === 'string' && typeof manifest.revision === 'string', 'Unsupported HGO dataset');
  assert(kind === 'pixel' && origin === 'top-left' && wrapX === false && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 50e6, 'Invalid native dimensions');
  async function asset(name) {
    signal?.throwIfAborted();
    const a = manifest.assets?.[name];
    assert(a && typeof a.url === 'string' && Number.isInteger(a.byteLength) && a.byteLength > 0 && a.byteLength <= MAX_ASSET && /^[a-f0-9]{64}$/i.test(a.sha256), `Invalid ${name} asset`);
    const url = new URL(a.url, base);
    assert(url.origin === base.origin, 'Cross-origin dataset asset refused');
    const r = await fetchImpl(url.href, {signal}); assert(r.ok, `${name}: HTTP ${r.status}`);
    const transport = new Uint8Array(a.byteLength);
    const transportReader = r.body.getReader(); let received = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const {done, value} = await transportReader.read(); if (done) break;
        assert(received + value.length <= transport.length, `${name}: byte length exceeds declared limit`);
        transport.set(value, received); received += value.length;
      }
    } finally { await transportReader.cancel(); }
    assert(received === a.byteLength, `${name}: byte length mismatch`);
    const bytes = transport.buffer;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    assert(digest === a.sha256.toLowerCase(), `${name}: integrity mismatch`);
    onProgress({phase: name, loaded: bytes.byteLength, total: bytes.byteLength});
    if (name === 'ids') {
      assert(a.encoding === 'gzip' && a.decodedByteLength === width * height * 2, 'Invalid ID encoding');
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const out = new Uint8Array(a.decodedByteLength); let offset = 0;
      try { while (true) { signal?.throwIfAborted(); const {done, value} = await reader.read(); if (done) break; assert(offset + value.length <= out.length, 'ID decompression exceeds bounds'); out.set(value, offset); offset += value.length; } } finally { await reader.cancel(); }
      assert(offset === out.length, 'Truncated ID raster');
      const ids = new Uint16Array(width * height), view = new DataView(out.buffer);
      for (let i = 0; i < ids.length; i++) ids[i] = view.getUint16(i * 2, true);
      return ids;
    }
    assert(a.encoding === 'json', `Invalid ${name} encoding`);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const [core, ids] = await Promise.all([asset('core'), asset('ids')]);
  const maps = validateCore(core, width, height);
  for (const code of ids) assert(code < core.provinceIds.length && (!code || maps.stateById.has(String(core.provinceStateIds[code]))), 'ID raster references missing province or state');
  for (const s of core.states) assert(String(core.provinceStateIds[ids[Math.floor(s.anchor[1]) * width + Math.floor(s.anchor[0])]]) === String(s.id), 'State anchor is outside its region');
  let places = [], placesWarning = null;
  if (manifest.assets.places) {
    try {
      const p = await asset('places'); assert(p.schemaVersion === 1 && Array.isArray(p.places), 'Invalid places');
      for (const place of p.places) assert(typeof place.name === 'string' && Number.isFinite(place.x) && Number.isFinite(place.y) && place.x >= 0 && place.x < width && place.y >= 0 && place.y < height && maps.stateById.has(String(place.stateId)), 'Invalid place coordinates');
      places = p.places;
    } catch (error) { if (signal?.aborted) throw error; placesWarning = error.message; onProgress({phase:'places-warning', message:error.message}); }
  }
  signal?.throwIfAborted();
  return {manifest, core, ids, places, placesWarning, ...maps};
}
