import {
  addCommunityComment,
  createBackendSave,
  downloadCommunitySave,
  exportBackendSave,
  getBackendAdminSave,
  getBackendAdminOverview,
  getBackendSave,
  getCommunitySave,
  hideBackendComment,
  isLocalBackendRuntimeAvailable,
  listBackendSaves,
  listCommunitySaves,
  loginBackendUser,
  logoutBackendUser,
  publishBackendSave,
  refreshBackendSession,
  registerBackendUser,
  reportCommunitySave,
  reviewBackendReport,
  seedBackendDemoCommunity,
  setBackendSaveComments,
  setBackendSaveImage,
  setBackendSaveVisibility,
  updateBackendUser,
} from "../js/api/backend_client.js";
import {
  escapeAttr,
  escapeHtml,
  formatDate,
  getBackendConsoleDocumentLang,
  getBackendConsoleTitle,
  sampleProjectPayload,
  translateBackendConsole,
} from "./backend_console_helpers.js";

const state = {
  locale: localStorage.getItem("backendConsoleLocale") || "zh",
  view: "community",
  authMode: "login",
  session: null,
  community: [],
  mySaves: [],
  admin: null,
  detailPayload: null,
  detailFilename: "mapcreator-save.json",
};

const $ = (id) => document.getElementById(id);
const el = {
  languageToggle: $("languageToggle"),
  sessionDot: $("sessionDot"),
  sessionLabel: $("sessionLabel"),
  openLogin: $("openLoginBtn"),
  openRegister: $("openRegisterBtn"),
  logout: $("logoutBtn"),
  authDialog: $("authDialog"),
  authTitle: $("authTitle"),
  displayNameField: $("displayNameField"),
  authSubmit: $("authSubmitBtn"),
  username: $("usernameInput"),
  password: $("passwordInput"),
  displayName: $("displayNameInput"),
  communityFeed: $("communityFeed"),
  refreshCommunity: $("refreshCommunityBtn"),
  seedDemo: $("seedDemoBtn"),
  accountGate: $("accountGate"),
  accountContent: $("accountContent"),
  createSample: $("createSampleBtn"),
  manualSaveForm: $("manualSaveForm"),
  saveTitle: $("saveTitleInput"),
  saveDescription: $("saveDescriptionInput"),
  saveImage: $("saveImageInput"),
  mySavesList: $("mySavesList"),
  adminGate: $("adminGate"),
  adminContent: $("adminContent"),
  metricGrid: $("metricGrid"),
  refreshAdmin: $("refreshAdminBtn"),
  adminSavesList: $("adminSavesList"),
  commentsList: $("commentsList"),
  usersList: $("usersList"),
  reportsList: $("reportsList"),
  activityList: $("activityList"),
  detailDialog: $("detailDialog"),
  detailImage: $("detailImage"),
  detailTitle: $("detailTitle"),
  detailMeta: $("detailMeta"),
  detailPayload: $("detailPayload"),
  closeDetail: $("closeDetailBtn"),
  downloadDetail: $("downloadDetailBtn"),
  toast: $("toast"),
};

function t(key, vars = {}) {
  return translateBackendConsole(state.locale, key, vars);
}

function renderStaticText() {
  document.documentElement.lang = getBackendConsoleDocumentLang(state.locale);
  document.title = getBackendConsoleTitle(state.locale);
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  el.languageToggle.textContent = t("languageButton");
  document.querySelectorAll(".dialog-close").forEach((button) => {
    button.setAttribute("aria-label", state.locale === "zh" ? "关闭" : "Close");
  });
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  renderGates();
}

function setAdminTab(tab) {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    const active = panel.dataset.adminPanel === tab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function bindTablistKeyboard(selector, attribute, onSelect) {
  const buttons = Array.from(document.querySelectorAll(selector));
  buttons.forEach((button) => {
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const candidates = buttons.filter((item) => !item.hidden && !item.disabled);
      const index = candidates.indexOf(button);
      if (index < 0 || !candidates.length) return;
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End" ? candidates.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + candidates.length) % candidates.length;
      const next = candidates[nextIndex];
      next.focus();
      onSelect(next.getAttribute(attribute));
    });
  });
}

