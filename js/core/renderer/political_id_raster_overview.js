// Temporary navigation coverage only. Center-sample categorical IDs and copy
// sparse coverage spans verbatim; never interpolate feature identity codes.
export function createPoliticalIdRasterOverview({ tiles, plan, dpr = 1, maxBytes = Infinity }) {
  const factor = 2 ** Math.ceil(Math.log2(2 * Math.max(1, dpr)));
  const cores = tiles.map(tile => tile.coreRect ? { originX: tile.coreRect.minX, originY: tile.coreRect.minY,
    width: tile.coreRect.maxX - tile.coreRect.minX, height: tile.coreRect.maxY - tile.coreRect.minY } : tile);
  const expectedBytes = tiles.reduce((sum, tile, index) => {
    const core = cores[index];
    let edgeBytes = tile.edgeIds.byteLength + tile.edgeWeights.byteLength;
    if (tile.coreRect) {
      const spans = new Set(), codes = tile.codes;
      edgeBytes = 0;
      for (let y = 0; y < core.height; y++) for (let x = 0; x < core.width; x++) {
        const code = codes[(core.originY - tile.originY + y) * tile.width + core.originX - tile.originX + x];
        if (!(code & 0x80000000)) continue;
        const offset = code & 0x7fffffff;
        if (spans.has(offset)) continue;
        spans.add(offset);
        edgeBytes += (tile.edgeIds[offset] + 1) * 8;
      }
    }
    return sum + core.width * core.height * 4 / (factor * factor) + edgeBytes;
  }, 0);
  if (expectedBytes > maxBytes || cores.some(tile => [tile.originX, tile.originY, tile.width, tile.height]
    .some(value => !Number.isSafeInteger(value / factor)))) return null;
  const reduced = tiles.map((tile, index) => {
    const core = cores[index];
    const width = core.width / factor, height = core.height / factor;
    const codes = new Uint32Array(width * height), ids = [], weights = [], spans = new Map();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (core.originY - tile.originY + y * factor + factor / 2) * tile.width
        + core.originX - tile.originX + x * factor + factor / 2;
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
    return { originX: core.originX / factor, originY: core.originY / factor, width, height,
      codes, edgeIds: Uint32Array.from(ids), edgeWeights: Float32Array.from(weights) };
  });
  return { tiles: reduced, factor, plan: { ...plan, density: plan.density / factor, scale: plan.scale * factor,
    level: plan.level - Math.log2(factor) * 4, originX: plan.originX / factor, originY: plan.originY / factor,
    width: plan.width / factor, height: plan.height / factor,
    tiles: plan.tiles.map(({ coreRect, storageRect, ...tile }) => ({ ...tile, key: `overview:${tile.key}`, density: tile.density / factor,
      originX: tile.originX / factor, originY: tile.originY / factor, width: tile.width / factor, height: tile.height / factor })) } };
}
