import { createViewBookmarkStore, VIEW_BOOKMARK_STORAGE_PREFIX } from "../core/view_bookmarks.js";

const copy = language => String(language).startsWith("zh") ? {
  title: "视图书签", close: "关闭视图书签", hint: "仅保存在此浏览器，按剧本分别记录位置和缩放。点击名称返回视图。",
  placeholder: "为当前视图命名", save: "保存当前视图", empty: "此剧本尚无视图书签。", base: "基础地图",
  rename: "改名", remove: "删除", commit: "保存名称", cancel: "取消", saved: "视图已保存。", renamed: "名称已更新。",
  removed: "书签已删除。", restored: "已返回所选视图。", changed: "剧本已变化，请在当前列表重新选择。", busy: "请等待地图加载完成。",
  errors: { name: "请输入 1–80 个字符的名称。", view: "当前视图尚不可保存。", limit: "每个剧本最多保存 50 个书签。",
    missing: "此书签已变化，请重新选择。", storage: "浏览器无法保存或读取书签，请检查本地存储权限和空间。", corrupt: "保存的书签数据无法读取。", scope: "当前地图范围无效。", id: "无法创建书签，请重试。" },
} : {
  title: "View bookmarks", close: "Close view bookmarks", hint: "Saved in this browser, separately for each scenario. Click a name to return to its position and zoom.",
  placeholder: "Name the current view", save: "Save current view", empty: "No bookmarks in this scenario yet.", base: "Base map",
  rename: "Rename", remove: "Delete", commit: "Save name", cancel: "Cancel", saved: "View saved.", renamed: "Name updated.",
  removed: "Bookmark deleted.", restored: "Returned to the selected view.", changed: "The scenario changed. Choose again from the current list.", busy: "Wait for the map to finish loading.",
  errors: { name: "Enter a name of 1–80 characters.", view: "The current view is not ready to save.", limit: "Each scenario can hold up to 50 bookmarks.",
    missing: "That bookmark changed. Choose again.", storage: "This browser cannot read or save bookmarks. Check local storage access and available space.", corrupt: "Saved bookmark data could not be read.", scope: "The current map scope is invalid.", id: "Could not create a bookmark. Try again." },
};

