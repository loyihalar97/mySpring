/* =========================================================================
   storage/project-storage.js
   ---------------------------------------------------------------------
   Loyiha JSON'i (Object Model State) uchun alohida namespace, Save/Reload
   va Autosave orkestratsiyasi.
   ========================================================================= */

import { createStorageAdapter, storageBackendLabel } from './storage-adapter.js';
import { AppState, notifyStateChange } from '../core/state.js';
import { uuid } from '../core/object-model.js';
import { migrateProject } from '../core/migrations.js';
import { toast } from '../ui/toast.js';
import { scheduleAssetCleanup } from './asset-cache.js';

export const ProjectStorage = createStorageAdapter('project');

export async function saveProject() {
  const project = AppState.objectModel.project;
  if (!project) return;
  try {
    await ProjectStorage.set('current', JSON.stringify(project));
    await ProjectStorage.set('lastSlideId', AppState.ui.activeSlideId);

    if (ProjectStorage.isPersistent) {
      toast(`Loyiha saqlandi \u2713 \u2014 ${storageBackendLabel(ProjectStorage.backendType)}`);
    } else {
      toast(`\u26a0 Vaqtinchalik saqlandi \u2014 sahifa yangilansa yo'qoladi`);
    }
  } catch (err) {
    console.error(err);
    toast("Saqlashda xato yuz berdi");
  }
}

export async function reloadProject() {
  try {
    const raw = await ProjectStorage.get('current');
    if (!raw) { toast('Saqlangan loyiha topilmadi'); return; }
    let project = JSON.parse(raw);

    AppState.ui.selectedElementIds = new Set();
    AppState.ui.clipboard = [];
    AppState.ui.mode = 'edit';
    AppState.commandLog = [{ id: uuid(), type: 'PROJECT_RELOADED', ts: new Date().toLocaleTimeString('uz-UZ'), error: false, undone: false }];

    project = migrateProject(project);

    AppState.objectModel.project = project;
    const lastSlideId = await ProjectStorage.get('lastSlideId');
    AppState.ui.activeSlideId = project.slides.find(s => s.id === lastSlideId) ? lastSlideId : project.slides[0].id;
    AppState.history = { stack: [{ id: 'INITIAL', project }], pointer: 0 };
    toast(`Loyiha qayta yuklandi \u2713 \u2014 ${storageBackendLabel(ProjectStorage.backendType)}`);
    notifyStateChange({ type: 'reload' });
    scheduleAssetCleanup();
  } catch (err) {
    console.error(err);
    toast("Saqlangan loyiha topilmadi yoki buzilgan");
  }
}

let autosaveTimer = null;
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveProject, 1500);
}

export async function autosaveProject() {
  const project = AppState.objectModel.project;
  if (!project) return;
  try {
    await ProjectStorage.set('current', JSON.stringify(project));
    await ProjectStorage.set('lastSlideId', AppState.ui.activeSlideId);
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
