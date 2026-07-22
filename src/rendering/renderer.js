/* =========================================================================
   rendering/renderer.js
   ---------------------------------------------------------------------
   Rendering Contract'ning soddalashtirilgan, bitta-texnologiyali (DOM)
   amalga oshirilishi. render() — YAGONA joy butun ilovada bo'lib, boshqa
   modullar buni to'g'ridan-to'g'ri chaqirmaydi (faqat main.js uni
   subscribeStateChange orqali ulaydi).

   Diqqat (hujjatlashtirilgan, ataylab qilingan layering "inversiyasi"):
   bu modul ui/selection.js (clearSelection) va ui/slide-panel.js
   (renderSlideList)ni import qiladi — ular esa render()ni HECH QACHON
   import qilmaydi (faqat notifyStateChange), shuning uchun aylanma
   bog'liqlik yo'q, garchi "rendering -> ui" yo'nalishi odatiy "ui yuqorida"
   intuitsiyasini teskari qilsa ham.
   ========================================================================= */

import { AppState, clearSelection, selectOnly, toggleSelect } from '../core/state.js';
import { dispatch } from '../core/commands.js';
import { renderElementContent } from './element-renderers.js';
import { renderFallbackElement } from './fallback-renderer.js';
import { enterQuizEditMode } from './quiz-renderer.js';
import { recordRenderTiming } from './render-diagnostics.js';
import { renderSlideList } from '../ui/slide-panel.js';
import { computePreviewScore, computeCourseResult } from '../runtime/scoring.js';
import {
  isCurrentLearnerSlideReady, computeCourseCompletionPercentage,
  restartCourse, exitLearnerMode,
} from '../runtime/course-player.js';
import { getRenderSlide } from '../runtime/runtime-state.js';
import { ProjectStorage } from '../storage/project-storage.js';
import { clamp } from '../core/utils.js';
import { renderLibraryView } from '../ui/project-library.js';
import { renderAuthPanel } from '../ui/auth-panel.js';

/* ---------- P0-1: Global Rendering Error Boundary ---------- */
export function render() {
  try {
    renderAuthPanel(); // Sprint R1.2: har ikkala ekranda (Library/Editor) ham ko'rinadi

    // Sprint R1.1: yuqori darajadagi ekran tanlovi — 'library' | 'editor'.
    // renderLibraryView() asinxron (o'z DOM yangilanishini mustaqil
    // boshqaradi); bu yerda faqat ko'rinuvchanlik almashtiriladi.
    const isLibrary = AppState.ui.view === 'library';
    document.getElementById('app').style.display = isLibrary ? 'none' : 'flex';
    document.getElementById('library-view').style.display = isLibrary ? 'flex' : 'none';

    if (isLibrary) {
      renderLibraryView();
      return;
    }

    renderStorageBanner();
    renderTopbarState();
    renderLearnerMode();

    const t0 = performance.now();
    renderSlideList();
    const t1 = performance.now();
    renderStage();
    const t2 = performance.now();

    renderCommandLog();
    recordRenderTiming({ slideList: t1 - t0, stage: t2 - t1 });
    hideGlobalRenderError();
  } catch (err) {
    console.error('[Rendering Engine] Global render xatosi', err);
    showGlobalRenderError();
  }
}

/* ---------- Learner Mode UI (Sprint 4) ---------- */
export function renderLearnerMode() {
  const inPreview = AppState.ui.mode === 'preview';
  document.getElementById('left-panel').style.display = inPreview ? 'none' : 'flex';
  document.getElementById('right-panel').style.display = inPreview ? 'none' : 'flex';
  document.getElementById('learner-nav').classList.toggle('show', inPreview);

  if (!inPreview) return;

  const project = AppState.objectModel.project;
  if (!project) return;

  const total = project.slides.length;
  const idx = AppState.runtime.currentSlideIndex;
  const isLast = idx >= total - 1;
  const completed = AppState.runtime.courseCompleted;

  document.getElementById('learner-counter').textContent = completed ? `${total} / ${total}` : `${idx + 1} / ${total}`;
  document.getElementById('learner-progress-fill').style.width = computeCourseCompletionPercentage(project) + '%';

  document.getElementById('learner-prev').disabled = completed || idx === 0;

  const nextBtn = document.getElementById('learner-next');
  const slideReady = isCurrentLearnerSlideReady();
  nextBtn.disabled = completed || !slideReady;
  nextBtn.textContent = isLast ? "Kursni yakunlash \u2713" : 'Keyingi \u2192';

  const hintEl = document.getElementById('learner-hint');
  if (!completed && !slideReady) {
    hintEl.style.display = 'block';
    hintEl.textContent = "\u26a0 Davom etish uchun ushbu slayddagi savol(lar)ga javob bering va Submit qiling.";
  } else {
    hintEl.style.display = 'none';
  }
}

