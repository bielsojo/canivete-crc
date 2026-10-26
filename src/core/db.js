/* Cache local no IndexedDB (fica só neste navegador). Cada ferramenta usa sua própria store
   com um registro "current_base" = {filename, dateStr, data}. */
const DB_NAME = 'CaniveteCRC';
const DB_VERSION = 1;
const STORES = ['backlog', 'equipamentos', 'laudos_state'];

let dbp = null;
function open(){
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, {keyPath:'id'}); });
    };
  });
  return dbp;
}
function tx(store, mode, fn){
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const dbStore = {
  save(store, filename, dateStr, data){ return tx(store, 'readwrite', s => s.put({id:'current_base', filename, dateStr, data})); },
  get(store){ return tx(store, 'readonly', s => s.get('current_base')); },
  clear(store){ return tx(store, 'readwrite', s => s.clear()); }
};
