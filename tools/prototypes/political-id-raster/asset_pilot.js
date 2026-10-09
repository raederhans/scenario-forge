// Local pilot interchange: uint32 LE JSON byte length, UTF-8 JSON, tile bytes.
// Tile offsets are relative to the start of the binary section, never paths.
export const POLITICAL_ID_PILOT_MAX_TILES = 128;
export const POLITICAL_ID_PILOT_MAX_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class PoliticalIdRasterPilotValidationError extends Error {
  constructor(message) { super(message); this.name = 'PoliticalIdRasterPilotValidationError'; }
}
const invalid = (message) => { throw new PoliticalIdRasterPilotValidationError(message); };
function identity(value, name = 'identity') {
  if (typeof value !== 'string' || !value || value.length > 65536) invalid(`Invalid pilot ${name}.`);
}
function exactKeys(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || Object.keys(object).length !== keys.length || keys.some((key) => !Object.hasOwn(object, key))) invalid('Invalid pilot metadata fields.');
}

export function packPoliticalIdRasterAssetPilot({ scenarioId, assets } = {}) {
  identity(scenarioId, 'scenarioId');
  if (!Array.isArray(assets) || assets.length > POLITICAL_ID_PILOT_MAX_TILES) invalid('Pilot exceeds tile count limit.');
  const unique = new Map();
  let offset = 0;
  for (const asset of assets) {
    identity(asset?.identity);
    if (!(asset.buffer instanceof ArrayBuffer) || asset.buffer.byteLength < 48) invalid('Invalid pilot tile buffer.');
    if (unique.has(asset.identity)) {
      const previous = new Uint8Array(unique.get(asset.identity).buffer), current = new Uint8Array(asset.buffer);
      if (previous.length !== current.length || previous.some((value, at) => value !== current[at])) invalid('Conflicting duplicate pilot identity.');
      continue;
    }
    if (offset + asset.buffer.byteLength > POLITICAL_ID_PILOT_MAX_BYTES) invalid('Pilot exceeds total byte limit.');
    unique.set(asset.identity, { ...asset, offset });
    offset += asset.buffer.byteLength;
  }
  const tiles = [...unique.values()].map((asset) => ({ identity: asset.identity, offset: asset.offset, byteLength: asset.buffer.byteLength }));
  const metadata = encoder.encode(JSON.stringify({ schemaVersion: 1, scenarioId, tiles }));
  const byteLength = 4 + metadata.byteLength + offset;
  if (metadata.byteLength > MAX_METADATA_BYTES || byteLength > POLITICAL_ID_PILOT_MAX_BYTES) invalid('Pilot exceeds metadata or total byte limit.');
  const buffer = new ArrayBuffer(byteLength);
  new DataView(buffer).setUint32(0, metadata.byteLength, true);
  const bytes = new Uint8Array(buffer);
  bytes.set(metadata, 4);
  for (const asset of unique.values()) bytes.set(new Uint8Array(asset.buffer), 4 + metadata.byteLength + asset.offset);
  return buffer;
}

export function unpackPoliticalIdRasterAssetPilot(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4 || buffer.byteLength > POLITICAL_ID_PILOT_MAX_BYTES) invalid('Invalid pilot bundle size.');
  const metadataLength = new DataView(buffer).getUint32(0, true);
  if (!metadataLength || metadataLength > MAX_METADATA_BYTES || metadataLength + 4 > buffer.byteLength) invalid('Invalid pilot metadata length.');
  let metadata;
  try { metadata = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, metadataLength))); }
  catch { invalid('Invalid UTF-8 pilot metadata.'); }
  exactKeys(metadata, ['schemaVersion', 'scenarioId', 'tiles']);
  if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.tiles)
    || metadata.tiles.length > POLITICAL_ID_PILOT_MAX_TILES) invalid('Invalid pilot schema or tile count.');
  identity(metadata.scenarioId, 'scenarioId');
  const binaryOffset = metadataLength + 4, identities = new Set();
  let expectedOffset = 0;
  for (const entry of metadata.tiles) {
    exactKeys(entry, ['identity', 'offset', 'byteLength']);
    identity(entry.identity);
    if (identities.has(entry.identity)) invalid('Duplicate pilot tile identity.');
    if (!Number.isSafeInteger(entry.offset) || entry.offset !== expectedOffset
      || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 48
      || entry.offset + entry.byteLength > buffer.byteLength - binaryOffset) invalid('Invalid pilot tile offset or byte length.');
    identities.add(entry.identity);
    expectedOffset += entry.byteLength;
  }
  if (expectedOffset !== buffer.byteLength - binaryOffset) invalid('Pilot binary length does not match metadata.');
  return { schemaVersion: 1, scenarioId: metadata.scenarioId,
    tiles: metadata.tiles.map((entry) => ({ identity: entry.identity,
      buffer: buffer.slice(binaryOffset + entry.offset, binaryOffset + entry.offset + entry.byteLength) })) };
}

/** Download only caller-captured coverage; renderer state remains caller-owned. */
export async function downloadPoliticalIdRasterAssetPilot({ renderer, scenarioId, filename = 'political-id-pilot.bundle' } = {}) {
  if (typeof renderer?.capturePoliticalIdRasterAssets !== 'function') throw new TypeError('Renderer capturePoliticalIdRasterAssets() is required.');
  identity(scenarioId, 'scenarioId');
  if (typeof filename !== 'string' || !filename || filename.length > 255 || /[\\/\x00-\x1f]/.test(filename)) invalid('Invalid pilot download filename.');
  const assets = await renderer.capturePoliticalIdRasterAssets();
  const buffer = packPoliticalIdRasterAssetPilot({ scenarioId, assets });
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  let anchor;
  try {
    anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
  } finally {
    try { anchor?.remove(); } finally { URL.revokeObjectURL(url); }
  }
  return { tileCount: new Set(assets.map((asset) => asset.identity)).size, byteLength: buffer.byteLength, filename };
}
