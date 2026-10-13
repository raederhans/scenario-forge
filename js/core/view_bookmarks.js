export const VIEW_BOOKMARK_STORAGE_PREFIX = "scenario-forge:view-bookmarks:v1:";
export const MAX_VIEW_BOOKMARKS = 50;
const finite = value => typeof value === "number" && Number.isFinite(value);

export function normalizeBookmarkView(view) {
  if (!view || ![view.x, view.y, view.k].every(finite)
    || Math.abs(view.x) > 1000000 || Math.abs(view.y) > 1000000 || view.k < 0.35 || view.k > 50) return null;
  return { x: view.x, y: view.y, k: view.k };
}

export function getViewBookmarkScope({ scenarioId = "", mapMode = "political" } = {}) {
  const id = String(scenarioId || "").trim();
  return id ? `scenario:${id}` : `base:${mapMode === "blank" ? "blank" : "political"}`;
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name && Array.from(name).length <= 80 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : "";
}

/** Browser-local preferences. No canonical map state or editing history is held. */
export function createViewBookmarkStore({ getStorage = () => globalThis.localStorage,
  createId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` } = {}) {
  const fail = error => ({ ok: false, error, bookmarks: [] });
  function read(scope) {
    if (typeof scope !== "string" || !scope || scope.length > 300) return fail("scope");
    try {
      const storage = getStorage();
      if (!storage) return fail("storage");
      const key = VIEW_BOOKMARK_STORAGE_PREFIX + encodeURIComponent(scope);
      const raw = storage.getItem(key);
      if (raw === null) return { ok: true, bookmarks: [], storage, key };
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.bookmarks) || data.bookmarks.length > MAX_VIEW_BOOKMARKS) return fail("corrupt");
      const ids = new Set();
      const bookmarks = [];
      for (const entry of data.bookmarks) {
        const view = normalizeBookmarkView(entry?.view);
        const name = normalizeName(entry?.name);
        if (!view || !name || typeof entry.id !== "string" || !entry.id || entry.id.length > 120 || ids.has(entry.id)) return fail("corrupt");
        ids.add(entry.id);
        bookmarks.push({ id: entry.id, name, view });
      }
      return { ok: true, bookmarks, storage, key };
    } catch { return fail("storage"); }
  }
  function write(current, bookmarks) {
    try {
      current.storage.setItem(current.key, JSON.stringify({ version: 1, bookmarks }));
      return { ok: true, bookmarks };
    } catch { return fail("storage"); }
  }
  function list(scope) {
    const result = read(scope);
    return result.ok ? { ok: true, bookmarks: result.bookmarks } : result;
  }
  function save(scope, name, view) {
    const current = read(scope);
    if (!current.ok) return current;
    const validName = normalizeName(name);
    if (!validName) return fail("name");
    const validView = normalizeBookmarkView(view);
    if (!validView) return fail("view");
    if (current.bookmarks.length >= MAX_VIEW_BOOKMARKS) return fail("limit");
    let id;
    try { id = createId(); } catch { return fail("id"); }
    if (typeof id !== "string" || !id || id.length > 120 || current.bookmarks.some(entry => entry.id === id)) return fail("id");
    return write(current, [...current.bookmarks, { id, name: validName, view: validView }]);
  }
  function rename(scope, id, name) {
    const current = read(scope);
    if (!current.ok) return current;
    const validName = normalizeName(name);
    if (!validName) return fail("name");
    if (!current.bookmarks.some(entry => entry.id === id)) return fail("missing");
    return write(current, current.bookmarks.map(entry => entry.id === id ? { ...entry, name: validName } : entry));
  }
  function remove(scope, id) {
    const current = read(scope);
    if (!current.ok) return current;
    if (!current.bookmarks.some(entry => entry.id === id)) return fail("missing");
    return write(current, current.bookmarks.filter(entry => entry.id !== id));
  }
  return Object.freeze({ list, save, rename, remove });
}
