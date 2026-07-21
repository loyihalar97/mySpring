/* =========================================================================
   ui/keyboard-shortcuts.js
   ---------------------------------------------------------------------
   Global klaviatura tezkor tugmalari. initKeyboardShortcuts() main.js
   tomonidan bir marta chaqiriladi.
   ========================================================================= */

import { AppState } from '../core/state.js';
import { undo, redo } from '../core/history.js';
import { copySelection, pasteClipboard, duplicateSelection, deleteSelection } from './selection.js';
import { goToNextSlide, goToPreviousSlide } from '../runtime/course-player.js';

export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isEditingText = (active && active.isContentEditable) || (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
    if (isEditingText) return; // native matn tahrirlashiga xalaqit bermaslik

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }

    if (AppState.ui.mode === 'preview') {
      if (e.key === 'ArrowRight') { e.preventDefault(); goToNextSlide(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPreviousSlide(); }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  });
}
