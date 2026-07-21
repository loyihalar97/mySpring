/* =========================================================================
   rendering/render-diagnostics.js
   ---------------------------------------------------------------------
   Deferred until profiling proves it necessary: to'liq dirty-node partial
   rendering yoki slide virtualization amalga oshirilmagan. Buning o'rniga
   qachon kerak bo'lishini aniqlash uchun o'lchov va chegara.
   ========================================================================= */

import { AppState } from '../core/state.js';

export const PARTIAL_RENDER_THRESHOLD_MS = 16;
export const VIRTUALIZATION_SLIDE_COUNT_THRESHOLD = 30;
export const RenderTiming = { stageMs: 0, slideListMs: 0 };

export function recordRenderTiming({ slideList, stage }) {
  RenderTiming.slideListMs = slideList;
  RenderTiming.stageMs = stage;
  const el = document.getElementById('render-timing');
  if (!el) return;
  const overBudget = stage > PARTIAL_RENDER_THRESHOLD_MS;
  const slideCount = (AppState.objectModel.project && AppState.objectModel.project.slides.length) || 0;
  el.textContent = `render: stage ${stage.toFixed(1)}ms \u00b7 slides ${slideList.toFixed(1)}ms \u00b7 n=${slideCount}`;
  el.style.color = overBudget ? 'var(--danger)' : 'var(--text-dim)';
  if (overBudget) {
    console.warn(`[Render Timing] Stage render ${stage.toFixed(1)}ms \u2014 ${PARTIAL_RENDER_THRESHOLD_MS}ms byudjetidan oshdi. Partial Rendering ko'rib chiqilishi kerak.`);
  }
  if (slideCount >= VIRTUALIZATION_SLIDE_COUNT_THRESHOLD) {
    console.warn(`[Render Timing] ${slideCount} ta slayd \u2014 virtualization chegarasiga yetdi (${VIRTUALIZATION_SLIDE_COUNT_THRESHOLD}).`);
  }
}
