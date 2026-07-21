/* =========================================================================
   rendering/fallback-renderer.js
   ---------------------------------------------------------------------
   P0-1: Fallback Rendering. Bog'liqliksiz — faqat berilgan (yoki buzilgan)
   element obyektidan xavfsiz DOM tuguni yasaydi.
   ========================================================================= */

export function renderFallbackElement(el) {
  const wrap = document.createElement('div');
  wrap.className = 'el el-fallback';
  const safeId = (el && el.id) || 'unknown';
  wrap.dataset.type = (el && el.type) || 'unknown';
  wrap.dataset.id = safeId;
  wrap.style.left = ((el && el.x) || 0) + 'px';
  wrap.style.top = ((el && el.y) || 0) + 'px';
  wrap.style.width = ((el && el.width) || 120) + 'px';
  wrap.style.height = ((el && el.height) || 60) + 'px';
  wrap.innerHTML = `<div class="fallback-inner">\u26a0 Render xatosi<br><span class="mono">${(el && el.type) || '?'} \u00b7 ${safeId.slice(0, 8)}</span></div>`;
  return wrap;
}
