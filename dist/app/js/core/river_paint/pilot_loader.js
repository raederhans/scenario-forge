import { resolveDataAssetUrl } from '../runtime_asset_registry.js';
import { normalizeRiverPartitionPack } from './partition_model.js';
import { RIVER_PAINT_PILOT } from './pilot_manifest.js';

// File input is untrusted. Coordinate/hash self-consistency alone is not a
// coverage proof: authenticate the complete offline-reviewed pack, including
// support geometry. A saved project remains self-contained and works offline.
export async function verifyApprovedRiverPack(value) {
  const pack = normalizeRiverPartitionPack(value);
  if (pack.packId !== RIVER_PAINT_PILOT.packId || pack.sceneId !== RIVER_PAINT_PILOT.sceneId) {
    throw new Error('Unsupported river partition pack. Use the reviewed Modern World pilot.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== RIVER_PAINT_PILOT.canonicalSha256) throw new Error('River partition pack integrity check failed');
  return pack;
}

export async function loadRiverPaintPilot({ signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(resolveDataAssetUrl(RIVER_PAINT_PILOT.assetKey), { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`River partition load failed (${response.status})`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('River partition download exceeds the pilot budget');
  return verifyApprovedRiverPack(JSON.parse(text));
}
