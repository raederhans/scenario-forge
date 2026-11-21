const databaseName = "mapcreator-recent-projects";

async function withStore(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("projects", mode);
      const request = operation(transaction.objectStore("projects"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function listRecentProjects() {
  return await withStore("readonly", store => store.get("recent")) || [];
}

export async function updateRecentProjects(previous, entry) {
  const matches = await Promise.all(previous.map(item => entry.handle.isSameEntry(item.handle)));
  return [entry, ...previous.filter((_, index) => !matches[index])].slice(0, 8);
}

export async function rememberProject(entry) {
  return navigator.locks.request(databaseName, async () => {
    const projects = await updateRecentProjects(await listRecentProjects(), entry);
    await withStore("readwrite", store => store.put(projects, "recent"));
    return projects;
  });
}
