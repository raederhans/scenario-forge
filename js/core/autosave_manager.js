import { state } from "./state.js";
import { subscribeChanges } from "./state/changes.js";
import { callRuntimeHook } from "./state/index.js";
import { markDirty } from "./dirty_state.js";
import { FileManager } from "./file_manager.js";
import { t } from "./i18n.js";
import { importProjectThroughFunnel } from "./interaction_funnel.js";
import { getScenarioDisplayName } from "./scenario/bundle_loader.js";
import { showAppDialog } from "../ui/components/app_dialog.js";

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
  list: () => transact("readonly", store => store.getAll()),
};

export function startAutosave({
  storage = indexedStorage,
  page = document,
  timers = globalThis,
  dialog = showAppDialog,
  importProject = importProjectThroughFunnel,
} = {}) {
  let timer;
  let idle;
  let recoveryPromptShown = false;
  let pending = Promise.resolve();

  function useStorage(operation) {
    pending = pending.then(operation).catch(() => undefined);
    return pending;
  }

  function cancelScheduled() {
    timers.clearTimeout(timer);
    if (idle != null) timers.cancelIdleCallback(idle);
    idle = null;
  }

  function save() {
    if (!state.isDirty) return;
    const scenarioId = state.activeScenarioId || "";
    const payload = new Blob([JSON.stringify(FileManager.buildProjectPayload(state))]);
    if (payload.size > 64 * 1024 * 1024) return;
    const record = {
      scenarioId, payload, savedAt: Date.now(),
      scenarioName: getScenarioDisplayName(state.activeScenarioManifest, scenarioId, t) || t("No scenario active", "ui"),
    };
    return useStorage(() => storage.put(record));
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
      useStorage(() => storage.remove(id));
    }
  });
  function onVisibilityChange() {
    if (page.visibilityState !== "hidden" || !state.isDirty) return;
    cancelScheduled();
    save();
  }
  page.addEventListener("visibilitychange", onVisibilityChange);
  if (state.isDirty) schedule();

  async function recover() {
    const records = await useStorage(() => storage.list());
    if (!records) return;
    const now = Date.now();
    let newest;
    for (const record of records) {
      if (now - record.savedAt > WEEK) await useStorage(() => storage.remove(record.scenarioId));
      else if (!newest || record.savedAt > newest.savedAt) newest = record;
    }
    if (!newest || recoveryPromptShown) return;
    recoveryPromptShown = true;
    const restore = await dialog({
      title: t("Unsaved changes", "ui"),
      message: t("Found unsaved work from {count} minutes ago ({scenario}).", "ui", {
        count: Math.max(0, Math.floor((now - newest.savedAt) / 60_000)),
        scenario: newest.scenarioName,
      }),
      confirmLabel: t("Restore", "ui"),
      cancelLabel: t("Not now", "ui"),
    });
    if (!restore) return;
    const outcome = await importProject(null, {
      fileName: "autosave.json",
      projectPayload: JSON.parse(await newest.payload.text()),
      ui: { t, showAppDialog: dialog, showToast: (...args) => callRuntimeHook(state, "showToastFn", ...args) },
      hooks: { refreshColorState: options => callRuntimeHook(state, "refreshColorStateFn", options) },
    });
    if (["committed", "committed-with-warnings"].includes(outcome.status)) markDirty("autosave-restore");
  }

  return {
    recover,
    dispose() {
      cancelScheduled();
      unsubscribe();
      page.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
