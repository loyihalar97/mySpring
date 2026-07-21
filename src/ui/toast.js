/* =========================================================================
   ui/toast.js
   ---------------------------------------------------------------------
   Bog'liqliksiz, sof DOM-yozuvchi funksiya. core/commands.js kabi "core"
   modullar buni to'g'ridan-to'g'ri import qilishi mumkin, chunki bu
   modulning o'zi HECH NARSAGA bog'liq emas — aylanma bog'liqlik xavfi yo'q.
   ========================================================================= */

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
