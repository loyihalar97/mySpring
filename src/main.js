/* =========================================================================
   src/main.js
   ---------------------------------------------------------------------
   Yagona kirish nuqtasi (Composition Root). Faqat shu fayl:
     1) render()ni subscribeStateChange orqali ulaydi (Sprint R1 markaziy
        qoidasi — boshqa hech qanday modul buni qilmaydi);
     2) notifyStateChange event turiga qarab autosave/asset-cleanup/toast
        orkestratsiyasini bajaradi (avval core/commands.js ichida to'g'ridan-
        to'g'ri bajarilardi);
     3) barcha ui/*.js init() funksiyalarini chaqiradi;
     4) bootstrap ketma-ketligini ishga tushiradi (State Hydration).
   ========================================================================= */

import { AppState, subscribeStateChange } from './core/state.js';
import { dispatch, dispatchBootstrap, ASSET_CLEANUP_TRIGGERS } from './core/commands.js';
import { getActiveSlide } from './core/state.js';
import { render } from './rendering/renderer.js';
import { ProjectStorage, reloadProject, scheduleAutosave } from './storage/project-storage.js';
import { scheduleAssetCleanup } from './storage/asset-cache.js';
import { toast } from './ui/toast.js';
import { initToolbar } from './ui/toolbar.js';
import { initKeyboardShortcuts } from './ui/keyboard-shortcuts.js';

/* ---------- Markazlashtirilgan holat-o'zgarishi obunachisi ----------
   Bu — Sprint R1'ning eng muhim arxitektura qarorining amalga oshirilishi:
   hech qanday boshqa modul render()ni to'g'ridan-to'g'ri chaqirmaydi
   (bir nechta hujjatlashtirilgan "ui->rendering" chaqiruvlaridan tashqari,
   ular ham faqat notifyStateChange ishlatadi). Shu yerda barcha "state
   o'zgargandan keyin nima qilish kerak" mantig'i markazlashgan. */
subscribeStateChange((event) => {
  render();

  if (event.type === 'command') {
    scheduleAutosave();
    if (ASSET_CLEANUP_TRIGGERS.has(event.command.type)) {
      scheduleAssetCleanup();
    }
  } else if (event.type === 'undo' || event.type === 'redo') {
    scheduleAutosave();
  } else if (event.type === 'rejected') {
    toast('Command rad etildi: ' + event.error);
  } else if (event.type === 'bootstrap') {
    scheduleAssetCleanup(); // yangi loyiha — avvalgi loyihaning barcha asset'lari endi yetim
  }
});

/* ---------- UI qatlamini ishga tushirish ---------- */
initToolbar();
initKeyboardShortcuts();

/* =========================================================================
   BOOTSTRAP — ilova ishga tushganda avval saqlangan loyihani tiklashga
   harakat qiladi (State Hydration), topilmasa — yangi demo loyiha
   yaratadi.
   ========================================================================= */
(async function bootstrap() {
  render(); // storage banner va bo'sh holatni darhol ko'rsatish uchun

  try {
    const existing = await ProjectStorage.get('current');
    if (existing) {
      await reloadProject();
      return;
    }
  } catch (_) { /* saqlangan loyiha yo'q — yangisini yaratamiz */ }

  dispatchBootstrap({ type: 'CREATE_PROJECT', payload: { name: 'Mening birinchi kursim' } });
  const slide = getActiveSlide();
  dispatch({ type: 'ADD_TEXT_ELEMENT', payload: { slideId: slide.id, x: 300, y: 220 } });
})();
