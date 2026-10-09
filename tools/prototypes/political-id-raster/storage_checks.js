import { createPoliticalIdRasterAssetStore, encodePoliticalIdRasterAsset }
  from '../../../js/core/renderer/political_id_raster_assets.js';

const DATABASE_PREFIX = 'political-id-raster-storage-check-';
const EDGE = 0x80000000;
const sourceCodes = new Map([[1, 'storage-feature-alpha'], [7, 'storage-feature-beta']]);
const targetCodes = new Map([['storage-feature-alpha', 19], ['storage-feature-beta', 3]]);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const errorDetails = (error) => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error) });

function fixture() {
  const codes = new Uint32Array(64).fill(1);
  codes[0] = EDGE; codes[1] = 7; codes[63] = 0;
  return { width: 8, height: 8, originX: -512, originY: 1024, codes,
    edgeIds: new Uint32Array([2, 1, 7]), edgeWeights: new Float32Array([0, 0.25, 0.5]) };
}
function assertRemapped(tile) {
  check(tile?.width === 8 && tile.height === 8 && tile.originX === -512 && tile.originY === 1024, 'Tile dimensions or origin changed.');
  check(tile.codes[0] === EDGE && tile.codes[1] === 3 && tile.codes[2] === 19 && tile.codes[63] === 0, 'Direct code, span offset or background did not roundtrip.');
  check(tile.edgeIds.length === 3 && tile.edgeIds[0] === 2 && tile.edgeIds[1] === 19 && tile.edgeIds[2] === 3, 'Edge contributor IDs or span count did not remap.');
  check(tile.edgeWeights[0] === 0 && tile.edgeWeights[1] === 0.25 && tile.edgeWeights[2] === 0.5, 'Edge weights changed.');
}
function assertSettled(store) {
  const stats = store.stats();
  check(stats.pendingReads === 0 && stats.pendingWrites === 0 && stats.pendingBytes === 0, 'Store retains pending operations or payload bytes.');
  return stats;
}

async function databaseInventory(dbName, signal) {
  const aborted = () => Object.assign(new Error('Storage inventory cancelled.'), { name: 'AbortError' });
  const database = await new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    let abandoned = false;
    const request = indexedDB.open(dbName);
    const release = () => signal.removeEventListener('abort', cancel);
    const cancel = () => { abandoned = true; release(); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
    request.onerror = () => { release(); reject(request.error); };
    request.onblocked = () => { abandoned = true; release(); reject(new Error('Storage inventory database open blocked.')); };
    request.onsuccess = () => {
      release();
      if (abandoned) { request.result.close(); return; }
      resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(aborted()); return; }
      const transaction = database.transaction(['tiles', 'metadata'], 'readonly');
      const cancel = () => { try { transaction.abort(); } catch {} };
      signal.addEventListener('abort', cancel, { once: true });
      const release = () => signal.removeEventListener('abort', cancel);
      const metadata = transaction.objectStore('metadata').getAll();
      const tileKeys = transaction.objectStore('tiles').getAllKeys();
      transaction.oncomplete = () => { release(); resolve({ identities: metadata.result.map((entry) => entry.identity).sort(),
        payloadKeys: tileKeys.result.map(String).sort(), byteLength: metadata.result.reduce((total, entry) => total + entry.byteLength, 0) }); };
      transaction.onabort = transaction.onerror = () => { release(); reject(signal.aborted ? aborted() : transaction.error); };
    });
  } finally { database.close(); }
}

function deleteOwnDatabase(dbName) {
  check(dbName.startsWith(DATABASE_PREFIX) && /^[\da-f-]{36}$/.test(dbName.slice(DATABASE_PREFIX.length)), 'Refusing to delete a database outside the random test namespace.');
  return new Promise((resolve) => {
    let blocked = false, completed = false;
    const finish = (result) => { if (completed) return; completed = true; clearTimeout(timer); resolve({ ...result, blocked }); };
    const request = indexedDB.deleteDatabase(dbName);
    const timer = setTimeout(() => finish({ status: 'fail', error: { name: 'TimeoutError', message: 'Random test database deletion did not complete within 3 seconds.' } }), 3000);
    request.onblocked = () => { blocked = true; };
    request.onerror = () => finish({ status: 'fail', error: errorDetails(request.error ?? new Error('Database deletion failed.')) });
    request.onsuccess = () => finish({ status: 'pass' });
  });
}

