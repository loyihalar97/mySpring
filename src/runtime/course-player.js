/* =========================================================================
   runtime/course-player.js
   ---------------------------------------------------------------------
   Learner navigatsiyasi (Previous/Next/Restart/Exit). Bular Object
   Model'ga hech qachon tegmaydi — faqat Runtime/UI State'ni o'zgartiradi
   va notifyStateChange() orqali e'lon qiladi.
   ========================================================================= */

import { AppState, notifyStateChange, clearSelection } from '../core/state.js';
import { getCompletionSettings } from '../core/object-model.js';
import { getRenderSlide, resetRuntimeState } from './runtime-state.js';
import { toast } from '../ui/toast.js';

export function isCurrentLearnerSlideReady() {
  const project = AppState.objectModel.project;
  const settings = getCompletionSettings(project);
  if (!settings.requireAllQuizzesSubmitted) return true;
  const slide = getRenderSlide();
  if (!slide) return true;
  const quizzes = slide.elements.filter(e => e.type === 'quiz');
  if (quizzes.length === 0) return true;
  return quizzes.every(q => {
    const rt = AppState.runtime.quizzes[q.id];
    return rt && rt.submitted;
  });
}

// Butun kurs bo'yicha (faqat joriy slayd emas) — himoya qatlami.
export function findFirstUnsubmittedRequiredQuiz(project) {
  const settings = getCompletionSettings(project);
  if (!settings.requireAllQuizzesSubmitted) return null;
  for (let i = 0; i < project.slides.length; i++) {
    const slide = project.slides[i];
    for (const el of slide.elements) {
      if (el.type !== 'quiz') continue;
      const rt = AppState.runtime.quizzes[el.id];
      if (!rt || !rt.submitted) {
        return { slideIndex: i, questionText: el.questionText };
      }
    }
  }
  return null;
}

export function goToNextSlide() {
  const project = AppState.objectModel.project;
  if (!project || AppState.runtime.courseCompleted) return;
  if (!isCurrentLearnerSlideReady()) return;
  const isLast = AppState.runtime.currentSlideIndex >= project.slides.length - 1;
  if (isLast) {
    const incomplete = findFirstUnsubmittedRequiredQuiz(project);
    if (incomplete) {
      toast(`\u26a0 ${incomplete.slideIndex + 1}-slayddagi savolga hali javob berilmagan \u2014 kursni yakunlab bo'lmaydi.`);
      return;
    }
    AppState.runtime.courseCompleted = true;
  } else {
    AppState.runtime.currentSlideIndex += 1;
  }
  notifyStateChange({ type: 'navigate' });
}

export function goToPreviousSlide() {
  if (AppState.runtime.courseCompleted || AppState.runtime.currentSlideIndex === 0) return;
  AppState.runtime.currentSlideIndex -= 1;
  notifyStateChange({ type: 'navigate' });
}

// Restart — faqat Runtime State'ni tozalaydi. Course result — Derived
// State bo'lgani uchun alohida "tozalash" talab qilmaydi. Object Model
// (completionSettings ham) BUTUNLAY tegilmaydi.
export function restartCourse() {
  resetRuntimeState();
  notifyStateChange({ type: 'restart' });
}

export function computeCourseCompletionPercentage(project) {
  if (!project || project.slides.length === 0) return 0;
  if (AppState.runtime.courseCompleted) return 100;
  return Math.round(((AppState.runtime.currentSlideIndex + 1) / project.slides.length) * 100);
}

export function exitLearnerMode() {
  AppState.ui.mode = 'edit';
  clearSelection();
  notifyStateChange({ type: 'exit-learner-mode' });
}
