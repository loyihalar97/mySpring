/* =========================================================================
   storage/sync-engine.js
   ---------------------------------------------------------------------
   Cloud (Supabase) va Local (IndexedDB) o'rtasidagi sinxronizatsiya
   orkestratori. Sync State Machine:

     local-only --[login]--> syncing --> synced
     synced --[save]--> syncing --> synced | conflict | offline(navbatga)
     offline --[online event]--> syncing --> synced | conflict
     conflict --[foydalanuvchi tanlovi]--> syncing --> synced

   Bu modul HECH QACHON supabase'ga to'g'ridan-to'g'ri murojaat qilmaydi —
   faqat supabase-adapter.js orqali.
   ========================================================================= */

import * as local from './local-project-store.js';
import * as cloud from './supabase-adapter.js';
import { isCloudAvailable } from './auth.js';
import { notifyStateChange } from '../core/state.js';
import { toast } from '../ui/toast.js';

let syncStatus = 'local-only'; // 'local-only' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'
let lastSyncedAt = null;
let pendingConflict = null; // { projectId, localProject, serverRevision, serverUpdatedAt }

export function getSyncStatus() {
  return { status: syncStatus, lastSyncedAt, pendingConflict };
}

function setSyncStatus(s) {
  syncStatus = s;
  notifyStateChange({ type: 'sync-status-changed' });
}

