import { state } from "./state.js";
import { subscribeChanges } from "./state/changes.js";
import { callRuntimeHook } from "./state/index.js";
import { markDirty } from "./dirty_state.js";
import { FileManager } from "./file_manager.js";
import { t } from "./i18n.js";
import { importProjectThroughFunnel } from "./interaction_funnel.js";
import { getScenarioDisplayName } from "./scenario/bundle_loader.js";

const STORE = "snapshots";
const WEEK = 7 * 24 * 60 * 60 * 1000;

async function transact(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("scenario-forge-autosave", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "scenarioId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error("Autosave storage is busy"));
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const indexedStorage = {
  put: record => transact("readwrite", store => store.put(record)),
  remove: id => transact("readwrite", store => store.delete(id)),
  edit: visit => transact("readwrite", store => {
    const request = store.getAll();
    request.onsuccess = () => visit(request.result, store);
    return request;
  }),
};

export function startAutosave({
  storage = indexedStorage,
  page = document,
  timers = globalThis,
  dialog = (options) => Promise.resolve(callRuntimeHook(state, "showAppDialogFn", options) ?? false),
  importProject = importProjectThroughFunnel,
  onHistoryChange = () => {},
} = {}) {
  let timer;
  let idle;
  let recoveryPromptShown = false;
  let pending = Promise.resolve();

  function useStorage(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  function cancelScheduled() {
    timers.clearTimeout(timer);
    if (idle != null) timers.cancelIdleCallback(idle);
    idle = null;
  }

  function buildRecord(type) {
    const scenarioId = state.activeScenarioId || "";
    const payload = new Blob([JSON.stringify(FileManager.buildProjectPayload(state))]);
    return {
      scenarioId, type, payload, savedAt: Date.now(), projectFileStem: state.projectFileStem,
      projectName: state.projectName || "",
      scenarioName: getScenarioDisplayName(state.activeScenarioManifest, scenarioId, t) || t("No scenario active", "ui"),
    };
  }

  function save() {
    if (!state.isDirty) return;
    const record = buildRecord("auto");
    if (record.payload.size > 64 * 1024 * 1024) return;
    return useStorage(() => storage.put(record)).then(onHistoryChange, () => {});
  }

  function saveSnapshot(note) {
    const record = { ...buildRecord("manual"), scenarioId: `manual@${crypto.randomUUID()}`, note };
    return useStorage(() => storage.edit((records, store) => {
      store.put(record);
      const previous = records.filter(item => item.type === "manual").sort((a, b) => b.savedAt - a.savedAt);
      for (const old of previous.slice(19)) store.delete(old.scenarioId);
    })).then(onHistoryChange);
  }

  function schedule() {
    timer = timers.setTimeout(() => {
      if (timers.requestIdleCallback) idle = timers.requestIdleCallback(save, { timeout: 1000 });
      else save();
    }, 30_000);
  }

  const unsubscribe = subscribeChanges(({ domains, dirtyReason }) => {
    if (!domains.includes("dirty") || dirtyReason === undefined) return;
    cancelScheduled();
    if (state.isDirty) schedule();
    else if (dirtyReason === "project-export") {
      const id = state.activeScenarioId || "";
      useStorage(() => storage.remove(id)).then(onHistoryChange, () => {});
    }
  });
  function onVisibilityChange() {
    if (page.visibilityState !== "hidden" || !state.isDirty) return;
    cancelScheduled();
    save();
  }
  page.addEventListener("visibilitychange", onVisibilityChange);
  if (state.isDirty) schedule();

  async function readRecords() {
    const now = Date.now();
    const history = [];
    await useStorage(() => storage.edit((records, store) => {
      for (const record of records) {
        const type = record.type || (record.deferred ? "deferred" : "auto");
        if (type !== "manual" && now - record.savedAt > WEEK) store.delete(record.scenarioId);
        else history.push({ ...record, type });
      }
    }));
    return history.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function listHistory() {
    const records = await readRecords();
    for (const record of records) {
      if (record.projectName === undefined) {
        record.projectName = JSON.parse(await record.payload.text()).projectName || "";
      }
    }
    return records;
  }

  function deleteSnapshot(record) {
    return useStorage(() => storage.edit((records, store) => {
      if (records.some(item => item.scenarioId === record.scenarioId && item.savedAt === record.savedAt)) {
        store.delete(record.scenarioId);
      }
    })).then(onHistoryChange);
  }

  async function recover(openHistory) {
    const history = await readRecords().catch(() => []);
    const offered = history.filter(record => record.type === "auto");
    if (!offered.length || recoveryPromptShown) return;
    recoveryPromptShown = true;
    const review = await dialog({
      title: t("Unsaved changes", "ui"),
      message: t("Found {count} unsaved projects.", "ui", { count: offered.length }),
      confirmLabel: t("Local history", "ui"),
      cancelLabel: t("Not now", "ui"),
    });
    await useStorage(() => storage.edit((records, store) => {
      for (const item of offered) {
        const current = records.find(record => record.scenarioId === item.scenarioId);
        if (current?.savedAt !== item.savedAt) continue;
        const prefix = `${item.scenarioId}@`;
        store.put({ ...item, type: "deferred", scenarioId: prefix + item.savedAt, deferred: true });
        store.delete(item.scenarioId);
        const previous = records.filter(record => record.deferred &&
          record.scenarioId === prefix + record.savedAt);
        for (const old of previous.sort((a, b) => b.savedAt - a.savedAt).slice(2)) store.delete(old.scenarioId);
      }
    })).then(onHistoryChange, () => {});
    if (review) return openHistory();
  }

  async function restoreSnapshot(record) {
    if (state.isDirty && !await dialog({
      title: t("Unsaved changes", "ui"),
      message: t("You have unsaved changes. Loading a project will replace the current map.", "ui"),
      confirmLabel: t("Discard and Load", "ui"),
      cancelLabel: t("Stay on Current Map", "ui"),
      tone: "warning",
    })) return;
    const outcome = await importProject(null, {
      fileName: record.projectFileStem ? `${record.projectFileStem}.json` : "",
      projectPayload: JSON.parse(await record.payload.text()),
      ui: { t, showAppDialog: dialog, showToast: (...args) => callRuntimeHook(state, "showToastFn", ...args) },
      hooks: { refreshColorState: options => callRuntimeHook(state, "refreshColorStateFn", options) },
    });
    if (["committed", "committed-with-warnings"].includes(outcome.status)) markDirty("autosave-restore");
  }

  return {
    recover, listHistory, saveSnapshot, restoreSnapshot, deleteSnapshot,
    dispose() {
      cancelScheduled();
      unsubscribe();
      page.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
