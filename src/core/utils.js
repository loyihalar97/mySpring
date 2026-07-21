/* =========================================================================
   core/utils.js
   Bog'liqliksiz, umumiy sof funksiyalar. Hech qanday boshqa modulga
   bog'liq emas — Sprint R1 aylanma-bog'liqlik siyosatining "leaf" modul
   namunasi.
   ========================================================================= */

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
