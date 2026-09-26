const TILE_SIZE = 256;
const GUTTER = 1;
const INDEX_CELL_SIZE = 32;

// Exact scale and subpixel phase are part of the key: cached tiles never stretch
// across zoom levels or shift the light field relative to the solar mask.
export function createLightTextureTileCache({ createCanvas, maxBytes = 32 * 1024 * 1024 } = {}) {
  const tiles = new Map();
  const tileBytes = (TILE_SIZE + GUTTER * 2) ** 2 * 4;
  const capacity = Math.floor(maxBytes / tileBytes);
  let source = null;
  let signature = '';
  let index = new Map();

  function clearTiles() {
    for (const canvas of tiles.values()) { canvas.width = 0; canvas.height = 0; }
    tiles.clear();
  }

  function query(minX, minY, maxX, maxY) {
    const found = new Set();
    for (let y = Math.floor(minY / INDEX_CELL_SIZE); y <= Math.floor(maxY / INDEX_CELL_SIZE); y++) {
      for (let x = Math.floor(minX / INDEX_CELL_SIZE); x <= Math.floor(maxX / INDEX_CELL_SIZE); x++) {
        for (const entry of index.get(`${x}:${y}`) || []) found.add(entry);
      }
    }
    // Preserve the original blend order, including at tile boundaries.
    return [...found].sort((a, b) => a.order - b.order).map(({ entry }) => entry);
  }

  function render({ context, entries, key, variant = '', drawEntries, drawViewport = null }) {
    const transform = context?.getTransform?.();
    if (!transform || capacity < 1 || transform.b !== 0 || transform.c !== 0
      || !(transform.a > 0 && transform.d > 0)) return null;
    if (source !== entries) {
      source = entries;
      index = new Map();
      entries.forEach((entry, order) => {
        const radius = Math.max(entry.rx, entry.ry) * 2.1;
        const indexed = { entry, order };
        for (let y = Math.floor((entry.y - radius) / INDEX_CELL_SIZE); y <= Math.floor((entry.y + radius) / INDEX_CELL_SIZE); y++) {
          for (let x = Math.floor((entry.x - radius) / INDEX_CELL_SIZE); x <= Math.floor((entry.x + radius) / INDEX_CELL_SIZE); x++) {
            const cell = `${x}:${y}`;
            if (!index.has(cell)) index.set(cell, []);
            index.get(cell).push(indexed);
          }
        }
      });
      clearTiles();
    }
    if (signature !== key) { signature = key; clearTiles(); }
    const { a, d, e, f } = transform;
    const offsetX = Math.floor(e), offsetY = Math.floor(f);
    const phaseX = e - offsetX, phaseY = f - offsetY;
    const prefix = [a, d, phaseX, phaseY, variant].join(':');
    const minTileX = Math.floor(-offsetX / TILE_SIZE);
    const minTileY = Math.floor(-offsetY / TILE_SIZE);
    const maxTileX = Math.floor((context.canvas.width - 1 - offsetX) / TILE_SIZE);
    const maxTileY = Math.floor((context.canvas.height - 1 - offsetY) / TILE_SIZE);
    const stats = { hits: 0, misses: 0, candidates: 0, bytes: 0, capacityBytes: capacity * tileBytes };
    const requested = [];
    for (let y = minTileY; y <= maxTileY; y++) {
      for (let x = minTileX; x <= maxTileX; x++) requested.push({ x, y, key: `${prefix}:${x}:${y}` });
    }
    const missing = requested.filter((tile) => !tiles.has(tile.key)).length;
    const missingCandidates = new Map();
    let candidateWork = 0;
    for (const tile of requested) {
      if (tiles.has(tile.key) || (drawViewport && missing === requested.length)) continue;
      const tx = tile.x * TILE_SIZE, ty = tile.y * TILE_SIZE;
      const candidates = query((tx - phaseX - GUTTER) / a, (ty - phaseY - GUTTER) / d,
        (tx + TILE_SIZE - phaseX + GUTTER) / a, (ty + TILE_SIZE - phaseY + GUTTER) / d);
      missingCandidates.set(tile.key, candidates);
      candidateWork += candidates.length;
    }
    const viewportCandidates = drawViewport && missing
      ? query(-e / a, -f / d, (context.canvas.width - e) / a, (context.canvas.height - f) / d) : null;
    // A new zoom should not draw each overlapping kernel in several tiles.
    // Paint once, then copy complete tiles from the already rendered surface.
    if (viewportCandidates && (missing === requested.length || candidateWork > viewportCandidates.length * 1.1)) {
      const candidates = viewportCandidates;
      drawViewport(context, candidates);
      for (const requestedTile of requested) {
        const sx = requestedTile.x * TILE_SIZE + offsetX - GUTTER;
        const sy = requestedTile.y * TILE_SIZE + offsetY - GUTTER;
        const size = TILE_SIZE + GUTTER * 2;
        if (sx < 0 || sy < 0 || sx + size > context.canvas.width || sy + size > context.canvas.height) continue;
        let tile = tiles.get(requestedTile.key);
        tiles.delete(requestedTile.key);
        if (!tile && tiles.size >= capacity) {
          const oldest = tiles.keys().next().value;
          tile = tiles.get(oldest);
          tiles.delete(oldest);
        }
        tile ||= createCanvas(size, size, context);
        const tileContext = tile?.getContext?.('2d');
        if (!tileContext) continue;
        tile.width = size; tile.height = size;
        tileContext.drawImage(context.canvas, sx, sy, size, size, 0, 0, size, size);
        tiles.set(requestedTile.key, tile);
      }
      return { ...stats, misses: missing, candidates: candidates.length, bytes: tiles.size * tileBytes, bulk: true };
    }
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      for (let y = minTileY; y <= maxTileY; y++) {
        for (let x = minTileX; x <= maxTileX; x++) {
          const tileKey = `${prefix}:${x}:${y}`;
          let tile = tiles.get(tileKey);
          if (tile) {
            tiles.delete(tileKey);
            tiles.set(tileKey, tile);
            stats.hits++;
          } else {
            if (tiles.size >= capacity) {
              const oldestKey = tiles.keys().next().value;
              tile = tiles.get(oldestKey);
              tiles.delete(oldestKey);
            } else {
              tile = createCanvas(TILE_SIZE + GUTTER * 2, TILE_SIZE + GUTTER * 2, context);
            }
            const tileContext = tile?.getContext?.('2d');
            if (!tileContext) return null;
            tile.width = TILE_SIZE + GUTTER * 2;
            tile.height = TILE_SIZE + GUTTER * 2;
            const tx = x * TILE_SIZE, ty = y * TILE_SIZE;
            const candidates = missingCandidates.get(tileKey) || query((tx - phaseX - GUTTER) / a, (ty - phaseY - GUTTER) / d,
              (tx + TILE_SIZE - phaseX + GUTTER) / a, (ty + TILE_SIZE - phaseY + GUTTER) / d);
            tileContext.setTransform(a, 0, 0, d, phaseX - tx + GUTTER, phaseY - ty + GUTTER);
            tileContext.globalCompositeOperation = 'screen';
            drawEntries(tileContext, candidates);
            tiles.set(tileKey, tile);
            stats.misses++;
            stats.candidates += candidates.length;
          }
          // Integer destination and identical source/destination sizes avoid
          // resampling seams. Gutters contain kernels crossing the tile edge.
          context.drawImage(tile, GUTTER, GUTTER, TILE_SIZE, TILE_SIZE,
            x * TILE_SIZE + offsetX, y * TILE_SIZE + offsetY, TILE_SIZE, TILE_SIZE);
        }
      }
    } finally {
      context.restore();
    }
    stats.bytes = tiles.size * tileBytes;
    return stats;
  }
  return { render };
}
