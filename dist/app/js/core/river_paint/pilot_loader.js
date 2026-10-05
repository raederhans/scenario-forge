import { resolveDataAssetUrl } from '../runtime_asset_registry.js';
import { normalizeRiverPartitionPack } from './partition_model.js';
import { decodeRiverPartitionTransport } from './pack_transport.js';
import { APPROVED_RIVER_PACKS, RIVER_PAINT_WAVE7 } from './pilot_manifest.js';

// File input is untrusted. Coordinate/hash self-consistency alone is not a
// coverage proof: authenticate the complete offline-reviewed pack, including
// support geometry. A saved project remains self-contained and works offline.
export async function verifyApprovedRiverPack(value) {
  const pack = normalizeRiverPartitionPack(value);
  const approved = APPROVED_RIVER_PACKS.find(entry => entry.packId === pack.packId && entry.sceneId === pack.sceneId);
  if (!approved) {
    throw new Error('Unsupported river partition pack. Use a reviewed Modern World pack.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== approved.canonicalSha256) throw new Error('River partition pack integrity check failed');
  return pack;
}

export async function loadRiverPaintPilot({ signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(resolveDataAssetUrl(RIVER_PAINT_WAVE7.assetKey), { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`River partition load failed (${response.status})`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('River partition download exceeds the budget');
  return verifyApprovedRiverPack(decodeRiverPartitionTransport(JSON.parse(text)));
}