export function showGlobalRenderError() {
  document.getElementById('render-error-banner').classList.add('show');
}
export function hideGlobalRenderError() {
  document.getElementById('render-error-banner').classList.remove('show');
}

function renderStorageBanner() {
  const banner = document.getElementById('storage-banner');
  banner.classList.toggle('show', !ProjectStorage.isPersistent);
}

function renderTopbarState() {
  const hasProject = !!AppState.objectModel.project;
  const isEdit = AppState.ui.mode === 'edit';
  const selCount = AppState.ui.selectedElementIds.size;

  document.getElementById('btn-save').disabled = !hasProject;
  document.getElementById('btn-course-settings').disabled = !hasProject;
  document.getElementById('btn-new-slide').disabled = !hasProject;
  document.getElementById('btn-add-text').disabled = !hasProject || !isEdit;
  document.getElementById('btn-add-image').disabled = !hasProject || !isEdit;
  document.getElementById('btn-add-shape').disabled = !hasProject || !isEdit;
  document.getElementById('btn-add-quiz').disabled = !hasProject || !isEdit;
  document.getElementById('btn-copy').disabled = !hasProject || !isEdit || selCount === 0;
  document.getElementById('btn-paste').disabled = !hasProject || !isEdit || AppState.ui.clipboard.length === 0;
  document.getElementById('btn-duplicate').disabled = !hasProject || !isEdit || selCount !== 1;
  document.getElementById('btn-delete').disabled = !hasProject || !isEdit || selCount === 0;
  document.getElementById('btn-undo').disabled = AppState.history.pointer <= 0;
  document.getElementById('btn-redo').disabled = AppState.history.pointer >= AppState.history.stack.length - 1;

  document.getElementById('mode-edit').classList.toggle('active', isEdit);
  document.getElementById('mode-preview').classList.toggle('active', !isEdit);

  document.getElementById('stage-label').textContent = hasProject
    ? `${AppState.objectModel.project.name} \u00b7 schema v${AppState.objectModel.project.schemaVersion}`
    : 'Loyiha ochilmagan';

  const scoreEl = document.getElementById('preview-score');
  if (hasProject && !isEdit) {
    const { correct, total } = computePreviewScore(AppState.objectModel.project);
    scoreEl.style.display = total > 0 ? 'inline' : 'none';
    scoreEl.textContent = `Ball: ${correct}/${total}`;
  } else {
    scoreEl.style.display = 'none';
  }
}

