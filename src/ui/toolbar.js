/* =========================================================================
   ui/toolbar.js
   ---------------------------------------------------------------------
   Barcha asosiy toolbar tugmalarining wiring'i. initToolbar() main.js
   tomonidan bir marta chaqiriladi. Bu — "ui" qatlamining tepasi, shuning
   uchun rendering/renderer.js'ni (render) to'g'ridan-to'g'ri import qilishi
   xavfsiz — hech kim toolbar.js'ni qaytadan import qilmaydi.
   ========================================================================= */

import { AppState, getActiveSlide, clearSelection } from '../core/state.js';
import { dispatch, dispatchBootstrap } from '../core/commands.js';
import { undo, redo } from '../core/history.js';
import { uuid } from '../core/object-model.js';
import { validateQuizForPreview } from '../core/validation.js';
import { resetRuntimeState } from '../runtime/runtime-state.js';
import { goToPreviousSlide, goToNextSlide, exitLearnerMode } from '../runtime/course-player.js';
import { saveProject, reloadProject } from '../storage/project-storage.js';
import { AssetStorage } from '../storage/asset-storage.js';
import { cacheAsset } from '../storage/asset-cache.js';
import { toast } from './toast.js';
import { showModal, showCourseSettingsModal, showPreviewBlockedModal } from './modals.js';
import { deleteSelection, duplicateSelection, copySelection, pasteClipboard } from './selection.js';
import { render } from '../rendering/renderer.js';

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function initToolbar() {
  document.getElementById('btn-new-project').addEventListener('click', () => {
    showModal({
      title: 'Yangi loyiha yaratish',
      placeholder: 'Loyiha nomi',
      defaultValue: 'Nomsiz loyiha',
      onSubmit: (name) => {
        AppState.objectModel.project = null;
        dispatchBootstrap({ type: 'CREATE_PROJECT', payload: { name } });
      }
    });
  });

  document.getElementById('btn-save').addEventListener('click', saveProject);
  document.getElementById('btn-reload').addEventListener('click', reloadProject);
  document.getElementById('btn-course-settings').addEventListener('click', showCourseSettingsModal);

  document.getElementById('btn-new-slide').addEventListener('click', () => {
    dispatch({ type: 'CREATE_SLIDE' });
  });

  document.getElementById('btn-add-text').addEventListener('click', () => {
    const slide = getActiveSlide();
    if (!slide) return;
    dispatch({ type: 'ADD_TEXT_ELEMENT', payload: { slideId: slide.id, x: 340, y: 240 } });
  });

  document.getElementById('btn-add-image').addEventListener('click', () => {
    const slide = getActiveSlide();
    if (!slide) return;
    document.getElementById('file-image-input').click();
  });

  document.getElementById('file-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const slide = getActiveSlide();
    if (!slide) return;

    if (file.size > 3 * 1024 * 1024) {
      toast('\u26a0 Rasm 3MB dan katta \u2014 brauzer xotirasiga saqlanmasligi mumkin');
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      const assetId = uuid();
      await AssetStorage.set(assetId, dataUrl);
      await cacheAsset(assetId, dataUrl);
      dispatch({ type: 'ADD_IMAGE_ELEMENT', payload: { slideId: slide.id, x: 300, y: 180, assetId } });
    } catch (err) {
      console.error(err);
      toast("Rasmni o'qishda xato yuz berdi");
    }
  });

  // ---- Shakl dropdown ----
  document.getElementById('shape-menu').innerHTML = `
    <button data-shape="rectangle">\u25ad To'g'ri burchakli</button>
    <button data-shape="roundedRectangle">\u25a2 Yumaloq burchakli</button>
    <button data-shape="circle">\u25cf Doira</button>
    <button data-shape="line">\u2014 Chiziq</button>
  `;
  document.getElementById('btn-add-shape').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('shape-menu').classList.toggle('open');
  });
  document.getElementById('shape-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    const slide = getActiveSlide();
    if (!slide) return;
    dispatch({ type: 'ADD_SHAPE_ELEMENT', payload: { slideId: slide.id, shapeType: btn.dataset.shape, x: 360, y: 220 } });
    document.getElementById('shape-menu').classList.remove('open');
  });

  // ---- Quiz dropdown ----
  document.getElementById('quiz-menu').innerHTML = `
    <button data-qtype="single">\u25c9 Single Choice</button>
    <button data-qtype="multiple">\u2611 Multiple Choice</button>
  `;
  document.getElementById('btn-add-quiz').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('quiz-menu').classList.toggle('open');
  });
  document.getElementById('quiz-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qtype]');
    if (!btn) return;
    const slide = getActiveSlide();
    if (!slide) return;
    dispatch({ type: 'ADD_QUIZ_ELEMENT', payload: { slideId: slide.id, x: 300, y: 140, questionType: btn.dataset.qtype } });
    document.getElementById('quiz-menu').classList.remove('open');
  });

  document.addEventListener('click', () => {
    document.getElementById('shape-menu').classList.remove('open');
    document.getElementById('quiz-menu').classList.remove('open');
  });

  document.getElementById('btn-delete').addEventListener('click', deleteSelection);
  document.getElementById('btn-duplicate').addEventListener('click', duplicateSelection);
  document.getElementById('btn-copy').addEventListener('click', copySelection);
  document.getElementById('btn-paste').addEventListener('click', pasteClipboard);

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  document.getElementById('mode-edit').addEventListener('click', exitLearnerMode);
  document.getElementById('mode-preview').addEventListener('click', () => {
    // Preview endi butun kursni (barcha slaydlarni) ketma-ket ko'rsatadi
    // (Course Player), shuning uchun bloklovchi tekshiruv ham LOYIHADAGI
    // BARCHA slaydlardagi Quiz elementlarida o'tkaziladi.
    const project = AppState.objectModel.project;
    if (project) {
      const blockingIssues = [];
      project.slides.forEach((slide, slideIdx) => {
        slide.elements.forEach(el => {
          if (el.type !== 'quiz') return;
          const errors = validateQuizForPreview(el);
          if (errors.length > 0) {
            blockingIssues.push({ questionText: `${slideIdx + 1}-slayd \u2014 ${el.questionText || '(savolsiz)'}`, errors });
          }
        });
      });
      if (blockingIssues.length > 0) {
        showPreviewBlockedModal(blockingIssues);
        return;
      }
    }
    AppState.ui.mode = 'preview'; clearSelection(); resetRuntimeState(); render();
  });

  document.getElementById('learner-prev').addEventListener('click', goToPreviousSlide);
  document.getElementById('learner-next').addEventListener('click', goToNextSlide);
  document.getElementById('learner-exit').addEventListener('click', exitLearnerMode);
}
