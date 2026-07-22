/* =========================================================================
   storage/project-storage.js
   ---------------------------------------------------------------------
   Sprint R1.2: bu fayl endi NOZIK MOSLASHUVCHI (thin shim). Haqiqiy
   mantiq ikkiga bo'lingan:
     - storage/local-project-store.js — sof lokal (IndexedDB) qatlam
     - storage/sync-engine.js         — cloud/local orkestratsiyasi

   BU AYIRISH TUFAYLI renderer.js/toolbar.js/project-library.js/main.js
   HECH QANDAY IMPORT O'ZGARTIRISH TALAB QILMAYDI — barcha eksport
   nomlari saqlanib qolgan.
   ========================================================================= */

import { AppState, notifyStateChange } from '../core/state.js';
import { uuid, createProject } from '../core/object-model.js';
import { migrateProject } from '../core/migrations.js';
import { toast } from '../ui/toast.js';
import { storageBackendLabel } from './storage-adapter.js';

import * as sync from './sync-engine.js';
import {
  ProjectStorage, getLastOpenedProjectId, setLastOpenedProjectId,
  migrateLegacyCurrentProject, scheduleGlobalAssetCleanup, runGlobalAssetCleanup,
} from './local-project-store.js';

// Diagnostika/legacy-migratsiya uchun kerak bo'lgan lokal eksportlar —
// o'zgarishsiz qayta eksport qilinadi.
export {
  ProjectStorage, getLastOpenedProjectId, setLastOpenedProjectId,
  migrateLegacyCurrentProject, scheduleGlobalAssetCleanup, runGlobalAssetCleanup,
};

// Sinxronizatsiya bilan boshqariladigan asosiy CRUD — endi sync-engine.js
// orqali (u avval local-project-store.js'ga, cloud mavjud bo'lsa keyin
// supabase-adapter.js'ga ham yozadi).
export const listProjects = sync.listProjects;
export const getProject = sync.getProject;
export const saveProject = sync.saveProject;
export const deleteProject = sync.deleteProject;
export const renameProject = sync.renameProject;
export const getSyncStatus = sync.getSyncStatus;
export const resolveConflictKeepLocal = sync.resolveConflictKeepLocal;
export const resolveConflictKeepCloud = sync.resolveConflictKeepCloud;
export const trySyncQueue = sync.trySyncQueue;
export const getPendingSyncCount = sync.getPendingSyncCount;

/* ---------- Editor bilan integratsiya ---------- */

export async function openProjectIntoEditor(projectId) {
  const project = await sync.getProject(projectId);
  if (!project) { toast("Loyiha topilmadi \u2014 ehtimol o'chirilgan"); return false; }

  const migrated = migrateProject(project); // himoya: schema eskirgan bo'lsa

  AppState.ui.selectedElementIds = new Set();
  AppState.ui.clipboard = [];
  AppState.ui.mode = 'edit';
  AppState.commandLog = [{ id: uuid(), type: 'PROJECT_OPENED', ts: new Date().toLocaleTimeString('uz-UZ'), error: false, undone: false }];
  AppState.objectModel.project = migrated;

  const lastSlideId = await ProjectStorage.get('lastSlideId:' + migrated.id);
  AppState.ui.activeSlideId = migrated.slides.find(s => s.id === lastSlideId) ? lastSlideId : migrated.slides[0].id;
  AppState.history = { stack: [{ id: 'INITIAL', project: migrated }], pointer: 0 };

  await setLastOpenedProjectId(migrated.id);
  scheduleGlobalAssetCleanup();
  return true;
}

export async function reloadCurrentProject() {
  const current = AppState.objectModel.project;
  if (!current) return;
  const ok = await openProjectIntoEditor(current.id);
  if (ok) {
    toast(`Loyiha qayta yuklandi \u2713 \u2014 ${storageBackendLabel(ProjectStorage.backendType)}`);
    notifyStateChange({ type: 'reload' });
  }
}

// Yangi loyiha — HAR DOIM yangi UUID, shuning uchun konstruksiya bo'yicha
// mavjud loyihani hech qachon bosib yozmaydi.
export async function createAndOpenNewProject(name) {
  const project = createProject(name);
  await sync.saveProject(project);
  await openProjectIntoEditor(project.id);
  notifyStateChange({ type: 'project-created' });
}

/* ---------- Save (qo'lda va avtomatik) ---------- */

export async function manualSaveCurrentProject() {
  const project = AppState.objectModel.project;
  if (!project) return;
  try {
    const result = await sync.saveProject(project);
    if (AppState.ui.activeSlideId) {
      await ProjectStorage.set('lastSlideId:' + project.id, AppState.ui.activeSlideId);
    }
    if (result.conflict) return; // sync-engine allaqachon toast ko'rsatdi
    if (result.queued) {
      toast('\u26a0 Oflayn \u2014 o\u2018zgarishlar navbatga qo\u2018yildi, ulanish tiklanganda yuboriladi');
    } else if (ProjectStorage.isPersistent) {
      toast(`Loyiha saqlandi \u2713 \u2014 ${storageBackendLabel(ProjectStorage.backendType)}`);
    } else {
      toast(`\u26a0 Vaqtinchalik saqlandi \u2014 sahifa yangilansa yo'qoladi`);
    }
  } catch (err) {
    console.error(err);
    toast('Saqlashda xato yuz berdi');
  }
}

let autosaveTimer = null;
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveCurrentProject, 1500);
}

export async function autosaveCurrentProject() {
  const project = AppState.objectModel.project;
  if (!project) return;
  try {
    await sync.saveProject(project);
    if (AppState.ui.activeSlideId) {
      await ProjectStorage.set('lastSlideId:' + project.id, AppState.ui.activeSlideId);
    }
    updateAutosaveIndicator(true);
  } catch (err) {
    console.error(err);
    updateAutosaveIndicator(false);
  }
}

export function updateAutosaveIndicator(success) {
  const el = document.getElementById('autosave-indicator');
  if (!el) return;
  const time = new Date().toLocaleTimeString('uz-UZ');
  if (!success) {
    el.textContent = `\u26a0 avtosaqlash xatosi (${time})`;
    el.style.color = 'var(--danger)';
    return;
  }
  el.style.color = 'var(--text-dim)';
  el.textContent = ProjectStorage.isPersistent
    ? `avtosaqlangan ${time}`
    : `vaqtinchalik avtosaqlangan ${time}`;
}
