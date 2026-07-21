/* =========================================================================
   core/state.js
   ---------------------------------------------------------------------
   Uch turdagi holat qat'iy ajratilgan:
   - Object Model State  (Command Layer orqaligina yoziladi)
   - UI/Local Editor State (Editor Framework boshqaradi, Object Model'ga
     tegmaydi)
   - History/Runtime State — boshqa fayllarda (core/history.js,
     runtime/runtime-state.js), lekin AppState singleton'i shu yerda
     e'lon qilinadi (barcha sub-daraxtlar bitta joyda).

   SPRINT R1 — MARKAZIY ARXITEKTURA QARORI (aylanma bog'liqlikni yechish):
   Monolitda `dispatch()`, `undo()`, quiz-runtime va boshqa juda ko'p joy
   mutatsiyadan keyin to'g'ridan-to'g'ri `render()`ni chaqirar edi. Modulga
   bo'linganda bu `core/commands.js` <-> `rendering/renderer.js` kabi
   ko'plab aylanma importlarga olib kelardi.

   Yechim: shu yerda minimal pub-sub. `notifyStateChange(event)` — istalgan
   modul chaqira oladi (hech qanday rendering import qilmasdan).
   `subscribeStateChange(fn)` — FAQAT src/main.js chaqiradi, `render()`ni
   ulash uchun. Boshqa hech bir modul `render()`ni to'g'ridan-to'g'ri
   import qilmaydi (ui/*.js'dagi ba'zi "leaf" holatlar bundan mustasno —
   ular hujjatlashtirilgan).
   ========================================================================= */

export const AppState = {
  objectModel: { project: null },          // == Object Model State ==
  ui: {                                     // == UI / Local Editor State ==
    activeSlideId: null,
    selectedElementIds: new Set(),          // ko'p-tanlov (Shift+Click)
    mode: 'edit',                           // 'edit' | 'preview'
    clipboard: [],                          // Copy/Paste — ephemeral, hech qachon persistlanmaydi
    draggingSlideId: null,                  // slaydni sudrab tartiblash uchun vaqtinchalik holat
    editingQuizElementId: null,             // qaysi Quiz element to'liq tahrirlash rejimida
  },
  // == Runtime State (Sprint 3-4) == — to'liq shakli runtime/runtime-state.js'da
  // hujjatlashtirilgan; bu yerda faqat boshlang'ich qiymat.
  runtime: {
    quizzes: {},
    currentSlideIndex: 0,
    courseCompleted: false,
  },
  history: { stack: [], pointer: -1 },      // == History / Undo-Redo == (core/history.js boshqaradi)
  commandLog: [],                           // Audit
};

// ---- Pub-Sub: aylanma bog'liqlikni yechish uchun yagona mexanizm ----
const stateChangeListeners = [];

export function subscribeStateChange(fn) {
  stateChangeListeners.push(fn);
}

export function notifyStateChange(event = {}) {
  stateChangeListeners.forEach(fn => fn(event));
}

// ---- Authoring selector: Editor'ning "joriy tanlangan slayd"i ----
export function getActiveSlide() {
  const p = AppState.objectModel.project;
  if (!p) return null;
  return p.slides.find(s => s.id === AppState.ui.activeSlideId) || p.slides[0];
}

// ---- Selection helpers (faqat UI State'ga tegadi, Object Model'ga hech qachon) ----
export function selectOnly(id) {
  AppState.ui.selectedElementIds = new Set([id]);
  if (AppState.ui.editingQuizElementId && AppState.ui.editingQuizElementId !== id) {
    AppState.ui.editingQuizElementId = null;
  }
}

export function toggleSelect(id) {
  const s = new Set(AppState.ui.selectedElementIds);
  if (s.has(id)) s.delete(id); else s.add(id);
  AppState.ui.selectedElementIds = s;
  AppState.ui.editingQuizElementId = null; // ko'p-tanlov paytida tahrirlash rejimidan chiqish
}

export function clearSelection() {
  AppState.ui.selectedElementIds = new Set();
  AppState.ui.editingQuizElementId = null;
}
