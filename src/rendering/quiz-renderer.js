/* =========================================================================
   rendering/quiz-renderer.js
   ---------------------------------------------------------------------
   Ikkita mustaqil "tana": Authoring (Editor, muallif tahrirlaydi) va
   Runtime (Preview, Learner interaktiv ishlaydi). ADR-03: Editor Renderer
   va Runtime Renderer alohida implementatsiya bo'lishi mumkin.
   ========================================================================= */

import { AppState, selectOnly, notifyStateChange, getActiveSlide } from '../core/state.js';
import { dispatch } from '../core/commands.js';
import { getQuizAuthoringWarnings, isQuizReadyForPreview, validateQuizForPreview } from '../core/validation.js';
import { getQuizRuntimeState, toggleQuizAnswerSelection, submitQuizAnswer } from '../runtime/quiz-runtime.js';
import { computeQuizResult } from '../runtime/scoring.js';

export function reorderQuizAnswer(el, fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= el.answers.length) return;
  const ids = el.answers.map(a => a.id);
  const [moved] = ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, moved);
  dispatch({ type: 'REORDER_QUIZ_ANSWERS', payload: { slideId: getActiveSlide().id, elementId: el.id, orderedAnswerIds: ids } });
}

export function enterQuizEditMode(e, el) {
  e.stopPropagation();
  selectOnly(el.id);
  AppState.ui.editingQuizElementId = el.id;
  notifyStateChange({ type: 'quiz-edit-mode' });
}

