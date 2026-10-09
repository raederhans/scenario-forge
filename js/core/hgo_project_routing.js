// This bridge knows only the project envelope and the destination URL. It never
// imports the native editor, dataset, renderer, or state.
const DATABASE = "scenario-forge-editor-handoff-v1";
const STORE = "projects";
const LIFETIME = 15 * 60 * 1000;

export function projectEditor(payload) {
  if (payload?.format === "scenario-forge-hgo") return "hgo";
  if (payload?.scenario?.id === "hgo_1936") return "retired-hgo";
  return "main";
}

export async function routeHgoProject(payload, {
  entryUrl = globalThis.document?.getElementById("hgoEditorLink")?.href,
  location = globalThis.location,
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  now = Date.now(),
} = {}) {
  if (projectEditor(payload) === "retired-hgo") {
    throw new Error("旧 HGO 共底项目无法转换为原生像素项目。请保留原文件，在 HGO 独立编辑器中创建新项目。 / Legacy HGO projects use a different map and cannot be converted.");
  }
  if (projectEditor(payload) !== "hgo") return null;
  if (payload.schemaVersion !== 1 || payload.coordinateSpace !== "hgo-pixel" || !payload.dataset?.id || !payload.dataset?.revision) {
    throw new Error("Unsupported HGO project envelope");
  }
  if (!entryUrl || !indexedDB) throw new Error("HGO handoff is unavailable; open this file from the HGO editor.");
  const target = new URL(entryUrl, location.href);
  if (target.origin !== new URL(location.href).origin) throw new Error("HGO entry must use the same origin");
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).byteLength > 16 * 1024 * 1024) throw new Error("HGO project exceeds 16 MiB");
  const token = crypto.randomUUID();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("HGO handoff storage is busy"));
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) { if (item.value.expiresAt < now) item.delete(); item.continue(); }
      };
      store.put({payload, expiresAt: now + LIFETIME}, token);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("HGO handoff cancelled"));
    });
  } finally { db.close(); }
  target.searchParams.set("handoff", token);
  // The normal beforeunload guard still protects the current main document.
  location.assign(target.href);
  return {status: "redirected", editor: "hgo"};
}