export function initViewBookmarks({ host, getContext, captureView, restoreView, store = createViewBookmarkStore() }) {
  if (!host) return { refresh() {} };
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const make = (tag, className = "", content = "") => {
    const node = doc.createElement(tag); node.className = className; node.textContent = content; return node;
  };
  const trigger = make("button", "zoom-btn view-bookmarks-trigger", "☆");
  trigger.id = "viewBookmarksBtn"; trigger.type = "button";
  trigger.setAttribute("aria-controls", "viewBookmarksPanel");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-haspopup", "dialog");
  const panel = make("section", "view-bookmarks-panel");
  panel.id = "viewBookmarksPanel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-labelledby", "viewBookmarksTitle");
  const header = make("div", "view-bookmarks-header");
  const title = make("h2"); title.id = "viewBookmarksTitle";
  const close = make("button", "btn-secondary", "×"); close.type = "button";
  header.append(title, close);
  const scopeLabel = make("p", "view-bookmarks-scope");
  const hint = make("p", "view-bookmarks-hint");
  const form = make("form", "view-bookmarks-form");
  const name = make("input", "input"); name.id = "viewBookmarkName"; name.type = "text"; name.maxLength = 80;
  const save = make("button", "btn-primary"); save.id = "viewBookmarkSaveBtn"; save.type = "submit";
  form.append(name, save);
  const status = make("p", "view-bookmarks-status"); status.id = "viewBookmarksStatus";
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const list = make("ul", "view-bookmarks-list"); list.id = "viewBookmarksList";
  panel.append(header, scopeLabel, hint, form, status, list);
  host.append(trigger); doc.body.append(panel);
  let context = null;
  let fingerprint = "";
  let text = copy("en");

  function position() {
    if (panel.hidden) return;
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(360, win.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(win.innerWidth - width - 12, bounds.right - width))}px`;
    panel.style.top = `${Math.max(12, bounds.bottom + 8)}px`;
    panel.style.maxHeight = `${Math.max(120, win.innerHeight - bounds.bottom - 24)}px`;
  }
  function closePanel({ focus = false } = {}) {
    panel.hidden = true; trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  }
  function checkScope(expectedScope) {
    const current = getContext();
    if (current.scope !== expectedScope) { refresh({ force: true }); status.textContent = text.changed; return false; }
    if (!current.ready) { refresh(); status.textContent = text.busy; return false; }
    return true;
  }
  function handleResult(result, message) {
    if (!result.ok) { status.textContent = text.errors[result.error] || text.errors.storage; return false; }
    refresh({ force: true }); status.textContent = message; return true;
  }
  function renderList() {
    list.replaceChildren();
    const result = store.list(context.scope);
    if (!result.ok) { status.textContent = text.errors[result.error] || text.errors.storage; return; }
    if (!result.bookmarks.length) { list.append(make("li", "view-bookmarks-empty", text.empty)); return; }
    const expectedScope = context.scope;
    for (const bookmark of result.bookmarks) {
      const row = make("li", "view-bookmark-row"); row.dataset.viewBookmarkId = bookmark.id;
      const go = make("button", "view-bookmark-go", bookmark.name); go.type = "button"; go.disabled = !context.ready;
      go.title = `${bookmark.name} · ${Math.round(bookmark.view.k * 100)}%`;
      go.addEventListener("click", () => {
        if (!checkScope(expectedScope)) return;
        const latest = store.list(expectedScope);
        const current = latest.ok && latest.bookmarks.find(entry => entry.id === bookmark.id);
        if (!current) { handleResult(latest.ok ? { ok: false, error: "missing" } : latest); return; }
        status.textContent = restoreView(current.view) === true ? text.restored : text.errors.view;
      });
      const actions = make("div", "view-bookmark-actions");
      const rename = make("button", "btn-secondary", text.rename); rename.type = "button";
      const remove = make("button", "btn-secondary", text.remove); remove.type = "button";
      const editor = make("form", "view-bookmark-rename"); editor.hidden = true;
      const input = make("input", "input"); input.type = "text"; input.maxLength = 80; input.setAttribute("aria-label", text.rename);
      const commit = make("button", "btn-secondary", text.commit); commit.type = "submit";
      const cancel = make("button", "btn-secondary", text.cancel); cancel.type = "button";
      const cancelRename = () => { editor.hidden = true; actions.hidden = false; go.hidden = false; rename.focus(); };
      rename.addEventListener("click", () => {
        if (!checkScope(expectedScope)) return;
        input.value = bookmark.name; editor.hidden = false; actions.hidden = true; go.hidden = true; input.focus(); input.select();
      });
      editor.addEventListener("submit", event => {
        event.preventDefault();
        if (checkScope(expectedScope) && handleResult(store.rename(expectedScope, bookmark.id, input.value), text.renamed)) {
          Array.from(list.children).find(node => node.dataset.viewBookmarkId === bookmark.id)?.querySelector(".view-bookmark-go")?.focus();
        }
      });
      input.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); cancelRename(); } });
      cancel.addEventListener("click", cancelRename);
      remove.addEventListener("click", () => {
        if (checkScope(expectedScope) && handleResult(store.remove(expectedScope, bookmark.id), text.removed)) name.focus();
      });
      editor.append(input, commit, cancel); actions.append(rename, remove); row.append(go, actions, editor); list.append(row);
    }
  }
  function refresh({ force = false } = {}) {
    const next = getContext();
    const nextFingerprint = JSON.stringify([next.scope, next.language, next.label, next.ready]);
    if (!force && fingerprint === nextFingerprint) return;
    const changedScope = context && context.scope !== next.scope;
    const changedLanguage = context && context.language !== next.language;
    context = next; fingerprint = nextFingerprint; text = copy(next.language);
    trigger.title = text.title; trigger.setAttribute("aria-label", text.title);
    title.textContent = text.title; close.setAttribute("aria-label", text.close);
    scopeLabel.textContent = next.label || text.base; hint.textContent = text.hint;
    name.placeholder = text.placeholder; name.setAttribute("aria-label", text.placeholder);
    save.textContent = text.save; save.disabled = !next.ready;
    if (changedScope) { name.value = ""; status.textContent = ""; }
    if (changedLanguage) status.textContent = "";
    if (!panel.hidden) { renderList(); position(); }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!checkScope(context.scope)) return;
    if (handleResult(store.save(context.scope, name.value, captureView()), text.saved)) { name.value = ""; name.focus(); }
  });
  trigger.addEventListener("click", () => {
    if (!panel.hidden) { closePanel(); return; }
    panel.hidden = false; trigger.setAttribute("aria-expanded", "true"); refresh({ force: true }); name.focus();
  });
  close.addEventListener("click", () => closePanel({ focus: true }));
  panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); closePanel({ focus: true }); } });
  doc.addEventListener("pointerdown", event => { if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) closePanel(); });
  win.addEventListener("resize", position);
  win.addEventListener("storage", event => { if (event.key === null || event.key.startsWith(VIEW_BOOKMARK_STORAGE_PREFIX)) refresh({ force: true }); });
  refresh();
  return { refresh };
}