/* ---------- Oflayn navbat (lokal, project namespace ostida) ---------- */
async function getQueue() {
  try {
    const raw = await local.ProjectStorage.get('syncQueue');
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}
async function setQueue(q) { await local.ProjectStorage.set('syncQueue', JSON.stringify(q)); }
async function enqueueSave(projectId) {
  const q = await getQueue();
  if (!q.includes(projectId)) { q.push(projectId); await setQueue(q); }
}
async function dequeueSave(projectId) {
  const q = await getQueue();
  await setQueue(q.filter(id => id !== projectId));
}
export async function getPendingSyncCount() {
  return (await getQueue()).length;
}

async function getRevisionCache(projectId) {
  const raw = await local.ProjectStorage.get('revision:' + projectId);
  return raw ? Number(raw) : null;
}
async function setRevisionCache(projectId, revision) {
  // MUHIM: `revision === null` holatini "cheklovni olib tashlash" (majburiy
  // qayta yozish) sifatida to'g'ri ifodalash uchun kalitning O'ZINI o'chiramiz
  // — String(null) === "null" (haqiqiy satr) yozib qo'yish xato edi, chunki
  // keyingi o'qishda Number("null") === NaN bo'lib, hech qachon `null`ga
  // teng bo'lmagani uchun konflikt tekshiruvi noto'g'ri qayta ishga tushardi.
  if (revision === null || revision === undefined) {
    await local.ProjectStorage.remove('revision:' + projectId);
  } else {
    await local.ProjectStorage.set('revision:' + projectId, String(revision));
  }
}

/* ---------- Public API (project-storage.js orqali chaqiriladi) ---------- */

export async function listProjects() {
  if (!isCloudAvailable()) { setSyncStatus('local-only'); return local.listProjects(); }
  try {
    setSyncStatus('syncing');
    const cloudList = await cloud.listProjects();
    setSyncStatus('synced'); lastSyncedAt = Date.now();
    return cloudList;
  } catch (err) {
    console.error('[Sync] listProjects xatosi \u2014 lokal keshga qaytilmoqda', err);
    setSyncStatus('offline');
    return local.listProjects();
  }
}

export async function getProject(projectId) {
  if (!isCloudAvailable()) return local.getProject(projectId);
  try {
    setSyncStatus('syncing');
    const result = await cloud.getProject(projectId);
    if (!result) { setSyncStatus('synced'); return local.getProject(projectId); }
    await local.saveProject(result.project); // lokal keshni yangilash (offline uchun)
    await setRevisionCache(projectId, result.revision);
    setSyncStatus('synced'); lastSyncedAt = Date.now();
    return result.project;
  } catch (err) {
    console.error('[Sync] getProject xatosi \u2014 lokal keshdan o\u2018qilmoqda', err);
    setSyncStatus('offline');
    return local.getProject(projectId);
  }
}

export async function saveProject(project) {
  await local.saveProject(project); // har doim darhol lokal keshga (tez, oflayn-xavfsiz)

  if (!isCloudAvailable()) { setSyncStatus('local-only'); return { success: true }; }

  try {
    setSyncStatus('syncing');
    const expectedRevision = await getRevisionCache(project.id);
    const result = await cloud.saveProject(project, expectedRevision);

    if (result.resultCode === 'conflict') {
      pendingConflict = {
        projectId: project.id, localProject: project,
        serverRevision: result.revision, serverUpdatedAt: result.serverUpdatedAt,
      };
      setSyncStatus('conflict');
      toast('\u26a0 Sinxronizatsiya konflikti: bulutda yangiroq versiya bor');
      return { success: false, conflict: true };
    }

    if (result.resultCode === 'forbidden' || result.resultCode === 'not_found') {
      setSyncStatus('error');
      toast('\u26a0 Bulutga saqlashda xato: ' + result.resultCode);
      return { success: false, error: result.resultCode };
    }

    await setRevisionCache(project.id, result.revision);
    await dequeueSave(project.id);
    setSyncStatus('synced'); lastSyncedAt = Date.now();
    return { success: true };
  } catch (err) {
    console.error('[Sync] saveProject xatosi \u2014 navbatga qo\u2018yildi', err);
    await enqueueSave(project.id);
    setSyncStatus('offline');
    return { success: true, queued: true }; // lokal saqlandi, keyinroq sinxronlanadi
  }
}

export async function deleteProject(projectId) {
  await local.deleteProject(projectId);
  if (!isCloudAvailable()) return;
  try { await cloud.deleteProject(projectId); }
  catch (err) { console.error('[Sync] cloud delete xatosi', err); }
}

export async function renameProject(projectId, newName) {
  const ok = await local.renameProject(projectId, newName);
  if (!isCloudAvailable()) return ok;
  try {
    const result = await cloud.renameProject(projectId, newName);
    if (!result.success) {
      console.error('[Sync] cloud rename muvaffaqiyatsiz:', result.resultCode);
      toast('\u26a0 Bulutda nomlashda xato: ' + result.resultCode);
    } else {
      await setRevisionCache(projectId, result.revision);
    }
  } catch (err) {
    console.error('[Sync] cloud rename xatosi', err);
  }
  return ok;
}

/* ---------- Konflikt hal qilish ---------- */
export async function resolveConflictKeepLocal() {
  if (!pendingConflict) return;
  const { projectId, localProject } = pendingConflict;
  pendingConflict = null;
  await setRevisionCache(projectId, null); // majburiy bosib yozish uchun cheklovni olib tashlash
  await saveProject(localProject);
}

export async function resolveConflictKeepCloud() {
  if (!pendingConflict) return;
  const { projectId } = pendingConflict;
  pendingConflict = null;
  try {
    const result = await cloud.getProject(projectId);
    if (result) {
      await local.saveProject(result.project);
      await setRevisionCache(projectId, result.revision);
    }
    setSyncStatus('synced'); lastSyncedAt = Date.now();
  } catch (err) {
    console.error('[Sync] Konfliktni bulut foydasiga hal qilishda xato', err);
    setSyncStatus('error');
  }
  notifyStateChange({ type: 'conflict-resolved', projectId });
}

/* ---------- Tarmoq qaytganda navbatni sinxronlash ---------- */
export async function trySyncQueue() {
  if (!isCloudAvailable()) return;
  const queue = await getQueue();
  for (const projectId of queue) {
    const project = await local.getProject(projectId);
    if (project) await saveProject(project);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { trySyncQueue(); });
}
