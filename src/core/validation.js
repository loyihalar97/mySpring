/* =========================================================================
   core/validation.js
   ---------------------------------------------------------------------
   Uch bosqichli validatsiya tizimi (Sprint 4.1 tuzatish #2). Bu qatlam
   Command Handler'lardan MUSTAQIL va boshqa hech qanday modulga
   (state/rendering/runtime) bog'liq emas — faqat Object Model shaklini
   (oddiy JS obyektlarni) tekshiradi.

   1) STRUCTURAL — har bir Command'dan keyin MAJBURIY.
   2) AUTHORING WARNINGS — Draft hali "tugallanmagan", lekin tahrirlash
      davom etishi kerak (Command rad etilmaydi).
   3) PREVIEW/PUBLISH BLOCKING — faqat Preview'ga kirishdan OLDIN.
   ========================================================================= */

// ---- 1) STRUCTURAL (har bir Command'dan keyin) ----
export function validateQuizStructural(el) {
  const errors = [];
  if (!el || el.type !== 'quiz') return errors;
  if (typeof el.questionText !== 'string') errors.push("questionText maydoni yo'q");
  if (!Array.isArray(el.answers)) errors.push("answers maydoni yo'q");
  if (!el.feedback || typeof el.feedback.correctText !== 'string' || typeof el.feedback.incorrectText !== 'string') {
    errors.push("feedback maydoni to'liq emas");
  }
  if (Array.isArray(el.answers)) {
    const ids = el.answers.map(a => a.id);
    if (new Set(ids).size !== ids.length) errors.push("Javob ID'lari takrorlanmoqda");
    const correctCount = el.answers.filter(a => a.correct).length;
    if (el.questionType === 'single' && correctCount > 1) {
      errors.push("Single Choice birdan ortiq to'g'ri javobga ega bo'la olmaydi");
    }
  }
  return errors;
}

// ---- 2) AUTHORING WARNINGS (Draft hali tahrirlanadigan holatda) ----
export function getQuizAuthoringWarnings(el) {
  const warnings = [];
  if (!el || el.type !== 'quiz') return warnings;
  if (el.answers.length < 2) warnings.push("Kamida 2 ta javob varianti kerak bo'ladi");
  const correctCount = el.answers.filter(a => a.correct).length;
  if (correctCount === 0) {
    warnings.push(el.questionType === 'single'
      ? "Hali to'g'ri javob tanlanmagan (Single Choice)"
      : "Hali to'g'ri javob belgilanmagan (Multiple Choice)");
  }
  return warnings;
}

// ---- 3) PREVIEW/PUBLISH BLOCKING (faqat kirishdan oldin) ----
export function validateQuizForPreview(el) {
  const errors = [];
  if (!el || el.type !== 'quiz') return errors;
  if (el.answers.length < 2) errors.push('Kamida 2 ta javob varianti kerak');
  if (!el.questionText || !el.questionText.trim()) errors.push("Savol matni bo'sh bo'lishi mumkin emas");
  el.answers.forEach((a, i) => {
    if (!a.text || !a.text.trim()) errors.push(`${i + 1}-javob matni bo'sh`);
  });
  const ids = el.answers.map(a => a.id);
  if (new Set(ids).size !== ids.length) errors.push("Javob ID'lari takrorlanmoqda");
  const correctCount = el.answers.filter(a => a.correct).length;
  if (el.questionType === 'single' && correctCount !== 1) {
    errors.push("Single Choice uchun aynan bitta to'g'ri javob kerak");
  }
  if (el.questionType === 'multiple' && correctCount < 1) {
    errors.push("Multiple Choice uchun kamida bitta to'g'ri javob kerak");
  }
  return errors;
}

export function isQuizReadyForPreview(el) {
  return validateQuizForPreview(el).length === 0;
}

// Qaysi Command turlari quiz strukturaviy yaxlitligiga ta'sir qilishi
// mumkin — shundagina Tier-1 post-simulation tekshiruvi ishga tushadi.
export const QUIZ_MUTATING_COMMANDS = new Set([
  'ADD_QUIZ_ANSWER', 'REMOVE_QUIZ_ANSWER', 'REORDER_QUIZ_ANSWERS',
  'SET_QUIZ_ANSWER_TEXT', 'SET_QUIZ_ANSWER_CORRECT',
  'SET_QUIZ_QUESTION_TEXT', 'SET_QUIZ_CORRECT_FEEDBACK', 'SET_QUIZ_INCORRECT_FEEDBACK',
]);

// Post-simulation (dry-run) tekshiruvi — FAQAT Tier-1 (Structural).
export function validatePostState(project, command) {
  if (!QUIZ_MUTATING_COMMANDS.has(command.type)) return null;
  const { slideId, elementId } = command.payload || {};
  const slide = project.slides.find(s => s.id === slideId);
  const el = slide && slide.elements.find(e => e.id === elementId);
  if (!el || el.type !== 'quiz') return null;
  const errors = validateQuizStructural(el);
  return errors.length > 0 ? errors[0] : null;
}
