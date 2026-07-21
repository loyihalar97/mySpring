/* =========================================================================
   rendering/element-renderers.js
   ---------------------------------------------------------------------
   P0-1: Fallback Rendering / Error Boundary. renderElementContent — tashqi
   qatlam; renderElementContentUnsafe xato tashlashi mumkin, lekin xato
   HECH QACHON Object Model'ga yozilmaydi.

   Sprint R1: asinxron rasm yuklangandan keyingi qayta-render zarurati
   `notifyStateChange()` orqali e'lon qilinadi (bu modul
   rendering/renderer.js'ni import QILMAYDI — aylanma bog'liqlikning
   oldini olish uchun).
   ========================================================================= */

import { AppState, notifyStateChange } from '../core/state.js';
import { resolveThemeColor } from '../core/object-model.js';
import { AssetCache, touchAssetCache, ensureAssetLoaded } from '../storage/asset-cache.js';
import { renderQuizAuthoringBody, renderQuizRuntimeBody } from './quiz-renderer.js';
import { renderFallbackElement } from './fallback-renderer.js';

export function renderShapeSVG(el) {
  const project = AppState.objectModel.project;
  const w = el.width, h = el.height;
  const fill = resolveThemeColor(el, 'fill', project);
  const stroke = resolveThemeColor(el, 'stroke', project);
  if (el.shapeType === 'rectangle') {
    return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect x="1.5" y="1.5" width="${w-3}" height="${h-3}" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
  }
  if (el.shapeType === 'roundedRectangle') {
    return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect x="1.5" y="1.5" width="${w-3}" height="${h-3}" rx="14" ry="14" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
  }
  if (el.shapeType === 'circle') {
    return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><ellipse cx="${w/2}" cy="${h/2}" rx="${w/2-2}" ry="${h/2-2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
  }
  if (el.shapeType === 'line') {
    return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="2" y1="${h/2}" x2="${w-2}" y2="${h/2}" stroke="${stroke}" stroke-width="${Math.max(3, h - 2)}" stroke-linecap="round"/></svg>`;
  }
  return '';
}

export function renderElementContent(el, isPreview) {
  try {
    return renderElementContentUnsafe(el, isPreview);
  } catch (err) {
    console.error('[Rendering Engine] Element render xatosi', { id: el && el.id, type: el && el.type, error: err });
    return renderFallbackElement(el);
  }
}

function renderElementContentUnsafe(el, isPreview) {
  const wrap = document.createElement('div');
  wrap.className = 'el';
  wrap.dataset.type = el.type;
  wrap.dataset.id = el.id;
  wrap.style.left = el.x + 'px';
  wrap.style.top = el.y + 'px';
  wrap.style.width = el.width + 'px';
  wrap.style.height = el.height + 'px';

  if (el.type === 'text') {
    wrap.textContent = el.text;
  } else if (el.type === 'shape') {
    wrap.innerHTML = renderShapeSVG(el);
  } else if (el.type === 'quiz') {
    // ADR-03: Preview = Runtime + Draft — Preview rejimida HAR DOIM
    // interaktiv Runtime tanasi ishlatiladi.
    const body = isPreview ? renderQuizRuntimeBody(el) : renderQuizAuthoringBody(el);
    wrap.appendChild(body);
  } else if (el.type === 'image') {
    if (el.assetId) {
      const cached = AssetCache.get(el.assetId);
      if (cached) {
        touchAssetCache(el.assetId);
        const img = document.createElement('img');
        img.src = cached.objectUrl;
        wrap.appendChild(img);
      } else {
        wrap.innerHTML = '<div class="img-broken">Yuklanmoqda\u2026</div>';
        ensureAssetLoaded(el.assetId).then(url => { if (url) notifyStateChange({ type: 'asset-render' }); });
      }
    } else if (el.src) {
      const img = document.createElement('img');
      img.src = el.src;
      img.onerror = () => { wrap.innerHTML = '<div class="img-broken">Rasm yuklanmadi</div>'; };
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = '<div class="img-broken">Rasm mavjud emas</div>';
    }
  } else {
    // Noma'lum element turi — bilib turib xato tashlanadi.
    throw new Error(`Noma'lum element turi: "${el.type}"`);
  }
  return wrap;
}
