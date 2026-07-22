/* =========================================================================
   storage/asset-cache.js
   ---------------------------------------------------------------------
   P1-5: chegaralangan LRU kesh. Runtime'da ObjectURL saqlanadi (dataURL
   emas). AssetStorage'dagi PERSISTENT nusxa har doim dataURL (matn).

   Sprint R1.1: Bu modul endi core/state.js'ga HAM, storage/project-
   storage.js'ga HAM bog'liq emas — sof (pure) qatlam. Ko'p-loyihali
   arxitekturada "qaysi asset qaysi loyiha(lar)da ishlatilmoqda" degan
   savolga javob berish uchun BARCHA loyihalarni bilish kerak — bu esa
   project-storage.js'ning vazifasi (listProjects/getProject). Agar bu
   modul project-storage.js'ni import qilsa, ikkalasi orasida aylanma
   bog'liqlik yuzaga kelardi (project-storage.js allaqachon tozalashni
   ishga tushirish uchun bu modulni import qiladi). Shuning uchun bu
   yerdagi funksiyalar "referencedAssetIds" to'plamini PARAMETR sifatida
   qabul qiladi — kim chaqirsa, o'sha hisoblab beradi.
   ========================================================================= */

import { AssetStorage } from './asset-storage.js';

export const ASSET_CACHE_LIMIT = 20;
export const AssetCache = new Map(); // assetId -> { objectUrl }

export function touchAssetCache(assetId) {
  const entry = AssetCache.get(assetId);
  if (!entry) return;
  AssetCache.delete(assetId);
  AssetCache.set(assetId, entry);
}

export function evictAssetCacheIfNeeded() {
  while (AssetCache.size > ASSET_CACHE_LIMIT) {
    const oldestKey = AssetCache.keys().next().value;
    const entry = AssetCache.get(oldestKey);
    if (entry && entry.objectUrl) {
      try { URL.revokeObjectURL(entry.objectUrl); } catch (_) {}
    }
    AssetCache.delete(oldestKey);
  }
}

export async function dataUrlToObjectUrl(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function cacheAsset(assetId, dataUrl) {
  const objectUrl = await dataUrlToObjectUrl(dataUrl);
  if (AssetCache.has(assetId)) {
    const old = AssetCache.get(assetId);
    if (old.objectUrl) { try { URL.revokeObjectURL(old.objectUrl); } catch (_) {} }
  }
  AssetCache.set(assetId, { objectUrl });
  evictAssetCacheIfNeeded();
  return objectUrl;
}

export async function ensureAssetLoaded(assetId) {
  if (AssetCache.has(assetId)) {
    touchAssetCache(assetId);
    return AssetCache.get(assetId).objectUrl;
  }
  try {
    const raw = await AssetStorage.get(assetId);
    if (!raw) return null;
    return await cacheAsset(assetId, raw);
  } catch (_) {
    return null;
  }
}

/* ---------- Asset Lifecycle Management (P1-4, Sprint R1.1: ko'p-loyihali) ----------
   `projects` — barcha (yoki tekshirilishi kerak bo'lgan) loyiha
   hujjatlarining massivi. Chaqiruvchi (project-storage.js) buni
   listProjects()+getProject() orqali yig'ib beradi. */
export function getReferencedAssetIdsAcrossProjects(projects) {
  const ids = new Set();
  (projects || []).forEach(project => {
    if (!project) return;
    project.slides.forEach(slide => slide.elements.forEach(el => {
      if (el.type === 'image' && el.assetId) ids.add(el.assetId);
    }));
  });
  return ids;
}

// Sof funksiya: qaysi assetId'lar hali ham kerakligini CHAQIRUVCHI hisoblab
// beradi (referencedAssetIds — Set<string>). Bu modul buni bilmaydi.
export async function cleanupOrphanedAssets(referencedAssetIds) {
  try {
    const storedIds = await AssetStorage.list();
    const orphaned = storedIds.filter(id => !referencedAssetIds.has(id));
    for (const id of orphaned) {
      await AssetStorage.remove(id);
      if (AssetCache.has(id)) {
        const entry = AssetCache.get(id);
        if (entry.objectUrl) { try { URL.revokeObjectURL(entry.objectUrl); } catch (_) {} }
        AssetCache.delete(id);
      }
    }
    if (orphaned.length > 0) {
      console.info(`[AssetLifecycle] ${orphaned.length} ta yetim asset tozalandi:`, orphaned);
    }
  } catch (err) {
    console.error('[AssetLifecycle] Tozalashda xato', err);
  }
}
