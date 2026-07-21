/* =========================================================================
   storage/asset-cache.js
   ---------------------------------------------------------------------
   P1-5: chegaralangan LRU kesh. Runtime'da ObjectURL saqlanadi (dataURL
   emas). AssetStorage'dagi PERSISTENT nusxa har doim dataURL (matn) —
   bu esa faqat runtime optimallashtirish, HECH QACHON haqiqat manbai emas.

   Sprint R1: asinxron rasm yuklangandan keyingi qayta-render zarurati
   `notifyStateChange()` orqali e'lon qilinadi — bu modul rendering/*.js'ni
   import qilmaydi.
   ========================================================================= */

import { AssetStorage } from './asset-storage.js';
import { AppState } from '../core/state.js';

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

/* ---------- Asset Lifecycle Management (P1-4) ---------- */
export function getReferencedAssetIds(project) {
  const ids = new Set();
  if (!project) return ids;
  project.slides.forEach(slide => slide.elements.forEach(el => {
    if (el.type === 'image' && el.assetId) ids.add(el.assetId);
  }));
  return ids;
}

let assetCleanupTimer = null;
export function scheduleAssetCleanup() {
  clearTimeout(assetCleanupTimer);
  assetCleanupTimer = setTimeout(() => {
    cleanupOrphanedAssets(AppState.objectModel.project);
  }, 2000);
}

export async function cleanupOrphanedAssets(project) {
  if (!project) return;
  try {
    const referenced = getReferencedAssetIds(project);
    const storedIds = await AssetStorage.list();
    const orphaned = storedIds.filter(id => !referenced.has(id));
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