export function renderQuizAuthoringBody(el) {
  const container = document.createElement('div');
  container.style.cssText = 'width:100%; height:100%; display:flex; flex-direction:column;';
  const isEditing = AppState.ui.editingQuizElementId === el.id;

  if (!isEditing) {
    const q = document.createElement('div');
    q.className = 'quiz-question';
    q.textContent = el.questionText;
    container.appendChild(q);

    const list = document.createElement('div');
    list.className = 'quiz-answers';
    el.answers.forEach(a => {
      const row = document.createElement('div');
      row.className = 'quiz-answer-row' + (a.correct ? ' correct-marker' : '');
      const marker = document.createElement('span');
      marker.textContent = a.correct ? '\u2713' : '\u25cb';
      const text = document.createElement('span');
      text.textContent = a.text;
      row.appendChild(marker); row.appendChild(text);
      list.appendChild(row);
    });
    container.appendChild(list);

    const hint = document.createElement('div');
    hint.className = 'quiz-hint';
    hint.textContent = 'Tahrirlash uchun ikki marta bosing';
    container.appendChild(hint);

    const errors = getQuizAuthoringWarnings(el);
    if (errors.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'quiz-warning-banner';
      warn.textContent = '\u2139 ' + errors.join(' \u00b7 ');
      container.appendChild(warn);
    }
    return container;
  }

  // ---- To'liq tahrirlash rejimi ----
  container.className = 'quiz-editor';
  container.style.cssText += 'overflow-y:auto;';
  // Editor forma ichidagi mousedown tashqi startDrag'ga yetib bormaydi.
  container.addEventListener('mousedown', (e) => e.stopPropagation());

  const slideId = getActiveSlide().id;

  const qLabel = document.createElement('div');
  qLabel.textContent = 'Savol matni';
  qLabel.style.cssText = 'font-size:10px;color:#6b7280;margin-bottom:3px;';
  container.appendChild(qLabel);

  const qInput = document.createElement('textarea');
  qInput.value = el.questionText;
  qInput.rows = 2;
  qInput.style.cssText = 'width:100%; font-family:inherit; font-size:12.5px; padding:5px 7px; border-radius:6px; border:1px solid #dde3ea; resize:vertical; margin-bottom:8px;';
  qInput.addEventListener('blur', () => {
    const val = qInput.value.trim() || 'Savol';
    if (val !== el.questionText) {
      dispatch({ type: 'SET_QUIZ_QUESTION_TEXT', payload: { slideId, elementId: el.id, text: val } });
    }
  });
  container.appendChild(qInput);

  const answersWrap = document.createElement('div');
  answersWrap.className = 'quiz-answers';
  el.answers.forEach((a, idx) => {
    const row = document.createElement('div');
    row.className = 'quiz-answer-row';

    const correctInput = document.createElement('input');
    correctInput.type = el.questionType === 'single' ? 'radio' : 'checkbox';
    correctInput.name = `quiz-correct-${el.id}`;
    correctInput.checked = a.correct;
    correctInput.addEventListener('change', () => {
      dispatch({ type: 'SET_QUIZ_ANSWER_CORRECT', payload: { slideId, elementId: el.id, answerId: a.id, correct: correctInput.checked } });
    });
    row.appendChild(correctInput);

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = a.text;
    textInput.addEventListener('blur', () => {
      const val = textInput.value.trim() || 'Variant';
      if (val !== a.text) {
        dispatch({ type: 'SET_QUIZ_ANSWER_TEXT', payload: { slideId, elementId: el.id, answerId: a.id, text: val } });
      }
    });
    row.appendChild(textInput);

    const upBtn = document.createElement('button');
    upBtn.textContent = '\u2191'; upBtn.disabled = idx === 0; upBtn.title = 'Tepaga';
    upBtn.addEventListener('click', () => reorderQuizAnswer(el, idx, idx - 1));
    row.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.textContent = '\u2193'; downBtn.disabled = idx === el.answers.length - 1; downBtn.title = 'Pastga';
    downBtn.addEventListener('click', () => reorderQuizAnswer(el, idx, idx + 1));
    row.appendChild(downBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '\u2715';
    removeBtn.title = "O'chirish";
    removeBtn.addEventListener('click', () => {
      dispatch({ type: 'REMOVE_QUIZ_ANSWER', payload: { slideId, elementId: el.id, answerId: a.id } });
    });
    row.appendChild(removeBtn);

    answersWrap.appendChild(row);
  });
  container.appendChild(answersWrap);

  const actions = document.createElement('div');
  actions.className = 'quiz-editor-actions';
  const addBtn = document.createElement('button');
  addBtn.textContent = "+ Javob qo'shish";
  addBtn.addEventListener('click', () => {
    dispatch({ type: 'ADD_QUIZ_ANSWER', payload: { slideId, elementId: el.id } });
  });
  actions.appendChild(addBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Yopish';
  closeBtn.className = 'primary';
  closeBtn.addEventListener('click', () => { AppState.ui.editingQuizElementId = null; notifyStateChange({ type: 'quiz-edit-close' }); });
  actions.appendChild(closeBtn);
  container.appendChild(actions);

  const fbWrap = document.createElement('div');
  fbWrap.className = 'quiz-feedback-fields';

  const correctLabel = document.createElement('label'); correctLabel.textContent = "To'g'ri javob xabari";
  const correctInput2 = document.createElement('input'); correctInput2.type = 'text'; correctInput2.value = el.feedback.correctText;
  correctInput2.addEventListener('blur', () => {
    const val = correctInput2.value.trim() || "To'g'ri!";
    if (val !== el.feedback.correctText) dispatch({ type: 'SET_QUIZ_CORRECT_FEEDBACK', payload: { slideId, elementId: el.id, text: val } });
  });

  const incorrectLabel = document.createElement('label'); incorrectLabel.textContent = "Noto'g'ri javob xabari";
  const incorrectInput2 = document.createElement('input'); incorrectInput2.type = 'text'; incorrectInput2.value = el.feedback.incorrectText;
  incorrectInput2.addEventListener('blur', () => {
    const val = incorrectInput2.value.trim() || "Noto'g'ri!";
    if (val !== el.feedback.incorrectText) dispatch({ type: 'SET_QUIZ_INCORRECT_FEEDBACK', payload: { slideId, elementId: el.id, text: val } });
  });

  fbWrap.appendChild(correctLabel); fbWrap.appendChild(correctInput2);
  fbWrap.appendChild(incorrectLabel); fbWrap.appendChild(incorrectInput2);
  container.appendChild(fbWrap);

  const errors = getQuizAuthoringWarnings(el);
  if (errors.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'quiz-warning-banner';
    warn.textContent = '\u2139 ' + errors.join(' \u00b7 ');
    container.appendChild(warn);
  }

  return container;
}

export function renderQuizRuntimeBody(el) {
  const container = document.createElement('div');
  container.style.cssText = 'width:100%; height:100%; display:flex; flex-direction:column;';

  const q = document.createElement('div');
  q.className = 'quiz-question';
  q.textContent = el.questionText;
  container.appendChild(q);

  // Ikkinchi himoya qatlami (defense in depth).
  if (!isQuizReadyForPreview(el)) {
    const warn = document.createElement('div');
    warn.className = 'quiz-invalid-banner';
    warn.textContent = "\u26a0 Bu savol hozircha to'g'ri sozlanmagan: " + validateQuizForPreview(el).join(' \u00b7 ') + ". Submit qilib bo'lmaydi.";
    container.appendChild(warn);
    return container;
  }

  const rt = getQuizRuntimeState(el.id);
  const list = document.createElement('div');
  list.className = 'quiz-answers';

  el.answers.forEach(a => {
    const row = document.createElement('div');
    const selected = rt.selectedAnswerIds.includes(a.id);
    let cls = 'quiz-runtime-answer';
    if (rt.submitted) {
      cls += ' disabled';
      if (a.correct) cls += ' correct-highlight';
      else if (selected) cls += ' incorrect-highlight';
    } else if (selected) {
      cls += ' selected';
    }
    row.className = cls;

    const marker = document.createElement('span');
    marker.textContent = el.questionType === 'single' ? (selected ? '\u25cf' : '\u25cb') : (selected ? '\u2611' : '\u2610');
    const text = document.createElement('span');
    text.textContent = a.text;
    row.appendChild(marker); row.appendChild(text);

    if (!rt.submitted) {
      row.addEventListener('click', () => toggleQuizAnswerSelection(el, a.id));
    }
    list.appendChild(row);
  });
  container.appendChild(list);

  if (!rt.submitted) {
    const submitBtn = document.createElement('button');
    submitBtn.className = 'quiz-submit-btn primary';
    submitBtn.textContent = 'Submit';
    submitBtn.disabled = rt.selectedAnswerIds.length === 0;
    submitBtn.addEventListener('click', () => submitQuizAnswer(el));
    container.appendChild(submitBtn);
  } else {
    const result = computeQuizResult(el, rt);
    const banner = document.createElement('div');
    banner.className = 'quiz-feedback-banner ' + (result.isCorrect ? 'correct' : 'incorrect');
    banner.textContent = result.isCorrect ? el.feedback.correctText : el.feedback.incorrectText;
    container.appendChild(banner);
  }

  return container;
}
