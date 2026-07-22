/* =========================================================================
   storage/project-storage.js
   ---------------------------------------------------------------------
   Sprint R1.1 — Project Library va ishonchli ko'p-loyihali persistence.
   Har bir loyiha o'zining barqaror ID'si ostida ALOHIDA saqlanadi
   (`doc:{projectId}`), bitta yengil Index bilan birga (`index`).

   Ilovaning boshqa hech qanday qismi localStorage/window.storage/
   IndexedDB'ga to'g'ridan-to'g'ri murojaat qilmaydi — faqat shu modul
   orqali.
   ========================================================================= */

import { createStorageAdapter, storageBackendLabel } from './storage-adapter.js';
import { AppState, notifyStateChange } from '../core/state.js';
import { uuid, createProject } from '../core/object-model.js';
import { migrateProject } from '../core/migrations.js';
import { toast } from '../ui/toast.js';
import { cleanupOrphanedAssets, getReferencedAssetIdsAcrossProjects } from './asset-cache.js';

// Xom (low-level) adapter — faqat shu fayl ichida ishlatiladi + tashqariga
// backendType/isPersistent kabi diagnostika uchun eksport qilinadi.
export const ProjectStorage = createStorageAdapter('project');

/* ---------- Project Index ---------- */
async function readIndex() {
  try {
    const raw = await ProjectStorage.get('index');
    if (!raw) return { projects: [] };
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.projects)) ? parsed : { projects: [] };
  } catch (_) {
    return { projects: [] };
  }
}

async function writeIndex(index) {
  await ProjectStorage.set('index', JSON.stringify(index));
}

function upsertIndexEntry(index, entry) {
  const i = index.projects.findIndex(p => p.id === entry.id);
  if (i === -1) index.projects.push(entry);
  else index.projects[i] = entry;
}

/* ---------- Public API (talab qilingan) ---------- */

