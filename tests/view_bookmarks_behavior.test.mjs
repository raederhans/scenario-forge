import assert from "node:assert/strict";
import test from "node:test";
import {
  createViewBookmarkStore,
  getViewBookmarkScope, MAX_VIEW_BOOKMARKS, VIEW_BOOKMARK_STORAGE_PREFIX,
} from "../js/core/view_bookmarks.js";

function harness() {
  const data = new Map();
  let writes = 0;
  let nextId = 0;
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes++; data.set(key, value); } };
  const store = () => createViewBookmarkStore({ getStorage: () => storage, createId: () => `bookmark-${++nextId}` });
  return { data, storage, store, writes: () => writes };
}
const view = Object.freeze({ x: 0.5, y: -0.2, k: 4 });
const scope = "scenario:hoi4_1936";

test("scenario and base map scopes persist separately when a store is reopened", () => {
  const h = harness();
  const scopes = [scope, getViewBookmarkScope({ scenarioId: "hoi4_1939" }), getViewBookmarkScope(), getViewBookmarkScope({ mapMode: "blank" })];
  assert.equal(new Set(scopes).size, 4);
  for (const [index, current] of scopes.entries()) assert.equal(h.store().save(current, `View ${index}`, view).ok, true);
  for (const [index, current] of scopes.entries()) assert.deepEqual(h.store().list(current).bookmarks.map(entry => entry.name), [`View ${index}`]);
  assert.equal(h.data.size, 4);
  assert.ok([...h.data.keys()].every(key => key.startsWith(VIEW_BOOKMARK_STORAGE_PREFIX)));
});

test("rename and delete persist only the selected bookmark in its scenario", () => {
  const h = harness(); const store = h.store();
  const first = store.save(scope, "  北京视图  ", view).bookmarks[0];
  store.save(scope, "Another", { ...view, k: 2 });
  store.save("scenario:other", "Keep", view);
  assert.equal(store.rename(scope, first.id, "北京 / 东亚").ok, true);
  assert.deepEqual(h.store().list(scope).bookmarks.map(entry => entry.name), ["北京 / 东亚", "Another"]);
  assert.equal(store.remove(scope, first.id).ok, true);
  assert.deepEqual(h.store().list(scope).bookmarks.map(entry => entry.name), ["Another"]);
  assert.equal(h.store().list("scenario:other").bookmarks[0].name, "Keep");
  assert.equal(store.rename(scope, first.id, "Missing").error, "missing");
  assert.equal(store.remove(scope, first.id).error, "missing");
});

test("stored views are scalar copies without caller or returned-object aliasing", () => {
  const h = harness(); const store = h.store(); const input = { ...view, territory: { owner: "keep" } };
  const saved = store.save(scope, "View", input);
  input.x = 100; input.territory.owner = "changed";
  saved.bookmarks[0].view.k = 40;
  const listed = store.list(scope); listed.bookmarks[0].name = "Changed";
  assert.deepEqual(store.list(scope).bookmarks[0], { id: "bookmark-1", name: "View", view });
  assert.deepEqual(Object.keys(JSON.parse([...h.data.values()][0])), ["version", "bookmarks"]);
});

test("invalid values and capacity reject without changing persistent data", () => {
  const h = harness(); const store = h.store();
  for (const invalid of [null, { ...view, x: NaN }, { ...view, k: 0 }, { ...view, k: 51 }, { ...view, y: Infinity }]) {
    assert.equal(store.save(scope, "View", invalid).error, "view");
  }
  for (const name of ["  ", "a".repeat(81), "line\nbreak", null]) assert.equal(store.save(scope, name, view).error, "name");
  assert.equal(h.writes(), 0);
  for (let i = 0; i < MAX_VIEW_BOOKMARKS; i++) assert.equal(store.save(scope, `View ${i}`, view).ok, true);
  const persisted = [...h.data.values()][0];
  assert.equal(store.save(scope, "Overflow", view).error, "limit");
  assert.equal([...h.data.values()][0], persisted);
});

test("blocked storage never reports an in-memory save as persistent success", () => {
  const blocked = createViewBookmarkStore({ getStorage: () => { throw new Error("blocked"); } });
  assert.equal(blocked.list(scope).error, "storage");
  assert.equal(blocked.save(scope, "View", view).ok, false);
  const h = harness(); const store = h.store();
  h.storage.setItem = () => { throw new Error("quota"); };
  assert.equal(store.save(scope, "View", view).error, "storage");
  assert.deepEqual(store.list(scope).bookmarks, []);
});

test("corrupt or newer bookmark data is preserved and not overwritten", () => {
  const h = harness(); const key = VIEW_BOOKMARK_STORAGE_PREFIX + encodeURIComponent(scope);
  for (const raw of ['{"version":2,"bookmarks":[]}', '{"version":1,"bookmarks":[{}]}', "not json"]) {
    h.data.set(key, raw);
    assert.equal(h.store().list(scope).ok, false);
    assert.equal(h.store().save(scope, "View", view).ok, false);
    assert.equal(h.data.get(key), raw);
  }
  assert.equal(h.writes(), 0);
});

test("multiple instances read fresh storage before each change", () => {
  const h = harness(); const a = h.store(); const b = h.store();
  const first = a.save(scope, "First", view).bookmarks[0];
  b.save(scope, "Second", view);
  a.rename(scope, first.id, "Renamed");
  assert.deepEqual(b.list(scope).bookmarks.map(entry => entry.name), ["Renamed", "Second"]);
  b.remove(scope, first.id);
  assert.deepEqual(a.list(scope).bookmarks.map(entry => entry.name), ["Second"]);
});