function renderSession() {
  const user = state.session?.user;
  el.sessionDot.classList.toggle("online", Boolean(user));
  el.sessionLabel.textContent = user
    ? `${user.displayName || user.username} (${t(user.role || "member")})`
    : t("loggedOut");
  el.openLogin.hidden = Boolean(user);
  el.openRegister.hidden = Boolean(user);
  el.logout.hidden = !user;
}

function renderGates() {
  const user = state.session?.user;
  const staff = ["admin", "moderator"].includes(user?.role);
  el.accountGate.hidden = Boolean(user);
  el.accountContent.hidden = !user;
  el.adminGate.hidden = staff;
  el.adminContent.hidden = !staff;
  el.seedDemo.hidden = user?.role !== "admin";
  document.querySelectorAll("[data-admin-only]").forEach((node) => {
    node.hidden = user?.role !== "admin";
  });
  if (user?.role !== "admin" && document.querySelector("[data-admin-tab='users']")?.classList.contains("active")) {
    setAdminTab("activity");
  }
}

function renderCommunity() {
  el.communityFeed.replaceChildren();
  if (!state.community.length) {
    el.communityFeed.appendChild(emptyCard(t("noCommunity")));
    return;
  }
  state.community.forEach((post) => el.communityFeed.appendChild(postCard(post)));
}

function postCard(post) {
  const node = document.createElement("article");
  node.className = "post-card";
  const imageStyle = post.imageUrl ? `style="background-image:url('${escapeAttr(post.imageUrl)}')"` : "";
  node.innerHTML = `
    <div class="post-image" ${imageStyle}></div>
    <div class="post-body">
      <p class="post-title">${escapeHtml(post.title)}</p>
      <p class="post-meta">${t("by")} ${escapeHtml(post.owner?.displayName || post.owner?.username || t("unknown"))} · ${formatDate(post.publishedAt || post.updatedAt)}</p>
      <p>${escapeHtml(post.description || "")}</p>
      <p class="post-meta">${post.commentCount || 0} ${t("comments")} · ${post.openReportCount || 0} ${t("reports")} · ${post.commentsEnabled ? t("commentsOpen") : t("commentsClosed")}</p>
      <div class="item-actions">
        <button data-action="community-detail" data-id="${escapeAttr(post.id)}">${t("detail")}</button>
        <button data-action="community-download" data-id="${escapeAttr(post.id)}">${t("download")}</button>
        <button data-action="community-comment" data-id="${escapeAttr(post.id)}">${t("comment")}</button>
        <button data-action="community-report" data-id="${escapeAttr(post.id)}">${t("report")}</button>
      </div>
    </div>
  `;
  return node;
}

function renderMySaves() {
  el.mySavesList.replaceChildren();
  if (!state.mySaves.length) {
    el.mySavesList.appendChild(emptyItem(t("noSaves")));
    return;
  }
  state.mySaves.forEach((save) => {
    el.mySavesList.appendChild(listItem({
      title: save.title,
      meta: `${t(save.visibility)} · ${formatDate(save.updatedAt)}`,
      body: save.description,
      pill: t(save.visibility),
      actions: [
        ["preview-save", save.id, t("detail")],
        ["export-save", save.id, t("export")],
        ["publish-save", save.id, t("publish")],
      ],
    }));
  });
}

function renderAdmin() {
  const stats = state.admin?.stats || {};
  [...el.metricGrid.querySelectorAll("strong")].forEach((node, index) => {
    const values = [stats.users, stats.saves, stats.publicSaves, stats.openReports, stats.comments, stats.bannedUsers];
    node.textContent = String(values[index] ?? "-");
  });
  renderAdminActivity();
  renderAdminSaves();
  renderAdminComments();
  renderAdminUsers();
  renderAdminReports();
}

function renderAdminActivity() {
  fillList(el.activityList, state.admin?.activity, (item) => listItem({
    title: `${t(item.type)} · ${item.label}`,
    meta: `${item.actor} · ${formatDate(item.createdAt)}`,
    body: item.id,
  }));
}

