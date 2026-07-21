/* =========================================================================
   runtime/runtime-state.js
   ---------------------------------------------------------------------
   Runtime State (Sprint 3-4) — Authoring State'dan BUTUNLAY ajratilgan,
   faqat JSON-serializable qiymatlar (Set emas!), Preview'ga har kirishda
   to'liq qayta yaratiladi. Hech qachon persistlanmaydi.

   getRenderSlide() — Sprint 4'ning markaziy arxitektura qarori: Preview
   rejimida "joriy slayd" Editor'ning activeSlideId'idan EMAS, balki shu
   Runtime Navigation'dan kelib chiqadi (chap panelga bog'liq emas).
   ========================================================================= */

import { AppState } from '../core/state.js';
import { getActiveSlide } from '../core/state.js';

export function resetRuntimeState() {
  AppState.runtime = { quizzes: {}, currentSlideIndex: 0, courseCompleted: false };
}

export function getRenderSlide() {
  const project = AppState.objectModel.project;
  if (!project) return null;
  if (AppState.ui.mode === 'preview') {
    return project.slides[AppState.runtime.currentSlideIndex] || project.slides[0] || null;
  }
  return getActiveSlide();
}
