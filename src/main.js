/* =========================================================================
   src/main.js
   ---------------------------------------------------------------------
   Yagona kirish nuqtasi (Composition Root). Faqat shu fayl:
     1) render()ni subscribeStateChange orqali ulaydi;
     2) notifyStateChange event turiga qarab autosave/asset-cleanup/toast
        orkestratsiyasini bajaradi;
     3) barcha ui/*.js init() funksiyalarini chaqiradi;
     4) Storage Backend'ni ishga tushiradi (async), legacy migratsiyani
        bir marta bajaradi, Project Library'ni ko'rsatadi (Sprint R1.1:
        demo loyiha AVTOMATIK yaratilmaydi).
   ========================================================================= */

import { subscribeStateChange } from './core/state.js';
import { ASSET_CLEANUP_TRIGGERS } from './core/commands.js';
import { render } from './rendering/renderer.js';
import { initStorageBackend } from './storage/storage-adapter.js';
import { initAuth } from './storage/auth.js';
import { trySyncQueue } from './storage/sync-engine.js';
import {
  scheduleAutosave, migrateLegacyCurrentProject, scheduleGlobalAssetCleanup,
} from './storage/project-storage.js';
import { toast } from './ui/toast.js';
import { initToolbar } from './ui/toolbar.js';
import { initKeyboardShortcuts } from './ui/keyboard-shortcuts.js';
import { initProjectLibrary } from './ui/project-library.js';

/* ---------- Markazlashtirilgan holat-o'zgarishi obunachisi ---------- */
subscribeStateChange((event) => {
  render();

  if (event.type === 'command') {
    scheduleAutosave();
    if (ASSET_CLEANUP_TRIGGERS.has(event.command.type)) {
      scheduleGlobalAssetCleanup();
    }
  } else if (event.type === 'undo' || event.type === 'redo') {
    scheduleAutosave();
  } else if (event.type === 'rejected') {
    toast('Command rad etildi: ' + event.error);
  } else if (event.type === 'project-created') {
    scheduleGlobalAssetCleanup(); // yangi loyiha ochilganda ham foydali (bo'sh, lekin arzon)
  } else if (event.type === 'auth-changed' && event.user) {
    trySyncQueue(); // login qilindi — navbatdagi oflayn o'zgarishlarni yuborishga urinish
  }
});

/* ---------- UI qatlamini ishga tushirish ---------- */
initToolbar();
initKeyboardShortcuts();
initProjectLibrary();

/* =========================================================================
   BOOTSTRAP — Sprint R1.2
   1) Storage Backend'ni ishga tushirish (MAJBURIY birinchi).
   2) Supabase Auth sessiyasini tiklash (mavjud bo'lsa).
   3) Bir martalik legacy migratsiya (eski bitta-loyihali model bo'lsa).
   4) Project Library'ni ko'rsatish — demo loyiha AVTOMATIK yaratilmaydi.
   ========================================================================= */
(async function bootstrap() {
  await initStorageBackend();

  try {
    await initAuth();
  } catch (err) {
    console.error('[Bootstrap] Auth ishga tushirishda xato', err);
  }

  try {
    const result = await migrateLegacyCurrentProject();
    if (result.migrated) {
      toast('Avvalgi loyihangiz Kutubxonaga ko\u2018chirildi');
    }
  } catch (err) {
    console.error('[Bootstrap] Legacy migratsiya xatosi', err);
  }

  render(); // AppState.ui.view standart holatda 'library' — Kutubxona ko'rsatiladi
})();