export async function listProjects() {
  const index = await readIndex();
  return [...index.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(projectId) {
  const raw = await ProjectStorage.get('doc:' + projectId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// Doc + Index'ni birga yozadi, updatedAt'ni yangilaydi.
export async function saveProject(project) {
  if (!project || !project.id) return;
  const now = Date.now();
  await ProjectStorage.set('doc:' + project.id, JSON.stringify(project));

  const index = await readIndex();
  const existing = index.projects.find(p => p.id === project.id);
  upsertIndexEntry(index, {
    id: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    createdAt: existing ? existing.createdAt : ((project.metadata && project.metadata.createdAt) || now),
    updatedAt: now,
  });
  await writeIndex(index);
}

export async function deleteProject(projectId) {
  await ProjectStorage.remove('doc:' + projectId);
  await ProjectStorage.remove('lastSlideId:' + projectId);

  const index = await readIndex();
  index.projects = index.projects.filter(p => p.id !== projectId);
  await writeIndex(index);

  const lastId = await getLastOpenedProjectId();
  if (lastId === projectId) {
    await ProjectStorage.remove('lastOpenedId');
  }
}

export async function renameProject(projectId, newName) {
  const project = await getProject(projectId);
  if (!project) return false;
  project.name = newName;
  await saveProject(project);
  return true;
}

export async function getLastOpenedProjectId() {
  return ProjectStorage.get('lastOpenedId');
}

export async function setLastOpenedProjectId(projectId) {
  await ProjectStorage.set('lastOpenedId', projectId);
}

/* ---------- Legacy migration (Sprint 1-R1 bitta-loyihali model) ---------- */
export async function migrateLegacyCurrentProject() {
  const already = await ProjectStorage.get('legacyMigrated');
  if (already === 'true') return { migrated: false };

  const legacyRaw = await ProjectStorage.get('current');
  if (!legacyRaw) {
    await ProjectStorage.set('legacyMigrated', 'true');
    return { migrated: false };
  }

  try {
    let project = JSON.parse(legacyRaw);
    project = migrateProject(project); // mavjud schema zanjiri — ID'lar tegilmaydi
    await saveProject(project);

    const legacySlideId = await ProjectStorage.get('lastSlideId');
    if (legacySlideId) {
      await ProjectStorage.set('lastSlideId:' + project.id, legacySlideId);
    }
    await setLastOpenedProjectId(project.id);

    await ProjectStorage.set('legacyMigrated', 'true');
    await ProjectStorage.remove('current');
    await ProjectStorage.remove('lastSlideId');

    console.info(`[Legacy Migration] "${project.name}" muvaffaqiyatli ko'chirildi (id: ${project.id})`);
    return { migrated: true, projectId: project.id };
  } catch (err) {
    console.error('[Legacy Migration] xato — keyingi ishga tushirishda qayta uriniladi', err);
    return { migrated: false, error: true };
  }
}

/* ---------- Editor bilan integratsiya ---------- */

// Loyihani AppState'ga yuklaydi (Editor'ga ochadi). O'zi SAQLAMAYDI — ochish
// o'zgartirish hisoblanmaydi.
export async function openProjectIntoEditor(projectId) {
  const raw = await ProjectStorage.get('doc:' + projectId);
  if (!raw) { toast("Loyiha topilmadi \u2014 ehtimol o'chirilgan"); return false; }
  let project;
  try { project = JSON.parse(raw); } catch (_) { toast('Loyiha fayli buzilgan'); return false; }

  project = migrateProject(project); // himoya: schema eskirgan bo'lsa

  AppState.ui.selectedElementIds = new Set();
  AppState.ui.clipboard = [];
  AppState.ui.mode = 'edit';
  AppState.commandLog = [{ id: uuid(), type: 'PROJECT_OPENED', ts: new Date().toLocaleTimeString('uz-UZ'), error: false, undone: false }];
  AppState.objectModel.project = project;

  const lastSlideId = await ProjectStorage.get('lastSlideId:' + project.id);
  AppState.ui.activeSlideId = project.slides.find(s => s.id === lastSlideId) ? lastSlideId : project.slides[0].id;
  AppState.history = { stack: [{ id: 'INITIAL', project }], pointer: 0 };

  await setLastOpenedProjectId(project.id);
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

// Yangi loyiha — HAR DOIM yangi UUID (createProject() orqali), shuning
// uchun konstruksiya bo'yicha mavjud loyihani hech qachon bosib yozmaydi.
export async function createAndOpenNewProject(name) {
  const project = createProject(name);
  await saveProject(project);
  await openProjectIntoEditor(project.id);
  notifyStateChange({ type: 'project-created' });
}

/* ---------- Save (qo'lda va avtomatik) ---------- */

export async function manualSaveCurrentProject() {
  const project = AppState.objectModel.project;
  if (!project) return;
  try {
    await saveProject(project);
    if (AppState.ui.activeSlideId) {
      await ProjectStorage.set('lastSlideId:' + project.id, AppState.ui.activeSlideId);
    }
    if (ProjectStorage.isPersistent) {
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
    await saveProject(project);
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

/* ---------- Global Asset Lifecycle (Sprint R1.1: ko'p-loyihali) ----------
   Bu yerda joylashgan, chunki faqat shu modul barcha loyihalarni
   (listProjects/getProject orqali) bilishi mumkin — storage/asset-cache.js
   ataylab bundan mustaqil (aylanma bog'liqlikni oldini olish uchun). */
let globalAssetCleanupTimer = null;
export function scheduleGlobalAssetCleanup() {
  clearTimeout(globalAssetCleanupTimer);
  globalAssetCleanupTimer = setTimeout(runGlobalAssetCleanup, 2000);
}

export async function runGlobalAssetCleanup() {
  try {
    const index = await listProjects();
    const projects = await Promise.all(index.map(entry => getProject(entry.id)));
    const referenced = getReferencedAssetIdsAcrossProjects(projects.filter(Boolean));
    await cleanupOrphanedAssets(referenced);
  } catch (err) {
    console.error('[AssetLifecycle] Global tozalashda xato', err);
  }
}
