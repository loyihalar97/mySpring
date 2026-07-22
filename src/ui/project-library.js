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
import * as local from '../storage/local-project-store.js';
import * as cloud from '../storage/supabase-adapter.js';
import { isCloudAvailable } from '../storage/auth.js';
import { AssetStorage } from '../storage/asset-storage.js';
import { showModal, showConfirmModal, escapeHtmlText } from './modals.js';
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

  document.getElementById('btn-import-local-to-cloud').addEventListener('click', async () => {
    if (!isCloudAvailable()) { toast("Avval Cloud'ga kiring"); return; }
    const candidates = await getLocalProjectsNotYetMigrated();
    if (candidates.length === 0) {
      toast("Bulutga yuklash uchun yangi lokal loyiha yo'q");
      return;
    }
    showImportModal(candidates);
  });
}

/* ---------- "Lokal loyihalarni bulutga yuklash" oqimi (talab #5/#13) ---------- */

async function getLocalProjectsNotYetMigrated() {
  const list = await local.listProjects();
  const result = [];
  for (const entry of list) {
    const marker = await local.ProjectStorage.get('cloudMigrated:' + entry.id);
    if (marker !== 'true') result.push(entry);
  }
  return result;
}

function showImportModal(candidates) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const itemsHtml = candidates.map(p => `
    <label style="display:flex; align-items:center; gap:8px; padding:6px 0; font-size:12.5px;">
      <input type="checkbox" class="import-check" value="${p.id}" checked />
      <span>${escapeHtmlText(p.name)}</span>
    </label>
  `).join('');
  modal.innerHTML = `
    <h3>Lokal loyihalarni bulutga yuklash</h3>
    <div style="max-height:240px; overflow-y:auto; margin-bottom:14px;">${itemsHtml}</div>
    <div class="row">
      <button id="modal-cancel">Bekor qilish</button>
      <button id="modal-ok" class="primary">Yuklash</button>
    </div>
  `;
  backdrop.classList.add('open');
  document.getElementById('modal-cancel').onclick = () => backdrop.classList.remove('open');
  document.getElementById('modal-ok').onclick = async () => {
    const checked = Array.from(document.querySelectorAll('.import-check:checked')).map(el => el.value);
    backdrop.classList.remove('open');
    if (checked.length > 0) await importProjectsToCloud(checked);
  };
}

function collectAssetIds(project) {
  const ids = [];
  project.slides.forEach(slide => slide.elements.forEach(el => {
    if (el.type === 'image' && el.assetId) ids.push(el.assetId);
  }));
  return ids;
}

function extractMimeType(dataUrl) {
  const m = /^data:([^;]+);/.exec(dataUrl);
  return m ? m[1] : 'image/png';
}

async function importProjectsToCloud(projectIds) {
  let successCount = 0;
  for (const id of projectIds) {
    try {
      const project = await local.getProject(id);
      if (!project) continue;

      // ID va schemaVersion SAQLANADI — cloud.saveProject expectedRevision=null
      // bilan chaqiriladi (bu ID hali bulutda yo'q, shuning uchun INSERT bo'ladi).
      const result = await cloud.saveProject(project, null);
      if (!result.success) {
        console.error('[Import] Cloud saqlashda muvaffaqiyatsiz', id);
        continue;
      }

      // Asset'larni yuklash
      const assetIds = collectAssetIds(project);
      for (const assetId of assetIds) {
        try {
          const dataUrl = await AssetStorage.get(assetId);
          if (dataUrl) {
            await cloud.uploadAsset(project.id, assetId, dataUrl, extractMimeType(dataUrl));
          }
        } catch (assetErr) {
          console.error('[Import] Asset yuklashda xato', assetId, assetErr);
        }
      }

      // Ikki marta yuklanmasligi uchun belgilash.
      await local.ProjectStorage.set('cloudMigrated:' + id, 'true');
      successCount++;
    } catch (err) {
      console.error('[Import] Loyihani yuklashda xato', id, err);
    }
  }
  toast(`${successCount} ta loyiha bulutga yuklandi \u2713`);
  renderLibraryView();
}
