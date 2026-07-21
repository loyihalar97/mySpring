/* =========================================================================
   runtime/quiz-runtime.js
   ---------------------------------------------------------------------
   Bular Object Model'ga HECH QACHON tegmaydi — faqat AppState.runtime'ni
   o'zgartiradi va notifyStateChange()ni chaqiradi. Kelajakdagi haqiqiy
   Runtime Player Trigger/Interaction Execution'ining soddalashtirilgan
   namunasi.
   ========================================================================= */

import { AppState, notifyStateChange } from '../core/state.js';
import { isQuizReadyForPreview } from '../core/validation.js';
import { toast } from '../ui/toast.js';

export function getQuizRuntimeState(elementId) {
  if (!AppState.runtime.quizzes[elementId]) {
    AppState.runtime.quizzes[elementId] = { selectedAnswerIds: [], submitted: false };
  }
  return AppState.runtime.quizzes[elementId];
}

export function toggleQuizAnswerSelection(el, answerId) {
  const rt = getQuizRuntimeState(el.id);
  if (rt.submitted) return;
  if (el.questionType === 'single') {
    rt.selectedAnswerIds = [answerId];
  } else {
    const idx = rt.selectedAnswerIds.indexOf(answerId);
    rt.selectedAnswerIds = idx === -1
      ? [...rt.selectedAnswerIds, answerId]
      : rt.selectedAnswerIds.filter(id => id !== answerId);
  }
  notifyStateChange({ type: 'quiz-selection' });
}

export function submitQuizAnswer(el) {
  const rt = getQuizRuntimeState(el.id);
  if (rt.submitted) return;

  // Preview-blocking (Tier-3) tekshiruvi — ikkinchi himoya qatlami
  // (defense in depth); odatda bu yerga yetib kelmaydi, chunki
  // Preview'ga kirishning o'zi allaqachon bloklangan bo'ladi.
  if (!isQuizReadyForPreview(el)) {
    toast("\u26a0 Bu savol tuzilishi noto'g'ri \u2014 Submit qilib bo'lmaydi.");
    return;
  }

  // Runtime himoyasi: faqat haqiqatda mavjud answerId'lar hisobga olinadi.
  const validIds = new Set(el.answers.map(a => a.id));
  rt.selectedAnswerIds = rt.selectedAnswerIds.filter(id => validIds.has(id));

  rt.submitted = true;
  notifyStateChange({ type: 'quiz-submitted', elementId: el.id });
}
