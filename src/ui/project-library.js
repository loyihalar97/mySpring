/* =========================================================================
   ui/project-library.js
   ---------------------------------------------------------------------
   Ilova ishga tushganda ko'rsatiladigan birinchi ekran. Loyihalarni
   yaratish, ochish, nomlash, o'chirish. rendering/renderer.js'ni
   IMPORT QILMAYDI — barcha qayta-render zarurati notifyStateChange()
   orqali e'lon qilinadi.
   ========================================================================= */

import { AppState, notifyStateChange } from '../core/state.js';
import {
  listProjects, deleteProject, renameProject, createAndOpenNewProject,
  openProjectIntoEditor, getLastOpenedProjectId, ProjectStorage,
  scheduleGlobalAssetCleanup,
} from '../storage/project-storage.js';
import { storageBackendLabel } from '../storage/storage-adapter.js';
import { showModal, showConfirmModal } from './modals.js';
import { toast } from './toast.js';

export async function renderLibraryView() {
  const container = document.getElementById('library-grid');
  const emptyEl = document.getElementById('library-empty');
  const warnEl = document.getElementById('library-storage-warning');
  const backendEl = document.getElementById('library-backend-label');

  if (ProjectStorage.isPersistent) {
    warnEl.style.display = 'none';
  } else {
    warnEl.style.display = 'flex';
    warnEl.textContent = "\u26a0 Vaqtinchalik xotira rejimi \u2014 loyihalar sahifa yangilanganda yo'qoladi.";
  }
  backendEl.textContent = `Faol saqlash: ${storageBackendLabel(ProjectStorage.backendType)}`;

  container.innerHTML = '';

  let projects = [];
  try {
    projects = await listProjects();
  } catch (err) {
    console.error(err);
    toast("Loyihalar ro'yxatini yuklashda xato");
  }

  emptyEl.style.display = projects.length === 0 ? 'flex' : 'none';

  let lastOpenedId = null;
  try { lastOpenedId = await getLastOpenedProjectId(); } catch (_) {}

  projects.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'library-card' + (entry.id === lastOpenedId ? ' last-opened' : '');
    const updatedText = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('uz-UZ') : '\u2014';
    card.innerHTML = `
      <div class="library-card-name"></div>
      <div class="library-card-meta">O'zgartirilgan: ${updatedText}</div>
      <div class="library-card-actions">
        <button data-action="open" class="primary">Ochish</button>
        <button data-action="rename">Nomlash</button>
        <button data-action="delete">O'chirish</button>
      </div>
    `;
    card.querySelector('.library-card-name').textContent = entry.name || '(nomsiz)';

    card.querySelector('[data-action="open"]').addEventListener('click', async () => {
      const ok = await openProjectIntoEditor(entry.id);
      if (ok) {
        AppState.ui.view = 'editor';
        notifyStateChange({ type: 'view-changed' });
      } else {
        renderLibraryView(); // ro'yxat eskirgan bo'lishi mumkin — qayta chizish
      }
    });

    card.querySelector('[data-action="rename"]').addEventListener('click', () => {
      showModal({
        title: 'Loyihani nomlash',
        placeholder: 'Yangi nom',
        defaultValue: entry.name,
        onSubmit: async (newName) => {
          await renameProject(entry.id, newName);
          renderLibraryView();
        }
      });
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', () => {
      showConfirmModal({
        title: "Loyihani o'chirish",
        message: `"${entry.name}" loyihasini o'chirmoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi.`,
        confirmLabel: "O'chirish",
        onConfirm: async () => {
          await deleteProject(entry.id);
          scheduleGlobalAssetCleanup();
          toast("Loyiha o'chirildi");
          renderLibraryView();
        }
      });
    });

    container.appendChild(card);
  });
}

export function initProjectLibrary() {
  document.getElementById('btn-library-new-project').addEventListener('click', () => {
    showModal({
      title: 'Yangi loyiha yaratish',
      placeholder: 'Loyiha nomi',
      defaultValue: 'Nomsiz loyiha',
      onSubmit: async (name) => {
        await createAndOpenNewProject(name);
        AppState.ui.view = 'editor';
        notifyStateChange({ type: 'view-changed' });
      }
    });
  });
}
