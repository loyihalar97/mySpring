/* =========================================================================
   runtime/scoring.js
   ---------------------------------------------------------------------
   Scoring — Derived State (hech qachon saqlanmaydi). Har chaqiruvda
   Object Model + Runtime State'dan qayta hisoblanadi.
   ========================================================================= */

import { AppState } from '../core/state.js';
import { getCompletionSettings } from '../core/object-model.js';

export function computeQuizResult(el, runtimeEntry) {
  if (!runtimeEntry) return null;
  const correctIds = new Set(el.answers.filter(a => a.correct).map(a => a.id));
  const selectedIds = new Set(runtimeEntry.selectedAnswerIds);
  if (correctIds.size !== selectedIds.size) return { isCorrect: false };
  for (const id of correctIds) if (!selectedIds.has(id)) return { isCorrect: false };
  return { isCorrect: true };
}

export function computePreviewScore(project) {
  let total = 0, correct = 0;
  project.slides.forEach(slide => slide.elements.forEach(el => {
    if (el.type !== 'quiz') return;
    const rt = AppState.runtime.quizzes[el.id];
    if (!rt || !rt.submitted) return;
    total++;
    const result = computeQuizResult(el, rt);
    if (result && result.isCorrect) correct++;
  }));
  return { correct, total };
}

/* =========================================================================
   COURSE-LEVEL RESULT — Pure Derived Function (Sprint 4.1 tuzatish)
   "Completion" va "Assessment" — ikkita mustaqil tushuncha. Kursda umuman
   Quiz elementi bo'lmasa, baholashning o'zi yo'q — soxta ball/Pass-Fail
   HECH QACHON o'ylab topilmaydi (fabricate qilinmaydi).
   ========================================================================= */
export function computeCourseResult(project) {
  const allQuizzes = [];
  project.slides.forEach(slide => slide.elements.forEach(el => {
    if (el.type === 'quiz') allQuizzes.push(el);
  }));
  const totalQuizCount = allQuizzes.length;

  let submittedQuizCount = 0;
  let correctQuizCount = 0;
  allQuizzes.forEach(q => {
    const rt = AppState.runtime.quizzes[q.id];
    if (rt && rt.submitted) {
      submittedQuizCount++;
      const r = computeQuizResult(q, rt);
      if (r && r.isCorrect) correctQuizCount++;
    }
  });

  const settings = getCompletionSettings(project);

  let completed = AppState.runtime.courseCompleted;
  if (settings.requireAllQuizzesSubmitted && totalQuizCount > 0 && submittedQuizCount < totalQuizCount) {
    completed = false;
  }

  if (totalQuizCount === 0) {
    return {
      assessmentAvailable: false,
      scorePercent: null,
      passingScore: null,
      passed: null,
      failed: null,
      completed,
      status: completed ? 'completed' : 'incomplete',
      submittedQuizCount: 0,
      totalQuizCount: 0,
      correctQuizCount: 0,
    };
  }

  const scorePercent = Math.round((correctQuizCount / totalQuizCount) * 100);
  const passed = completed && scorePercent >= settings.passingScore;
  const failed = completed && scorePercent < settings.passingScore;
  const status = passed ? 'passed' : (failed ? 'failed' : 'incomplete');

  return {
    assessmentAvailable: true,
    scorePercent,
    passingScore: settings.passingScore,
    passed,
    failed,
    completed,
    status,
    submittedQuizCount,
    totalQuizCount,
    correctQuizCount,
  };
}
