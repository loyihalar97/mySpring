/* =========================================================================
   ui/modals.js
   ---------------------------------------------------------------------
   Generic modal, Kurs Sozlamalari modali, Preview-blocked xatolar modali.
   ========================================================================= */

import { AppState } from '../core/state.js';
import { dispatch } from '../core/commands.js';
import { getCompletionSettings } from '../core/object-model.js';
import { clamp } from '../core/utils.js';

export function showModal({ title, placeholder, defaultValue = '', onSubmit }) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>${title}</h3>
    <input id="modal-input" type="text" placeholder="${placeholder}" value="${defaultValue}" />
    <div class="row">
      <button id="modal-cancel">Bekor qilish</button>
      <button id="modal-ok" class="primary">Tasdiqlash</button>
    </div>
  `;
  backdrop.classList.add('open');
  const input = document.getElementById('modal-input');
  input.focus(); input.select();

  function close() { backdrop.classList.remove('open'); }
  document.getElementById('modal-cancel').onclick = close;
  document.getElementById('modal-ok').onclick = () => {
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    close();
    onSubmit(val);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-ok').click();
    if (e.key === 'Escape') close();
  });
}

// Sprint 4.1: minimal Kurs Sozlamalari modali. Barcha o'zgarishlar
// Command Layer orqali — shuning uchun Undo/Redo, Save/Reload va Schema
// Migration bilan avtomatik moslashadi.
export function showCourseSettingsModal() {
  const project = AppState.objectModel.project;
  if (!project) return;
  const settings = getCompletionSettings(project);

  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Kurs sozlamalari</h3>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px;">O'tish balli (%)</label>
      <input id="settings-passing-score" type="number" min="0" max="100" step="1" value="${settings.passingScore}" />
    </div>
    <div style="margin-bottom:16px; display:flex; align-items:center; gap:8px;">
      <input id="settings-require-all" type="checkbox" ${settings.requireAllQuizzesSubmitted ? 'checked' : ''} />
      <label for="settings-require-all" style="font-size:12px;">Barcha savollarga javob berish majburiy (Preview'ni yakunlash uchun)</label>
    </div>
    <div class="row">
      <button id="modal-cancel">Bekor qilish</button>
      <button id="modal-ok" class="primary">Saqlash</button>
    </div>
  `;
  backdrop.classList.add('open');

  document.getElementById('modal-cancel').onclick = () => backdrop.classList.remove('open');
  document.getElementById('modal-ok').onclick = () => {
    const scoreInput = document.getElementById('settings-passing-score');
    const requireInput = document.getElementById('settings-require-all');
    const newScore = clamp(Math.round(Number(scoreInput.value) || 0), 0, 100);
    const newRequire = requireInput.checked;

    if (newScore !== settings.passingScore) {
      dispatch({ type: 'SET_COURSE_PASSING_SCORE', payload: { passingScore: newScore } });
    }
    if (newRequire !== settings.requireAllQuizzesSubmitted) {
      dispatch({ type: 'SET_REQUIRE_ALL_QUIZZES_SUBMITTED', payload: { required: newRequire } });
    }
    backdrop.classList.remove('open');
  };
}

export function escapeHtmlText(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

export function showConfirmModal({ title, message, confirmLabel = 'Tasdiqlash', onConfirm }) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>${escapeHtmlText(title)}</h3>
    <p style="font-size:12.5px; color:var(--text-dim); margin: 0 0 16px 0; line-height:1.5;">${escapeHtmlText(message)}</p>
    <div class="row">
      <button id="modal-cancel">Bekor qilish</button>
      <button id="modal-ok" class="primary" style="background:var(--danger); border-color:var(--danger); color:#fff;">${escapeHtmlText(confirmLabel)}</button>
    </div>
  `;
  backdrop.classList.add('open');
  document.getElementById('modal-cancel').onclick = () => backdrop.classList.remove('open');
  document.getElementById('modal-ok').onclick = () => {
    backdrop.classList.remove('open');
    onConfirm();
  };
}

export function showPreviewBlockedModal(issues) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const itemsHtml = issues.map(issue => {
    const errs = issue.errors.map(e => `<li>${escapeHtmlText(e)}</li>`).join('');
    return `<div style="margin-bottom:10px;"><b style="font-size:12px;">${escapeHtmlText(issue.questionText)}</b>
      <ul style="margin:4px 0 0 16px; padding:0; font-size:11.5px; color:var(--danger);">${errs}</ul></div>`;
  }).join('');
  modal.innerHTML = `
    <h3>\u26a0 Preview'ga o'tib bo'lmaydi</h3>
    <div style="max-height:280px; overflow-y:auto; margin-bottom:14px;">${itemsHtml}</div>
    <div class="row"><button id="modal-ok" class="primary">Tushunarli</button></div>
  `;
  backdrop.classList.add('open');
  document.getElementById('modal-ok').onclick = () => backdrop.classList.remove('open');
}
