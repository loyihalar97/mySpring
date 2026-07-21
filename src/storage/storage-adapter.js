/* =========================================================================
   storage/storage-adapter.js
   ---------------------------------------------------------------------
   Butun ilovada window.storage, localStorage yoki IndexedDB'ga hech qanday
   boshqa joydan to'g'ridan-to'g'ri murojaat qilinmaydi — faqat shu modul
   orqali. Bog'liqliksiz — pure browser API wrapper.

   Backend ustuvorligi (birinchi mos kelgani ishlatiladi):
     1) Claude Artifact Storage   (window.storage)      — persistent
     2) Browser Storage           (localStorage)         — persistent
     3) In-Memory Fallback        (JS Map)                — NON-PERSISTENT
   ========================================================================= */

export const StorageBackendType = {
  CLAUDE_ARTIFACT: 'claude-artifact',
  BROWSER: 'browser-localStorage',
  MEMORY: 'memory-fallback',
};

// ---- Har bir backend uchun xom (raw) implementatsiya: get/set/remove/list(fullKey) ----
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

export function detectStorageBackend() {
  if (typeof window.storage !== 'undefined'
      && typeof window.storage.get === 'function'
      && typeof window.storage.set === 'function') {
    return { type: StorageBackendType.CLAUDE_ARTIFACT, impl: RawBackends.claudeArtifact, persistent: true };
  }
  try {
    const probeKey = '__myspring_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return { type: StorageBackendType.BROWSER, impl: RawBackends.browserLocalStorage, persistent: true };
  } catch (_) { /* localStorage yo'q yoki bloklangan */ }
  return { type: StorageBackendType.MEMORY, impl: RawBackends.memory, persistent: false };
}

export const ActiveStorageBackend = detectStorageBackend();

// ---- Namespace-based adapter fabrikasi ----
export function createStorageAdapter(namespace) {
  const prefix = `myspring:${namespace}:`;
  return {
    namespace,
    backendType: ActiveStorageBackend.type,
    isPersistent: ActiveStorageBackend.persistent,
    async get(key) { return ActiveStorageBackend.impl.get(prefix + key); },
    async set(key, value) { return ActiveStorageBackend.impl.set(prefix + key, value); },
    async remove(key) { return ActiveStorageBackend.impl.remove(prefix + key); },
    async list() {
      const fullKeys = await ActiveStorageBackend.impl.list(prefix);
      return fullKeys.map(k => k.slice(prefix.length));
    },
  };
}

export function storageBackendLabel(type) {
  if (type === StorageBackendType.CLAUDE_ARTIFACT) return 'Claude Artifact Storage';
  if (type === StorageBackendType.BROWSER) return 'Brauzer (localStorage)';
  return 'Vaqtinchalik xotira (non-persistent)';
}
