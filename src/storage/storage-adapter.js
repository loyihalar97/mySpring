/* =========================================================================
   storage/storage-adapter.js
   ---------------------------------------------------------------------
   Butun ilovada window.storage, IndexedDB, localStorage'ga hech qanday
   boshqa joydan to'g'ridan-to'g'ri murojaat qilinmaydi — faqat shu modul
   orqali.

   Backend ustuvorligi (birinchi mos kelgani ishlatiladi):
     1) Claude Artifact Storage   (window.storage)      — persistent
     2) IndexedDB                (real brauzer uchun afzal) — persistent
     3) Browser Storage           (localStorage)         — persistent
     4) In-Memory Fallback        (JS Map)                — NON-PERSISTENT

   Sprint R1.1: Backend aniqlash endi ASINXRON (IndexedDB ochish asinxron
   API talab qiladi). Shuning uchun `initStorageBackend()` ilova ishga
   tushganda BIR MARTA, boshqa hech qanday storage chaqiruvidan OLDIN
   kutilishi (await) SHART — main.js buni ta'minlaydi. Adapter metodlari
   (get/set/remove/list) va isPersistent/backendType — barchasi module-level
   `ActiveStorageBackend` o'zgaruvchisini CHAQIRUV VAQTIDA (lazy) o'qiydi,
   yaratilish vaqtida emas — shunda `createStorageAdapter()` hali backend
   aniqlanmasdan turib chaqirilgan bo'lsa ham (ES module top-level export),
   keyinchalik to'g'ri ishlaydi.
   ========================================================================= */

export const StorageBackendType = {
  CLAUDE_ARTIFACT: 'claude-artifact',
  INDEXED_DB: 'indexed-db',
  BROWSER: 'browser-localStorage',
  MEMORY: 'memory-fallback',
};

// ---- IndexedDB xom implementatsiyasi ----
const IDB_DB_NAME = 'myspring-suite';
const IDB_STORE_NAME = 'kv';
const IDB_VERSION = 1;
let idbPromise = null;

function openIndexedDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE_NAME)) {
        req.result.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return idbPromise;
}

const indexedDbBackend = {
  async get(fullKey) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(fullKey);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(fullKey, value) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(value, fullKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async remove(fullKey) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(fullKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async list(prefix) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result.filter(k => typeof k === 'string' && k.startsWith(prefix)));
      req.onerror = () => reject(req.error);
    });
  },
};

export const RawBackends = {
  claudeArtifact: {
    async get(fullKey) {
      try {
        const result = await window.storage.get(fullKey, false);
        return result ? result.value : null;
      } catch (_) {
        return null;
      }
    },
    async set(fullKey, value) {
      await window.storage.set(fullKey, value, false);
    },
    async remove(fullKey) {
      try { await window.storage.delete(fullKey, false); } catch (_) {}
    },
    async list(prefix) {
      try {
        const result = await window.storage.list(prefix, false);
        return result ? result.keys : [];
      } catch (_) {
        return [];
      }
    },
  },
  indexedDb: indexedDbBackend,
  browserLocalStorage: {
    async get(fullKey) {
      const v = window.localStorage.getItem(fullKey);
      return v === null ? null : v;
    },
    async set(fullKey, value) {
      window.localStorage.setItem(fullKey, value);
    },
    async remove(fullKey) {
      window.localStorage.removeItem(fullKey);
    },
    async list(prefix) {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return keys;
    },
  },
  memory: (() => {
    const store = new Map();
    return {
      async get(fullKey) { return store.has(fullKey) ? store.get(fullKey) : null; },
      async set(fullKey, value) { store.set(fullKey, value); },
      async remove(fullKey) { store.delete(fullKey); },
      async list(prefix) { return Array.from(store.keys()).filter(k => k.startsWith(prefix)); },
    };
  })(),
};

async function detectStorageBackendAsync() {
  // 1) Claude Artifact Storage
  if (typeof window.storage !== 'undefined'
      && typeof window.storage.get === 'function'
      && typeof window.storage.set === 'function') {
    return { type: StorageBackendType.CLAUDE_ARTIFACT, impl: RawBackends.claudeArtifact, persistent: true };
  }
  // 2) IndexedDB — real brauzer uchun afzal (kattaroq, strukturaviy ma'lumot)
  if (typeof indexedDB !== 'undefined') {
    try {
      await openIndexedDB(); // probe — shu ulanish keyinchalik qayta ishlatiladi
      return { type: StorageBackendType.INDEXED_DB, impl: RawBackends.indexedDb, persistent: true };
    } catch (_) { /* IndexedDB bloklangan yoki mavjud emas */ }
  }
  // 3) Browser localStorage
  try {
    const probeKey = '__myspring_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return { type: StorageBackendType.BROWSER, impl: RawBackends.browserLocalStorage, persistent: true };
  } catch (_) { /* localStorage yo'q yoki bloklangan */ }
  // 4) In-memory fallback — NON-PERSISTENT
  return { type: StorageBackendType.MEMORY, impl: RawBackends.memory, persistent: false };
}

let ActiveStorageBackend = null;
let initPromise = null;

// main.js tomonidan BIR MARTA, boshqa hech qanday storage chaqiruvidan
// OLDIN await qilinishi SHART.
export function initStorageBackend() {
  if (!initPromise) {
    initPromise = detectStorageBackendAsync().then(backend => {
      ActiveStorageBackend = backend;
      return backend;
    });
  }
  return initPromise;
}

// Diagnostika uchun — hozircha faol backend haqida ma'lumot.
export function getActiveStorageBackendInfo() {
  return ActiveStorageBackend;
}

function requireBackend() {
  if (!ActiveStorageBackend) {
    throw new Error('[StorageAdapter] initStorageBackend() hali kutilmagan (await qilinmagan)');
  }
  return ActiveStorageBackend;
}

// ---- Namespace-based adapter fabrikasi ----
export function createStorageAdapter(namespace) {
  const prefix = `myspring:${namespace}:`;
  return {
    namespace,
    get backendType() { return ActiveStorageBackend ? ActiveStorageBackend.type : null; },
    get isPersistent() { return ActiveStorageBackend ? ActiveStorageBackend.persistent : false; },
    async get(key) { return requireBackend().impl.get(prefix + key); },
    async set(key, value) { return requireBackend().impl.set(prefix + key, value); },
    async remove(key) { return requireBackend().impl.remove(prefix + key); },
    async list() {
      const fullKeys = await requireBackend().impl.list(prefix);
      return fullKeys.map(k => k.slice(prefix.length));
    },
  };
}

export function storageBackendLabel(type) {
  if (type === StorageBackendType.CLAUDE_ARTIFACT) return 'Claude Artifact Storage';
  if (type === StorageBackendType.INDEXED_DB) return 'IndexedDB';
  if (type === StorageBackendType.BROWSER) return 'Brauzer (localStorage)';
  return 'Vaqtinchalik xotira (non-persistent)';
}