function renderAdminSaves() {
  fillList(el.adminSavesList, state.admin?.saves, (save) => {
    const actions = [
      ["admin-toggle-visibility", save.id, save.visibility === "public" ? t("makePrivate") : t("makePublic"), save.visibility === "public" ? "private" : "public"],
      ["admin-toggle-comments", save.id, save.commentsEnabled ? t("closeComments") : t("openComments"), String(!save.commentsEnabled)],
      ["admin-clear-image", save.id, t("clearImage")],
      ["admin-preview-save", save.id, t("detail")],
    ];
    return listItem({
      title: save.title,
      meta: `${save.owner?.displayName || save.owner?.username || t("unknown")} · ${save.commentCount || 0} ${t("comments")} · ${save.openReportCount || 0} ${t("reports")}`,
      body: save.description || save.imageUrl || "",
      pill: `${t(save.visibility)} · ${save.commentsEnabled ? t("commentsOpen") : t("commentsClosed")}`,
      actions,
    });
  });
}

function renderAdminComments() {
  fillList(el.commentsList, state.admin?.comments, (comment) => listItem({
    title: comment.save?.title || comment.saveId,
    meta: `${comment.author?.displayName || comment.author?.username || t("unknown")} · ${formatDate(comment.createdAt)} · ${t(comment.status)}`,
    body: comment.body,
    pill: t(comment.status),
    actions: comment.status === "visible" ? [["admin-hide-comment", comment.id, t("hideComment")]] : [],
  }));
}

function renderAdminUsers() {
  fillList(el.usersList, state.admin?.users, (user) => listItem({
    title: `${user.displayName} @${user.username}`,
    meta: `${t(user.role)} · ${t(user.status)} · ${user.saveCount} ${t("metricSaves")}`,
    body: user.id,
    pill: `${t(user.role)} · ${t(user.status)}`,
    actions: [
      ["admin-user-status", user.id, user.status === "banned" ? t("unbanUser") : t("banUser"), user.status === "banned" ? "active" : "banned"],
      ["admin-user-role", user.id, t("promoteModerator"), "moderator"],
      ["admin-user-role", user.id, t("promoteAdmin"), "admin"],
      ["admin-user-role", user.id, t("demoteMember"), "member"],
    ],
  }));
}

function renderAdminReports() {
  fillList(el.reportsList, state.admin?.reports, (report) => listItem({
    title: `${report.reason} · ${report.save?.title || report.saveId}`,
    meta: `${report.reporter?.displayName || report.reporter?.username || t("unknown")} · ${formatDate(report.createdAt)}`,
    body: report.details,
    pill: t(report.status),
    actions: report.status === "open" ? [["review-report", report.id, t("reviewReport")]] : [],
  }));
}

function fillList(container, items, renderer) {
  container.replaceChildren();
  if (!items || !items.length) {
    container.appendChild(emptyItem(t("noItems")));
    return;
  }
  items.forEach((item) => container.appendChild(renderer(item)));
}

function listItem({ title, meta = "", body = "", pill = "", actions = [] }) {
  const node = document.createElement("article");
  node.className = "list-item";
  node.innerHTML = `
    <div class="list-head">
      <div>
        <p class="item-title">${escapeHtml(title)}</p>
        <p class="item-meta">${escapeHtml(meta)}</p>
      </div>
      ${pill ? `<span class="pill ${escapeAttr(String(pill).toLowerCase())}">${escapeHtml(pill)}</span>` : ""}
    </div>
    ${body ? `<p class="body-muted">${escapeHtml(body)}</p>` : ""}
    <div class="item-actions">
      ${actions.map(([action, id, label, value = ""]) => `<button data-action="${escapeAttr(action)}" data-id="${escapeAttr(id)}" data-value="${escapeAttr(value)}">${escapeHtml(label)}</button>`).join("")}
    </div>
  `;
  return node;
}

function emptyCard(message) {
  const node = document.createElement("article");
  node.className = "post-card";
  node.innerHTML = `<div class="post-image"></div><div class="post-body"><p class="post-title">${escapeHtml(message)}</p></div>`;
  return node;
}

