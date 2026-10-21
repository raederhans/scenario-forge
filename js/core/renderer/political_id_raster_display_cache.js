// Disposable RGBA presentation cache. Integer ID tiles and canonical features
// remain authoritative. Never interpolate IDs or read pixels on the hot path.
export function createPoliticalIdRasterDisplayCache({
  createCanvas = (width, height) => new OffscreenCanvas(width, height),
  now = () => performance.now(),
} = {}) {
  let canvas = null, context = null, previous = null, disposed = false;
  // A presentation snapshot must not retain evicted CPU tile buffers. Tokens
  // have no backlink to their tile; the original byte-bounded LRU owns payloads.
  const tileTokens = new WeakMap();
  function tokenFor(tile) {
    let token = tileTokens.get(tile);
    if (!token) { token = {}; tileTokens.set(tile, token); }
    return token;
  }
  const stats = { fullUpdates: 0, partialUpdates: 0, reusedFrames: 0, shadedPixels: 0,
    lastUpdatedPixels: 0, lastFullPixels: 0, lastGpuMs: 0, lastCaptureMs: 0,
    paletteSnapshotCopies: 0 };

  function reset() {
    previous = null;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    canvas = null; context = null;
  }

  function draw({ gpu, plan, tiles, palette, revision, dependencies }) {
    if (disposed) throw new Error("Raster display cache is disposed.");
    if (!plan || !Number.isSafeInteger(plan.width) || !Number.isSafeInteger(plan.height)
      || plan.width <= 0 || plan.height <= 0 || !(palette instanceof Uint8Array)
      || palette.length < 4 || palette.length % 4 || !Array.isArray(tiles)) {
      throw new TypeError("Invalid retained raster frame.");
    }
    const fullPixels = plan.width * plan.height;
    stats.lastFullPixels = fullPixels;
    stats.lastUpdatedPixels = 0; stats.lastGpuMs = 0; stats.lastCaptureMs = 0;
    const sameGrid = previous && ["width", "height", "originX", "originY", "density"]
      .every(key => previous.plan[key] === plan[key]);
    const tokens = tiles.map(tokenFor);
    const sameTiles = sameGrid && previous.tokens.length === tokens.length
      && tokens.every((token, index) => token === previous.tokens[index]);
    let dirty = tiles;
    if (sameTiles && palette.length === previous.palette.length) {
      const changed = new Set();
      if (revision !== previous.revision) {
        for (let offset = 0; offset < palette.length; offset += 4) {
          if ([0, 1, 2, 3].some(channel => palette[offset + channel] !== previous.palette[offset + channel])) {
            changed.add(offset / 4);
          }
        }
      }
      // Code zero can affect every unpainted pixel. Missing dependency metadata
      // fails conservative: shade the tile, never publish stale colors.
      dirty = changed.has(0) ? tiles : tiles.filter(tile => {
        if (!changed.size) return false;
        const codes = dependencies?.(tile);
        return !codes || codes.some(code => changed.has(code));
      });
    }
    if (!canvas || canvas.width !== plan.width || canvas.height !== plan.height) {
      reset();
      canvas = createCanvas(plan.width, plan.height);
      context = canvas.getContext("2d");
      if (!context) { reset(); throw new Error("Retained raster requires a 2D surface."); }
      dirty = tiles;
    }
    if (dirty.length) {
      let minX = Math.min(...dirty.map(tile => tile.originX)), minY = Math.min(...dirty.map(tile => tile.originY));
      let maxX = Math.max(...dirty.map(tile => tile.originX + tile.width));
      let maxY = Math.max(...dirty.map(tile => tile.originY + tile.height));
      minX = Math.max(plan.originX, minX); minY = Math.max(plan.originY, minY);
      maxX = Math.min(plan.originX + plan.width, maxX); maxY = Math.min(plan.originY + plan.height, maxY);
      // One bounded union region avoids a WebGL-to-Canvas synchronization for
      // each tile. Dense or widely separated changes use the full frame.
      const full = !sameTiles || (maxX - minX) * (maxY - minY) >= fullPixels * 0.65;
      const region = full ? { width: plan.width, height: plan.height, originX: plan.originX, originY: plan.originY }
        : { width: maxX - minX, height: maxY - minY, originX: minX, originY: minY };
      if (region.width <= 0 || region.height <= 0) throw new Error("Invalid dirty raster region.");
      const started = now();
      gpu.draw(region);
      const captured = now();
      const x = region.originX - plan.originX, y = region.originY - plan.originY;
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        context.imageSmoothingEnabled = false;
        // Clear first so transparent ocean/edge pixels cannot leave old color.
        context.clearRect(x, y, region.width, region.height);
        context.drawImage(gpu.canvas, x, y);
      } catch (error) {
        previous = null;
        throw error;
      } finally { context.restore(); }
      stats.lastGpuMs = captured - started;
      stats.lastCaptureMs = now() - captured;
      stats.lastUpdatedPixels = region.width * region.height;
      stats.shadedPixels += stats.lastUpdatedPixels;
      stats[full ? "fullUpdates" : "partialUpdates"]++;
    } else stats.reusedFrames++;
    // Commit only after the region was successfully copied. The byte snapshot
    // detects changes even when a caller updates the palette buffer in place.
    // The palette revision already gates byte comparison and GPU uploads.
    // An unchanged revision can keep its owned byte snapshot through pans or
    // grid changes; a new revision still snapshots in-place edits after success.
    const paletteSnapshot = previous && previous.revision === revision && previous.palette.length === palette.length
      ? previous.palette : palette.slice();
    if (paletteSnapshot !== previous?.palette) stats.paletteSnapshotCopies++;
    previous = { plan: { width: plan.width, height: plan.height, originX: plan.originX,
      originY: plan.originY, density: plan.density }, tokens, revision, palette: paletteSnapshot };
    return canvas;
  }

  return Object.freeze({ draw, reset,
    dispose() { if (!disposed) { reset(); disposed = true; } },
    getStats: () => ({ ...stats, retainedSurfaceBytes: canvas ? canvas.width * canvas.height * 4 : 0,
      paletteSnapshotBytes: previous?.palette.byteLength || 0 }),
  });
}