/* ---------- Course End Screen (Sprint 4 / 4.1) ---------- */
function renderCourseEndScreen(project) {
  const wrap = document.createElement('div');
  const result = computeCourseResult(project);

  wrap.className = 'course-end-screen ' + (result.passed ? 'passed' : (result.failed ? 'failed' : ''));

  const h2 = document.createElement('h2');
  h2.textContent = result.passed ? '\ud83c\udf89 Kurs yakunlandi!' : (result.failed ? '\ud83d\udccb Kurs yakunlandi' : '\u2714 Kurs yakunlandi');
  wrap.appendChild(h2);

  if (!result.assessmentAvailable) {
    const assessmentEl = document.createElement('div');
    assessmentEl.className = 'course-end-meta';
    assessmentEl.textContent = 'Baholash: kiritilmagan';
    wrap.appendChild(assessmentEl);

    const resultEl = document.createElement('div');
    resultEl.className = 'course-end-score';
    resultEl.style.color = '#6b7280';
    resultEl.textContent = 'Natija: Yakunlandi';
    wrap.appendChild(resultEl);
  } else {
    if (result.passed || result.failed) {
      const badge = document.createElement('div');
      badge.className = 'course-end-result-badge ' + (result.passed ? 'passed' : 'failed');
      badge.textContent = result.passed ? "O'tdi \u2713" : "O'tmadi \u2715";
      wrap.appendChild(badge);
    }

    const scoreEl = document.createElement('div');
    scoreEl.className = 'course-end-score';
    scoreEl.textContent = `Yakuniy ball: ${result.scorePercent}%  \u00b7  O'tish balli: ${result.passingScore}%`;
    wrap.appendChild(scoreEl);

    const submittedEl = document.createElement('div');
    submittedEl.className = 'course-end-meta';
    submittedEl.textContent = `Javob berilgan savollar: ${result.submittedQuizCount} / ${result.totalQuizCount}`;
    wrap.appendChild(submittedEl);
  }

  const completionEl = document.createElement('div');
  completionEl.className = 'course-end-meta';
  completionEl.textContent = `Kursni tugatish darajasi: ${computeCourseCompletionPercentage(project)}%`;
  wrap.appendChild(completionEl);

  const actions = document.createElement('div');
  actions.className = 'course-end-actions';

  const restartBtn = document.createElement('button');
  restartBtn.className = 'primary';
  restartBtn.textContent = "\u21ba Kursni qayta boshlash";
  restartBtn.addEventListener('click', restartCourse);
  actions.appendChild(restartBtn);

  const exitBtn = document.createElement('button');
  exitBtn.textContent = "\u2715 Learner Mode'dan chiqish";
  exitBtn.addEventListener('click', exitLearnerMode);
  actions.appendChild(exitBtn);

  wrap.appendChild(actions);
  return wrap;
}

function renderCommandLog() {
  const container = document.getElementById('cmd-log');
  container.innerHTML = '';
  AppState.commandLog.slice(-60).forEach(entry => {
    const div = document.createElement('div');
    div.className = 'cmd-entry';
    div.innerHTML = `<span class="type ${entry.undone ? 'undone' : ''}">${entry.type}</span>` +
      (entry.error ? ' <span style="color:var(--danger)">\u2715 rad etildi</span>' : '') +
      `<span class="ts">${entry.ts}</span>`;
    container.appendChild(div);
  });
}

