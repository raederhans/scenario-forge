// One-time same-origin document handoff. This is the entire shared protocol;
// neither editor imports the other's runtime.
export async function consumeHandoff(token, accept, {indexedDB=globalThis.indexedDB, now=Date.now()}={}) {
  if (!token) return false;
  if (!/^[a-f0-9-]{36}$/i.test(token)) throw new Error('Invalid HGO handoff token');
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('scenario-forge-editor-handoff-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('projects');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('HGO handoff storage is busy'));
  });
  try {
    const record=await new Promise((resolve,reject)=>{
      const request=db.transaction('projects','readonly').objectStore('projects').get(token);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    if (!record||record.expiresAt<now) throw new Error('HGO handoff expired; open the original project file.');
    await accept(record.payload); // Atomic dataset/document validation happens here.
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(token);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    return true;
  } finally { db.close(); }
}