function emptyItem(message) {
  const node = document.createElement("article");
  node.className = "list-item";
  node.innerHTML = `<p class="body-muted">${escapeHtml(message)}</p>`;
  return node;
}

async function refreshSession() {
  try {
    state.session = await refreshBackendSession();
  } catch {
    state.session = null;
  }
  renderSession();
  renderGates();
}

async function refreshCommunity() {
  const payload = await listCommunitySaves();
  state.community = payload.saves || [];
  renderCommunity();
}

async function refreshMySaves() {
  if (!state.session?.user) {
    state.mySaves = [];
    renderMySaves();
    return;
  }
  const payload = await listBackendSaves();
  state.mySaves = payload.saves || [];
  renderMySaves();
}

async function refreshAdmin() {
  if (!["admin", "moderator"].includes(state.session?.user?.role)) {
    state.admin = null;
    renderAdmin();
    return;
  }
  state.admin = await getBackendAdminOverview();
  renderAdmin();
}

async function refreshAll() {
  await refreshSession();
  await refreshCommunity().catch(() => {});
  await refreshMySaves().catch(() => {});
  await refreshAdmin().catch(() => {});
}

async function createDraft(event) {
  event.preventDefault();
  const payload = await createBackendSave({
    title: el.saveTitle.value.trim() || "新的地图存档",
    description: el.saveDescription.value.trim(),
    imageUrl: el.saveImage.value.trim(),
    project: sampleProjectPayload("manual"),
  });
  showToast(t("saved"));
  showDetail(payload.save.title, payload, `mapcreator-save-${payload.save.id.slice(0, 8)}.json`, payload.save.imageUrl);
  await refreshAll();
}

async function runAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id, value } = button.dataset;
  try {
    if (action === "community-detail") {
      const payload = await getCommunitySave(id);
      showDetail(payload.save.title, payload, `community-save-${id.slice(0, 8)}.json`, payload.save.imageUrl);
    } else if (action === "community-download") {
      const payload = await downloadCommunitySave(id);
      showDetail(payload.save.title, payload, payload.filename, payload.save.imageUrl);
      downloadJson(payload.filename, payload.save);
    } else if (action === "community-comment") {
      requireLogin();
      await addCommunityComment(id, state.locale === "zh" ? "我看过这个存档。" : "I reviewed this save.");
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "community-report") {
      requireLogin();
      await reportCommunitySave(id, "other", state.locale === "zh" ? "需要管理员检查。" : "Needs admin review.");
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "preview-save") {
      const payload = await getBackendSave(id);
      showDetail(payload.save.title, payload, `mapcreator-save-${id.slice(0, 8)}.json`, payload.save.imageUrl);
    } else if (action === "admin-preview-save") {
      const payload = await getBackendAdminSave(id);
      showDetail(payload.save.title, payload, `admin-save-${id.slice(0, 8)}.json`, payload.save.imageUrl);
    } else if (action === "export-save") {
      const payload = await exportBackendSave(id);
      showDetail(payload.save.title, payload, payload.filename, payload.save.imageUrl);
      downloadJson(payload.filename, payload.save);
    } else if (action === "publish-save") {
      await publishBackendSave(id);
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "review-report") {
      await reviewBackendReport(id);
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "admin-toggle-visibility") {
      await setBackendSaveVisibility(id, value);
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "admin-toggle-comments") {
      await setBackendSaveComments(id, value === "true");
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "admin-clear-image") {
      await setBackendSaveImage(id, "");
      showToast(t("imageManaged"));
      await refreshAll();
    } else if (action === "admin-hide-comment") {
      await hideBackendComment(id);
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "admin-user-status") {
      await updateBackendUser(id, { status: value });
      showToast(t("actionDone"));
      await refreshAll();
    } else if (action === "admin-user-role") {
      await updateBackendUser(id, { role: value });
      showToast(t("actionDone"));
      await refreshAll();
    }
  } catch (error) {
    showToast(error.message || t("actionDone"));
  }
}