/** Browser-owned probe. Its random DB is isolated from every app cache. */
export async function runPoliticalIdRasterStorageChecks() {
  const stores = new Set();
  const report = { schemaVersion: 1, status: 'pass', checks: [],
    realIndexedDB: { available: typeof globalThis.indexedDB?.open === 'function', dbName: null },
    cleanup: { status: 'skipped', reason: 'No test database was created.' } };
  let dbName;
  const retain = (options) => { const store = createPoliticalIdRasterAssetStore(options); stores.add(store); return store; };
  async function run(name, kind, action) {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const evidence = await action(controller.signal);
      report.checks.push({ name, kind, status: 'pass', durationMs: performance.now() - started, ...evidence });
    } catch (error) {
      report.checks.push({ name, kind, status: 'fail', durationMs: performance.now() - started, error: errorDetails(error) });
    } finally { clearTimeout(timeout); }
  }
  const identityA = 'storage:tile:a', identityB = 'storage:tile:b', identityC = 'storage:tile:c';
  const tile = fixture();
  const tileBytes = encodePoliticalIdRasterAsset(tile, { identity: identityA, codeToId: sourceCodes }).byteLength;
  try {
    if (report.realIndexedDB.available && typeof globalThis.crypto?.randomUUID === 'function') {
      dbName = `${DATABASE_PREFIX}${crypto.randomUUID()}`;
      report.realIndexedDB.dbName = dbName;
      let current;
      await run('persist-dispose-reopen-remap', 'real-indexeddb', async (signal) => {
        const first = retain({ dbName, maxBytes: tileBytes * 2, memoryMaxBytes: 0, fetchImpl: null });
        check(await first.save(identityA, tile, { codeToId: sourceCodes, signal }), 'First persistent save failed.');
        check(await first.save(identityB, tile, { codeToId: sourceCodes, signal }), 'Second persistent save failed.');
        const beforeDispose = assertSettled(first);
        check(beforeDispose.memoryBytes === 0 && beforeDispose.saves === 2, 'Probe unexpectedly used encoded memory caching.');
        first.dispose();
        current = retain({ dbName, maxBytes: tileBytes * 2, memoryMaxBytes: 0, fetchImpl: null });
        assertRemapped(await current.load(identityA, { idToCode: targetCodes, signal }));
        const reopened = assertSettled(current);
        check(reopened.indexedDBHits === 1 && reopened.memoryHits === 0, 'Reopened load was not backed by real IndexedDB.');
        return { tileBytes, beforeDispose, reopened };
      });
      await run('persistent-byte-lru-trims-old-tile', 'real-indexeddb', async (signal) => {
        check(current, 'Reopen prerequisite failed.');
        check(await current.save(identityC, tile, { codeToId: sourceCodes, signal }), 'Persistent insertion failed.');
        check(await current.load(identityB, { idToCode: targetCodes, signal }) === null, 'Least recently used tile survived the byte limit.');
        assertRemapped(await current.load(identityA, { idToCode: targetCodes, signal }));
        assertRemapped(await current.load(identityC, { idToCode: targetCodes, signal }));
        const inventory = await databaseInventory(dbName, signal);
        check(inventory.byteLength <= tileBytes * 2, 'Persistent metadata exceeds byte budget.');
        check(JSON.stringify(inventory.identities) === JSON.stringify([identityA, identityC]), 'Unexpected persistent tile identities.');
        check(JSON.stringify(inventory.payloadKeys) === JSON.stringify(inventory.identities), 'Payload and LRU metadata stores diverged.');
        return { inventory, stats: assertSettled(current) };
      });
      await run('reopen-with-smaller-byte-budget', 'real-indexeddb', async (signal) => {
        check(current, 'Reopen prerequisite failed.');
        current.dispose();
        const smaller = retain({ dbName, maxBytes: tileBytes, memoryMaxBytes: 0, fetchImpl: null });
        assertRemapped(await smaller.load(identityA, { idToCode: targetCodes, signal }));
        check(await smaller.load(identityC, { idToCode: targetCodes, signal }) === null, 'Smaller reopened budget retained an old tile.');
        const inventory = await databaseInventory(dbName, signal);
        check(inventory.byteLength === tileBytes && inventory.identities.length === 1 && inventory.identities[0] === identityA, 'Smaller byte budget failed to prune database.');
        return { inventory, stats: assertSettled(smaller) };
      });
    } else {
      report.checks.push({ name: 'real-indexeddb-availability', kind: 'real-indexeddb', status: 'skipped',
        reason: 'Global indexedDB or crypto.randomUUID is unavailable; real persistence was not tested.' });
    }

    // These deliberate failures prove recovery semantics, never real browser quota
    // exhaustion or a real blocked version upgrade. Reports preserve that distinction.
    for (const [name, errorName, message] of [
      ['quota-failure-memory-fallback', 'QuotaExceededError', 'Injected quota exhaustion.'],
      ['blocked-failure-memory-fallback', 'Error', 'Injected database open blocked.'],
    ]) await run(name, 'injected-backend', async (signal) => {
      const failure = new Error(message); failure.name = errorName;
      const store = retain({ indexedDB: null, fetchImpl: null, maxBytes: tileBytes * 2, memoryMaxBytes: tileBytes,
        backend: { read: async () => { throw failure; }, writeBounded: async () => { throw failure; } } });
      check(await store.save(identityA, tile, { codeToId: sourceCodes, signal }), 'Memory fallback did not retain valid tile.');
      assertRemapped(await store.load(identityA, { idToCode: targetCodes, signal }));
      check(await store.load(identityB, { idToCode: targetCodes, signal }) === null, 'Failed uncached load must return null.');
      const stats = assertSettled(store);
      check(stats.memoryHits === 1 && stats.failures === 2 && stats.lastError.name === errorName, 'Failure diagnostics or fallback hit count differ.');
      return { simulated: true, stats };
    });
  } catch (error) {
    report.checks.push({ name: 'probe-setup', kind: 'probe', status: 'fail', error: errorDetails(error) });
  } finally {
    for (const store of stores) store.dispose();
    report.disposedStores = stores.size;
    report.pendingAfterDispose = [...stores].map((store) => store.stats()).map(({ pendingReads, pendingWrites, pendingBytes, memoryBytes }) => ({ pendingReads, pendingWrites, pendingBytes, memoryBytes }));
    if (dbName) {
      try { report.cleanup = { dbName, ...await deleteOwnDatabase(dbName) }; }
      catch (error) { report.cleanup = { dbName, status: 'fail', error: errorDetails(error) }; }
    }
  }
  if (report.checks.some((entry) => entry.status === 'fail') || report.cleanup.status === 'fail'
    || report.pendingAfterDispose.some((stats) => Object.values(stats).some((value) => value !== 0))) report.status = 'fail';
  else if (report.checks.some((entry) => entry.status === 'skipped')) report.status = 'partial';
  return report;
}
