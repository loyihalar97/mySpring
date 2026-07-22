/* =========================================================================
   src/config/supabase.config.example.js
   ---------------------------------------------------------------------
   NAMUNA fayl — git repozitoriyga QO'SHILADI.

   Sozlash uchun:
     cp src/config/supabase.config.example.js src/config/supabase.config.js
   va quyidagi ikkita qiymatni Supabase Dashboard > Project Settings > API
   dan to'ldiring.

   XAVFSIZLIK — MUHIM:
   - SUPABASE_URL va SUPABASE_ANON_KEY — OMMAVIY (public) qiymatlar.
     Ular brauzer kodida ko'rinishi XAVFSIZ, chunki haqiqiy ruxsat
     RLS (Row Level Security) orqali server tomonida ta'minlanadi.
   - "service_role" kaliti (Supabase Dashboard'da alohida ko'rsatiladi)
     HECH QACHON bu faylga yoki boshqa har qanday frontend kodiga
     qo'yilmasin — u RLS'ni butunlay chetlab o'tadi.
   ========================================================================= */

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-PUBLIC-ANON-KEY';