function showDetail(title, payload, filename, imageUrl = "") {
  state.detailPayload = payload;
  state.detailFilename = filename;
  el.detailTitle.textContent = title;
  el.detailMeta.textContent = filename;
  el.detailPayload.textContent = JSON.stringify(payload, null, 2);
  el.detailImage.style.backgroundImage = imageUrl ? `url('${imageUrl}')` : "";
  el.detailDialog.showModal();
}

function downloadJson(filename, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function requireLogin() {
  if (!state.session?.user) {
    openAuth("login");
    throw new Error(t("loginRequired"));
  }
}

function openAuth(mode) {
  state.authMode = mode;
  el.authTitle.textContent = t(mode);
  el.authSubmit.textContent = t(mode);
  el.displayNameField.hidden = mode !== "register";
  el.authDialog.showModal();
}

function bindEvents() {
  el.languageToggle.addEventListener("click", () => {
    state.locale = state.locale === "zh" ? "en" : "zh";
    localStorage.setItem("backendConsoleLocale", state.locale);
    renderStaticText();
    renderSession();
    renderCommunity();
    renderMySaves();
    renderAdmin();
  });
  document.querySelector(".mode-nav").addEventListener("click", (event) => {
    const target = event.target.closest("[data-view]");
    if (target) setView(target.dataset.view);
  });
  document.querySelector(".admin-tabs").addEventListener("click", (event) => {
    const target = event.target.closest("[data-admin-tab]");
    if (target) setAdminTab(target.dataset.adminTab);
  });
  bindTablistKeyboard("[data-view]", "data-view", setView);
  bindTablistKeyboard("[data-admin-tab]", "data-admin-tab", setAdminTab);
  el.openLogin.addEventListener("click", () => openAuth("login"));
  el.openRegister.addEventListener("click", () => openAuth("register"));
  el.authSubmit.addEventListener("click", async (event) => {
    event.preventDefault();
    if (state.authMode === "register") {
      state.session = await registerBackendUser({
        username: el.username.value.trim(),
        password: el.password.value,
        displayName: el.displayName.value.trim(),
      });
      showToast(t("registered"));
    } else {
      state.session = await loginBackendUser({
        username: el.username.value.trim(),
        password: el.password.value,
      });
      showToast(t("loggedIn"));
    }
    el.authDialog.close();
    await refreshAll();
  });
  el.logout.addEventListener("click", async () => {
    await logoutBackendUser().catch(() => {});
    state.session = null;
    state.mySaves = [];
    state.admin = null;
    showToast(t("loggedOutToast"));
    await refreshAll();
  });
  el.refreshCommunity.addEventListener("click", refreshCommunity);
  el.refreshAdmin.addEventListener("click", refreshAdmin);
  el.seedDemo.addEventListener("click", async () => {
    if (!state.session?.user) {
      openAuth("login");
      return;
    }
    await seedBackendDemoCommunity();
    showToast(t("demoSeeded"));
    await refreshAll();
  });
  el.createSample.addEventListener("click", async () => {
    const payload = await createBackendSave({
      title: state.locale === "zh" ? "我的示例存档" : "My sample save",
      description: state.locale === "zh" ? "用户中心创建的私有草稿。" : "Private draft created from user center.",
      imageUrl: "/backend/assets/demo-plains.svg",
      project: sampleProjectPayload("sample"),
    });
    showDetail(payload.save.title, payload, `mapcreator-save-${payload.save.id.slice(0, 8)}.json`, payload.save.imageUrl);
    await refreshAll();
  });
  el.manualSaveForm.addEventListener("submit", createDraft);
  el.downloadDetail.addEventListener("click", () => {
    if (state.detailPayload) downloadJson(state.detailFilename, state.detailPayload);
  });
  el.closeDetail.addEventListener("click", () => el.detailDialog.close());
  document.body.addEventListener("click", runAction);
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove("visible"), 2600);
}

async function boot() {
  renderStaticText();
  setView(state.view);
  setAdminTab("activity");
  bindEvents();
  if (!isLocalBackendRuntimeAvailable()) {
    showToast(t("backendUnavailable"));
    return;
  }
  await refreshAll();
}

boot();
