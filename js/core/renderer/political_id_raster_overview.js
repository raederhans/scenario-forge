// Temporary navigation coverage only. Center-sample categorical IDs and copy
// sparse coverage spans verbatim; never interpolate feature identity codes.
export function createPoliticalIdRasterOverview({ tiles, plan, dpr = 1, maxBytes = Infinity }) {
  const factor = 2 ** Math.ceil(Math.log2(2 * Math.max(1, dpr)));
  const expectedBytes = tiles.reduce((sum, tile) => sum + tile.codes.byteLength / (factor * factor)
    + tile.edgeIds.byteLength + tile.edgeWeights.byteLength, 0);
  if (expectedBytes > maxBytes || tiles.some(tile => [tile.originX, tile.originY, tile.width, tile.height]
    .some(value => !Number.isSafeInteger(value / factor)))) return null;
  const reduced = tiles.map(tile => {
    const width = tile.width / factor, height = tile.height / factor;
    const codes = new Uint32Array(width * height), ids = [], weights = [], spans = new Map();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (y * factor + factor / 2) * tile.width + x * factor + factor / 2;
      let code = tile.codes[source];
      if (code & 0x80000000) {
        const offset = code & 0x7fffffff;
        if (!spans.has(offset)) {
          const count = tile.edgeIds[offset];
          if (!count || offset + count >= tile.edgeIds.length) throw new RangeError("Invalid overview edge span.");
          spans.set(offset, ids.length);
          for (let i = 0; i <= count; i++) { ids.push(tile.edgeIds[offset + i]); weights.push(tile.edgeWeights[offset + i]); }
        }
        code = (0x80000000 | spans.get(offset)) >>> 0;
      }
      codes[y * width + x] = code;
    }
    return { originX: tile.originX / factor, originY: tile.originY / factor, width, height,
      codes, edgeIds: Uint32Array.from(ids), edgeWeights: Float32Array.from(weights) };
  });
  return { tiles: reduced, factor, plan: { ...plan, density: plan.density / factor, scale: plan.scale * factor,
    level: plan.level - Math.log2(factor) * 4, originX: plan.originX / factor, originY: plan.originY / factor,
    width: plan.width / factor, height: plan.height / factor,
    tiles: plan.tiles.map(tile => ({ ...tile, key: `overview:${tile.key}`, density: tile.density / factor,
      originX: tile.originX / factor, originY: tile.originY / factor, width: tile.width / factor, height: tile.height / factor })) } };
}
