/* =========================================================================
   ui/selection.js
   ---------------------------------------------------------------------
   Tanlovga asoslangan UI harakatlari: Copy/Paste/Duplicate/Delete. Pastki
   darajadagi selectOnly/toggleSelect/clearSelection — core/state.js'da
   (chunki ular AppState.ui'ning bevosita, elementar mutatorlari).
   ========================================================================= */

import { AppState, clearSelection, notifyStateChange } from '../core/state.js';
import { getActiveSlide } from '../core/state.js';
import { dispatch } from '../core/commands.js';
import { toast } from './toast.js';

export function deleteSelection() {
  const slide = getActiveSlide();
  if (!slide) return;
  const ids = Array.from(AppState.ui.selectedElementIds);
  if (ids.length === 0) return;
  if (ids.length === 1) {
    dispatch({ type: 'DELETE_ELEMENT', payload: { slideId: slide.id, elementId: ids[0] } });
  } else {
    dispatch({ type: 'DELETE_ELEMENTS', payload: { slideId: slide.id, elementIds: ids } });
  }
  clearSelection();
  notifyStateChange({ type: 'selection-changed' });
}

export function duplicateSelection() {
  const slide = getActiveSlide();
  if (!slide) return;
  const ids = Array.from(AppState.ui.selectedElementIds);
  if (ids.length !== 1) { toast("Duplicate \u2014 faqat bitta element uchun (ko'p element uchun Copy+Paste ishlating)"); return; }
  dispatch({ type: 'DUPLICATE_ELEMENT', payload: { slideId: slide.id, elementId: ids[0] } });
}

export function copySelection() {
  const slide = getActiveSlide();
  if (!slide) return;
  const ids = Array.from(AppState.ui.selectedElementIds);
  if (ids.length === 0) return;
  // Clipboard — UI-local, ephemeral holat; Object Model'ga hech qanday aloqasi yo'q.
  AppState.ui.clipboard = ids.map(id => slide.elements.find(el => el.id === id)).filter(Boolean).map(el => ({ ...el }));
  toast(`${ids.length} ta element nusxalandi`);
}

export function pasteClipboard() {
  const slide = getActiveSlide();
  if (!slide || AppState.ui.clipboard.length === 0) return;
  dispatch({ type: 'PASTE_ELEMENTS', payload: { slideId: slide.id, elements: AppState.ui.clipboard } });
}
