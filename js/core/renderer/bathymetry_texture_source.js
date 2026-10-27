export async function loadBathymetryImageBitmap(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Bathymetry image request failed: ${response.status}`);
  return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export function createBathymetryTextureSource({ manifestUrl, fetchJson, loadImageBitmap,
  maxCachedTiles = 64, now = Date.now, onTileLoaded = () => {} }) {
  let manifest, overview, revision = 0, active = 0;
  const loaded = new Map(), pending = new Map(), failed = new Map(), queue = [];
  let present;

  function drain() {
    while (active < 6 && queue.length) {
      const { key, resolve } = queue.shift();
      active++;
      const [col, row] = key.split('_');
      Promise.resolve().then(() => loadImageBitmap(manifest.tiles.url_template.replace('{col}', col).replace('{row}', row)))
        .then((bitmap) => {
          loaded.set(key, bitmap);
          revision++;
          while (loaded.size > maxCachedTiles) {
            const oldest = loaded.keys().next().value;
            loaded.get(oldest).close?.();
            loaded.delete(oldest);
            revision++;
          }
          failed.delete(key);
          onTileLoaded(key);
        }, () => { failed.set(key, now() + 30000); })
        .finally(() => { active--; pending.delete(key); resolve(); drain(); });
    }
  }

  return {
    async load() {
      manifest = await fetchJson(manifestUrl);
      present = new Set(manifest.tiles.present);
      overview = await loadImageBitmap(manifest.overview.url);
      return true;
    },
    getTileKeysForBounds([west, south, east, north]) {
      const intervals = west > east ? [[west, 180], [-180, east]] : [[west, east]];
      return [...present].filter((key) => {
        const [col, row] = key.split('_').map(Number);
        const left = -180 + col * 20, top = 90 - row * 20;
        return top > south && top - 20 < north && intervals.some(([w, e]) => left < e && left + 20 > w);
      });
    },
    requestTiles(keys) {
      const requests = [];
      for (const key of new Set(keys)) {
        if (!present.has(key)) continue;
        if (loaded.has(key)) {
          const bitmap = loaded.get(key);
          loaded.delete(key); loaded.set(key, bitmap);
          continue;
        }
        if ((failed.get(key) ?? -Infinity) > now()) continue;
        if (!pending.has(key)) {
          let resolve;
          pending.set(key, new Promise((done) => { resolve = done; }));
          queue.push({ key, resolve });
        }
        requests.push(pending.get(key));
      }
      drain();
      return Promise.all(requests);
    },
    getLoadedTiles: () => new Map(loaded),
    getOverview: () => overview,
    getManifest: () => manifest,
    getRevision: () => revision,
    getCapacity: () => maxCachedTiles,
  };
}
