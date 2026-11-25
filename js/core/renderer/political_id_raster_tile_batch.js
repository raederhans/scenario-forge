export function selectPoliticalIdTileBatch(tiles, size, needsTile) {
  const batch = [];
  for (const tile of tiles) {
    if (needsTile(tile)) batch.push(tile);
    if (batch.length === size) break;
  }
  return batch;
}

export function createPoliticalIdTileFeed(descriptors, peek, tileToken, signal) {
  const remaining = new Set(descriptors.map(tile => tile.key));
  const delivered = new Map();
  let wake;
  function notify() {
    wake?.();
    wake = null;
  }
  signal.addEventListener("abort", notify, { once: true });
  async function takeTile() {
    while (remaining.size) {
      signal.throwIfAborted();
      for (const key of remaining) {
        const tile = peek(key);
        if (!tile) continue;
        delivered.set(key, tileToken(tile));
        remaining.delete(key);
        return tile;
      }
      await new Promise(resolve => { wake = resolve; });
    }
  }
  function current() {
    for (const [key, token] of delivered) if (tileToken(peek(key)) !== token) return false;
    return true;
  }
  return { takeTile, notify, current };
}
