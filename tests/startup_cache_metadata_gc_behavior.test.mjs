import test from "node:test";
import assert from "node:assert/strict";

// A metadata-only IndexedDB double: any payload/getAll access fails the test.
function installLegacyDb(t, records) {
  const previousDb = globalThis.indexedDB, previousRange = globalThis.IDBKeyRange;
  const rows = new Map(records.map(row => [row.cacheKey, row]));
  const indexes = new Map([["by_kind", "kind"], ["by_updated_at", "updatedAt"]]);
  const stats = { upgrades: [], keyCursors: 0 };
  const request = value => {
    const req = {};
    queueMicrotask(() => { req.result = value; req.onsuccess?.(); });
    return req;
  };
  const store = {
    indexNames: { contains: name => indexes.has(name) },
    createIndex(name, keyPath) { indexes.set(name, keyPath); stats.upgrades.push(name); },
    count: () => request(rows.size),
    getAll() { throw new Error("Full payload read is forbidden"); },
    delete(key) { rows.delete(key); },
    index(name) {
      assert.ok(indexes.has(name), `missing index ${name}`);
      return {
        getAll() { throw new Error("Index payload read is forbidden"); },
        openKeyCursor(range) {
          stats.keyCursors++;
          const entries = [...rows.values()]
            .filter(row => name === "by_kind" ? typeof row.kind === "string" : row.kind === range.lower[0] && typeof row.updatedAt === "string")
            .map(row => ({ primaryKey: row.cacheKey, key: name === "by_kind" ? row.kind : [row.kind, row.updatedAt] }))
            .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)) || a.primaryKey.localeCompare(b.primaryKey));
          const req = {};
          let position = 0;
          const advance = () => queueMicrotask(() => {
            const entry = entries[position++];
            req.result = entry ? { ...entry, continue: advance, get value() { throw new Error("Cursor payload read is forbidden"); } } : null;
            req.onsuccess?.();
          });
          advance();
          return req;
        },
      };
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction(_name, mode) {
      const tx = { objectStore: () => store };
      if (mode === "readwrite") setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  globalThis.indexedDB = { open(_name, version) {
    assert.equal(version, 2);
    const req = { result: db, transaction: { objectStore: () => store } };
    queueMicrotask(() => { req.onupgradeneeded?.({ oldVersion: 1, newVersion: 2 }); req.onsuccess?.(); });
    return req;
  } };
  t.after(() => { globalThis.indexedDB = previousDb; globalThis.IDBKeyRange = previousRange; });
  return { rows, stats };
}

const kind = "startup-base-topology";
const row = (cacheKey, updatedAt, rowKind = kind) => ({ cacheKey, kind: rowKind, updatedAt,
  get payload() { throw new Error("Payload clone is forbidden"); },
});

test("version 1 populated cache upgrades and GC keeps newest entries without reading payloads", async t => {
  const { rows, stats } = installLegacyDb(t, [row("middle", "2026-09-02"), row("old", "2026-09-01"), row("new", "2026-09-03"), row("other", "2026-09-04", "startup-localization")]);
  const { garbageCollectStartupCache } = await import("../js/core/startup_cache.js?metadata-upgrade");
  assert.deepEqual(await garbageCollectStartupCache({ keepKinds: [kind], maxEntriesPerKind: 2 }), { deletedKeys: ["old"] });
  assert.deepEqual([...rows.keys()].sort(), ["middle", "new", "other"]);
  assert.deepEqual(stats.upgrades, ["by_kind_updated_at"]);
  assert.equal(stats.keyCursors, 1);
  assert.deepEqual(await garbageCollectStartupCache({ keepKinds: [kind], maxEntriesPerKind: -2 }), { deletedKeys: ["middle", "new"] });
  assert.deepEqual([...rows.keys()], ["other"]);
});

test("diagnostics retains custom and unindexed legacy kind counts with key cursors only", async t => {
  installLegacyDb(t, [row("a", "2026-09-01"), row("b", "2026-09-02", "legacy-custom"), row("c", "2026-09-03", "legacy-custom"), { cacheKey: "missing" }, row("proto", "2026-09-01", "__proto__")]);
  const { getStartupCacheDiagnostics } = await import("../js/core/startup_cache.js?metadata-diagnostics");
  const result = await getStartupCacheDiagnostics();
  assert.equal(result.entryCount, 5);
  assert.equal(result.kinds[kind], 1);
  assert.equal(result.kinds["legacy-custom"], 2);
  assert.equal(result.kinds.unknown, 1);
  assert.equal(Object.hasOwn(result.kinds, "__proto__"), true);
  assert.equal(result.kinds.__proto__, 1);
  assert.equal(Object.values(result.kinds).reduce((sum, count) => sum + count, 0), result.entryCount);
});
