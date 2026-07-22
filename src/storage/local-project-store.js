/* =========================================================================
   storage/local-project-store.js
   ---------------------------------------------------------------------
   Sof LOKAL loyiha saqlash qatlami (IndexedDB/localStorage/Xotira-ichi —
   storage-adapter.js orqali). Bu modul Supabase yoki AppState haqida
   HECH NARSA bilmaydi — Sprint R1.1'dagi bir-loyihali/ko'p-loyihali
   model shu yerda, o'zgarishsiz qoladi.

   Sprint R1.2: bu — sync-engine.js'ning "lokal yarim"i. Cloud mavjud
   bo'lmaganda yoki oflayn bo'lganda ILOVA TO'G'RIDAN-TO'G'RI shu modulga
   tayanadi (storage/project-storage.js orqali).
   ========================================================================= */

import { createStorageAdapter } from './storage-adapter.js';
import { migrateProject } from '../core/migrations.js';
import { cleanupOrphanedAssets, getReferencedAssetIdsAcrossProjects } from './asset-cache.js';

// Xom (low-level) adapter — backendType/isPersistent kabi diagnostika
// uchun ham eksport qilinadi.
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

export async function listProjects() {
  const index = await readIndex();
  return [...index.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(projectId) {
  const raw = await ProjectStorage.get('doc:' + projectId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

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

/* ---------- Global Asset Lifecycle (lokal) ---------- */
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