function renderStage() {
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  stage.classList.toggle('preview-mode', AppState.ui.mode === 'preview');

  const project = AppState.objectModel.project;
  if (!project) return;

  const isPreview = AppState.ui.mode === 'preview';

  if (isPreview && AppState.runtime.courseCompleted) {
    stage.appendChild(renderCourseEndScreen(project));
    return;
  }

  if (!AppState.ui.activeSlideId) AppState.ui.activeSlideId = project.slides[0].id;
  const slide = getRenderSlide();
  if (!slide) return;

  // P1-8: deterministik stacking-tartib.
  const sortedElements = [...slide.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  sortedElements.forEach(el => {
    try {
      const node = renderElementContent(el, isPreview);
      if (!isPreview) {
        node.addEventListener('mousedown', (e) => startDrag(e, slide.id, el));
        if (el.type === 'text') {
          node.addEventListener('dblclick', (e) => enterTextEditMode(e, slide.id, el, node));
        }
        if (el.type === 'quiz') {
          node.addEventListener('dblclick', (e) => enterQuizEditMode(e, el));
        }
      }
      stage.appendChild(node);
    } catch (err) {
      console.error('[Rendering Engine] Element pass xatosi', { id: el && el.id, error: err });
      stage.appendChild(renderFallbackElement(el));
    }
  });

  if (!isPreview) {
    AppState.ui.selectedElementIds.forEach(id => {
      const el = slide.elements.find(e => e.id === id);
      if (!el) return;
      const overlay = document.createElement('div');
      overlay.className = 'overlay-box';
      overlay.dataset.id = el.id;
      overlay.style.left = el.x + 'px';
      overlay.style.top = el.y + 'px';
      overlay.style.width = el.width + 'px';
      overlay.style.height = el.height + 'px';
      if (AppState.ui.selectedElementIds.size === 1) {
        const handle = document.createElement('div');
        handle.className = 'handle';
        handle.style.pointerEvents = 'all';
        handle.addEventListener('mousedown', (e) => startResize(e, slide.id, el));
        overlay.appendChild(handle);
      }
      stage.appendChild(overlay);
    });

    stage.addEventListener('mousedown', (e) => {
      if (e.target === stage) {
        clearSelection();
        render();
      }
    }, { once: true });
  }
}

/* ---------- Drag to move ---------- */
function startDrag(e, slideId, el) {
  if (AppState.ui.mode === 'preview') return;
  e.stopPropagation();

  if (e.shiftKey) {
    toggleSelect(el.id);
    render();
    return;
  }

  if (!AppState.ui.selectedElementIds.has(el.id)) {
    selectOnly(el.id);
    render();
  }

  const slide = AppState.objectModel.project.slides.find(s => s.id === slideId);
  const selectedIds = Array.from(AppState.ui.selectedElementIds);
  const origins = {};
  selectedIds.forEach(id => {
    const e2 = slide.elements.find(x => x.id === id);
    if (e2) origins[id] = { x: e2.x, y: e2.y, width: e2.width, height: e2.height };
  });

  const startX = e.clientX, startY = e.clientY;
  let moved = false;

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    selectedIds.forEach(id => {
      const o = origins[id];
      if (!o) return;
      const nx = clamp(o.x + dx, 0, 960 - o.width);
      const ny = clamp(o.y + dy, 0, 540 - o.height);
      const node = document.querySelector(`.el[data-id="${id}"]`);
      const overlay = document.querySelector(`.overlay-box[data-id="${id}"]`);
      if (node) { node.style.left = nx + 'px'; node.style.top = ny + 'px'; }
      if (overlay) { overlay.style.left = nx + 'px'; overlay.style.top = ny + 'px'; }
    });
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    const moves = selectedIds.filter(id => origins[id]).map(id => {
      const o = origins[id];
      return {
        elementId: id,
        x: clamp(o.x + dx, 0, 960 - o.width),
        y: clamp(o.y + dy, 0, 540 - o.height)
      };
    });
    if (moves.length === 1) {
      dispatch({ type: 'MOVE_ELEMENT', payload: { slideId, elementId: moves[0].elementId, x: moves[0].x, y: moves[0].y } });
    } else {
      dispatch({ type: 'MOVE_ELEMENTS', payload: { slideId, moves } });
    }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(e, slideId, el) {
  e.stopPropagation(); e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const originW = el.width, originH = el.height;

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    const node = document.querySelector(`.el[data-id="${el.id}"]`);
    const overlay = document.querySelector(`.overlay-box[data-id="${el.id}"]`);
    const w = Math.max(24, originW + dx), h = Math.max(24, originH + dy);
    if (node) { node.style.width = w + 'px'; node.style.height = h + 'px'; }
    if (overlay) { overlay.style.width = w + 'px'; overlay.style.height = h + 'px'; }
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    dispatch({
      type: 'RESIZE_ELEMENT',
      payload: { slideId, elementId: el.id, width: Math.max(24, originW + dx), height: Math.max(24, originH + dy) }
    });
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function selectAllTextIn(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function enterTextEditMode(e, slideId, el, node) {
  e.stopPropagation();
  node.contentEditable = 'true';
  node.focus();
  selectAllTextIn(node);

  node.addEventListener('blur', function onBlur() {
    node.removeEventListener('blur', onBlur);
    node.contentEditable = 'false';
    const newText = node.textContent.trim() || 'Matn';
    if (newText !== el.text) {
      dispatch({ type: 'SET_TEXT', payload: { slideId, elementId: el.id, text: newText } });
    }
  }, { once: true });
}
