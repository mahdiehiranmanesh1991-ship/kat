// IndexedDB: media blobs + projects. Everything stays on this device.
const open = () => new Promise((res, rej) => { const r = indexedDB.open('kat', 1);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('media', { keyPath: 'id' }); d.createObjectStore('projects', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
let dbp; const db = () => (dbp ||= open());
const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
export const put = (store, v) => tx(store, 'readwrite', (s) => { s.put(v); });
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const del = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });
