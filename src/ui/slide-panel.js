/* =========================================================================
   ui/slide-panel.js
   ---------------------------------------------------------------------
   Chap paneldagi slayd ro'yxati: tanlash, nusxalash, o'chirish, drag-and-
   drop orqali tartiblash. Bu modul rendering/renderer.js'ni IMPORT
   QILMAYDI — render() zarurati notifyStateChange() orqali e'lon qilinadi
   (Sprint R1 markaziy qoidasi). Shu tufayli rendering/renderer.js bu
   modulni (renderSlideList) xavfsiz import qila oladi, aylanma bog'liqlik
   yuzaga kelmaydi.
   ========================================================================= */

import { AppState, clearSelection, notifyStateChange } from '../core/state.js';
import { dispatch } from '../core/commands.js';

export function renderSlideList() {
  const container = document.getElementById('slide-list');
  container.innerHTML = '';
  const project = AppState.objectModel.project;
  if (!project) return;
  // Preview rejimida chap panel butunlay yashirin (Learner Mode unga
  // bog'liq emas) — shuning uchun bu yerda ishlashning hojati yo'q.
  if (AppState.ui.mode === 'preview') return;
  const isEdit = AppState.ui.mode === 'edit';

  project.slides.forEach((slide, i) => {
    const div = document.createElement('div');
    div.className = 'slide-thumb' + (slide.id === AppState.ui.activeSlideId ? ' active' : '');
    div.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="slide-thumb-inner"></div>
      <div class="thumb-actions">
        <button class="thumb-btn" data-action="duplicate" title="Slaydni nusxalash">\u29c9</button>
        <button class="thumb-btn" data-action="delete" title="Slaydni o'chirish" ${project.slides.length <= 1 ? 'disabled' : ''}>\ud83d\uddd1</button>
      </div>
    `;
    const inner = div.querySelector('.slide-thumb-inner');
    slide.elements.forEach(el => {
      const mini = document.createElement('div');
      mini.className = 'mini-el';
      mini.style.left = (el.x / 960 * 100) + '%';
      mini.style.top = (el.y / 540 * 100) + '%';
      mini.style.width = Math.max(4, el.width / 960 * 100) + '%';
      mini.style.height = Math.max(4, el.height / 540 * 100) + '%';
      inner.appendChild(mini);
    });

    div.addEventListener('click', () => {
      AppState.ui.activeSlideId = slide.id;
      clearSelection();
      notifyStateChange({ type: 'slide-selected' });
    });

    div.querySelector('[data-action="duplicate"]').addEventListener('click', (e) => {
      e.stopPropagation();
      dispatch({ type: 'DUPLICATE_SLIDE', payload: { slideId: slide.id } });
    });
    div.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = AppState.ui.activeSlideId === slide.id;
      dispatch({ type: 'DELETE_SLIDE', payload: { slideId: slide.id } });
      if (wasActive) {
        const proj = AppState.objectModel.project;
        if (proj && proj.slides.length > 0) {
          AppState.ui.activeSlideId = proj.slides[0].id;
          clearSelection();
          notifyStateChange({ type: 'slide-deleted' });
        }
      }
    });

    // ---- Slaydlarni sudrab tartiblash (Reorder via drag-and-drop) ----
    if (isEdit) {
      div.draggable = true;
      div.addEventListener('dragstart', (e) => {
        AppState.ui.draggingSlideId = slide.id;
        e.dataTransfer.effectAllowed = 'move';
      });
      div.addEventListener('dragover', (e) => {
        e.preventDefault();
        div.classList.add('drag-over');
      });
      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        div.classList.remove('drag-over');
        const draggedId = AppState.ui.draggingSlideId;
        AppState.ui.draggingSlideId = null;
        if (!draggedId || draggedId === slide.id) return;
        const ids = project.slides.map(s => s.id);
        const fromIdx = ids.indexOf(draggedId);
        const toIdx = ids.indexOf(slide.id);
        if (fromIdx === -1 || toIdx === -1) return;
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, draggedId);
        dispatch({ type: 'REORDER_SLIDES', payload: { orderedSlideIds: ids } });
      });
    }

    container.appendChild(div);
  });
}
